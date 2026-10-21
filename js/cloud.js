/**
 * CMCloud — Login + salvataggio online delle mappe con Supabase.
 *
 * Funzionamento:
 *  - Senza login (o se Supabase non è configurato) l'app funziona come prima, solo in locale.
 *  - Dopo il login ogni utente ha la propria cache locale (offline-first) che viene
 *    sincronizzata automaticamente con la tabella `public.maps` di Supabase.
 *  - Al primo login le mappe create da ospite vengono aggiunte all'account
 *    (le mappe di esempio non modificate vengono ignorate).
 *  - Conflitti: vince la versione modificata più di recente (last-write-wins).
 *  - Le eliminazioni sono "soft" (deleted_at) così si propagano a tutti i dispositivi.
 *
 * API pubblica (window.CMCloud) — pensata per l'interfaccia grafica che verrà creata dopo:
 *   await CMCloud.ready()                        -> true se il cloud è attivo
 *   CMCloud.isConfigured() / isLoggedIn() / getUser() / getStatus()
 *   await CMCloud.signUp(email, password, nome) -> { ok, error, needsConfirmation }
 *   await CMCloud.signIn(email, password)       -> { ok, error, user }
 *   await CMCloud.signInWithMagicLink(email)    -> { ok, error }
 *   await CMCloud.signInWithProvider('google')  -> { ok, error }
 *   await CMCloud.sendPasswordReset(email)      -> { ok, error }
 *   await CMCloud.updatePassword(nuovaPassword) -> { ok, error }
 *   await CMCloud.signOut({ force, keepLocalCopy }) -> { ok, error, unsynced }
 *   await CMCloud.getProfile() / updateProfile({ display_name })
 *   await CMCloud.deleteAccount()               -> { ok, error }
 *   await CMCloud.syncNow() / flush()
 *   CMCloud.onAuth(cb) / onSync(cb) / onPasswordRecovery(cb) -> funzione per annullare
 *
 * Eventi sul window:
 *   'cm:auth'              detail: { user, event }
 *   'cm:sync'              detail: { status: 'local'|'syncing'|'synced'|'offline'|'error', message }
 *   'cm:maps-changed'      detail: { reason: 'login'|'logout'|'sync'|'account-deleted' }
 *   'cm:password-recovery' detail: { user }  (l'utente ha aperto il link "reimposta password")
 */
(function () {
  'use strict';

  const { normalizeMap, GUEST_SCOPE } = window.CMStore;

  const TABLE = 'maps';
  const PROFILE_TABLE = 'profiles';
  const PUSH_DELAY_MS = 1500;
  const PERIODIC_SYNC_MS = 60 * 1000;
  const FETCH_CHUNK = 40;

  const state = {
    client: null,
    configured: false,
    user: null,
    store: null,
    status: 'local',
    statusMessage: '',
    readyPromise: null,
    pushTimer: null,
    pushing: false,
    pushQueued: false,
    syncing: false,
    syncQueued: false,
    syncedUserId: null,
    pendingUserId: null,
    clearCacheOnSignOut: false,
    periodicTimer: null
  };

  // ---------------------------------------------------------------------------
  // Utilità
  // ---------------------------------------------------------------------------

  function emit(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (e) {
      console.warn(e);
    }
  }

  function setStatus(status, message = '') {
    state.status = status;
    state.statusMessage = message;
    emit('cm:sync', { status, message });
  }

  function isNetworkError(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    return msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed');
  }

  function translateError(err) {
    if (!err) return '';
    const raw = String(err.message || err.error_description || err || '');
    const msg = raw.toLowerCase();
    if (msg.includes('invalid login credentials')) return 'Email o password non corretti.';
    if (msg.includes('email not confirmed')) return 'Devi prima confermare la tua email: controlla la posta (anche lo spam).';
    if (msg.includes('user already registered') || msg.includes('already been registered')) return 'Esiste già un account con questa email.';
    if (msg.includes('password should be at least') || msg.includes('password is too short')) return 'La password deve avere almeno 6 caratteri.';
    if (msg.includes('weak password') || msg.includes('password is known to be weak')) return 'Password troppo debole: usane una più lunga o complessa.';
    if (msg.includes('should be different from the old password') || msg.includes('same password')) return 'La nuova password deve essere diversa da quella attuale.';
    if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('security purposes')) return 'Troppi tentativi ravvicinati: riprova tra qualche minuto.';
    if (msg.includes('invalid email') || msg.includes('unable to validate email') || msg.includes('email address') && msg.includes('invalid')) return 'Indirizzo email non valido.';
    if (msg.includes('signups not allowed') || msg.includes('signup is disabled')) return 'Le nuove registrazioni sono disattivate.';
    if (msg.includes('jwt') && msg.includes('expired')) return 'Sessione scaduta: effettua di nuovo l\'accesso.';
    if (msg.includes('not authenticated') || msg.includes('auth session missing')) return 'Devi effettuare l\'accesso.';
    if (msg.includes('row-level security') || msg.includes('permission denied')) return 'Permesso negato dal database (controlla le policy RLS).';
    if (msg.includes('maps_data_size')) return 'La mappa è troppo grande per essere salvata online (riduci le immagini).';
    if (isNetworkError(err)) return 'Connessione assente: le modifiche restano salvate sul dispositivo e verranno caricate appena torni online.';
    return raw || 'Si è verificato un errore imprevisto.';
  }

  function fail(err) {
    return { ok: false, error: translateError(err) };
  }

  function redirectUrl() {
    return window.location.origin + window.location.pathname;
  }

  function notConfigured() {
    return { ok: false, error: 'Il salvataggio online non è configurato (mancano URL e chiave di Supabase).' };
  }

  function canSync() {
    return Boolean(
      state.configured &&
        state.client &&
        state.user &&
        state.store &&
        state.store.scope === state.user.id &&
        navigator.onLine !== false
    );
  }

  const LOCAL_CFG_KEY = 'cm_supabase_cfg_v1';

  function getSavedLocalConfig() {
    try {
      const raw = localStorage.getItem(LOCAL_CFG_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.supabaseUrl && parsed.supabaseAnonKey) return parsed;
    } catch {}
    return null;
  }

  async function loadConfig() {
    const local = window.CM_CONFIG || {};
    if (local.supabaseUrl && local.supabaseAnonKey) return local;
    const saved = getSavedLocalConfig();
    if (saved) return saved;
    if (window.location.protocol === 'file:') return null;
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (!res.ok) return null;
      const json = await res.json();
      if (json && json.supabaseUrl && json.supabaseAnonKey) return json;
    } catch {}
    return null;
  }

  // ---------------------------------------------------------------------------
  // Conversione mappa <-> riga del database
  // ---------------------------------------------------------------------------

  function mapToRow(map, userId) {
    return {
      user_id: userId,
      id: map.id,
      title: String(map.title || '').slice(0, 200),
      data: {
        layout: map.layout,
        style: map.style,
        root: map.root,
        links: map.links || []
      },
      updated_at: new Date(map.updatedAt || Date.now()).toISOString(),
      deleted_at: null
    };
  }

  function rowToMap(row) {
    const data = row.data || {};
    return normalizeMap({
      id: row.id,
      title: row.title,
      updatedAt: Date.parse(row.updated_at) || Date.now(),
      layout: data.layout,
      style: data.style,
      root: data.root,
      links: data.links
    });
  }

  // ---------------------------------------------------------------------------
  // Lettura dal database (indice leggero + dati completi solo dove serve)
  // ---------------------------------------------------------------------------

  async function fetchRemoteIndex() {
    const { data, error } = await state.client
      .from(TABLE)
      .select('id,updated_at,deleted_at')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function fetchRemoteFull(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += FETCH_CHUNK) {
      const chunk = ids.slice(i, i + FETCH_CHUNK);
      const { data, error } = await state.client
        .from(TABLE)
        .select('id,title,data,updated_at,deleted_at')
        .in('id', chunk);
      if (error) throw error;
      out.push(...(data || []));
    }
    return out;
  }

  /** Quali mappe remote vanno scaricate per intero (nuove o più recenti della copia locale). */
  function idsToDownload(localMaps, meta, index) {
    const local = new Map(localMaps.map((m) => [m.id, m]));
    const tombs = new Set((meta.deleted || []).map((d) => d.id));
    const need = [];
    for (const r of index) {
      if (r.deleted_at || tombs.has(r.id)) continue;
      const l = local.get(r.id);
      const ru = Date.parse(r.updated_at) || 0;
      if (!l || ru > (l.updatedAt || 0)) need.push(r.id);
    }
    return need;
  }

  /**
   * Unisce le mappe locali con quelle online.
   * Restituisce { maps, meta, changed } — le mappe locali non modificate mantengono lo stesso oggetto.
   */
  function mergeMaps(localMaps, meta, index, fullRows, adopt = []) {
    const result = new Map(localMaps.map((m) => [m.id, m]));
    const dirty = new Set(meta.dirty || []);
    const tombs = new Map((meta.deleted || []).map((d) => [d.id, d]));
    const full = new Map(fullRows.map((r) => [r.id, r]));
    const remoteIds = new Set();
    let changed = false;

    for (const r of index) {
      remoteIds.add(r.id);

      // Eliminata in locale e non ancora propagata: verrà eliminata online da pushPending()
      if (tombs.has(r.id)) {
        if (r.deleted_at) tombs.delete(r.id); // già eliminata anche online
        continue;
      }

      const l = result.get(r.id);
      const ru = Date.parse(r.updated_at) || 0;

      if (r.deleted_at) {
        const da = Date.parse(r.deleted_at) || 0;
        if (l) {
          const editedAfterDeletion = dirty.has(r.id) && (l.updatedAt || 0) > da;
          if (!editedAfterDeletion) {
            result.delete(r.id);
            dirty.delete(r.id);
            changed = true;
          }
        }
        continue;
      }

      if (!l || ru > (l.updatedAt || 0)) {
        const row = full.get(r.id);
        if (row && !row.deleted_at) {
          result.set(r.id, rowToMap(row));
          dirty.delete(r.id);
          changed = true;
        }
      } else if ((l.updatedAt || 0) > ru) {
        dirty.add(r.id);
      }
    }

    // Mappe presenti solo in locale -> da caricare online
    for (const m of result.values()) {
      if (!remoteIds.has(m.id) && !m.sample) dirty.add(m.id);
    }

    // Mappe create da ospite da aggiungere all'account
    for (const g of adopt) {
      if (!result.has(g.id) && !tombs.has(g.id)) {
        result.set(g.id, g);
        dirty.add(g.id);
        changed = true;
      }
    }

    const maps = Array.from(result.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return {
      maps,
      meta: {
        dirty: Array.from(dirty).filter((id) => result.has(id)),
        deleted: Array.from(tombs.values())
      },
      changed
    };
  }

  // ---------------------------------------------------------------------------
  // Scrittura sul database
  // ---------------------------------------------------------------------------

  function schedulePush(delay = PUSH_DELAY_MS) {
    if (!canSync()) return;
    clearTimeout(state.pushTimer);
    state.pushTimer = setTimeout(() => {
      state.pushTimer = null;
      pushPending();
    }, delay);
  }

  async function pushPending() {
    if (!canSync()) return false;
    if (state.pushing) {
      state.pushQueued = true;
      return false;
    }
    const store = state.store;
    const uid = state.user.id;
    if (!store.hasPendingChanges()) {
      setStatus('synced');
      return true;
    }

    state.pushing = true;
    setStatus('syncing');
    let ok = true;
    try {
      // 1. Eliminazioni (soft delete, così si propagano agli altri dispositivi)
      const tombs = [...store.meta.deleted];
      if (tombs.length > 0) {
        const ids = tombs.map((t) => t.id);
        const nowIso = new Date().toISOString();
        const { error } = await state.client
          .from(TABLE)
          .update({ deleted_at: nowIso, updated_at: nowIso })
          .in('id', ids);
        if (error) throw error;
        if (store.scope === uid) store.clearTombstones(ids);
      }

      // 2. Mappe nuove o modificate (una alla volta: le mappe con immagini possono essere grandi)
      const dirtyIds = [...store.meta.dirty];
      for (const id of dirtyIds) {
        if (store.scope !== uid) break;
        const m = store.maps.find((x) => x.id === id);
        if (!m || m.sample) {
          store.clearDirty(id);
          continue;
        }
        const stamp = m.updatedAt;
        const { error } = await state.client
          .from(TABLE)
          .upsert(mapToRow(m, uid), { onConflict: 'user_id,id' });
        if (error) throw error;
        store.clearDirty(id, stamp);
      }
      setStatus(store.hasPendingChanges() ? 'syncing' : 'synced');
    } catch (e) {
      ok = false;
      console.warn('[CMCloud] Caricamento online non riuscito:', e);
      setStatus(navigator.onLine === false || isNetworkError(e) ? 'offline' : 'error', translateError(e));
    } finally {
      state.pushing = false;
      if (state.pushQueued) {
        state.pushQueued = false;
        if (ok) schedulePush(300);
      }
    }
    return ok;
  }

  /** Carica subito online le modifiche in attesa (es. prima di chiudere la pagina o fare logout). */
  async function flush() {
    if (state.pushTimer) {
      clearTimeout(state.pushTimer);
      state.pushTimer = null;
    }
    if (!canSync()) return false;
    // Se un caricamento è già in corso aspettiamo che finisca e poi ricarichiamo il resto
    let guard = 0;
    while (state.pushing && guard < 100) {
      await new Promise((r) => setTimeout(r, 100));
      guard++;
    }
    return pushPending();
  }

  // ---------------------------------------------------------------------------
  // Sincronizzazione completa (scarica + carica)
  // ---------------------------------------------------------------------------

  async function syncNow() {
    if (!canSync()) return false;
    if (state.syncing) {
      state.syncQueued = true;
      return false;
    }
    state.syncing = true;
    setStatus('syncing');
    const store = state.store;
    const uid = state.user.id;
    let ok = true;
    try {
      const index = await fetchRemoteIndex();
      const need = idsToDownload(store.maps, store.meta, index);
      const full = need.length ? await fetchRemoteFull(need) : [];
      if (store.scope !== uid) return false;
      const merged = mergeMaps(store.maps, store.meta, index, full);
      if (merged.changed) {
        store.replaceMaps(merged.maps, merged.meta);
        emit('cm:maps-changed', { reason: 'sync' });
      } else {
        store.meta = merged.meta;
        store.saveMeta();
      }
      ok = await pushPending();
    } catch (e) {
      ok = false;
      console.warn('[CMCloud] Sincronizzazione non riuscita:', e);
      setStatus(navigator.onLine === false || isNetworkError(e) ? 'offline' : 'error', translateError(e));
    } finally {
      state.syncing = false;
      if (state.syncQueued) {
        state.syncQueued = false;
        setTimeout(syncNow, 500);
      }
    }
    return ok;
  }

  // ---------------------------------------------------------------------------
  // Cambi di sessione
  // ---------------------------------------------------------------------------

  async function onSignedIn(user) {
    const store = state.store;
    state.pendingUserId = user.id;
    setStatus('syncing');

    // Mappe create da ospite (esclusi gli esempi mai modificati) da portare nell'account
    const adopt =
      store.scope === GUEST_SCOPE
        ? store.maps.filter((m) => !m.sample).map((m) => JSON.parse(JSON.stringify(m)))
        : [];

    const base =
      store.scope === user.id
        ? { maps: store.maps, meta: store.meta, active: store.activeId }
        : store.readCache(user.id);

    let index = null;
    let full = [];
    try {
      index = await fetchRemoteIndex();
      const need = idsToDownload(base.maps, base.meta, index);
      full = need.length ? await fetchRemoteFull(need) : [];
    } catch (e) {
      console.warn('[CMCloud] Impossibile scaricare le mappe online:', e);
      index = null;
    }

    // Se l'utente cambia di nuovo mentre scaricavamo, interrompiamo
    if (state.pendingUserId !== user.id) return;

    let baseMaps = base.maps;
    // Se online ci sono già mappe vere, togliamo gli esempi non modificati dalla cache locale
    if (index && index.some((r) => !r.deleted_at)) {
      baseMaps = baseMaps.filter((m) => !m.sample);
    }

    let merged;
    if (index) {
      merged = mergeMaps(baseMaps, base.meta, index, full, adopt);
    } else {
      // Offline: usiamo la cache e accodiamo le mappe ospite per il caricamento successivo
      merged = mergeMaps(baseMaps, base.meta, [], [], adopt);
    }

    const preferredActive =
      adopt.length > 0 && store.scope === GUEST_SCOPE ? store.activeId : base.active;
    store.applyScope(user.id, merged.maps, merged.meta, preferredActive);
    if (adopt.length > 0 || store.scope !== GUEST_SCOPE) {
      // Le mappe ospite sono ora nell'account: svuotiamo la cache ospite
      store.clearCache(GUEST_SCOPE);
    }

    state.syncedUserId = user.id;
    state.pendingUserId = null;
    emit('cm:maps-changed', { reason: 'login' });

    if (index) {
      await pushPending();
    } else {
      setStatus('offline', 'Sei offline: le mappe verranno sincronizzate appena torni online.');
    }
    startPeriodicSync();
  }

  function onSignedOutLocal(clearUserCache) {
    const store = state.store;
    stopPeriodicSync();
    clearTimeout(state.pushTimer);
    state.pushTimer = null;
    state.syncedUserId = null;
    state.pendingUserId = null;
    if (!store) return;
    const prevScope = store.scope;
    if (prevScope !== GUEST_SCOPE) {
      if (clearUserCache) store.clearCache(prevScope);
      const guest = store.readCache(GUEST_SCOPE);
      store.applyScope(GUEST_SCOPE, guest.maps, guest.meta, guest.active);
      emit('cm:maps-changed', { reason: 'logout' });
    }
    setStatus('local');
  }

  async function handleAuthEvent(event, session) {
    const user = session?.user || null;

    if (event === 'PASSWORD_RECOVERY') {
      emit('cm:password-recovery', { user });
    }

    if (user) {
      state.user = user;
      if (state.syncedUserId !== user.id && state.pendingUserId !== user.id) {
        await onSignedIn(user);
      }
      emit('cm:auth', { user, event });
      return;
    }

    if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') {
      const clear = state.clearCacheOnSignOut;
      state.clearCacheOnSignOut = false;
      state.user = null;
      onSignedOutLocal(clear);
      emit('cm:auth', { user: null, event });
    }
  }

  function startPeriodicSync() {
    stopPeriodicSync();
    state.periodicTimer = setInterval(() => {
      if (document.visibilityState === 'visible') syncNow();
    }, PERIODIC_SYNC_MS);
  }

  function stopPeriodicSync() {
    if (state.periodicTimer) clearInterval(state.periodicTimer);
    state.periodicTimer = null;
  }

  // ---------------------------------------------------------------------------
  // Inizializzazione
  // ---------------------------------------------------------------------------

  function attachStore(store) {
    state.store = store;
    store.onMapChanged = () => schedulePush();
    store.onMapDeleted = () => schedulePush(400);
  }

  function init(store) {
    if (state.readyPromise) return state.readyPromise;
    if (store) attachStore(store);

    state.readyPromise = (async () => {
      if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        console.info('[CMCloud] SDK Supabase non disponibile: modalità solo locale.');
        if (state.store && !state.store.isGuest()) onSignedOutLocal(false);
        setStatus('local');
        return false;
      }
      const cfg = await loadConfig();
      if (!cfg) {
        console.info('[CMCloud] Supabase non configurato: modalità solo locale.');
        if (state.store && !state.store.isGuest()) onSignedOutLocal(false);
        setStatus('local');
        return false;
      }

      state.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'cm-auth'
        }
      });
      state.configured = true;

      // Nota: non chiamare altre funzioni Supabase direttamente dentro questo callback (consiglio ufficiale)
      state.client.auth.onAuthStateChange((event, session) => {
        setTimeout(() => {
          handleAuthEvent(event, session).catch((e) => console.warn('[CMCloud]', e));
        }, 0);
      });

      window.addEventListener('online', () => {
        if (state.user) syncNow();
      });
      document.addEventListener('visibilitychange', () => {
        if (!state.user) return;
        if (document.visibilityState === 'visible') syncNow();
        else flush();
      });
      window.addEventListener('pagehide', () => {
        if (state.user) flush();
      });

      return true;
    })();

    return state.readyPromise;
  }

  // ---------------------------------------------------------------------------
  // API di autenticazione
  // ---------------------------------------------------------------------------

  async function ensureClient() {
    if (state.readyPromise) await state.readyPromise;
    return state.configured && state.client;
  }

  async function signUp(email, password, displayName = '') {
    if (!(await ensureClient())) return notConfigured();
    try {
      const { data, error } = await state.client.auth.signUp({
        email: String(email || '').trim(),
        password: String(password || ''),
        options: {
          data: { display_name: String(displayName || '').trim().slice(0, 80) },
          emailRedirectTo: redirectUrl()
        }
      });
      if (error) return fail(error);
      // Con la conferma email attiva Supabase non segnala gli account già esistenti: li riconosciamo così
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return { ok: false, error: 'Esiste già un account con questa email.' };
      }
      return { ok: true, user: data.user, needsConfirmation: !data.session };
    } catch (e) {
      return fail(e);
    }
  }

  async function signIn(email, password) {
    if (!(await ensureClient())) return notConfigured();
    try {
      const { data, error } = await state.client.auth.signInWithPassword({
        email: String(email || '').trim(),
        password: String(password || '')
      });
      if (error) return fail(error);
      return { ok: true, user: data.user };
    } catch (e) {
      return fail(e);
    }
  }

  async function signInWithMagicLink(email) {
    if (!(await ensureClient())) return notConfigured();
    try {
      const { error } = await state.client.auth.signInWithOtp({
        email: String(email || '').trim(),
        options: { emailRedirectTo: redirectUrl() }
      });
      if (error) return fail(error);
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }

  async function signInWithProvider(provider = 'google') {
    if (!(await ensureClient())) return notConfigured();
    try {
      const { error } = await state.client.auth.signInWithOAuth({
        provider,
        options: { redirectTo: redirectUrl() }
      });
      if (error) return fail(error);
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }

  async function sendPasswordReset(email) {
    if (!(await ensureClient())) return notConfigured();
    try {
      const { error } = await state.client.auth.resetPasswordForEmail(String(email || '').trim(), {
        redirectTo: redirectUrl()
      });
      if (error) return fail(error);
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }

  async function updatePassword(newPassword) {
    if (!(await ensureClient())) return notConfigured();
    try {
      const { data, error } = await state.client.auth.updateUser({ password: String(newPassword || '') });
      if (error) return fail(error);
      return { ok: true, user: data.user };
    } catch (e) {
      return fail(e);
    }
  }

  /**
   * Esce dall'account.
   *  - force: esce anche se ci sono modifiche non ancora caricate (andrebbero perse se keepLocalCopy=false)
   *  - keepLocalCopy: lascia la copia offline dell'account su questo browser (default: no, per privacy)
   */
  async function signOut({ force = false, keepLocalCopy = false } = {}) {
    if (!(await ensureClient())) return notConfigured();
    try {
      await flush();
      if (!force && state.store && state.store.hasPendingChanges()) {
        return {
          ok: false,
          unsynced: true,
          error: 'Alcune modifiche non sono ancora state salvate online. Riprova quando sei connesso oppure esci comunque.'
        };
      }
      state.clearCacheOnSignOut = !keepLocalCopy;
      const { error } = await state.client.auth.signOut({ scope: 'local' });
      if (error) {
        state.clearCacheOnSignOut = false;
        return fail(error);
      }
      return { ok: true };
    } catch (e) {
      state.clearCacheOnSignOut = false;
      return fail(e);
    }
  }

  async function getProfile() {
    if (!(await ensureClient())) return notConfigured();
    if (!state.user) return { ok: false, error: 'Devi effettuare l\'accesso.' };
    try {
      const { data, error } = await state.client
        .from(PROFILE_TABLE)
        .select('id,display_name,created_at,updated_at')
        .eq('id', state.user.id)
        .maybeSingle();
      if (error) return fail(error);
      return { ok: true, profile: data };
    } catch (e) {
      return fail(e);
    }
  }

  async function updateProfile({ display_name } = {}) {
    if (!(await ensureClient())) return notConfigured();
    if (!state.user) return { ok: false, error: 'Devi effettuare l\'accesso.' };
    try {
      const name = String(display_name || '').trim().slice(0, 80);
      const { data, error } = await state.client
        .from(PROFILE_TABLE)
        .upsert({ id: state.user.id, display_name: name }, { onConflict: 'id' })
        .select()
        .maybeSingle();
      if (error) return fail(error);
      await state.client.auth.updateUser({ data: { display_name: name } });
      return { ok: true, profile: data };
    } catch (e) {
      return fail(e);
    }
  }

  /** Elimina definitivamente account e mappe online (funzione SQL `delete_my_account`). */
  async function deleteAccount() {
    if (!(await ensureClient())) return notConfigured();
    if (!state.user) return { ok: false, error: 'Devi effettuare l\'accesso.' };
    try {
      const { error } = await state.client.rpc('delete_my_account');
      if (error) return fail(error);
      const uid = state.user.id;
      state.clearCacheOnSignOut = true;
      await state.client.auth.signOut({ scope: 'local' });
      if (state.store) state.store.clearCache(uid);
      emit('cm:maps-changed', { reason: 'account-deleted' });
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }

  // ---------------------------------------------------------------------------
  // Sottoscrizioni comode per la futura interfaccia grafica
  // ---------------------------------------------------------------------------

  function subscribe(eventName, cb) {
    const handler = (e) => cb(e.detail);
    window.addEventListener(eventName, handler);
    return () => window.removeEventListener(eventName, handler);
  }

  async function configure(supabaseUrl, supabaseAnonKey) {
    const url = String(supabaseUrl || '').trim().replace(/\/+$/, '');
    const key = String(supabaseAnonKey || '').trim();
    if (!url || !key) {
      try {
        localStorage.removeItem(LOCAL_CFG_KEY);
      } catch {}
      state.configured = false;
      state.client = null;
      setStatus('local');
      emit('cm:auth', { user: null, event: 'CONFIG_CLEARED' });
      return { ok: true, configured: false };
    }
    try {
      localStorage.setItem(LOCAL_CFG_KEY, JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key }));
    } catch {}
    state.readyPromise = null;
    const ok = await init(state.store);
    emit('cm:auth', { user: state.user, event: 'CONFIGURED' });
    return { ok, configured: ok };
  }

  window.CMCloud = {
    init,
    configure,
    getSavedLocalConfig,
    ready: () => state.readyPromise || Promise.resolve(false),
    isConfigured: () => state.configured,
    isLoggedIn: () => Boolean(state.user),
    getUser: () => state.user,
    getDisplayName: () =>
      state.user?.user_metadata?.display_name || (state.user?.email ? state.user.email.split('@')[0] : ''),
    getStatus: () => ({ status: state.status, message: state.statusMessage }),
    getClient: () => state.client,
    hasPendingChanges: () => Boolean(state.store && state.store.hasPendingChanges()),

    signUp,
    signIn,
    signInWithMagicLink,
    signInWithProvider,
    sendPasswordReset,
    updatePassword,
    signOut,
    getProfile,
    updateProfile,
    deleteAccount,

    syncNow,
    flush,

    onAuth: (cb) => subscribe('cm:auth', cb),
    onSync: (cb) => subscribe('cm:sync', cb),
    onMapsChanged: (cb) => subscribe('cm:maps-changed', cb),
    onPasswordRecovery: (cb) => subscribe('cm:password-recovery', cb),

    // Esposti per i test
    _internal: { mergeMaps, idsToDownload, mapToRow, rowToMap, translateError }
  };
})();
