(function () {
  'use strict';

  const { uid, deepClone } = window.CMUtil;
  const { createNode, parseOutline } = window.CMOutline;

  const STORAGE_KEY = 'algor_cm_maps_v1';
  const ACTIVE_KEY = 'algor_cm_active_v1';
  const META_KEY = 'algor_cm_meta_v1';          // modifiche in attesa di sincronizzazione (dirty / eliminate)
  const LAST_USER_KEY = 'algor_cm_last_user_v1'; // ultimo utente loggato (per aprire subito la sua cache locale)
  const GUEST_SCOPE = 'guest';
  const MAX_HISTORY = 60;

  /**
   * Ogni "scope" (ospite oppure id utente) ha la propria cache nel localStorage,
   * così le mappe di utenti diversi sullo stesso browser non si mescolano mai.
   */
  function keysFor(scope) {
    if (!scope || scope === GUEST_SCOPE) {
      return { maps: STORAGE_KEY, active: ACTIVE_KEY, meta: META_KEY };
    }
    return {
      maps: `${STORAGE_KEY}__${scope}`,
      active: `${ACTIVE_KEY}__${scope}`,
      meta: `${META_KEY}__${scope}`
    };
  }

  function emptyMeta() {
    return { dirty: [], deleted: [] };
  }

  function defaultStyle() {
    return {
      theme: 'algor',
      font: 'sans',
      shape: 'round',      // 'round' | 'rect' | 'pill'
      lineType: 'ortho',   // 'ortho' (squadrata/incolonnata tipo Algor) | 'curve' | 'straight'
      arrows: true,
      stackLeaves: true,   // sempre attivo: incolonna automaticamente i sotto-concetti
      freeMode: false,     // consente di spostare e ridimensionare liberamente i riquadri
      hGap: 36,
      vGap: 54
    };
  }

  const LEGACY_SAMPLE_TITLES = new Set(["Il Ciclo dell'Acqua", 'La Costituzione Italiana']);

  function isLegacySampleMap(m) {
    if (!m) return false;
    if (m.sample === true && LEGACY_SAMPLE_TITLES.has(m.title)) return true;
    if (LEGACY_SAMPLE_TITLES.has(m.title) && m.root && LEGACY_SAMPLE_TITLES.has(m.root.text)) return true;
    return false;
  }

  function createStarterMaps() {
    const map = createBlankMap('Nuova mappa concettuale');
    map.sample = true;
    return [map];
  }

  function createBlankMap(title = 'Nuova mappa concettuale') {
    const root = createNode(title, '');
    return {
      id: uid('map'),
      title,
      updatedAt: Date.now(),
      layout: 'down',
      style: defaultStyle(),
      root,
      links: []
    };
  }

  function normalizeNode(node, isRoot = false) {
    if (!node || typeof node !== 'object') return createNode('Concetto');
    const wasLineShape = node.shape === 'line';
    return {
      id: node.id || uid('n'),
      text: String(node.text ?? 'Concetto'),
      linkText: isRoot ? '' : String(node.linkText ?? ''),
      children: Array.isArray(node.children)
        ? node.children.map((c) => normalizeNode(c, false))
        : [],
      collapsed: Boolean(node.collapsed),
      color: node.color || '',
      textColor: node.textColor || '',
      shape: wasLineShape ? '' : (node.shape || ''),
      bold: typeof node.bold === 'boolean' ? node.bold : null,
      italic: Boolean(node.italic),
      underline: Boolean(node.underline) || wasLineShape,
      fontSize: Number(node.fontSize) || 0,
      manualX: typeof node.manualX === 'number' && isFinite(node.manualX) ? node.manualX : null,
      manualY: typeof node.manualY === 'number' && isFinite(node.manualY) ? node.manualY : null,
      customW: Number(node.customW) > 0 ? Number(node.customW) : 0,
      customH: Number(node.customH) > 0 ? Number(node.customH) : 0,
      image: node.image && node.image.src ? {
        src: node.image.src,
        w: Number(node.image.w) || 200,
        h: Number(node.image.h) || 140
      } : null
    };
  }

  function normalizeMap(raw) {
    const def = defaultStyle();
    const root = normalizeNode(raw?.root || createNode(raw?.title || 'Concetto principale'), true);
    const mergedStyle = Object.assign(def, raw?.style || {});
    mergedStyle.stackLeaves = true; // Sempre attivo
    mergedStyle.freeMode = Boolean(raw?.style?.freeMode);
    if (mergedStyle.shape === 'line') mergedStyle.shape = 'round';
    const out = {
      id: raw?.id || uid('map'),
      title: String(raw?.title || root.text || 'Mappa concettuale').slice(0, 120),
      updatedAt: Number(raw?.updatedAt) || Date.now(),
      layout: ['down', 'right', 'mind'].includes(raw?.layout) ? raw.layout : 'down',
      style: mergedStyle,
      root,
      links: Array.isArray(raw?.links)
        ? raw.links
            .filter((l) => l && l.from && l.to && l.from !== l.to)
            .map((l) => ({
              id: l.id || uid('lk'),
              from: l.from,
              to: l.to,
              text: String(l.text || 'collegato a')
            }))
        : []
    };
    if (raw?.sample === true) out.sample = true;
    return out;
  }

  function cloneSubtreeWithNewIds(node) {
    const copy = deepClone(node);
    function reId(n) {
      n.id = uid('n');
      for (const ch of n.children || []) reId(ch);
    }
    reId(copy);
    return copy;
  }

  function findNode(root, targetId, parent = null, index = 0, depth = 0, branchIndex = 0, path = []) {
    if (!root) return null;
    const currentPath = path.concat(root);
    if (root.id === targetId) {
      return { node: root, parent, index, depth, branchIndex, path: currentPath };
    }
    const kids = root.children || [];
    for (let i = 0; i < kids.length; i++) {
      const bIdx = depth === 0 ? i : branchIndex;
      const found = findNode(kids[i], targetId, root, i, depth + 1, bIdx, currentPath);
      if (found) return found;
    }
    return null;
  }

  function isDescendant(rootNode, candidateId) {
    if (!rootNode) return false;
    if (rootNode.id === candidateId) return true;
    for (const ch of rootNode.children || []) {
      if (isDescendant(ch, candidateId)) return true;
    }
    return false;
  }

  function collectNodeIds(node, set = new Set()) {
    if (!node) return set;
    set.add(node.id);
    for (const ch of node.children || []) collectNodeIds(ch, set);
    return set;
  }

  class Store {
    constructor() {
      this.maps = [];
      this.activeId = null;
      this.history = new Map(); // mapId -> { undo: [], redo: [] }
      this.onSaveState = null;
      this.onMapChanged = null;  // (map) => void  — usato dal modulo cloud per caricare online
      this.onMapDeleted = null;  // (mapId) => void
      this.meta = emptyMeta();

      // Se l'ultimo utente era loggato, apriamo subito la sua cache locale (evita il "flash" delle mappe ospite)
      let lastUser = null;
      try {
        lastUser = localStorage.getItem(LAST_USER_KEY);
      } catch {}
      this.scope = lastUser || GUEST_SCOPE;
      this.keys = keysFor(this.scope);
      this.loadFromStorage();
    }

    /**
     * Legge la cache locale di uno scope senza applicarla.
     */
    readCache(scope) {
      const k = keysFor(scope);
      let maps = [];
      let meta = emptyMeta();
      let active = null;
      try {
        const raw = localStorage.getItem(k.maps);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            maps = parsed.map(normalizeMap).filter((m) => !isLegacySampleMap(m));
          }
        }
      } catch (e) {
        console.warn('Errore lettura localStorage:', e);
      }
      try {
        const m = JSON.parse(localStorage.getItem(k.meta) || 'null');
        if (m && typeof m === 'object') {
          meta = {
            dirty: Array.isArray(m.dirty) ? m.dirty.filter((x) => typeof x === 'string') : [],
            deleted: Array.isArray(m.deleted)
              ? m.deleted.filter((d) => d && typeof d.id === 'string').map((d) => ({ id: d.id, at: Number(d.at) || Date.now() }))
              : []
          };
        }
      } catch {}
      try {
        active = localStorage.getItem(k.active);
      } catch {}
      return { maps, meta, active };
    }

    /**
     * Sostituisce completamente lo scope attivo (ospite <-> utente) con le mappe indicate.
     */
    applyScope(scope, maps, meta = null, preferredActive = null) {
      this.scope = scope || GUEST_SCOPE;
      this.keys = keysFor(this.scope);
      this.history.clear();
      this.maps = Array.isArray(maps) && maps.length > 0 ? maps : createStarterMaps();
      this.meta = meta ? { dirty: [...(meta.dirty || [])], deleted: [...(meta.deleted || [])] } : emptyMeta();
      this.activeId =
        preferredActive && this.maps.some((m) => m.id === preferredActive)
          ? preferredActive
          : this.maps[0].id;
      try {
        if (this.scope === GUEST_SCOPE) localStorage.removeItem(LAST_USER_KEY);
        else localStorage.setItem(LAST_USER_KEY, this.scope);
      } catch {}
      this.persist(false);
    }

    /**
     * Sostituisce le mappe dello scope corrente (usato dopo una sincronizzazione) mantenendo la mappa aperta se esiste ancora.
     */
    replaceMaps(maps, meta) {
      const prevActive = this.activeId;
      this.maps = Array.isArray(maps) && maps.length > 0 ? maps : createStarterMaps();
      if (meta) this.meta = { dirty: [...(meta.dirty || [])], deleted: [...(meta.deleted || [])] };
      for (const id of Array.from(this.history.keys())) {
        if (!this.maps.some((m) => m.id === id)) this.history.delete(id);
      }
      this.activeId = this.maps.some((m) => m.id === prevActive) ? prevActive : this.maps[0].id;
      this.persist(false);
    }

    clearCache(scope) {
      const k = keysFor(scope);
      try {
        localStorage.removeItem(k.maps);
        localStorage.removeItem(k.active);
        localStorage.removeItem(k.meta);
      } catch {}
    }

    isGuest() {
      return this.scope === GUEST_SCOPE;
    }

    hasPendingChanges() {
      return this.meta.dirty.length > 0 || this.meta.deleted.length > 0;
    }

    markDirty(mapId) {
      if (this.scope === GUEST_SCOPE || !mapId) return;
      if (!this.meta.dirty.includes(mapId)) this.meta.dirty.push(mapId);
    }

    /**
     * Rimuove una mappa dalla lista "da caricare". Se `ifUpdatedAt` è indicato, la rimuove solo
     * se la mappa non è stata modificata di nuovo durante il caricamento.
     */
    clearDirty(mapId, ifUpdatedAt = null) {
      if (ifUpdatedAt !== null) {
        const m = this.maps.find((x) => x.id === mapId);
        if (m && m.updatedAt !== ifUpdatedAt) return;
      }
      this.meta.dirty = this.meta.dirty.filter((id) => id !== mapId);
      this.saveMeta();
    }

    clearTombstones(ids) {
      const set = new Set(ids);
      this.meta.deleted = this.meta.deleted.filter((d) => !set.has(d.id));
      this.saveMeta();
    }

    saveMeta() {
      try {
        localStorage.setItem(this.keys.meta, JSON.stringify(this.meta));
      } catch {}
    }

    loadFromStorage() {
      const cache = this.readCache(this.scope);
      this.maps = cache.maps;
      this.meta = cache.meta;

      if (this.maps.length === 0) {
        this.maps = createStarterMaps();
      }

      const savedActive = cache.active;
      if (savedActive && this.maps.some((m) => m.id === savedActive)) {
        this.activeId = savedActive;
      } else {
        this.activeId = this.maps[0].id;
      }
      this.persist(false);
    }

    persist(touchTime = true) {
      const current = this.getMap();
      if (current && touchTime) {
        current.updatedAt = Date.now();
        // Una mappa di esempio modificata diventa una mappa vera e propria dell'utente
        if (current.sample) delete current.sample;
        this.markDirty(current.id);
      }
      if (this.onSaveState) this.onSaveState('saving');
      try {
        localStorage.setItem(this.keys.maps, JSON.stringify(this.maps));
        if (this.activeId) localStorage.setItem(this.keys.active, this.activeId);
        localStorage.setItem(this.keys.meta, JSON.stringify(this.meta));
        if (this.onSaveState) {
          setTimeout(() => this.onSaveState && this.onSaveState('saved'), 140);
        }
      } catch (e) {
        console.error('Errore salvataggio localStorage:', e);
        if (this.onSaveState) this.onSaveState('error');
      }
      if (current && touchTime && this.onMapChanged) {
        try {
          this.onMapChanged(current);
        } catch (e) {
          console.warn(e);
        }
      }
    }

    getMap() {
      return this.maps.find((m) => m.id === this.activeId) || this.maps[0];
    }

    setActiveMap(id) {
      if (this.maps.some((m) => m.id === id)) {
        this.activeId = id;
        try {
          localStorage.setItem(this.keys.active, id);
        } catch {}
      }
    }

    getHistoryBucket(mapId = this.activeId) {
      if (!this.history.has(mapId)) {
        this.history.set(mapId, { undo: [], redo: [] });
      }
      return this.history.get(mapId);
    }

    snapshot() {
      const map = this.getMap();
      if (!map) return;
      const bucket = this.getHistoryBucket(map.id);
      const snap = JSON.stringify({
        title: map.title,
        layout: map.layout,
        style: map.style,
        root: map.root,
        links: map.links
      });
      if (bucket.undo.length > 0 && bucket.undo[bucket.undo.length - 1] === snap) {
        return;
      }
      bucket.undo.push(snap);
      if (bucket.undo.length > MAX_HISTORY) bucket.undo.shift();
      bucket.redo.length = 0;
    }

    canUndo() {
      return this.getHistoryBucket().undo.length > 0;
    }

    canRedo() {
      return this.getHistoryBucket().redo.length > 0;
    }

    undo() {
      const map = this.getMap();
      if (!map) return false;
      const bucket = this.getHistoryBucket(map.id);
      if (bucket.undo.length === 0) return false;
      const currentSnap = JSON.stringify({
        title: map.title,
        layout: map.layout,
        style: map.style,
        root: map.root,
        links: map.links
      });
      bucket.redo.push(currentSnap);
      const prev = JSON.parse(bucket.undo.pop());
      Object.assign(map, prev);
      this.persist();
      return true;
    }

    redo() {
      const map = this.getMap();
      if (!map) return false;
      const bucket = this.getHistoryBucket(map.id);
      if (bucket.redo.length === 0) return false;
      const currentSnap = JSON.stringify({
        title: map.title,
        layout: map.layout,
        style: map.style,
        root: map.root,
        links: map.links
      });
      bucket.undo.push(currentSnap);
      const next = JSON.parse(bucket.redo.pop());
      Object.assign(map, next);
      this.persist();
      return true;
    }

    createNewMap(customMap = null) {
      const m = customMap ? normalizeMap(customMap) : createBlankMap();
      this.maps.unshift(m);
      this.activeId = m.id;
      this.persist();
      return m;
    }

    duplicateMap(id) {
      const orig = this.maps.find((m) => m.id === id);
      if (!orig) return null;
      const copy = deepClone(orig);
      copy.id = uid('map');
      copy.title = orig.title + ' (copia)';
      copy.updatedAt = Date.now();
      delete copy.sample;
      this.maps.unshift(copy);
      this.activeId = copy.id;
      this.persist();
      return copy;
    }

    recordDeletion(id) {
      const target = this.maps.find((m) => m.id === id);
      this.meta.dirty = this.meta.dirty.filter((x) => x !== id);
      // Le mappe di esempio mai modificate non esistono online: nessuna eliminazione da propagare
      if (this.scope !== GUEST_SCOPE && target && !target.sample) {
        if (!this.meta.deleted.some((d) => d.id === id)) {
          this.meta.deleted.push({ id, at: Date.now() });
        }
      }
    }

    deleteMap(id) {
      if (this.maps.length <= 1) {
        this.recordDeletion(id);
        const fresh = createBlankMap();
        this.maps = [fresh];
        this.activeId = fresh.id;
        this.history.delete(id);
        this.persist();
        if (this.onMapDeleted) this.onMapDeleted(id);
        return fresh;
      }
      const idx = this.maps.findIndex((m) => m.id === id);
      if (idx === -1) return this.getMap();
      this.recordDeletion(id);
      this.maps.splice(idx, 1);
      this.history.delete(id);
      if (this.activeId === id) {
        this.activeId = this.maps[Math.max(0, idx - 1)].id;
      }
      this.persist(false);
      if (this.onMapDeleted) this.onMapDeleted(id);
      return this.getMap();
    }

    pruneOrphanLinks() {
      const map = this.getMap();
      if (!map) return;
      const validIds = collectNodeIds(map.root);
      map.links = (map.links || []).filter(
        (l) => validIds.has(l.from) && validIds.has(l.to) && l.from !== l.to
      );
    }

    addChild(parentId, text = 'Nuovo concetto', linkText = '') {
      const map = this.getMap();
      const info = findNode(map.root, parentId);
      if (!info) return null;
      this.snapshot();
      info.node.collapsed = false;
      const defaultLink = linkText !== ''
        ? linkText
        : info.depth === 0
          ? ''
          : '';
      const child = createNode(text, defaultLink);
      info.node.children.push(child);
      this.persist();
      return child;
    }

    addSibling(nodeId, text = 'Nuovo concetto', linkText = '') {
      const map = this.getMap();
      const info = findNode(map.root, nodeId);
      if (!info) return null;
      if (!info.parent) {
        // Root has no sibling: add child instead
        return this.addChild(nodeId, text, linkText);
      }
      this.snapshot();
      const sib = createNode(text, linkText || info.node.linkText || '');
      info.parent.children.splice(info.index + 1, 0, sib);
      this.persist();
      return sib;
    }

    insertParent(nodeId, text = 'Concetto intermedio') {
      const map = this.getMap();
      const info = findNode(map.root, nodeId);
      if (!info || !info.parent) return null;
      this.snapshot();
      const wrapper = createNode(text, info.node.linkText || '');
      info.node.linkText = '';
      wrapper.children.push(info.node);
      info.parent.children.splice(info.index, 1, wrapper);
      this.persist();
      return wrapper;
    }

    deleteNode(nodeId) {
      const map = this.getMap();
      const info = findNode(map.root, nodeId);
      if (!info || !info.parent) return null; // Cannot delete root
      this.snapshot();
      const parent = info.parent;
      const idx = info.index;
      parent.children.splice(idx, 1);
      this.pruneOrphanLinks();
      this.persist();
      // Select next closest sibling or parent
      if (parent.children.length > 0) {
        return parent.children[Math.min(idx, parent.children.length - 1)].id;
      }
      return parent.id;
    }

    reorderSibling(nodeId, delta) {
      const map = this.getMap();
      const info = findNode(map.root, nodeId);
      if (!info || !info.parent) return false;
      const arr = info.parent.children;
      const newIdx = info.index + delta;
      if (newIdx < 0 || newIdx >= arr.length) return false;
      this.snapshot();
      const [item] = arr.splice(info.index, 1);
      arr.splice(newIdx, 0, item);
      this.persist();
      return true;
    }

    moveNode(dragId, targetId, mode = 'inside') {
      if (!dragId || !targetId || dragId === targetId) return false;
      const map = this.getMap();
      const dragInfo = findNode(map.root, dragId);
      const targetInfo = findNode(map.root, targetId);
      if (!dragInfo || !dragInfo.parent || !targetInfo) return false;
      // Prevent moving a node into its own descendant
      if (isDescendant(dragInfo.node, targetId)) return false;

      this.snapshot();
      // Remove from old parent
      dragInfo.parent.children.splice(dragInfo.index, 1);

      if (mode === 'inside' || !targetInfo.parent) {
        targetInfo.node.collapsed = false;
        targetInfo.node.children.push(dragInfo.node);
      } else {
        // Re-locate target index after removal
        const updatedTarget = findNode(map.root, targetId);
        const insIdx = mode === 'before' ? updatedTarget.index : updatedTarget.index + 1;
        updatedTarget.parent.children.splice(insIdx, 0, dragInfo.node);
      }
      this.persist();
      return true;
    }

    duplicateSubtree(nodeId) {
      const map = this.getMap();
      const info = findNode(map.root, nodeId);
      if (!info || !info.parent) return null;
      this.snapshot();
      const copy = cloneSubtreeWithNewIds(info.node);
      info.parent.children.splice(info.index + 1, 0, copy);
      this.persist();
      return copy;
    }

    pasteSubtree(parentId, subtreeRoot) {
      const map = this.getMap();
      const info = findNode(map.root, parentId);
      if (!info || !subtreeRoot) return null;
      this.snapshot();
      const copy = cloneSubtreeWithNewIds(subtreeRoot);
      info.node.collapsed = false;
      info.node.children.push(copy);
      this.persist();
      return copy;
    }

    addCrossLink(fromId, toId, text = 'collegato a') {
      if (!fromId || !toId || fromId === toId) return null;
      const map = this.getMap();
      const existing = map.links.find(
        (l) => (l.from === fromId && l.to === toId) || (l.from === toId && l.to === fromId)
      );
      if (existing) return existing;
      this.snapshot();
      const lk = { id: uid('lk'), from: fromId, to: toId, text };
      map.links.push(lk);
      this.persist();
      return lk;
    }

    deleteCrossLink(linkId) {
      const map = this.getMap();
      const idx = map.links.findIndex((l) => l.id === linkId);
      if (idx === -1) return false;
      this.snapshot();
      map.links.splice(idx, 1);
      this.persist();
      return true;
    }

    resetManualLayout() {
      const map = this.getMap();
      if (!map || !map.root) return;
      this.snapshot();
      function clear(n) {
        n.manualX = null;
        n.manualY = null;
        n.customW = 0;
        n.customH = 0;
        for (const ch of n.children || []) clear(ch);
      }
      clear(map.root);
      this.persist();
    }
  }

  window.CMStore = {
    Store,
    findNode,
    isDescendant,
    cloneSubtreeWithNewIds,
    normalizeMap,
    defaultStyle,
    createBlankMap,
    GUEST_SCOPE
  };
})();
