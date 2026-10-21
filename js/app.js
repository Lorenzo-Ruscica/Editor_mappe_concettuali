(function () {
  'use strict';

  const {
    clamp,
    debounce,
    escapeHtml,
    stripRichTags,
    richTextToHtml,
    htmlToRichText,
    sanitizeFilename,
    formatDate,
    showToast,
    downloadBlob,
    resizeImageFile
  } = window.CMUtil;
  const { svgIcon, hydrateIcons } = window.CMIcons;
  const { THEMES, NODE_SWATCHES, LINK_CHIPS, FONTS, getTheme } = window.CMThemes;
  const { SAMPLE_OUTLINES, parseOutline, parseOpml, treeToOutline, countNodesInTree } = window.CMOutline;
  const { Store, findNode, isDescendant } = window.CMStore;
  const { computeLayout } = window.CMLayout;
  const { renderSceneGroupMarkup, buildStandaloneSvg } = window.CMRender;
  const { computeExportPlan, svgToDataUrl, exportPdf, printMap, exportPng, exportSvg } = window.CMExporter;

  // Application state
  const store = new Store();
  let layout = null;
  let selectedId = null;
  let selectedLinkId = null;

  // Viewport pan & zoom
  let cam = { x: 0, y: 0, k: 1 };
  let isPanning = false;
  let panStart = { x: 0, y: 0, camX: 0, camY: 0 };

  // Node dragging (reparent / reorder / free move) & resizing
  let dragState = null; // { nodeId, startX, startY, moved, dropTarget, freeMove, startWorld, origX, origY }
  let resizeState = null; // { nodeId, dir, startWorld, origX, origY, origW, origH }

  // Cross-linking mode
  let linkingFrom = null;
  let pointerWorld = null;

  // Inline editor state
  let editSession = null; // { type: 'node'|'edge'|'xlink', id, isNew }

  // Internal clipboard for subtree copy/paste
  let internalClipboard = null;

  // Export modal options
  const exportOpts = {
    size: 'a4',
    orient: 'auto',
    pages: '1',
    margin: 'normal',
    quality: 'high',
    includeTitle: true,
    forceMono: false,
    expandAll: false
  };

  let sampleIdx = 0;

  // DOM references
  const dom = {
    toolbar: document.getElementById('toolbar'),
    btnSidebar: document.getElementById('btn-sidebar'),
    mapTitle: document.getElementById('map-title'),
    saveState: document.getElementById('save-state'),
    btnUndo: document.getElementById('btn-undo'),
    btnRedo: document.getElementById('btn-redo'),
    btnChild: document.getElementById('btn-child'),
    btnSibling: document.getElementById('btn-sibling'),
    btnLink: document.getElementById('btn-link'),
    btnDelete: document.getElementById('btn-delete'),
    layoutSeg: document.getElementById('layout-seg'),
    btnFreeMode: document.getElementById('btn-free-mode'),
    btnZoomOut: document.getElementById('btn-zoom-out'),
    zoomLabel: document.getElementById('zoom-label'),
    btnZoomIn: document.getElementById('btn-zoom-in'),
    btnFit: document.getElementById('btn-fit'),
    btnFullscreen: document.getElementById('btn-fullscreen'),
    btnImport: document.getElementById('btn-import'),
    btnSpeak: document.getElementById('btn-speak'),
    btnHelp: document.getElementById('btn-help'),
    btnProps: document.getElementById('btn-props'),
    btnQuickPdf: document.getElementById('btn-quick-pdf'),
    btnExport: document.getElementById('btn-export'),

    sidebar: document.getElementById('sidebar'),
    btnNew: document.getElementById('btn-new'),
    mapList: document.getElementById('map-list'),
    btnOpenFile: document.getElementById('btn-open-file'),
    btnSaveFile: document.getElementById('btn-save-file'),
    btnOutline: document.getElementById('btn-outline'),

    canvasWrap: document.getElementById('canvas-wrap'),
    canvas: document.getElementById('canvas'),
    viewport: document.getElementById('viewport'),
    editor: document.getElementById('editor'),
    linkHint: document.getElementById('link-hint'),

    props: document.getElementById('props'),
    propsTitle: document.getElementById('props-title'),
    propsBody: document.getElementById('props-body'),

    statusText: document.getElementById('status-text'),
    statusCount: document.getElementById('status-count'),

    modalImport: document.getElementById('modal-import'),
    impText: document.getElementById('imp-text'),
    impExample: document.getElementById('imp-example'),
    impStats: document.getElementById('imp-stats'),
    impPreview: document.getElementById('imp-preview'),
    impEmpty: document.getElementById('imp-empty'),
    impGo: document.getElementById('imp-go'),

    modalExport: document.getElementById('modal-export'),
    expPreview: document.getElementById('exp-preview'),
    expTitle: document.getElementById('exp-title'),
    expMono: document.getElementById('exp-mono'),
    expExpandRow: document.getElementById('exp-expand-row'),
    expExpand: document.getElementById('exp-expand'),
    expInfo: document.getElementById('exp-info'),
    expPdf: document.getElementById('exp-pdf'),
    expPrint: document.getElementById('exp-print'),
    expPng: document.getElementById('exp-png'),
    expSvg: document.getElementById('exp-svg'),
    expJson: document.getElementById('exp-json'),
    expTxt: document.getElementById('exp-txt'),

    modalHelp: document.getElementById('modal-help'),
    fileOpen: document.getElementById('file-open'),
    fileImage: document.getElementById('file-image'),

    // Auth & Cloud UI
    btnAuth: document.getElementById('btn-auth'),
    authDot: document.getElementById('auth-dot'),
    authAvatar: document.getElementById('auth-avatar'),
    authIcon: document.getElementById('auth-icon'),
    authLabel: document.getElementById('auth-label'),
    sbCloudBar: document.getElementById('sb-cloud-bar'),
    sbcDot: document.getElementById('sbc-dot'),
    sbcText: document.getElementById('sbc-text'),
    sbcBtn: document.getElementById('sbc-btn'),
    modalAuth: document.getElementById('modal-auth'),
    authModalTitle: document.getElementById('auth-modal-title'),
    authCfgBanner: document.getElementById('auth-cfg-banner'),
    authCfgToggle: document.getElementById('auth-cfg-toggle'),
    authCfgBox: document.getElementById('auth-cfg-box'),
    authCfgUrl: document.getElementById('auth-cfg-url'),
    authCfgKey: document.getElementById('auth-cfg-key'),
    authCfgSave: document.getElementById('auth-cfg-save'),
    authCfgClear: document.getElementById('auth-cfg-clear'),
    authMsg: document.getElementById('auth-msg'),
    authGuestView: document.getElementById('auth-guest-view'),
    authTabs: document.getElementById('auth-tabs'),
    authForm: document.getElementById('auth-form'),
    authNameWrap: document.getElementById('auth-name-wrap'),
    authName: document.getElementById('auth-name'),
    authEmail: document.getElementById('auth-email'),
    authPassWrap: document.getElementById('auth-pass-wrap'),
    authPassword: document.getElementById('auth-password'),
    authSubmit: document.getElementById('auth-submit'),
    authSubmitText: document.getElementById('auth-submit-text'),
    authRecoveryView: document.getElementById('auth-recovery-view'),
    authRecoveryForm: document.getElementById('auth-recovery-form'),
    authNewPassword: document.getElementById('auth-new-password'),
    authSavePassBtn: document.getElementById('auth-save-pass-btn'),
    authCancelPassBtn: document.getElementById('auth-cancel-pass-btn'),
    authUserView: document.getElementById('auth-user-view'),
    profAvatar: document.getElementById('prof-avatar'),
    profDisplayTitle: document.getElementById('prof-display-title'),
    profEmail: document.getElementById('prof-email'),
    profSyncBadge: document.getElementById('prof-sync-badge'),
    profSyncText: document.getElementById('prof-sync-text'),
    profNameInput: document.getElementById('prof-name-input'),
    profSaveName: document.getElementById('prof-save-name'),
    profSyncNow: document.getElementById('prof-sync-now'),
    profChangePass: document.getElementById('prof-change-pass'),
    profLogout: document.getElementById('prof-logout'),
    profDeleteAccount: document.getElementById('prof-delete-account'),

    // Home / Dashboard Menu
    appRoot: document.getElementById('app'),
    homeScreen: document.getElementById('home-screen'),
    btnHome: document.getElementById('btn-home'),
    homeSearch: document.getElementById('home-search'),
    homeBtnImportFile: document.getElementById('home-btn-import-file'),
    homeBtnImportText: document.getElementById('home-btn-import-text'),
    homeBtnCreate: document.getElementById('home-btn-create'),
    homeAccAvatar: document.getElementById('home-acc-avatar'),
    homeAccName: document.getElementById('home-acc-name'),
    homeAccEmail: document.getElementById('home-acc-email'),
    homeAccDot: document.getElementById('home-acc-dot'),
    homeAccStatusText: document.getElementById('home-acc-status-text'),
    homeAccBtn: document.getElementById('home-acc-btn'),
    homeSyncBtn: document.getElementById('home-sync-btn'),
    homeBtnNewFolder: document.getElementById('home-btn-new-folder'),
    homeNewFolderForm: document.getElementById('home-new-folder-form'),
    homeNewFolderName: document.getElementById('home-new-folder-name'),
    homeNewFolderColors: document.getElementById('home-new-folder-colors'),
    homeCancelFolder: document.getElementById('home-cancel-folder'),
    homeFolderList: document.getElementById('home-folder-list'),
    homeViewTitle: document.getElementById('home-view-title'),
    homeViewCount: document.getElementById('home-view-count'),
    homeFolderActions: document.getElementById('home-folder-actions'),
    homeRenameFolder: document.getElementById('home-rename-folder'),
    homeDeleteFolder: document.getElementById('home-delete-folder'),
    homeMapGrid: document.getElementById('home-map-grid'),

    // Internal Confirm / Prompt Dialog
    modalDialog: document.getElementById('modal-dialog'),
    dlgTitle: document.getElementById('dlg-title'),
    dlgClose: document.getElementById('dlg-close'),
    dlgForm: document.getElementById('dlg-form'),
    dlgMsg: document.getElementById('dlg-msg'),
    dlgInputWrap: document.getElementById('dlg-input-wrap'),
    dlgInput: document.getElementById('dlg-input'),
    dlgCancel: document.getElementById('dlg-cancel'),
    dlgOk: document.getElementById('dlg-ok')
  };

  let authTab = 'login'; // 'login' | 'signup' | 'reset'
  let authRecoveryMode = false;
  let activeFolderFilter = 'all'; // 'all' | <folder.id>
  let newFolderColor = '#2563eb';
  let draggedMapCardId = null;
  let activeDialogResolve = null;
  let exportTargetMapId = null;

  function isMobileMode() {
    return (
      window.matchMedia('(max-width: 820px)').matches ||
      window.matchMedia('(pointer: coarse) and (max-width: 1024px)').matches ||
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '')
    );
  }

  function syncMobileMode() {
    const mobile = isMobileMode();
    document.body.classList.toggle('is-mobile', mobile);
    if (mobile && dom.appRoot && !dom.appRoot.hidden) {
      showHomeScreen();
    }
    return mobile;
  }

  function getExportTargetMap() {
    if (exportTargetMapId) {
      const found = store.maps.find((m) => m.id === exportTargetMapId);
      if (found) return found;
    }
    return store.getMap();
  }

  function quickDownloadMap(mapId = null) {
    const target = mapId
      ? store.maps.find((m) => m.id === mapId)
      : getExportTargetMap();
    if (!target) {
      showToast('Nessuna mappa disponibile da scaricare.', 'error');
      return;
    }
    exportPdf(target, exportOpts);
  }

  function closeInternalDialog(result) {
    if (dom.modalDialog) dom.modalDialog.hidden = true;
    if (activeDialogResolve) {
      const fn = activeDialogResolve;
      activeDialogResolve = null;
      fn(result);
    }
  }

  function openConfirmDialog({ title = 'Conferma', message = '', confirmText = 'Conferma', danger = false } = {}) {
    if (activeDialogResolve) closeInternalDialog(false);
    return new Promise((resolve) => {
      activeDialogResolve = resolve;
      if (dom.dlgTitle) dom.dlgTitle.textContent = title;
      if (dom.dlgMsg) {
        dom.dlgMsg.textContent = message;
        dom.dlgMsg.hidden = !message;
      }
      if (dom.dlgInputWrap) dom.dlgInputWrap.hidden = true;
      if (dom.dlgOk) {
        dom.dlgOk.textContent = confirmText;
        dom.dlgOk.className = danger ? 'btn danger-solid' : 'btn primary';
      }
      if (dom.modalDialog) dom.modalDialog.hidden = false;
      dom.dlgOk?.focus();
    });
  }

  function openPromptDialog({
    title = 'Rinomina',
    message = '',
    defaultValue = '',
    placeholder = '',
    confirmText = 'Salva'
  } = {}) {
    if (activeDialogResolve) closeInternalDialog(null);
    return new Promise((resolve) => {
      activeDialogResolve = (ok) => {
        if (!ok) {
          resolve(null);
          return;
        }
        const val = (dom.dlgInput?.value || '').trim();
        resolve(val || null);
      };
      if (dom.dlgTitle) dom.dlgTitle.textContent = title;
      if (dom.dlgMsg) {
        dom.dlgMsg.textContent = message;
        dom.dlgMsg.hidden = !message;
      }
      if (dom.dlgInputWrap) dom.dlgInputWrap.hidden = false;
      if (dom.dlgInput) {
        dom.dlgInput.value = defaultValue || '';
        dom.dlgInput.placeholder = placeholder || '';
      }
      if (dom.dlgOk) {
        dom.dlgOk.textContent = confirmText;
        dom.dlgOk.className = 'btn primary';
      }
      if (dom.modalDialog) dom.modalDialog.hidden = false;
      setTimeout(() => {
        dom.dlgInput?.focus();
        dom.dlgInput?.select();
      }, 20);
    });
  }

  function init() {
    hydrateIcons(document);

    store.onSaveState = (st) => {
      if (!dom.saveState) return;
      if (st === 'saving') {
        dom.saveState.textContent = 'Salvataggio…';
        dom.saveState.className = 'save-state saving';
      } else if (st === 'error') {
        dom.saveState.textContent = 'Spazio pieno';
        dom.saveState.className = 'save-state error';
      } else if (window.CMCloud && window.CMCloud.isLoggedIn() && window.CMCloud.hasPendingChanges()) {
        dom.saveState.textContent = 'Salvataggio online…';
        dom.saveState.className = 'save-state saving';
      } else {
        dom.saveState.textContent = window.CMCloud && window.CMCloud.isLoggedIn() ? 'Salvato online' : 'Salvato';
        dom.saveState.className = 'save-state';
      }
    };

    const map = store.getMap();
    selectedId = map ? map.root.id : null;

    bindToolbarEvents();
    bindCanvasEvents();
    bindKeyboardEvents();
    bindModalEvents();
    bindCloudEvents();
    bindHomeEvents();

    syncMobileMode();
    window.addEventListener('resize', debounce(() => {
      const wasMobile = document.body.classList.contains('is-mobile');
      const nowMobile = syncMobileMode();
      if (wasMobile !== nowMobile) {
        renderHomeScreen();
      }
    }, 120));

    // All'avvio mostriamo sempre il menu principale (Home / Dashboard)
    showHomeScreen();

    // Login + salvataggio online (Supabase). Se non configurato l'app resta solo locale.
    if (window.CMCloud) {
      window.CMCloud.init(store).then(() => {
        updateAuthUI();
        renderHomeScreen();
      });
    }
    updateAuthUI();
  }

  // =========================================================================
  // HOME / DASHBOARD MENU (ACCOUNT, CARTELLE E MAPPE)
  // =========================================================================

  function currentRealFolderId() {
    if (activeFolderFilter !== 'all') {
      if (store.folders.some((f) => f.id === activeFolderFilter)) {
        return activeFolderFilter;
      }
    }
    return '';
  }

  function showHomeScreen() {
    commitInlineEditor();
    if (dom.appRoot) dom.appRoot.hidden = true;
    if (dom.homeScreen) dom.homeScreen.hidden = false;
    renderHomeScreen();
    updateAuthUI();
  }

  function openMapInEditor(mapId) {
    if (isMobileMode()) {
      showToast('La creazione e modifica delle mappe è disponibile solo da computer.');
      return;
    }
    store.setActiveMap(mapId);
    const map = store.getMap();
    if (!map) return;
    selectedId = map.root.id;
    selectedLinkId = null;
    if (dom.homeScreen) dom.homeScreen.hidden = true;
    if (dom.appRoot) dom.appRoot.hidden = false;
    refreshAll(true);
  }

  function renderHomeScreen() {
    if (!dom.homeScreen) return;
    const mobile = syncMobileMode();

    // Se la cartella selezionata non esiste più, torniamo a "Tutte le mappe"
    if (
      activeFolderFilter !== 'all' &&
      !store.folders.some((f) => f.id === activeFolderFilter)
    ) {
      activeFolderFilter = 'all';
    }

    const folderById = new Map(store.folders.map((f) => [f.id, f]));
    const totalCount = store.maps.length;

    // 1. Elenco cartelle nella sidebar ("Tutte le mappe" + cartelle create dall'utente)
    const folderItems = [
      `
        <div class="hf-item${activeFolderFilter === 'all' ? ' active' : ''}" data-folder-filter="all" data-drop-folder="">
          <span class="hf-ic">${svgIcon('grid', 17)}</span>
          <span class="hf-name">Tutte le mappe</span>
          <span class="hf-badge">${totalCount}</span>
        </div>
      `
    ];

    for (const f of store.folders) {
      const cnt = store.maps.filter((m) => m.folderId === f.id).length;
      const isAct = activeFolderFilter === f.id ? ' active' : '';
      folderItems.push(`
        <div class="hf-item${isAct}" data-folder-filter="${escapeHtml(f.id)}" data-drop-folder="${escapeHtml(f.id)}">
          <span class="hf-ic" style="color:${escapeHtml(f.color)}">${svgIcon('folder', 17)}</span>
          <span class="hf-name">${escapeHtml(f.name)}</span>
          <span class="hf-badge">${cnt}</span>
        </div>
      `);
    }

    if (dom.homeFolderList) {
      dom.homeFolderList.innerHTML = folderItems.join('');
    }

    // 2. Intestazione vista corrente e pulsanti gestione cartella
    const activeFolderObj = folderById.get(activeFolderFilter) || null;
    if (dom.homeViewTitle) {
      dom.homeViewTitle.textContent =
        activeFolderFilter === 'all' ? 'Tutte le mappe' : activeFolderObj?.name || 'Cartella';
    }
    if (dom.homeFolderActions) {
      dom.homeFolderActions.hidden = !activeFolderObj;
    }

    // 3. Filtra mappe per cartella e ricerca
    const query = (dom.homeSearch?.value || '').trim().toLowerCase();
    const filtered = store.maps.filter((m) => {
      if (activeFolderFilter !== 'all') {
        if (m.folderId !== activeFolderFilter) return false;
      }
      if (query) {
        const t = (m.title || '').toLowerCase();
        if (!t.includes(query)) return false;
      }
      return true;
    });

    if (dom.homeViewCount) {
      dom.homeViewCount.textContent = `${filtered.length} mapp${filtered.length === 1 ? 'a' : 'e'}`;
    }

    // 4. Griglia mappe o stato vuoto
    if (!dom.homeMapGrid) return;

    if (filtered.length === 0) {
      const isSearch = Boolean(query);
      const isLoggedIn = Boolean(window.CMCloud && window.CMCloud.isLoggedIn());
      if (mobile) {
        dom.homeMapGrid.innerHTML = `
          <div class="home-empty">
            <div class="he-icon">${svgIcon('folder', 28)}</div>
            <h2>${
              isSearch
                ? 'Nessuna mappa trovata'
                : activeFolderObj
                ? `La cartella "${escapeHtml(activeFolderObj.name)}" è vuota`
                : 'Nessuna mappa disponibile'
            }</h2>
            <p>${
              isSearch
                ? 'Prova a cercare con un altro termine oppure azzera la barra di ricerca.'
                : isLoggedIn
                ? 'La creazione di nuove mappe è disponibile solo da computer. Quando crei una mappa dal PC la troverai sincronizzata qui pronta da scaricare.'
                : 'Da smartphone puoi consultare e scaricare le tue mappe. Accedi al tuo account per sincronizzare le mappe che hai creato da computer.'
            }</p>
            ${
              !isSearch && !isLoggedIn
                ? `<div class="he-btns">
                     <button type="button" class="btn primary" data-empty-login>${svgIcon('user', 17)}<span>Accedi all'account</span></button>
                   </div>`
                : ''
            }
          </div>
        `;
      } else {
        dom.homeMapGrid.innerHTML = `
          <div class="home-empty">
            <div class="he-icon">${svgIcon('folderPlus', 28)}</div>
            <h2>${
              isSearch
                ? 'Nessuna mappa trovata'
                : activeFolderObj
                ? `La cartella "${escapeHtml(activeFolderObj.name)}" è vuota`
                : 'Non hai ancora creato nessuna mappa'
            }</h2>
            <p>${
              isSearch
                ? 'Prova a cercare con un altro termine oppure azzera la barra di ricerca.'
                : 'L\'editor non crea mappe da solo: clicca qui sotto quando vuoi iniziare una nuova mappa concettuale o generarla da un testo.'
            }</p>
            <div class="he-btns">
              <button type="button" class="btn primary" data-empty-create>${svgIcon('plus', 17)}<span>Crea nuova mappa</span></button>
              <button type="button" class="btn" data-empty-import-text>${svgIcon('wand', 17)}<span>Crea da testo</span></button>
            </div>
          </div>
        `;
      }
      return;
    }

    const folderOptionsHtml = (selectedFolderId) => {
      const opts = [
        `<option value=""${!selectedFolderId || !folderById.has(selectedFolderId) ? ' selected' : ''}>Nessuna</option>`
      ];
      for (const f of store.folders) {
        const sel = f.id === selectedFolderId ? ' selected' : '';
        opts.push(`<option value="${escapeHtml(f.id)}"${sel}>${escapeHtml(f.name)}</option>`);
      }
      return opts.join('');
    };

    dom.homeMapGrid.innerHTML = filtered
      .map((m) => {
        const count = countNodesInTree(m.root);
        const fObj = m.folderId ? folderById.get(m.folderId) : null;
        const theme = getTheme(m.style?.theme, false);
        let previewInner = '';
        let viewBoxAttr = '0 0 400 240';
        try {
          const built = buildStandaloneSvg(m, { transparentBg: true });
          viewBoxAttr = `${built.minX} ${built.minY} ${built.width} ${built.height}`;
          previewInner = built.svg.replace(/^<svg[^>]*>|<\/svg>$/g, '');
        } catch {}

        const pillHtml = fObj
          ? `<div class="mc-folder-pill"><span class="mc-folder-dot" style="background:${escapeHtml(fObj.color)}"></span><span>${escapeHtml(fObj.name)}</span></div>`
          : '';

        const primaryCardActionAttr = mobile
          ? `data-export-map="${escapeHtml(m.id)}"`
          : `data-open-map="${escapeHtml(m.id)}"`;

        return `
          <article class="map-card" draggable="${!mobile}" data-card-map-id="${escapeHtml(m.id)}">
            <div class="mc-preview" ${primaryCardActionAttr} style="background:${escapeHtml(theme.bg)}">
              ${pillHtml}
              <svg viewBox="${viewBoxAttr}" preserveAspectRatio="xMidYMid meet">${previewInner}</svg>
            </div>
            <div class="mc-body">
              <div class="mc-title" ${primaryCardActionAttr} title="${escapeHtml(m.title)}">${escapeHtml(m.title || 'Senza titolo')}</div>
              <div class="mc-meta">${count} concett${count === 1 ? 'o' : 'i'} · ${formatDate(m.updatedAt)}</div>
              <div class="mc-folder-row">
                <label>Cartella:</label>
                <select class="mc-folder-select" data-map-folder="${escapeHtml(m.id)}">
                  ${folderOptionsHtml(m.folderId)}
                </select>
              </div>
            </div>
            <div class="mc-actions">
              <button type="button" class="btn primary small mc-desktop-only" data-open-map="${escapeHtml(m.id)}">Apri</button>
              <button type="button" class="btn small mc-dl-action" data-quick-download="${escapeHtml(m.id)}" title="Scarica subito in PDF">${svgIcon('download', 15)}<span>Scarica</span></button>
              <button type="button" class="icon-btn" data-rename-map="${escapeHtml(m.id)}" title="Rinomina mappa">${svgIcon('edit', 16)}</button>
              <button type="button" class="icon-btn mc-desktop-only" data-dup-map="${escapeHtml(m.id)}" title="Duplica mappa">${svgIcon('copy', 16)}</button>
              <button type="button" class="icon-btn" style="color:var(--danger)" data-del-map="${escapeHtml(m.id)}" title="Elimina mappa">${svgIcon('trash', 16)}</button>
            </div>
          </article>
        `;
      })
      .join('');
  }

  function bindHomeEvents() {
    dom.btnHome?.addEventListener('click', () => showHomeScreen());

    dom.homeSearch?.addEventListener('input', () => renderHomeScreen());

    dom.homeBtnCreate?.addEventListener('click', () => {
      if (isMobileMode()) {
        showToast('La creazione di nuove mappe è disponibile solo da computer.');
        return;
      }
      const m = store.createNewMap(null, currentRealFolderId());
      openMapInEditor(m.id);
      showToast('Nuova mappa creata!');
    });

    dom.homeBtnImportText?.addEventListener('click', () => {
      if (isMobileMode()) {
        showToast('La creazione di nuove mappe è disponibile solo da computer.');
        return;
      }
      openImportModal();
    });

    dom.homeBtnImportFile?.addEventListener('click', () => {
      if (isMobileMode()) {
        showToast('L\'importazione di mappe è disponibile solo da computer.');
        return;
      }
      dom.fileOpen.value = '';
      dom.fileOpen.click();
    });

    dom.homeAccBtn?.addEventListener('click', () => openAuthModal());

    dom.homeSyncBtn?.addEventListener('click', async () => {
      if (!window.CMCloud) return;
      dom.homeSyncBtn.disabled = true;
      const ok = await window.CMCloud.syncNow();
      dom.homeSyncBtn.disabled = false;
      renderHomeScreen();
      updateAuthUI();
      if (ok) showToast('Mappe sincronizzate col cloud!', 'ok');
    });

    // Creazione nuova cartella
    dom.homeBtnNewFolder?.addEventListener('click', () => {
      if (!dom.homeNewFolderForm) return;
      dom.homeNewFolderForm.hidden = !dom.homeNewFolderForm.hidden;
      if (!dom.homeNewFolderForm.hidden) {
        dom.homeNewFolderName.value = '';
        dom.homeNewFolderName.focus();
      }
    });

    dom.homeCancelFolder?.addEventListener('click', () => {
      if (dom.homeNewFolderForm) dom.homeNewFolderForm.hidden = true;
    });

    dom.homeNewFolderColors?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-color]');
      if (!btn) return;
      newFolderColor = btn.getAttribute('data-color') || '#2563eb';
      dom.homeNewFolderColors.querySelectorAll('.hf-col').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
    });

    dom.homeNewFolderForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = dom.homeNewFolderName?.value.trim() || '';
      if (!name) {
        showToast('Inserisci un nome per la cartella.', 'error');
        return;
      }
      const f = store.createFolder(name, newFolderColor);
      if (f) {
        activeFolderFilter = f.id;
        dom.homeNewFolderForm.hidden = true;
        dom.homeNewFolderName.value = '';
        renderHomeScreen();
        showToast(`Cartella "${f.name}" creata!`, 'ok');
      }
    });

    // Selezione cartella e drag & drop di una mappa sopra una cartella
    dom.homeFolderList?.addEventListener('click', (e) => {
      const item = e.target.closest('[data-folder-filter]');
      if (!item) return;
      activeFolderFilter = item.getAttribute('data-folder-filter') || 'all';
      renderHomeScreen();
    });

    dom.homeFolderList?.addEventListener('dragover', (e) => {
      const dropTarget = e.target.closest('[data-drop-folder]');
      if (!dropTarget || !draggedMapCardId) return;
      e.preventDefault();
      dropTarget.classList.add('drop-over');
    });

    dom.homeFolderList?.addEventListener('dragleave', (e) => {
      const dropTarget = e.target.closest('[data-drop-folder]');
      if (dropTarget) dropTarget.classList.remove('drop-over');
    });

    dom.homeFolderList?.addEventListener('drop', (e) => {
      const dropTarget = e.target.closest('[data-drop-folder]');
      if (!dropTarget || !draggedMapCardId) return;
      e.preventDefault();
      dropTarget.classList.remove('drop-over');
      const folderId = dropTarget.getAttribute('data-drop-folder') || '';
      store.setMapFolder(draggedMapCardId, folderId);
      draggedMapCardId = null;
      renderHomeScreen();
      showToast(folderId ? 'Mappa spostata nella cartella!' : 'Mappa rimossa dalla cartella.');
    });

    // Dialogo interno (conferma / rinomina)
    dom.dlgClose?.addEventListener('click', () => closeInternalDialog(false));
    dom.dlgCancel?.addEventListener('click', () => closeInternalDialog(false));
    dom.modalDialog?.addEventListener('click', (e) => {
      if (e.target === dom.modalDialog) closeInternalDialog(false);
    });
    dom.dlgForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      closeInternalDialog(true);
    });

    // Rinomina / Elimina cartella selezionata
    dom.homeRenameFolder?.addEventListener('click', async () => {
      const folderId = currentRealFolderId();
      const f = store.folders.find((x) => x.id === folderId);
      if (!f) return;
      const next = await openPromptDialog({
        title: 'Rinomina cartella',
        message: 'Inserisci il nuovo nome della cartella:',
        defaultValue: f.name,
        confirmText: 'Salva'
      });
      if (next && next.trim()) {
        store.renameFolder(f.id, next.trim());
        renderHomeScreen();
        showToast('Cartella rinominata.');
      }
    });

    dom.homeDeleteFolder?.addEventListener('click', async () => {
      const folderId = currentRealFolderId();
      const f = store.folders.find((x) => x.id === folderId);
      if (!f) return;
      const ok = await openConfirmDialog({
        title: 'Elimina cartella',
        message: `Vuoi eliminare la cartella "${f.name}"? Le mappe al suo interno non verranno cancellate ma rimarranno visibili in "Tutte le mappe".`,
        confirmText: 'Elimina cartella',
        danger: true
      });
      if (!ok) return;
      store.deleteFolder(f.id);
      activeFolderFilter = 'all';
      renderHomeScreen();
      showToast('Cartella eliminata.');
    });

    // Eventi sulle card delle mappe nella griglia
    dom.homeMapGrid?.addEventListener('click', async (e) => {
      if (e.target.closest('[data-empty-login]')) {
        openAuthModal('login');
        return;
      }
      if (e.target.closest('[data-empty-create]')) {
        if (isMobileMode()) {
          showToast('La creazione di mappe è disponibile solo da computer.');
          return;
        }
        const m = store.createNewMap(null, currentRealFolderId());
        openMapInEditor(m.id);
        showToast('Nuova mappa creata!');
        return;
      }
      if (e.target.closest('[data-empty-import-text]')) {
        if (isMobileMode()) {
          showToast('La creazione di mappe è disponibile solo da computer.');
          return;
        }
        openImportModal();
        return;
      }

      const quickDlBtn = e.target.closest('[data-quick-download]');
      if (quickDlBtn) {
        e.stopPropagation();
        quickDownloadMap(quickDlBtn.getAttribute('data-quick-download'));
        return;
      }

      const expBtn = e.target.closest('[data-export-map]');
      if (expBtn) {
        e.stopPropagation();
        openExportModal(expBtn.getAttribute('data-export-map'));
        return;
      }

      const openEl = e.target.closest('[data-open-map]');
      if (openEl) {
        const targetId = openEl.getAttribute('data-open-map');
        if (isMobileMode()) {
          openExportModal(targetId);
          return;
        }
        openMapInEditor(targetId);
        return;
      }

      const renBtn = e.target.closest('[data-rename-map]');
      if (renBtn) {
        const id = renBtn.getAttribute('data-rename-map');
        const m = store.maps.find((x) => x.id === id);
        if (!m) return;
        const next = await openPromptDialog({
          title: 'Rinomina mappa',
          message: 'Inserisci il nuovo titolo della mappa:',
          defaultValue: m.title,
          confirmText: 'Salva'
        });
        if (next && next.trim()) {
          store.renameMap(id, next.trim());
          renderHomeScreen();
          renderSidebarList();
          showToast('Mappa rinominata!');
        }
        return;
      }

      const dupBtn = e.target.closest('[data-dup-map]');
      if (dupBtn) {
        if (isMobileMode()) {
          showToast('La creazione di mappe è disponibile solo da computer.');
          return;
        }
        const id = dupBtn.getAttribute('data-dup-map');
        const m = store.duplicateMap(id);
        if (m) {
          renderHomeScreen();
          renderSidebarList();
          showToast('Mappa duplicata!');
        }
        return;
      }

      const delBtn = e.target.closest('[data-del-map]');
      if (delBtn) {
        const id = delBtn.getAttribute('data-del-map');
        const m = store.maps.find((x) => x.id === id);
        if (!m) return;
        const ok = await openConfirmDialog({
          title: 'Elimina mappa',
          message: `Vuoi eliminare definitivamente la mappa "${m.title}"?`,
          confirmText: 'Elimina',
          danger: true
        });
        if (!ok) return;
        store.deleteMap(id);
        renderHomeScreen();
        renderSidebarList();
        showToast('Mappa eliminata.');
      }
    });

    dom.homeMapGrid?.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-map-folder]');
      if (!sel) return;
      const mapId = sel.getAttribute('data-map-folder');
      store.setMapFolder(mapId, sel.value);
      renderHomeScreen();
      showToast(sel.value ? 'Mappa spostata nella cartella!' : 'Mappa rimossa dalla cartella.');
    });

    dom.homeMapGrid?.addEventListener('dragstart', (e) => {
      const card = e.target.closest('[data-card-map-id]');
      if (!card) return;
      draggedMapCardId = card.getAttribute('data-card-map-id');
    });

    dom.homeMapGrid?.addEventListener('dragend', () => {
      draggedMapCardId = null;
      dom.homeFolderList?.querySelectorAll('.drop-over').forEach((el) => el.classList.remove('drop-over'));
    });
  }

  // =========================================================================
  // CLOUD & AUTH (login, registrazione, profilo e sincronizzazione online)
  // =========================================================================

  function setAuthMessage(text, type = '') {
    if (!dom.authMsg) return;
    if (!text) {
      dom.authMsg.hidden = true;
      dom.authMsg.textContent = '';
      dom.authMsg.className = 'auth-msg';
      return;
    }
    dom.authMsg.hidden = false;
    dom.authMsg.textContent = text;
    dom.authMsg.className = 'auth-msg' + (type ? ` ${type}` : '');
  }

  function openAuthModal(defaultTab = null) {
    commitInlineEditor();
    if (defaultTab) authTab = defaultTab;
    setAuthMessage('', '');
    updateAuthUI();
    if (dom.modalAuth) dom.modalAuth.hidden = false;

    if (authRecoveryMode) {
      dom.authNewPassword?.focus();
    } else if (window.CMCloud && !window.CMCloud.isLoggedIn()) {
      dom.authEmail?.focus();
    }
  }

  function updateAuthUI() {
    const cloud = window.CMCloud;
    if (!cloud) return;

    const isConfigured = cloud.isConfigured();
    const isLoggedIn = cloud.isLoggedIn();
    const user = cloud.getUser();
    const sync = cloud.getStatus();
    const displayName = cloud.getDisplayName();
    const initial = ((displayName || user?.email || 'U').trim().charAt(0) || 'U').toUpperCase();

    // 1. Pulsante Account nella barra superiore
    if (dom.btnAuth) {
      dom.btnAuth.classList.toggle('logged-in', isLoggedIn);
      if (isLoggedIn) {
        if (dom.authAvatar) {
          dom.authAvatar.hidden = false;
          dom.authAvatar.textContent = initial;
        }
        if (dom.authIcon) dom.authIcon.hidden = true;
        if (dom.authLabel) dom.authLabel.textContent = displayName || 'Account';
        if (dom.authDot) {
          const dotState =
            sync.status === 'syncing'
              ? 'syncing'
              : sync.status === 'error'
              ? 'error'
              : sync.status === 'offline'
              ? 'offline'
              : 'online';
          dom.authDot.className = `auth-dot ${dotState}`;
        }
      } else {
        if (dom.authAvatar) dom.authAvatar.hidden = true;
        if (dom.authIcon) dom.authIcon.hidden = false;
        if (dom.authLabel) dom.authLabel.textContent = 'Accedi';
        if (dom.authDot) dom.authDot.className = 'auth-dot';
      }
    }

    // 2. Barra stato cloud nella barra laterale sinistra
    if (dom.sbCloudBar) {
      if (isLoggedIn) {
        const dotCls =
          sync.status === 'syncing'
            ? 'sync'
            : sync.status === 'error'
            ? 'err'
            : sync.status === 'offline'
            ? 'warn'
            : 'ok';
        if (dom.sbcDot) dom.sbcDot.className = `sbc-dot ${dotCls}`;
        if (dom.sbcText) {
          dom.sbcText.textContent =
            sync.status === 'syncing'
              ? 'Sincronizzazione…'
              : sync.status === 'error'
              ? 'Errore salvataggio cloud'
              : sync.status === 'offline'
              ? 'Offline · salvato qui'
              : `Cloud · ${displayName || user?.email || 'Attivo'}`;
        }
        if (dom.sbcBtn) dom.sbcBtn.textContent = 'Profilo';
      } else if (isConfigured) {
        if (dom.sbcDot) dom.sbcDot.className = 'sbc-dot';
        if (dom.sbcText) dom.sbcText.textContent = 'Salvataggio solo locale';
        if (dom.sbcBtn) dom.sbcBtn.textContent = 'Accedi';
      } else {
        if (dom.sbcDot) dom.sbcDot.className = 'sbc-dot';
        if (dom.sbcText) dom.sbcText.textContent = 'Modalità locale';
        if (dom.sbcBtn) dom.sbcBtn.textContent = 'Cloud';
      }
    }

    // 2b. Scheda Account nella schermata Home / Dashboard
    if (dom.homeAccName) {
      if (isLoggedIn && user) {
        if (dom.homeAccAvatar) dom.homeAccAvatar.textContent = initial;
        dom.homeAccName.textContent = displayName || 'Account attivo';
        if (dom.homeAccEmail) dom.homeAccEmail.textContent = user.email || '';
        const dotCls =
          sync.status === 'syncing'
            ? 'syncing'
            : sync.status === 'error'
            ? 'error'
            : sync.status === 'offline'
            ? 'offline'
            : 'ok';
        if (dom.homeAccDot) dom.homeAccDot.className = `sbc-dot ${dotCls}`;
        if (dom.homeAccStatusText) {
          dom.homeAccStatusText.textContent =
            sync.status === 'syncing'
              ? 'Sincronizzazione in corso…'
              : sync.status === 'error'
              ? 'Errore sincronizzazione cloud'
              : sync.status === 'offline'
              ? 'Offline · salvato sul dispositivo'
              : 'Mappe sincronizzate online';
        }
        if (dom.homeAccBtn) {
          dom.homeAccBtn.textContent = 'Gestisci account';
          dom.homeAccBtn.className = 'btn small block';
        }
        if (dom.homeSyncBtn) dom.homeSyncBtn.hidden = false;
      } else {
        if (dom.homeAccAvatar) dom.homeAccAvatar.innerHTML = svgIcon('user', 18);
        dom.homeAccName.textContent = 'Ospite';
        if (dom.homeAccEmail) dom.homeAccEmail.textContent = 'Non connesso';
        if (dom.homeAccDot) dom.homeAccDot.className = 'sbc-dot';
        if (dom.homeAccStatusText) {
          dom.homeAccStatusText.textContent = 'Accedi per salvare le mappe online';
        }
        if (dom.homeAccBtn) {
          dom.homeAccBtn.textContent = 'Accedi / Registrati';
          dom.homeAccBtn.className = 'btn primary small block';
        }
        if (dom.homeSyncBtn) dom.homeSyncBtn.hidden = true;
      }
    }

    // 3. Banner configurazione Supabase nel modal
    if (dom.authCfgBanner) {
      const savedCfg = cloud.getSavedLocalConfig() || window.CM_CONFIG || {};
      if (dom.authCfgUrl && !dom.authCfgUrl.value && savedCfg.supabaseUrl) {
        dom.authCfgUrl.value = savedCfg.supabaseUrl;
      }
      if (dom.authCfgKey && !dom.authCfgKey.value && savedCfg.supabaseAnonKey) {
        dom.authCfgKey.value = savedCfg.supabaseAnonKey;
      }
      dom.authCfgBanner.hidden = isConfigured && dom.authCfgBox?.hidden !== false;
    }

    // 4. Viste interne del modal Auth
    if (!dom.modalAuth) return;

    if (authRecoveryMode) {
      if (dom.authModalTitle) dom.authModalTitle.textContent = 'Imposta nuova password';
      if (dom.authGuestView) dom.authGuestView.hidden = true;
      if (dom.authUserView) dom.authUserView.hidden = true;
      if (dom.authRecoveryView) dom.authRecoveryView.hidden = false;
      return;
    }

    if (isLoggedIn && user) {
      if (dom.authModalTitle) dom.authModalTitle.textContent = 'Il tuo account';
      if (dom.authGuestView) dom.authGuestView.hidden = true;
      if (dom.authRecoveryView) dom.authRecoveryView.hidden = true;
      if (dom.authUserView) dom.authUserView.hidden = false;

      if (dom.profAvatar) dom.profAvatar.textContent = initial;
      if (dom.profDisplayTitle) dom.profDisplayTitle.textContent = displayName || 'Utente';
      if (dom.profEmail) dom.profEmail.textContent = user.email || '';
      if (dom.profNameInput && document.activeElement !== dom.profNameInput) {
        dom.profNameInput.value = user.user_metadata?.display_name || displayName || '';
      }

      if (dom.profSyncBadge) {
        const badgeDot = dom.profSyncBadge.querySelector('.sbc-dot');
        const dotCls =
          sync.status === 'syncing'
            ? 'sync'
            : sync.status === 'error'
            ? 'err'
            : sync.status === 'offline'
            ? 'warn'
            : 'ok';
        if (badgeDot) badgeDot.className = `sbc-dot ${dotCls}`;
      }
      if (dom.profSyncText) {
        dom.profSyncText.textContent =
          sync.status === 'syncing'
            ? 'Sincronizzazione in corso…'
            : sync.status === 'error'
            ? sync.message || 'Errore di sincronizzazione'
            : sync.status === 'offline'
            ? 'Offline · modifiche salvate sul dispositivo'
            : 'Tutte le mappe sono sincronizzate nel cloud';
      }
    } else {
      if (dom.authModalTitle) dom.authModalTitle.textContent = 'Account e salvataggio online';
      if (dom.authGuestView) dom.authGuestView.hidden = false;
      if (dom.authRecoveryView) dom.authRecoveryView.hidden = true;
      if (dom.authUserView) dom.authUserView.hidden = true;

      if (dom.authTabs) {
        dom.authTabs.querySelectorAll('button[data-auth-tab]').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-auth-tab') === authTab);
        });
      }
      if (dom.authNameWrap) dom.authNameWrap.hidden = authTab !== 'signup';
      if (dom.authPassWrap) dom.authPassWrap.hidden = authTab === 'reset';
      if (dom.authPassword) {
        dom.authPassword.required = authTab !== 'reset';
        dom.authPassword.autocomplete = authTab === 'signup' ? 'new-password' : 'current-password';
      }
      if (dom.authSubmitText) {
        dom.authSubmitText.textContent =
          authTab === 'login'
            ? "Accedi all'account"
            : authTab === 'signup'
            ? 'Crea account gratuito'
            : 'Invia link di recupero password';
      }
    }
  }

  function bindCloudEvents() {
    // Apertura modal da barra superiore e da barra laterale
    dom.btnAuth?.addEventListener('click', () => openAuthModal());
    dom.sbcBtn?.addEventListener('click', () => openAuthModal());

    // Cambio scheda Accedi / Registrati / Password dimenticata
    dom.authTabs?.querySelectorAll('button[data-auth-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        authTab = btn.getAttribute('data-auth-tab') || 'login';
        setAuthMessage('', '');
        updateAuthUI();
      });
    });

    // Configurazione diretta URL + Anon Key di Supabase
    dom.authCfgToggle?.addEventListener('click', () => {
      if (!dom.authCfgBox) return;
      dom.authCfgBox.hidden = !dom.authCfgBox.hidden;
    });

    dom.authCfgSave?.addEventListener('click', async () => {
      const url = dom.authCfgUrl?.value.trim() || '';
      const key = dom.authCfgKey?.value.trim() || '';
      if (!url || !key) {
        setAuthMessage('Inserisci sia il Project URL sia la Anon Key di Supabase.', 'error');
        return;
      }
      dom.authCfgSave.disabled = true;
      const res = await window.CMCloud.configure(url, key);
      dom.authCfgSave.disabled = false;
      if (res.configured) {
        if (dom.authCfgBox) dom.authCfgBox.hidden = true;
        setAuthMessage('Database Supabase collegato! Ora puoi registrarti o accedere.', 'ok');
        showToast('Database cloud collegato!', 'ok');
      } else {
        setAuthMessage('Impossibile collegare Supabase: controlla URL e chiave.', 'error');
      }
      updateAuthUI();
    });

    dom.authCfgClear?.addEventListener('click', async () => {
      if (dom.authCfgUrl) dom.authCfgUrl.value = '';
      if (dom.authCfgKey) dom.authCfgKey.value = '';
      await window.CMCloud.configure('', '');
      setAuthMessage('Collegamento locale rimosso.', 'info');
      updateAuthUI();
    });

    // Invio modulo principale (Accedi / Registrati / Recupera password)
    dom.authForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!window.CMCloud) return;

      const email = dom.authEmail?.value.trim() || '';
      const password = dom.authPassword?.value || '';
      const name = dom.authName?.value.trim() || '';

      if (!email) {
        setAuthMessage('Inserisci il tuo indirizzo email.', 'error');
        return;
      }

      dom.authSubmit.disabled = true;
      setAuthMessage('Attendere…', 'info');

      try {
        if (authTab === 'login') {
          const res = await window.CMCloud.signIn(email, password);
          if (!res.ok) {
            setAuthMessage(res.error, 'error');
          } else {
            setAuthMessage('', '');
            dom.authPassword.value = '';
            dom.modalAuth.hidden = true;
            showToast('Accesso effettuato! Mappe sincronizzate.', 'ok');
          }
        } else if (authTab === 'signup') {
          const res = await window.CMCloud.signUp(email, password, name);
          if (!res.ok) {
            setAuthMessage(res.error, 'error');
          } else if (res.needsConfirmation) {
            setAuthMessage(
              'Registrazione completata! Controlla la tua casella email (anche in Spam) e clicca sul link di conferma per attivare l\'account.',
              'ok'
            );
            dom.authPassword.value = '';
          } else {
            setAuthMessage('', '');
            dom.authPassword.value = '';
            dom.modalAuth.hidden = true;
            showToast('Benvenuto! Account creato e mappe salvate online.', 'ok');
          }
        } else if (authTab === 'reset') {
          const res = await window.CMCloud.sendPasswordReset(email);
          if (!res.ok) {
            setAuthMessage(res.error, 'error');
          } else {
            setAuthMessage(
              'Ti abbiamo inviato un\'email con il link per scegliere una nuova password.',
              'ok'
            );
          }
        }
      } finally {
        dom.authSubmit.disabled = false;
        updateAuthUI();
      }
    });

    // Impostazione nuova password (da link email o da pulsante "Cambia password")
    dom.authRecoveryForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newPass = dom.authNewPassword?.value || '';
      if (newPass.length < 6) {
        setAuthMessage('La nuova password deve avere almeno 6 caratteri.', 'error');
        return;
      }
      dom.authSavePassBtn.disabled = true;
      const res = await window.CMCloud.updatePassword(newPass);
      dom.authSavePassBtn.disabled = false;
      if (!res.ok) {
        setAuthMessage(res.error, 'error');
      } else {
        authRecoveryMode = false;
        dom.authNewPassword.value = '';
        setAuthMessage('Password aggiornata con successo!', 'ok');
        showToast('Password aggiornata!', 'ok');
        updateAuthUI();
      }
    });

    dom.authCancelPassBtn?.addEventListener('click', () => {
      authRecoveryMode = false;
      if (dom.authNewPassword) dom.authNewPassword.value = '';
      setAuthMessage('', '');
      updateAuthUI();
    });

    // Azioni profilo utente loggato
    dom.profSaveName?.addEventListener('click', async () => {
      const display_name = dom.profNameInput?.value.trim() || '';
      dom.profSaveName.disabled = true;
      const res = await window.CMCloud.updateProfile({ display_name });
      dom.profSaveName.disabled = false;
      if (!res.ok) {
        setAuthMessage(res.error, 'error');
      } else {
        setAuthMessage('Nome aggiornato!', 'ok');
        showToast('Profilo aggiornato.', 'ok');
        updateAuthUI();
      }
    });

    dom.profSyncNow?.addEventListener('click', async () => {
      dom.profSyncNow.disabled = true;
      setAuthMessage('Sincronizzazione delle mappe in corso…', 'info');
      const ok = await window.CMCloud.syncNow();
      dom.profSyncNow.disabled = false;
      if (ok) {
        setAuthMessage('Tutte le mappe sono state sincronizzate!', 'ok');
        showToast('Mappe sincronizzate col cloud.', 'ok');
      } else {
        setAuthMessage(window.CMCloud.getStatus().message || 'Sincronizzazione non riuscita.', 'error');
      }
      updateAuthUI();
    });

    dom.profChangePass?.addEventListener('click', () => {
      authRecoveryMode = true;
      setAuthMessage('', '');
      updateAuthUI();
      dom.authNewPassword?.focus();
    });

    dom.profLogout?.addEventListener('click', async () => {
      dom.profLogout.disabled = true;
      let res = await window.CMCloud.signOut();
      if (!res.ok && res.unsynced) {
        const confirmForce = await openConfirmDialog({
          title: 'Modifiche non sincronizzate',
          message: 'Ci sono modifiche non ancora salvate online. Vuoi uscire comunque mantenendo una copia sul dispositivo?',
          confirmText: 'Esci comunque',
          danger: true
        });
        if (confirmForce) {
          res = await window.CMCloud.signOut({ force: true, keepLocalCopy: true });
        }
      }
      dom.profLogout.disabled = false;
      if (!res.ok) {
        if (!res.unsynced) setAuthMessage(res.error, 'error');
      } else {
        setAuthMessage('', '');
        dom.modalAuth.hidden = true;
        showToast('Sei uscito dall\'account.');
        updateAuthUI();
      }
    });

    dom.profDeleteAccount?.addEventListener('click', async () => {
      const sure = await openConfirmDialog({
        title: 'Elimina account',
        message: 'Sei sicuro di voler eliminare definitivamente il tuo account e tutte le mappe salvate online? Questa operazione non può essere annullata.',
        confirmText: 'Elimina definitivamente',
        danger: true
      });
      if (!sure) return;
      dom.profDeleteAccount.disabled = true;
      const res = await window.CMCloud.deleteAccount();
      dom.profDeleteAccount.disabled = false;
      if (!res.ok) {
        setAuthMessage(res.error, 'error');
      } else {
        setAuthMessage('', '');
        dom.modalAuth.hidden = true;
        showToast('Account eliminato definitivamente.');
        updateAuthUI();
      }
    });

    // Eventi emessi da CMCloud
    window.addEventListener('cm:auth', async () => {
      updateAuthUI();
      if (window.CMCloud && window.CMCloud.isLoggedIn()) {
        const prof = await window.CMCloud.getProfile();
        if (prof.ok && prof.profile?.display_name && dom.profNameInput) {
          if (document.activeElement !== dom.profNameInput) {
            dom.profNameInput.value = prof.profile.display_name;
          }
          if (dom.profDisplayTitle) dom.profDisplayTitle.textContent = prof.profile.display_name;
          if (dom.authLabel) dom.authLabel.textContent = prof.profile.display_name;
        }
      }
    });

    window.addEventListener('cm:password-recovery', () => {
      authRecoveryMode = true;
      openAuthModal();
      setAuthMessage('Inserisci la nuova password per il tuo account.', 'info');
    });

    window.addEventListener('cm:maps-changed', (e) => {
      const reason = e.detail?.reason || 'sync';
      renderHomeScreen();
      const map = store.getMap();
      if (!map) {
        selectedId = null;
        selectedLinkId = null;
        showHomeScreen();
        return;
      }
      if (!selectedId || !findNode(map.root, selectedId)) {
        selectedId = map.root.id;
        selectedLinkId = null;
      }

      if (reason === 'sync') {
        if (dom.appRoot && !dom.appRoot.hidden) {
          const typingInProps = dom.props.contains(document.activeElement);
          renderCanvas();
          renderToolbarState();
          renderSidebarList();
          updateStatusBar();
          dom.mapTitle.value = map.title;
          if (!typingInProps && !editSession) renderPropsPanel();
        }
        updateAuthUI();
        return;
      }

      // Login / logout: aggiorniamo sia il menu sia l'editor se aperto
      editSession = null;
      dom.editor.className = '';
      if (dom.appRoot && !dom.appRoot.hidden) {
        refreshAll(true);
      }
      updateAuthUI();
    });

    window.addEventListener('cm:sync', (e) => {
      updateAuthUI();
      if (!dom.saveState) return;
      const { status, message } = e.detail || {};
      const labels = {
        syncing: ['Salvataggio online…', 'save-state saving'],
        synced: ['Salvato online', 'save-state'],
        offline: ['Offline · salvato sul dispositivo', 'save-state saving'],
        error: ['Errore salvataggio online', 'save-state error']
      };
      const lbl = labels[status];
      if (!lbl) return;
      dom.saveState.textContent = lbl[0];
      dom.saveState.className = lbl[1];
      dom.saveState.title = message || '';
    });
  }

  // API pubblica dell'applicazione
  window.CMApp = {
    get store() {
      return store;
    },
    refresh: (fit = false) => refreshAll(fit),
    openAuthModal
  };

  // =========================================================================
  // RENDER & VIEWPORT
  // =========================================================================

  function refreshAll(fitAfter = false) {
    const map = store.getMap();
    if (!map) return;

    // Ensure selectedId exists in current map
    if (selectedId && !findNode(map.root, selectedId)) {
      selectedId = map.root.id;
    }

    dom.mapTitle.value = map.title;
    const theme = getTheme(map.style?.theme, false);
    dom.canvasWrap.style.backgroundColor = theme.bg;

    renderCanvas();
    renderToolbarState();
    renderSidebarList();
    renderPropsPanel();
    updateStatusBar();

    if (fitAfter) {
      requestAnimationFrame(() => fitToScreen(false));
    }
  }

  function renderCanvas() {
    const map = store.getMap();
    layout = computeLayout(map);

    const editingKey = editSession ? `${editSession.type}:${editSession.id}` : null;
    const dropTarget = dragState && dragState.moved ? dragState.dropTarget : null;

    dom.viewport.innerHTML = renderSceneGroupMarkup(layout, map, {
      interactive: true,
      selectedId,
      selectedLinkId,
      editingKey,
      dropTarget,
      linkingFrom,
      pointerWorld
    });

    applyCameraTransform();
    if (editSession) {
      positionInlineEditor();
    }
  }

  function applyCameraTransform() {
    dom.viewport.setAttribute('transform', `translate(${cam.x},${cam.y}) scale(${cam.k})`);
    dom.zoomLabel.textContent = `${Math.round(cam.k * 100)}%`;
  }

  function screenToWorld(clientX, clientY) {
    const rect = dom.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: (sx - cam.x) / cam.k,
      y: (sy - cam.y) / cam.k
    };
  }

  function worldToScreen(wx, wy) {
    return {
      x: wx * cam.k + cam.x,
      y: wy * cam.k + cam.y
    };
  }

  function zoomAroundPoint(newK, screenX, screenY) {
    const clampedK = clamp(newK, 0.2, 3.0);
    const wx = (screenX - cam.x) / cam.k;
    const wy = (screenY - cam.y) / cam.k;
    cam.k = clampedK;
    cam.x = screenX - wx * cam.k;
    cam.y = screenY - wy * cam.k;
    applyCameraTransform();
    if (editSession) positionInlineEditor();
  }

  function fitToScreen(animate = true) {
    if (!layout) return;
    const rect = dom.canvasWrap.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;

    const margin = 44;
    const availW = Math.max(100, rect.width - margin * 2);
    const availH = Math.max(100, rect.height - margin * 2);

    const scaleX = availW / Math.max(1, layout.bbox.width);
    const scaleY = availH / Math.max(1, layout.bbox.height);
    const k = clamp(Math.min(scaleX, scaleY, 1.15), 0.25, 1.5);

    const cx = layout.bbox.minX + layout.bbox.width / 2;
    const cy = layout.bbox.minY + layout.bbox.height / 2;

    cam.k = k;
    cam.x = rect.width / 2 - cx * k;
    cam.y = rect.height / 2 - cy * k;
    applyCameraTransform();
  }

  function ensureNodeVisible(nodeId) {
    if (!layout) return;
    const it = layout.itemById.get(nodeId);
    if (!it) return;
    const rect = dom.canvasWrap.getBoundingClientRect();
    const pad = 65;
    const scr = worldToScreen(it.x, it.y);
    const hw = (it.w * cam.k) / 2;
    const hh = (it.h * cam.k) / 2;

    let dx = 0;
    let dy = 0;
    if (scr.x - hw < pad) dx = pad - (scr.x - hw);
    else if (scr.x + hw > rect.width - pad) dx = rect.width - pad - (scr.x + hw);

    if (scr.y - hh < pad) dy = pad - (scr.y - hh);
    else if (scr.y + hh > rect.height - pad) dy = rect.height - pad - (scr.y + hh);

    if (dx !== 0 || dy !== 0) {
      cam.x += dx;
      cam.y += dy;
      applyCameraTransform();
    }
  }

  function renderToolbarState() {
    const map = store.getMap();
    const isRoot = selectedId === map.root.id;
    dom.btnUndo.disabled = !store.canUndo();
    dom.btnRedo.disabled = !store.canRedo();
    dom.btnChild.disabled = !selectedId;
    dom.btnSibling.disabled = !selectedId;
    dom.btnLink.disabled = !selectedId;
    dom.btnLink.classList.toggle('active', Boolean(linkingFrom));
    dom.btnDelete.disabled = (!selectedId || isRoot) && !selectedLinkId;

    dom.layoutSeg.querySelectorAll('button[data-layout]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-layout') === map.layout);
    });

    if (dom.btnFreeMode) {
      dom.btnFreeMode.classList.toggle('active', Boolean(map.style?.freeMode));
    }
    if (dom.btnFullscreen) {
      const isFs = Boolean(document.fullscreenElement) || document.body.classList.contains('pseudo-fullscreen');
      dom.btnFullscreen.classList.toggle('active', isFs);
      dom.btnFullscreen.innerHTML = svgIcon(isFs ? 'exitFullscreen' : 'fullscreen', 18);
    }

    dom.btnProps.classList.toggle('active', !dom.props.classList.contains('collapsed'));
    dom.btnSidebar.classList.toggle('active', !dom.sidebar.classList.contains('collapsed'));
  }

  function updateStatusBar() {
    const map = store.getMap();
    const total = countNodesInTree(map.root);
    const linksCount = (map.links || []).length;
    dom.statusCount.textContent = `${total} concett${total === 1 ? 'o' : 'i'}${linksCount > 0 ? ` · ${linksCount} collegament${linksCount === 1 ? 'o' : 'i'}` : ''}`;
  }

  // =========================================================================
  // SIDEBAR: MAP LIBRARY
  // =========================================================================

  function renderSidebarList() {
    const html = store.maps
      .map((m) => {
        const active = m.id === store.activeId ? ' active' : '';
        const count = countNodesInTree(m.root);
        return `
          <div class="mi${active}" data-map-id="${m.id}">
            <div class="mi-t">${escapeHtml(m.title || 'Senza titolo')}</div>
            <div class="mi-d">${count} concetti · ${formatDate(m.updatedAt)}</div>
            <div class="mi-act">
              <button type="button" data-map-dl="${m.id}" title="Scarica subito PDF">${svgIcon('download', 15)}</button>
              <button type="button" data-map-dup="${m.id}" title="Duplica mappa">${svgIcon('copy', 15)}</button>
              <button type="button" class="del" data-map-del="${m.id}" title="Elimina mappa">${svgIcon('trash', 15)}</button>
            </div>
          </div>
        `;
      })
      .join('');
    dom.mapList.innerHTML = html;
  }

  // =========================================================================
  // PROPERTIES PANEL (RIGHT SIDEBAR)
  // =========================================================================

  function renderPropsPanel() {
    const map = store.getMap();
    const style = map.style;

    if (selectedLinkId) {
      const lk = (map.links || []).find((l) => l.id === selectedLinkId);
      if (lk) {
        dom.propsTitle.textContent = 'Collegamento trasversale';
        dom.propsBody.innerHTML = `
          <div class="pp-sec">
            <div class="pp-h">Parola legame</div>
            <input type="text" class="pp-input" id="pp-xlink-text" value="${escapeHtml(lk.text || '')}" placeholder="es. causa, dipende da…">
            <div class="chips">
              ${LINK_CHIPS.map((c) => `<button type="button" class="chip" data-xlink-chip="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
            </div>
          </div>
          <div class="pp-sec">
            <button type="button" class="btn danger block" id="pp-del-xlink">${svgIcon('trash', 16)}<span>Elimina collegamento</span></button>
          </div>
        `;
        bindXlinkPropsEvents(lk);
        return;
      }
    }

    const info = selectedId ? findNode(map.root, selectedId) : null;
    const parts = [];

    if (info) {
      const n = info.node;
      const isRoot = info.depth === 0;
      const effectiveBold = typeof n.bold === 'boolean' ? n.bold : (info.depth <= 1);
      dom.propsTitle.textContent = isRoot ? 'Concetto principale' : 'Concetto selezionato';

      parts.push(`
        <div class="pp-sec">
          <div class="pp-h">Testo del concetto</div>
          <div class="pp-input pp-rich-input" id="pp-node-text" contenteditable="true" spellcheck="true">${richTextToHtml(n.text)}</div>
          ${
            !isRoot
              ? `
            <div class="pp-h">Parola legame <span class="muted">(sulla freccia)</span></div>
            <input type="text" class="pp-input" id="pp-link-text" value="${escapeHtml(n.linkText || '')}" placeholder="es. è formato da, causa, comprende…">
            <div class="chips">
              ${LINK_CHIPS.map((c) => `<button type="button" class="chip" data-chip="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
            </div>
          `
              : `<div class="pp-note">Questo è il nodo radice della mappa. Premi <kbd>Tab</kbd> per aggiungere rami.</div>`
          }
        </div>

        <div class="pp-sec">
          <div class="pp-h">Azioni rapide</div>
          <div class="pp-grid2">
            <button type="button" class="btn small" id="pp-act-child">${svgIcon('child', 15)}<span>+ Figlio (Tab)</span></button>
            <button type="button" class="btn small" id="pp-act-sibling">${svgIcon('sibling', 15)}<span>+ Fratello</span></button>
            ${
              !isRoot
                ? `<button type="button" class="btn small" id="pp-act-parent">${svgIcon('plus', 15)}<span>Nodo sopra</span></button>
                   <button type="button" class="btn small" id="pp-act-dup">${svgIcon('copy', 15)}<span>Duplica ramo</span></button>`
                : ''
            }
          </div>
        </div>

        <div class="pp-sec">
          <div class="pp-h">Colore del nodo</div>
          <div class="swatches">
            <button type="button" class="sw auto${!n.color ? ' on' : ''}" data-sw="" title="Automatico dal tema">A</button>
            ${NODE_SWATCHES.map(
              (hex) =>
                `<button type="button" class="sw${n.color.toLowerCase() === hex ? ' on' : ''}" data-sw="${hex}" style="background:${hex}" title="${hex}"></button>`
            ).join('')}
            <label class="sw custom" title="Colore personalizzato">+<input type="color" id="pp-custom-color" value="${n.color || '#2563eb'}"></label>
          </div>

          <div class="pp-h">Forma e testo</div>
          <div class="pp-row">
            <div class="seg" id="pp-shape-seg">
              <button type="button" data-shape="" class="${!n.shape ? 'active' : ''}" title="Predefinita">Auto</button>
              <button type="button" data-shape="round" class="${n.shape === 'round' ? 'active' : ''}" title="Arrotondata">
                <svg class="shape-ic" viewBox="0 0 26 18"><rect x="2" y="2" width="22" height="14" rx="4" fill="none" stroke="currentColor" stroke-width="2"/></svg>
              </button>
              <button type="button" data-shape="pill" class="${n.shape === 'pill' ? 'active' : ''}" title="Capsula">
                <svg class="shape-ic" viewBox="0 0 26 18"><rect x="2" y="2" width="22" height="14" rx="7" fill="none" stroke="currentColor" stroke-width="2"/></svg>
              </button>
              <button type="button" data-shape="rect" class="${n.shape === 'rect' ? 'active' : ''}" title="Rettangolo">
                <svg class="shape-ic" viewBox="0 0 26 18"><rect x="2" y="2" width="22" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>
              </button>
            </div>
            <div class="seg">
              <button type="button" class="bold-btn${effectiveBold ? ' active' : ''}" id="pp-bold" title="Grassetto (Ctrl+B)">B</button>
              <button type="button" class="bold-btn${n.italic ? ' active' : ''}" id="pp-italic" style="font-style:italic" title="Corsivo (Ctrl+I)">I</button>
              <button type="button" class="bold-btn${n.underline ? ' active' : ''}" id="pp-underline" style="text-decoration:underline" title="Sottolineato (Ctrl+U)">U</button>
            </div>
          </div>

          <div class="pp-h">Immagine nel concetto</div>
          ${
            n.image && n.image.src
              ? `<img class="pp-img" src="${n.image.src}" alt="">
                 <div class="pp-grid2">
                   <button type="button" class="btn small" id="pp-img-add">${svgIcon('image', 15)}<span>Cambia</span></button>
                   <button type="button" class="btn small danger" id="pp-img-del">${svgIcon('trash', 15)}<span>Rimuovi</span></button>
                 </div>`
              : `<button type="button" class="btn small block" id="pp-img-add">${svgIcon('image', 15)}<span>Aggiungi immagine (Ctrl+V)</span></button>`
          }
        </div>
      `);
    } else {
      dom.propsTitle.textContent = 'Impostazioni mappa';
    }

    // Map-wide styling section (always visible so user can tweak layout/themes anytime)
    const themeTiles = Object.values(THEMES)
      .map((t) => {
        const active = style.theme === t.id ? ' active' : '';
        const sw = t.branchPalette
          .slice(0, 4)
          .map((c) => `<i style="background:${c}"></i>`)
          .join('');
        return `
          <button type="button" class="theme-tile${active}" data-theme="${t.id}">
            <div class="tt-sw" style="background:${t.bg}">
              <i class="r" style="background:${t.rootFill}"></i>${sw}
            </div>
            <div class="tt-n">${escapeHtml(t.name)}</div>
          </button>
        `;
      })
      .join('');

    parts.push(`
      <div class="pp-sec">
        <div class="pp-h">Tema colori della mappa</div>
        <div class="themes">${themeTiles}</div>

        <div class="pp-h">Stile collegamenti</div>
        <div class="seg full" id="pp-line-seg">
          <button type="button" data-line="ortho" class="${style.lineType === 'ortho' ? 'active' : ''}">Squadrati</button>
          <button type="button" data-line="curve" class="${style.lineType === 'curve' ? 'active' : ''}">Curvi</button>
          <button type="button" data-line="straight" class="${style.lineType === 'straight' ? 'active' : ''}">Dritti</button>
        </div>

        <button type="button" class="btn small block pp-reset-btn" id="pp-reset-free">${svgIcon('refresh', 15)}<span>Riallinea e ripristina dimensioni</span></button>

        <label class="toggle">
          <input type="checkbox" id="pp-arrows" ${style.arrows ? 'checked' : ''}>
          <span></span> Mostra frecce direzionali
        </label>

        <div class="range-row">
          <div class="rr-top"><span>Distanza tra colonne</span><b id="pp-hgap-val">${style.hGap} px</b></div>
          <input type="range" id="pp-hgap" min="16" max="80" step="2" value="${style.hGap}">
        </div>

        <div class="range-row">
          <div class="rr-top"><span>Distanza tra livelli</span><b id="pp-vgap-val">${style.vGap} px</b></div>
          <input type="range" id="pp-vgap" min="32" max="100" step="2" value="${style.vGap}">
        </div>

        <div class="pp-h">Carattere</div>
        <select class="pp-input" id="pp-font">
          ${FONTS.map((f) => `<option value="${f.id}" ${style.font === f.id ? 'selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}
        </select>
      </div>
    `);

    dom.propsBody.innerHTML = parts.join('');
    bindPropsEvents(info);
  }

  function bindXlinkPropsEvents(lk) {
    const inp = document.getElementById('pp-xlink-text');
    if (inp) {
      inp.addEventListener('focus', () => store.snapshot());
      inp.addEventListener('input', () => {
        lk.text = inp.value;
        store.persist();
        renderCanvas();
      });
    }
    dom.propsBody.querySelectorAll('[data-xlink-chip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        store.snapshot();
        lk.text = btn.getAttribute('data-xlink-chip');
        store.persist();
        renderCanvas();
        renderPropsPanel();
      });
    });
    const delBtn = document.getElementById('pp-del-xlink');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        store.deleteCrossLink(lk.id);
        selectedLinkId = null;
        refreshAll(false);
      });
    }
  }

  function ensureManualPositionsFromCurrentLayout() {
    const map = store.getMap();
    if (!map) return;
    if (!layout) layout = computeLayout(map);
    for (const it of layout.items) {
      if (typeof it.node.manualX !== 'number' || typeof it.node.manualY !== 'number') {
        it.node.manualX = Math.round(it.x);
        it.node.manualY = Math.round(it.y);
      }
    }
  }

  function toggleFreeMode(forceValue = null) {
    commitInlineEditor();
    const map = store.getMap();
    const style = map.style;
    store.snapshot();
    const next = typeof forceValue === 'boolean' ? forceValue : !style.freeMode;
    if (next) {
      ensureManualPositionsFromCurrentLayout();
    }
    style.freeMode = next;
    store.persist();
    refreshAll(false);
    showToast(
      next
        ? 'Modalità libera attiva: sposta e ridimensiona i riquadri come vuoi!'
        : 'Disposizione automatica riattivata.'
    );
  }

  function applyTextFormat(info, cmd) {
    if (!info) return;
    const map = store.getMap();
    const n = info.node;
    const txtEl = document.getElementById('pp-node-text');

    // Check if there is a non-collapsed text selection inside #editor or #pp-node-text
    const sel = window.getSelection ? window.getSelection() : null;
    const hasSelection = sel && !sel.isCollapsed && sel.toString().trim().length > 0;
    const inCanvasEditor =
      hasSelection &&
      editSession &&
      editSession.type === 'node' &&
      editSession.id === n.id &&
      dom.editor.contains(sel.anchorNode);
    const inSidebarEditor = hasSelection && txtEl && txtEl.contains(sel.anchorNode);

    if (inCanvasEditor || inSidebarEditor) {
      // Partial selection formatting inside the active rich text editor
      const targetEl = inCanvasEditor ? dom.editor : txtEl;
      if (cmd === 'bold' && n.bold === null && info.depth <= 1) {
        // Turn off automatic whole-box bold so only the selected text is bold
        n.bold = false;
        if (inCanvasEditor) dom.editor.style.fontWeight = '500';
      }
      document.execCommand(cmd, false, null);
      n.text = htmlToRichText(targetEl).trim() || 'Concetto';
      if (inCanvasEditor && txtEl) {
        txtEl.innerHTML = richTextToHtml(n.text);
      } else if (inSidebarEditor && editSession && editSession.type === 'node' && editSession.id === n.id) {
        dom.editor.innerHTML = richTextToHtml(n.text);
      }
      store.persist();
      renderCanvas();
      return;
    }

    // Whole-node formatting toggle when no partial text is selected
    store.snapshot();
    if (cmd === 'bold') {
      const curBold = typeof n.bold === 'boolean' ? n.bold : info.depth <= 1;
      n.bold = !curBold;
      if (!n.bold) {
        n.text = n.text.replace(/<\/?(?:b|strong)\b[^>]*>/gi, '');
      }
    } else if (cmd === 'italic') {
      n.italic = !n.italic;
      if (!n.italic) {
        n.text = n.text.replace(/<\/?(?:i|em)\b[^>]*>/gi, '');
      }
    } else if (cmd === 'underline') {
      n.underline = !n.underline;
      if (!n.underline) {
        n.text = n.text.replace(/<\/?u\b[^>]*>/gi, '');
      }
    }

    store.persist();
    if (editSession && editSession.type === 'node' && editSession.id === n.id) {
      dom.editor.innerHTML = richTextToHtml(n.text);
      renderCanvas();
      positionInlineEditor();
      // Update active button state in sidebar without destroying focus
      const bBtn = document.getElementById('pp-bold');
      const iBtn = document.getElementById('pp-italic');
      const uBtn = document.getElementById('pp-underline');
      const effB = typeof n.bold === 'boolean' ? n.bold : info.depth <= 1;
      if (bBtn) bBtn.classList.toggle('active', effB);
      if (iBtn) iBtn.classList.toggle('active', Boolean(n.italic));
      if (uBtn) uBtn.classList.toggle('active', Boolean(n.underline));
      dom.editor.focus({ preventScroll: true });
    } else {
      refreshAll(false);
    }
  }

  function bindPropsEvents(info) {
    const map = store.getMap();
    const style = map.style;

    if (info) {
      const n = info.node;
      const txtEl = document.getElementById('pp-node-text');
      if (txtEl) {
        txtEl.addEventListener('focus', () => store.snapshot());
        txtEl.addEventListener('input', () => {
          n.text = htmlToRichText(txtEl).trim() || 'Concetto';
          if (info.depth === 0) {
            map.title = stripRichTags(n.text).replace(/\s+/g, ' ').trim() || map.title;
            dom.mapTitle.value = map.title;
            renderSidebarList();
          }
          store.persist();
          renderCanvas();
        });
      }

      const linkEl = document.getElementById('pp-link-text');
      if (linkEl) {
        linkEl.addEventListener('focus', () => store.snapshot());
        linkEl.addEventListener('input', () => {
          n.linkText = linkEl.value;
          store.persist();
          renderCanvas();
        });
      }

      dom.propsBody.querySelectorAll('[data-chip]').forEach((chip) => {
        chip.addEventListener('click', () => {
          store.snapshot();
          n.linkText = chip.getAttribute('data-chip');
          store.persist();
          renderCanvas();
          renderPropsPanel();
        });
      });

      const actChild = document.getElementById('pp-act-child');
      if (actChild) actChild.addEventListener('click', () => actionAddChild(n.id));

      const actSibling = document.getElementById('pp-act-sibling');
      if (actSibling) actSibling.addEventListener('click', () => actionAddSibling(n.id));

      const actParent = document.getElementById('pp-act-parent');
      if (actParent) {
        actParent.addEventListener('click', () => {
          const created = store.insertParent(n.id);
          if (created) {
            selectedId = created.id;
            refreshAll(false);
            openInlineEditor('node', created.id, true);
          }
        });
      }

      const actDup = document.getElementById('pp-act-dup');
      if (actDup) {
        actDup.addEventListener('click', () => {
          const dup = store.duplicateSubtree(n.id);
          if (dup) {
            selectedId = dup.id;
            refreshAll(false);
            ensureNodeVisible(dup.id);
          }
        });
      }

      dom.propsBody.querySelectorAll('[data-sw]').forEach((sw) => {
        sw.addEventListener('click', () => {
          store.snapshot();
          n.color = sw.getAttribute('data-sw') || '';
          store.persist();
          refreshAll(false);
        });
      });

      const customColor = document.getElementById('pp-custom-color');
      if (customColor) {
        customColor.addEventListener('change', () => {
          store.snapshot();
          n.color = customColor.value;
          store.persist();
          refreshAll(false);
        });
      }

      dom.propsBody.querySelectorAll('#pp-shape-seg button').forEach((btn) => {
        btn.addEventListener('click', () => {
          store.snapshot();
          n.shape = btn.getAttribute('data-shape') || '';
          store.persist();
          refreshAll(false);
        });
      });

      const bindFormatBtn = (btnId, cmd) => {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        // Prevent focus/selection loss in #editor or #pp-node-text when clicking B, I, U
        btn.addEventListener('pointerdown', (e) => e.preventDefault());
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          applyTextFormat(info, cmd);
        });
      };

      bindFormatBtn('pp-bold', 'bold');
      bindFormatBtn('pp-italic', 'italic');
      bindFormatBtn('pp-underline', 'underline');

      const imgAdd = document.getElementById('pp-img-add');
      if (imgAdd) {
        imgAdd.addEventListener('click', () => {
          dom.fileImage.value = '';
          dom.fileImage.click();
        });
      }

      const imgDel = document.getElementById('pp-img-del');
      if (imgDel) {
        imgDel.addEventListener('click', () => {
          store.snapshot();
          n.image = null;
          store.persist();
          refreshAll(false);
        });
      }
    }

    // Map-wide settings
    dom.propsBody.querySelectorAll('[data-theme]').forEach((tile) => {
      tile.addEventListener('click', () => {
        store.snapshot();
        style.theme = tile.getAttribute('data-theme');
        store.persist();
        refreshAll(false);
      });
    });

    dom.propsBody.querySelectorAll('#pp-line-seg button').forEach((btn) => {
      btn.addEventListener('click', () => {
        store.snapshot();
        style.lineType = btn.getAttribute('data-line');
        store.persist();
        refreshAll(false);
      });
    });

    const resetFreeBtn = document.getElementById('pp-reset-free');
    if (resetFreeBtn) {
      resetFreeBtn.addEventListener('click', () => {
        store.resetManualLayout();
        style.freeMode = false;
        store.persist();
        refreshAll(true);
        showToast('Riquadri riallineati e riportati alle dimensioni automatiche!');
      });
    }

    const arrows = document.getElementById('pp-arrows');
    if (arrows) {
      arrows.addEventListener('change', () => {
        store.snapshot();
        style.arrows = arrows.checked;
        store.persist();
        refreshAll(false);
      });
    }

    const hGap = document.getElementById('pp-hgap');
    const hGapVal = document.getElementById('pp-hgap-val');
    if (hGap) {
      hGap.addEventListener('input', () => {
        style.hGap = Number(hGap.value);
        if (hGapVal) hGapVal.textContent = `${style.hGap} px`;
        store.persist();
        renderCanvas();
      });
    }

    const vGap = document.getElementById('pp-vgap');
    const vGapVal = document.getElementById('pp-vgap-val');
    if (vGap) {
      vGap.addEventListener('input', () => {
        style.vGap = Number(vGap.value);
        if (vGapVal) vGapVal.textContent = `${style.vGap} px`;
        store.persist();
        renderCanvas();
      });
    }

    const fontSel = document.getElementById('pp-font');
    if (fontSel) {
      fontSel.addEventListener('change', () => {
        store.snapshot();
        style.font = fontSel.value;
        store.persist();
        refreshAll(false);
      });
    }
  }

  // =========================================================================
  // INLINE EDITOR (ON-CANVAS CONTENTEDITABLE FOR NODES & LINKING WORDS)
  // =========================================================================

  function selectEditorContents(el, selectAll = true) {
    try {
      const sel = window.getSelection();
      if (!sel) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      if (!selectAll) {
        range.collapse(false);
      }
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {}
  }

  function openInlineEditor(type, id, selectAll = true, initialChar = null) {
    if (editSession && editSession.type === type && editSession.id === id) {
      dom.editor.focus();
      return;
    }
    commitInlineEditor();
    const map = store.getMap();

    let initialValue = '';
    if (type === 'node') {
      const info = findNode(map.root, id);
      if (!info) return;
      initialValue = initialChar !== null ? initialChar : info.node.text;
    } else if (type === 'edge') {
      const info = findNode(map.root, id);
      if (!info || info.depth === 0) return;
      initialValue = initialChar !== null ? initialChar : info.node.linkText || '';
    } else if (type === 'xlink') {
      const lk = (map.links || []).find((l) => l.id === id);
      if (!lk) return;
      initialValue = initialChar !== null ? initialChar : lk.text || '';
    }

    store.snapshot();
    dragState = null;
    resizeState = null;
    isPanning = false;
    editSession = { type, id, originalValue: initialValue, openedAt: performance.now() };

    if (type === 'node') {
      dom.editor.innerHTML = initialChar !== null ? escapeHtml(initialChar) : richTextToHtml(initialValue);
      dom.editor.removeAttribute('data-placeholder');
    } else {
      dom.editor.textContent = initialValue;
      dom.editor.setAttribute('data-placeholder', 'parola legame…');
    }
    dom.editor.className = 'show' + (type !== 'node' ? ' label-mode' : '');

    renderCanvas();
    positionInlineEditor();

    const shouldSelectAll = selectAll && initialChar === null;
    const focusAndSelect = () => {
      if (!editSession) return;
      dom.editor.focus({ preventScroll: true });
      selectEditorContents(dom.editor, shouldSelectAll);
    };
    focusAndSelect();
    requestAnimationFrame(focusAndSelect);
  }

  function positionInlineEditor() {
    if (!editSession || !layout) return;
    const ed = dom.editor;

    if (editSession.type === 'node') {
      const it = layout.itemById.get(editSession.id);
      if (!it) return;
      const scr = worldToScreen(it.x, it.y);
      const w = Math.max(140, it.w * cam.k + 16);
      const h = Math.max(42, it.h * cam.k + 8);
      const rx = it.shape === 'pill' ? h / 2 : it.shape === 'rect' ? 4 : 11 * cam.k;

      ed.style.width = `${w}px`;
      ed.style.minHeight = `${h}px`;
      ed.style.left = `${scr.x - w / 2}px`;
      ed.style.top = `${scr.y - h / 2}px`;
      ed.style.borderRadius = `${rx}px`;
      ed.style.backgroundColor = it.colors.fill;
      ed.style.color = it.colors.text;
      ed.style.fontFamily = it.fontFamily;
      ed.style.fontSize = `${Math.max(12, it.fontSize * cam.k)}px`;
      ed.style.fontWeight = it.fontWeight;
      ed.style.fontStyle = it.fontStyle;
      ed.style.textDecoration = it.isUnderline ? 'underline' : 'none';
      ed.style.textAlign = 'center';
      ed.style.padding = `${Math.max(7, 10 * cam.k)}px ${Math.max(10, 14 * cam.k)}px`;
      autoResizeEditorTextarea();
    } else if (editSession.type === 'edge') {
      const edge = layout.edges.find((e) => e.child.id === editSession.id);
      if (!edge) return;
      const scr = worldToScreen(edge.labelX, edge.labelY);
      const w = Math.max(145, (edge.child.linkW || 110) * cam.k + 28);
      const h = Math.max(32, 28 * cam.k);

      ed.style.width = `${w}px`;
      ed.style.minHeight = `${h}px`;
      ed.style.height = `${h}px`;
      ed.style.left = `${scr.x - w / 2}px`;
      ed.style.top = `${scr.y - h / 2}px`;
      ed.style.borderRadius = '9px';
      ed.style.backgroundColor = '#ffffff';
      ed.style.color = '#1e293b';
      ed.style.fontSize = `${Math.max(12, 12.5 * cam.k)}px`;
      ed.style.fontWeight = '600';
      ed.style.fontStyle = 'italic';
      ed.style.textDecoration = 'none';
      ed.style.textAlign = 'center';
      ed.style.padding = '5px 8px';
    } else if (editSession.type === 'xlink') {
      const cl = layout.crossLinks.find((c) => c.id === editSession.id);
      if (!cl) return;
      const scr = worldToScreen(cl.labelX, cl.labelY);
      const w = 155;
      const h = 32;
      ed.style.width = `${w}px`;
      ed.style.minHeight = `${h}px`;
      ed.style.height = `${h}px`;
      ed.style.left = `${scr.x - w / 2}px`;
      ed.style.top = `${scr.y - h / 2}px`;
      ed.style.borderRadius = '9px';
      ed.style.backgroundColor = '#ffffff';
      ed.style.color = '#6d28d9';
      ed.style.fontSize = '13px';
      ed.style.fontWeight = '600';
      ed.style.fontStyle = 'italic';
      ed.style.textDecoration = 'none';
      ed.style.textAlign = 'center';
      ed.style.padding = '5px 8px';
    }
  }

  function autoResizeEditorTextarea() {
    if (!editSession) return;
    const ed = dom.editor;
    ed.style.height = 'auto';
    const minH = parseFloat(ed.style.minHeight) || 40;
    const newH = Math.max(ed.scrollHeight, minH);
    ed.style.height = `${newH}px`;
    if (editSession.type === 'node' && layout) {
      const it = layout.itemById.get(editSession.id);
      if (it) {
        const scr = worldToScreen(it.x, it.y);
        ed.style.top = `${scr.y - newH / 2}px`;
      }
    }
  }

  function commitInlineEditor() {
    if (!editSession) return;
    const { type, id } = editSession;
    const richVal = htmlToRichText(dom.editor).trim();
    const plainVal = (dom.editor.textContent || '').trim();
    editSession = null;
    dom.editor.className = '';
    dom.editor.removeAttribute('data-placeholder');

    const map = store.getMap();
    if (type === 'node') {
      const info = findNode(map.root, id);
      if (info) {
        info.node.text = plainVal ? richVal : 'Concetto';
        if (info.depth === 0) {
          map.title = stripRichTags(info.node.text).replace(/\s+/g, ' ').trim();
          dom.mapTitle.value = map.title;
        }
      }
    } else if (type === 'edge') {
      const info = findNode(map.root, id);
      if (info && info.depth > 0) {
        info.node.linkText = plainVal;
      }
    } else if (type === 'xlink') {
      const lk = (map.links || []).find((l) => l.id === id);
      if (lk) lk.text = plainVal || 'collegato a';
    }

    store.persist();
    refreshAll(false);
  }

  function cancelInlineEditor() {
    if (!editSession) return;
    editSession = null;
    dom.editor.className = '';
    dom.editor.removeAttribute('data-placeholder');
    store.undo();
    refreshAll(false);
  }

  // =========================================================================
  // NODE ACTIONS & SPATIAL NAVIGATION
  // =========================================================================

  function actionAddChild(parentId = selectedId) {
    if (!parentId) return;
    commitInlineEditor();
    const map = store.getMap();
    const parentLayout = layout ? layout.itemById.get(parentId) : null;
    const child = store.addChild(parentId, 'Nuovo concetto', '');
    if (child) {
      if (map.style?.freeMode && parentLayout) {
        const info = findNode(map.root, parentId);
        const idx = info ? Math.max(0, info.node.children.length - 1) : 0;
        if (map.layout === 'right') {
          child.manualX = Math.round(parentLayout.x + parentLayout.w / 2 + 130);
          child.manualY = Math.round(parentLayout.y + idx * 58);
        } else {
          const offset = (idx % 2 === 0 ? 1 : -1) * Math.floor((idx + 1) / 2) * 85;
          child.manualX = Math.round(parentLayout.x + offset);
          child.manualY = Math.round(parentLayout.y + parentLayout.h / 2 + 78);
        }
        store.persist();
      }
      selectedId = child.id;
      selectedLinkId = null;
      refreshAll(false);
      ensureNodeVisible(child.id);
      openInlineEditor('node', child.id, true);
    }
  }

  function actionAddSibling(nodeId = selectedId) {
    if (!nodeId) return;
    commitInlineEditor();
    const map = store.getMap();
    const curLayout = layout ? layout.itemById.get(nodeId) : null;
    const sib = store.addSibling(nodeId, 'Nuovo concetto', '');
    if (sib) {
      if (map.style?.freeMode && curLayout) {
        if (map.layout === 'right') {
          sib.manualX = Math.round(curLayout.x);
          sib.manualY = Math.round(curLayout.y + curLayout.h + 26);
        } else {
          sib.manualX = Math.round(curLayout.x + curLayout.w + 36);
          sib.manualY = Math.round(curLayout.y);
        }
        store.persist();
      }
      selectedId = sib.id;
      selectedLinkId = null;
      refreshAll(false);
      ensureNodeVisible(sib.id);
      openInlineEditor('node', sib.id, true);
    }
  }

  function actionDeleteSelected() {
    commitInlineEditor();
    if (selectedLinkId) {
      store.deleteCrossLink(selectedLinkId);
      selectedLinkId = null;
      refreshAll(false);
      return;
    }
    if (!selectedId) return;
    const map = store.getMap();
    if (selectedId === map.root.id) {
      showToast('Il concetto principale non può essere eliminato.', 'error');
      return;
    }
    const nextId = store.deleteNode(selectedId);
    selectedId = nextId || map.root.id;
    refreshAll(false);
  }

  function toggleLinkMode() {
    if (linkingFrom) {
      linkingFrom = null;
      dom.canvasWrap.classList.remove('linking');
      dom.linkHint.hidden = true;
      renderToolbarState();
      renderCanvas();
    } else if (selectedId) {
      commitInlineEditor();
      linkingFrom = selectedId;
      dom.canvasWrap.classList.add('linking');
      dom.linkHint.hidden = false;
      renderToolbarState();
    }
  }

  function toggleFullscreen() {
    const isNativeFs = Boolean(document.fullscreenElement);
    const isPseudoFs = document.body.classList.contains('pseudo-fullscreen');

    if (isNativeFs) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    if (isPseudoFs) {
      document.body.classList.remove('pseudo-fullscreen');
      dom.props.classList.remove('collapsed');
      renderToolbarState();
      setTimeout(() => fitToScreen(true), 240);
      showToast('Uscito da schermo intero.');
      return;
    }

    if (document.documentElement.requestFullscreen) {
      document.documentElement
        .requestFullscreen()
        .then(() => {
          renderToolbarState();
          setTimeout(() => fitToScreen(true), 180);
          showToast('Modalità schermo intero attiva (Esc per uscire).');
        })
        .catch(() => {
          document.body.classList.add('pseudo-fullscreen');
          dom.sidebar.classList.add('collapsed');
          dom.props.classList.add('collapsed');
          renderToolbarState();
          setTimeout(() => fitToScreen(true), 240);
          showToast('Vista a tutto schermo attiva.');
        });
    } else {
      document.body.classList.add('pseudo-fullscreen');
      dom.sidebar.classList.add('collapsed');
      dom.props.classList.add('collapsed');
      renderToolbarState();
      setTimeout(() => fitToScreen(true), 240);
      showToast('Vista a tutto schermo attiva.');
    }
  }

  function navigateSpatially(dirKey) {
    if (!layout || !selectedId) return;
    const cur = layout.itemById.get(selectedId);
    if (!cur) return;

    const dirVec = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 }
    }[dirKey];
    if (!dirVec) return;

    let bestId = null;
    let bestScore = Infinity;

    for (const cand of layout.items) {
      if (cand.id === cur.id) continue;
      const dx = cand.x - cur.x;
      const dy = cand.y - cur.y;
      const proj = dx * dirVec.x + dy * dirVec.y;
      if (proj <= 8) continue; // Must be in the chosen direction
      const ortho = Math.abs(dx * dirVec.y) + Math.abs(dy * dirVec.x);
      const score = proj + ortho * 2.1;
      if (score < bestScore) {
        bestScore = score;
        bestId = cand.id;
      }
    }

    if (bestId) {
      selectedId = bestId;
      selectedLinkId = null;
      refreshAll(false);
      ensureNodeVisible(bestId);
    }
  }

  // =========================================================================
  // SPEECH SYNTHESIS (LEGGI AD ALTA VOCE)
  // =========================================================================

  function speakMap() {
    if (!('speechSynthesis' in window)) {
      showToast('Sintesi vocale non supportata in questo browser.', 'error');
      return;
    }
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      dom.btnSpeak.classList.remove('active');
      showToast('Lettura interrotta.');
      return;
    }

    const map = store.getMap();
    const startNode = selectedId ? findNode(map.root, selectedId)?.node || map.root : map.root;

    const phrases = [];
    function buildSpeech(node, isStart) {
      if (isStart) {
        phrases.push(stripRichTags(node.text));
      }
      const kids = node.children || [];
      for (const ch of kids) {
        const prefix = ch.linkText ? `${ch.linkText}: ` : '';
        phrases.push(`${prefix}${stripRichTags(ch.text)}`);
        if (ch.children && ch.children.length > 0) {
          buildSpeech(ch, false);
        }
      }
    }
    buildSpeech(startNode, true);

    const textToRead = phrases.join('. ');
    const utter = new SpeechSynthesisUtterance(textToRead);
    utter.lang = 'it-IT';
    utter.rate = 1.0;
    utter.onend = () => dom.btnSpeak.classList.remove('active');
    utter.onerror = () => dom.btnSpeak.classList.remove('active');

    dom.btnSpeak.classList.add('active');
    window.speechSynthesis.speak(utter);
    showToast('Lettura ad alta voce avviata…');
  }

  // =========================================================================
  // EVENT BINDINGS: TOOLBAR, SIDEBAR, CANVAS, KEYBOARD, MODALS
  // =========================================================================

  function bindToolbarEvents() {
    dom.btnSidebar.addEventListener('click', () => {
      dom.sidebar.classList.toggle('collapsed');
      renderToolbarState();
    });

    dom.btnProps.addEventListener('click', () => {
      dom.props.classList.toggle('collapsed');
      renderToolbarState();
    });

    dom.mapTitle.addEventListener('focus', () => store.snapshot());
    dom.mapTitle.addEventListener('input', () => {
      const map = store.getMap();
      map.title = dom.mapTitle.value;
      store.persist();
      renderSidebarList();
    });
    dom.mapTitle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') dom.mapTitle.blur();
    });

    dom.btnUndo.addEventListener('click', () => {
      commitInlineEditor();
      if (store.undo()) refreshAll(false);
    });

    dom.btnRedo.addEventListener('click', () => {
      commitInlineEditor();
      if (store.redo()) refreshAll(false);
    });

    dom.btnChild.addEventListener('click', () => actionAddChild());
    dom.btnSibling.addEventListener('click', () => actionAddSibling());
    dom.btnLink.addEventListener('click', () => toggleLinkMode());
    dom.btnDelete.addEventListener('click', () => actionDeleteSelected());

    dom.layoutSeg.querySelectorAll('button[data-layout]').forEach((btn) => {
      btn.addEventListener('click', () => {
        commitInlineEditor();
        store.snapshot();
        const map = store.getMap();
        map.layout = btn.getAttribute('data-layout');
        if (map.style?.freeMode) {
          map.style.freeMode = false;
        }
        store.persist();
        refreshAll(true);
      });
    });

    if (dom.btnFreeMode) {
      dom.btnFreeMode.addEventListener('click', () => toggleFreeMode());
    }

    dom.btnZoomIn.addEventListener('click', () => {
      const r = dom.canvasWrap.getBoundingClientRect();
      zoomAroundPoint(cam.k * 1.2, r.width / 2, r.height / 2);
    });

    dom.btnZoomOut.addEventListener('click', () => {
      const r = dom.canvasWrap.getBoundingClientRect();
      zoomAroundPoint(cam.k / 1.2, r.width / 2, r.height / 2);
    });

    dom.zoomLabel.addEventListener('click', () => {
      const r = dom.canvasWrap.getBoundingClientRect();
      zoomAroundPoint(1, r.width / 2, r.height / 2);
    });

    dom.btnFit.addEventListener('click', () => {
      fitToScreen(true);
      showToast('Mappa centrata e adattata alla finestra');
    });

    if (dom.btnFullscreen) {
      dom.btnFullscreen.addEventListener('click', () => toggleFullscreen());
    }
    document.addEventListener('fullscreenchange', () => {
      renderToolbarState();
      setTimeout(() => fitToScreen(true), 120);
    });

    dom.btnImport.addEventListener('click', () => openImportModal());
    dom.btnSpeak.addEventListener('click', () => speakMap());
    dom.btnHelp.addEventListener('click', () => {
      dom.modalHelp.hidden = false;
    });
    dom.btnQuickPdf?.addEventListener('click', () => {
      commitInlineEditor();
      quickDownloadMap();
    });
    dom.btnExport.addEventListener('click', () => openExportModal());

    // Sidebar events
    dom.btnNew.addEventListener('click', () => {
      if (isMobileMode()) {
        showToast('La creazione di mappe è disponibile solo da computer.');
        return;
      }
      commitInlineEditor();
      const m = store.createNewMap(null, currentRealFolderId());
      openMapInEditor(m.id);
      renderHomeScreen();
      showToast('Nuova mappa creata!');
    });

    dom.mapList.addEventListener('click', (e) => {
      const dlBtn = e.target.closest('[data-map-dl]');
      if (dlBtn) {
        e.stopPropagation();
        quickDownloadMap(dlBtn.getAttribute('data-map-dl'));
        return;
      }

      const dupBtn = e.target.closest('[data-map-dup]');
      if (dupBtn) {
        e.stopPropagation();
        const m = store.duplicateMap(dupBtn.getAttribute('data-map-dup'));
        if (m) {
          selectedId = m.root.id;
          refreshAll(true);
          renderHomeScreen();
          showToast('Mappa duplicata!');
        }
        return;
      }

      const delBtn = e.target.closest('[data-map-del]');
      if (delBtn) {
        e.stopPropagation();
        const id = delBtn.getAttribute('data-map-del');
        const targetMap = store.maps.find((x) => x.id === id);
        if (targetMap) {
          openConfirmDialog({
            title: 'Elimina mappa',
            message: `Vuoi eliminare definitivamente la mappa "${targetMap.title}"?`,
            confirmText: 'Elimina',
            danger: true
          }).then((ok) => {
            if (!ok) return;
            const m = store.deleteMap(id);
            renderHomeScreen();
            if (!m) {
              selectedId = null;
              selectedLinkId = null;
              showHomeScreen();
            } else {
              selectedId = m.root.id;
              refreshAll(true);
            }
            showToast('Mappa eliminata.');
          });
        }
        return;
      }

      const item = e.target.closest('[data-map-id]');
      if (item) {
        commitInlineEditor();
        store.setActiveMap(item.getAttribute('data-map-id'));
        selectedId = store.getMap().root.id;
        selectedLinkId = null;
        refreshAll(true);
      }
    });

    dom.btnSaveFile.addEventListener('click', () => {
      const map = store.getMap();
      const json = JSON.stringify(map, null, 2);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      downloadBlob(blob, sanitizeFilename(map.title) + '.json');
      showToast('File .json salvato!');
    });

    dom.btnOutline.addEventListener('click', () => {
      const map = store.getMap();
      const txt = treeToOutline(map.root);
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      downloadBlob(blob, sanitizeFilename(map.title) + '-scaletta.txt');
      showToast('Scaletta .txt scaricata!');
    });

    dom.btnOpenFile.addEventListener('click', () => {
      dom.fileOpen.value = '';
      dom.fileOpen.click();
    });

    dom.fileOpen.addEventListener('change', async () => {
      const file = dom.fileOpen.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const name = file.name.replace(/\.[^.]+$/, '');
        const folderId = currentRealFolderId();
        let m = null;
        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(text);
          m = store.createNewMap(parsed, folderId);
          showToast('Mappa caricata con successo!', 'ok');
        } else if (file.name.endsWith('.opml') || file.name.endsWith('.xml')) {
          const root = parseOpml(text);
          m = store.createNewMap({ title: root.text || name, root }, folderId);
          showToast('File OPML importato!', 'ok');
        } else {
          const root = parseOutline(text);
          m = store.createNewMap({ title: root.text || name, root }, folderId);
          showToast('Scaletta importata come mappa!', 'ok');
        }
        if (m) {
          openMapInEditor(m.id);
          renderHomeScreen();
        }
      } catch (err) {
        showToast('Impossibile leggere il file selezionato.', 'error');
      }
    });

    dom.fileImage.addEventListener('change', async () => {
      const file = dom.fileImage.files?.[0];
      if (!file || !selectedId) return;
      try {
        const imgData = await resizeImageFile(file);
        const map = store.getMap();
        const info = findNode(map.root, selectedId);
        if (info) {
          store.snapshot();
          info.node.image = imgData;
          store.persist();
          refreshAll(false);
          showToast('Immagine aggiunta al concetto!', 'ok');
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  function bindCanvasEvents() {
    let lastTap = { time: 0, type: '', id: '' };

    // Inline editor events
    dom.editor.addEventListener('input', () => {
      autoResizeEditorTextarea();
      if (editSession && editSession.type === 'node') {
        const ppTxt = document.getElementById('pp-node-text');
        const rich = htmlToRichText(dom.editor);
        if (ppTxt) ppTxt.innerHTML = richTextToHtml(rich);
      }
    });
    dom.editor.addEventListener('blur', () => {
      if (!editSession) return;
      if (performance.now() - (editSession.openedAt || 0) < 220) {
        dom.editor.focus({ preventScroll: true });
        return;
      }
      commitInlineEditor();
    });
    dom.editor.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        e.stopPropagation();
        if (editSession && editSession.type === 'node') {
          const info = findNode(store.getMap().root, editSession.id);
          const cmd = e.key.toLowerCase() === 'b' ? 'bold' : e.key.toLowerCase() === 'i' ? 'italic' : 'underline';
          applyTextFormat(info, cmd);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelInlineEditor();
        dom.canvasWrap.focus();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        commitInlineEditor();
        dom.canvasWrap.focus();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        const currentId = editSession ? editSession.id : selectedId;
        commitInlineEditor();
        actionAddChild(currentId);
      }
    });

    // Wheel zoom / pan
    dom.canvasWrap.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = dom.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * 0.0014);
        zoomAroundPoint(cam.k * factor, sx, sy);
      },
      { passive: false }
    );

    // Pointer down on canvas
    dom.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      e.preventDefault();
      commitInlineEditor();

      const now = performance.now();
      const map = store.getMap();
      const isFreeMode = Boolean(map.style?.freeMode);

      // 0. Check resize handles when in freeMode
      const resizeEl = e.target.closest('.resize-handle[data-resize-dir]');
      if (resizeEl && e.button === 0) {
        e.stopPropagation();
        const dir = resizeEl.getAttribute('data-resize-dir');
        const nid = resizeEl.getAttribute('data-node-id');
        const it = layout ? layout.itemById.get(nid) : null;
        if (it) {
          ensureManualPositionsFromCurrentLayout();
          store.snapshot();
          resizeState = {
            nodeId: nid,
            dir,
            startWorld: screenToWorld(e.clientX, e.clientY),
            origX: it.x,
            origY: it.y,
            origW: it.w,
            origH: it.h
          };
        }
        return;
      }

      // 1. Check UI quick buttons (collapse, + child, + sibling)
      const uiBtn = e.target.closest('.ui-btn');
      if (uiBtn) {
        e.stopPropagation();
        const action = uiBtn.getAttribute('data-action');
        const nid = uiBtn.getAttribute('data-node-id');
        if (action === 'toggle-collapse') {
          const info = findNode(map.root, nid);
          if (info) {
            store.snapshot();
            info.node.collapsed = !info.node.collapsed;
            store.persist();
            refreshAll(false);
          }
        } else if (action === 'quick-child') {
          actionAddChild(nid);
        } else if (action === 'quick-sibling') {
          actionAddSibling(nid);
        }
        return;
      }

      // 2. Check cross-link click
      const xlinkEl = e.target.closest('[data-xlink-id]');
      if (xlinkEl) {
        e.stopPropagation();
        const xid = xlinkEl.getAttribute('data-xlink-id');
        const isDbl =
          e.detail >= 2 || (now - lastTap.time < 480 && lastTap.type === 'xlink' && lastTap.id === xid);
        lastTap = { time: now, type: 'xlink', id: xid };
        selectedLinkId = xid;
        selectedId = null;
        refreshAll(false);
        if (isDbl) {
          openInlineEditor('xlink', xid, true);
        }
        return;
      }

      // 3. Check edge / linking-word click
      const edgeEl = e.target.closest('[data-edge-child]');
      if (edgeEl) {
        e.stopPropagation();
        const childId = edgeEl.getAttribute('data-edge-child');
        lastTap = { time: now, type: 'edge', id: childId };
        selectedId = childId;
        selectedLinkId = null;
        refreshAll(false);
        openInlineEditor('edge', childId, true);
        return;
      }

      // 4. Check concept node click / double-click / drag
      const nodeEl = e.target.closest('.node[data-node-id]');
      if (nodeEl && e.button === 0) {
        e.stopPropagation();
        const nid = nodeEl.getAttribute('data-node-id');

        // If we are in "Collega" mode, complete the cross-link!
        if (linkingFrom) {
          if (linkingFrom !== nid) {
            const lk = store.addCrossLink(linkingFrom, nid, 'collegato a');
            linkingFrom = null;
            dom.canvasWrap.classList.remove('linking');
            dom.linkHint.hidden = true;
            if (lk) {
              selectedLinkId = lk.id;
              selectedId = null;
              refreshAll(false);
              openInlineEditor('xlink', lk.id, true);
            }
          } else {
            toggleLinkMode();
          }
          return;
        }

        const isDbl =
          e.detail >= 2 || (now - lastTap.time < 480 && lastTap.type === 'node' && lastTap.id === nid);
        lastTap = { time: now, type: 'node', id: nid };

        if (selectedId !== nid || selectedLinkId !== null) {
          selectedId = nid;
          selectedLinkId = null;
          refreshAll(false);
        }

        if (isDbl) {
          dragState = null;
          openInlineEditor('node', nid, true);
          return;
        }

        dom.canvasWrap.focus({ preventScroll: true });

        if (isFreeMode) {
          ensureManualPositionsFromCurrentLayout();
          const it = layout ? layout.itemById.get(nid) : null;
          if (it) {
            dragState = {
              nodeId: nid,
              freeMove: true,
              startX: e.clientX,
              startY: e.clientY,
              startWorld: screenToWorld(e.clientX, e.clientY),
              origX: it.x,
              origY: it.y,
              moved: false,
              snapshotTaken: false
            };
          }
        } else if (nid !== map.root.id) {
          dragState = {
            nodeId: nid,
            freeMove: false,
            startX: e.clientX,
            startY: e.clientY,
            moved: false,
            dropTarget: null
          };
        }
        return;
      }

      // 5. Clicked on empty canvas background: start panning
      lastTap = { time: now, type: 'canvas', id: '' };
      if (linkingFrom) {
        toggleLinkMode();
      }
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY, camX: cam.x, camY: cam.y };
      dom.canvasWrap.classList.add('panning');
      dom.canvasWrap.focus({ preventScroll: true });
    });

    // Native dblclick fallback (with coordinate hit-test if SVG elements were re-rendered)
    dom.canvas.addEventListener('dblclick', (e) => {
      if (editSession) return;

      const xlinkEl = e.target.closest('[data-xlink-id]');
      if (xlinkEl) {
        e.stopPropagation();
        openInlineEditor('xlink', xlinkEl.getAttribute('data-xlink-id'), true);
        return;
      }

      const edgeEl = e.target.closest('[data-edge-child]');
      if (edgeEl) {
        e.stopPropagation();
        openInlineEditor('edge', edgeEl.getAttribute('data-edge-child'), true);
        return;
      }

      const nodeEl = e.target.closest('.node[data-node-id]');
      if (nodeEl) {
        e.stopPropagation();
        const nid = nodeEl.getAttribute('data-node-id');
        selectedId = nid;
        openInlineEditor('node', nid, true);
        return;
      }

      // Coordinate hit-test fallback in case DOM node was replaced between clicks
      if (layout) {
        const pt = screenToWorld(e.clientX, e.clientY);
        for (const it of layout.items) {
          if (
            pt.x >= it.x - it.w / 2 &&
            pt.x <= it.x + it.w / 2 &&
            pt.y >= it.y - it.h / 2 &&
            pt.y <= it.y + it.h / 2
          ) {
            selectedId = it.id;
            openInlineEditor('node', it.id, true);
            return;
          }
        }
      }
    });

    window.addEventListener('pointermove', (e) => {
      if (linkingFrom) {
        pointerWorld = screenToWorld(e.clientX, e.clientY);
        renderCanvas();
        return;
      }

      if (resizeState) {
        const pt = screenToWorld(e.clientX, e.clientY);
        const dx = pt.x - resizeState.startWorld.x;
        const dy = pt.y - resizeState.startWorld.y;
        const dir = resizeState.dir;
        const minW = 72;
        const minH = 34;

        let newW = resizeState.origW;
        let newH = resizeState.origH;
        let newX = resizeState.origX;
        let newY = resizeState.origY;

        if (dir.includes('e')) {
          newW = Math.max(minW, resizeState.origW + dx);
          newX = resizeState.origX + (newW - resizeState.origW) / 2;
        } else if (dir.includes('w')) {
          newW = Math.max(minW, resizeState.origW - dx);
          newX = resizeState.origX - (newW - resizeState.origW) / 2;
        }

        if (dir.includes('s')) {
          newH = Math.max(minH, resizeState.origH + dy);
          newY = resizeState.origY + (newH - resizeState.origH) / 2;
        } else if (dir.includes('n')) {
          newH = Math.max(minH, resizeState.origH - dy);
          newY = resizeState.origY - (newH - resizeState.origH) / 2;
        }

        const info = findNode(store.getMap().root, resizeState.nodeId);
        if (info) {
          info.node.customW = Math.round(newW);
          info.node.customH = Math.round(newH);
          info.node.manualX = Math.round(newX);
          info.node.manualY = Math.round(newY);
          renderCanvas();
        }
        return;
      }

      if (dragState) {
        const dist = Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY);
        if (!dragState.moved && dist > 4) {
          dragState.moved = true;
          dom.canvasWrap.classList.add('dragging');
        }
        if (dragState.moved && layout) {
          const pt = screenToWorld(e.clientX, e.clientY);

          if (dragState.freeMove) {
            if (!dragState.snapshotTaken) {
              store.snapshot();
              dragState.snapshotTaken = true;
            }
            const dx = pt.x - dragState.startWorld.x;
            const dy = pt.y - dragState.startWorld.y;
            const info = findNode(store.getMap().root, dragState.nodeId);
            if (info) {
              info.node.manualX = Math.round(dragState.origX + dx);
              info.node.manualY = Math.round(dragState.origY + dy);
              renderCanvas();
            }
            return;
          }

          const dragInfo = findNode(store.getMap().root, dragState.nodeId);
          let foundTarget = null;

          for (const it of layout.items) {
            if (it.id === dragState.nodeId) continue;
            if (dragInfo && isDescendant(dragInfo.node, it.id)) continue;

            const left = it.x - it.w / 2 - 10;
            const right = it.x + it.w / 2 + 10;
            const top = it.y - it.h / 2 - 8;
            const bottom = it.y + it.h / 2 + 8;

            if (pt.x >= left && pt.x <= right && pt.y >= top && pt.y <= bottom) {
              let mode = 'inside';
              if (it.depth > 0) {
                if (it.side === 'down' && !it.stackedInParent) {
                  const relX = (pt.x - (it.x - it.w / 2)) / it.w;
                  if (relX < 0.24) mode = 'before';
                  else if (relX > 0.76) mode = 'after';
                } else {
                  const relY = (pt.y - (it.y - it.h / 2)) / it.h;
                  if (relY < 0.25) mode = 'before';
                  else if (relY > 0.75) mode = 'after';
                }
              }
              foundTarget = { id: it.id, mode };
              break;
            }
          }

          dragState.dropTarget = foundTarget;
          renderCanvas();
        }
        return;
      }

      if (isPanning) {
        cam.x = panStart.camX + (e.clientX - panStart.x);
        cam.y = panStart.camY + (e.clientY - panStart.y);
        applyCameraTransform();
      }
    });

    window.addEventListener('pointerup', () => {
      if (resizeState) {
        resizeState = null;
        store.persist();
        renderCanvas();
      }

      if (dragState) {
        if (dragState.freeMove) {
          if (dragState.moved) {
            store.persist();
          }
        } else if (dragState.moved && dragState.dropTarget) {
          const ok = store.moveNode(
            dragState.nodeId,
            dragState.dropTarget.id,
            dragState.dropTarget.mode
          );
          if (ok) {
            selectedId = dragState.nodeId;
            refreshAll(false);
            showToast('Concetto spostato e ricolonnato automaticamente.');
          }
        }
        const wasMoved = dragState.moved;
        dragState = null;
        dom.canvasWrap.classList.remove('dragging');
        if (wasMoved) renderCanvas();
      }

      if (isPanning) {
        isPanning = false;
        dom.canvasWrap.classList.remove('panning');
      }
    });
  }

  function bindKeyboardEvents() {
    window.addEventListener('keydown', (e) => {
      // Ignore shortcuts if user is typing in an input/textarea/contenteditable or modal is open
      const activeEl = document.activeElement;
      const tag = activeEl?.tagName?.toLowerCase();
      const inInput = tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(activeEl?.isContentEditable);

      // Global Ctrl+P -> open PDF/Print modal
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        commitInlineEditor();
        openExportModal();
        return;
      }

      // Global Ctrl+S -> quick PDF download
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        commitInlineEditor();
        quickDownloadMap();
        return;
      }

      if (e.key === 'F11') {
        e.preventDefault();
        toggleFullscreen();
        return;
      }

      if (dom.modalDialog && !dom.modalDialog.hidden) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeInternalDialog(false);
        }
        return;
      }

      if (!dom.modalImport.hidden || !dom.modalExport.hidden || !dom.modalHelp.hidden || (dom.modalAuth && !dom.modalAuth.hidden)) {
        if (e.key === 'Escape') {
          dom.modalImport.hidden = true;
          dom.modalExport.hidden = true;
          dom.modalHelp.hidden = true;
          if (dom.modalAuth) dom.modalAuth.hidden = true;
        }
        return;
      }

      if (inInput) return;
      if (dom.homeScreen && !dom.homeScreen.hidden) return;
      if (!store.getMap()) return;

      // Formatting shortcuts on selected node (Ctrl+B, Ctrl+I, Ctrl+U)
      if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase()) && selectedId) {
        e.preventDefault();
        const info = findNode(store.getMap().root, selectedId);
        const cmd = e.key.toLowerCase() === 'b' ? 'bold' : e.key.toLowerCase() === 'i' ? 'italic' : 'underline';
        applyTextFormat(info, cmd);
        return;
      }

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (store.redo()) refreshAll(false);
        } else {
          if (store.undo()) refreshAll(false);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (store.redo()) refreshAll(false);
        return;
      }

      // Zoom shortcuts
      if ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.key === 'NumPad0')) {
        e.preventDefault();
        fitToScreen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        const r = dom.canvasWrap.getBoundingClientRect();
        zoomAroundPoint(cam.k * 1.2, r.width / 2, r.height / 2);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        const r = dom.canvasWrap.getBoundingClientRect();
        zoomAroundPoint(cam.k / 1.2, r.width / 2, r.height / 2);
        return;
      }

      // Duplicate branch (Ctrl+D)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (selectedId && selectedId !== store.getMap().root.id) {
          const dup = store.duplicateSubtree(selectedId);
          if (dup) {
            selectedId = dup.id;
            refreshAll(false);
            ensureNodeVisible(dup.id);
            showToast('Ramo duplicato!');
          }
        }
        return;
      }

      // Edit linking word (Ctrl+L)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        if (selectedId && selectedId !== store.getMap().root.id) {
          openInlineEditor('edge', selectedId, true);
        }
        return;
      }

      // Copy / Cut subtree
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selectedId) {
        const info = findNode(store.getMap().root, selectedId);
        if (info) {
          internalClipboard = JSON.parse(JSON.stringify(info.node));
          try {
            navigator.clipboard.writeText(treeToOutline(info.node));
          } catch {}
          showToast('Ramo copiato negli appunti.');
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x' && selectedId) {
        const map = store.getMap();
        if (selectedId !== map.root.id) {
          const info = findNode(map.root, selectedId);
          if (info) {
            internalClipboard = JSON.parse(JSON.stringify(info.node));
            selectedId = store.deleteNode(selectedId);
            refreshAll(false);
            showToast('Ramo tagliato.');
          }
        }
        return;
      }

      if (e.key === 'Escape') {
        if (linkingFrom) toggleLinkMode();
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        actionAddChild(selectedId);
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        actionAddSibling(selectedId);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        actionDeleteSelected();
        return;
      }

      if (e.key === 'F2' || e.key === ' ') {
        if (selectedId) {
          e.preventDefault();
          openInlineEditor('node', selectedId, true);
        }
        return;
      }

      if (e.key.toLowerCase() === 'k' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleLinkMode();
        return;
      }

      // Alt + Arrow -> reorder sibling
      if (e.altKey && ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        if (selectedId) {
          const delta = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
          if (store.reorderSibling(selectedId, delta)) {
            refreshAll(false);
            ensureNodeVisible(selectedId);
          }
        }
        return;
      }

      // Arrow keys -> spatial navigation
      if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        navigateSpatially(e.key);
        return;
      }

      // Direct typing on a selected node starts editing immediately
      if (
        selectedId &&
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        openInlineEditor('node', selectedId, false, e.key);
      }
    });

    // Paste event: supports pasting images, internal subtree, or external text outlines
    window.addEventListener('paste', async (e) => {
      const activeEl = document.activeElement;
      const tag = activeEl?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (activeEl?.isContentEditable) {
        e.preventDefault();
        const plain = e.clipboardData?.getData('text/plain') || '';
        document.execCommand('insertText', false, plain);
        return;
      }
      if (!selectedId) return;

      const items = e.clipboardData?.items || [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const imgData = await resizeImageFile(file);
            const info = findNode(store.getMap().root, selectedId);
            if (info) {
              store.snapshot();
              info.node.image = imgData;
              store.persist();
              refreshAll(false);
              showToast('Immagine incollata nel concetto!', 'ok');
            }
          }
          return;
        }
      }

      const text = e.clipboardData?.getData('text/plain') || '';
      if (text && text.trim().includes('\n')) {
        e.preventDefault();
        const parsedRoot = parseOutline(text);
        const pasted = store.pasteSubtree(selectedId, parsedRoot);
        if (pasted) {
          selectedId = pasted.id;
          refreshAll(false);
          ensureNodeVisible(pasted.id);
          showToast('Scaletta incollata e incolonnata!', 'ok');
        }
        return;
      }

      if (internalClipboard) {
        e.preventDefault();
        const pasted = store.pasteSubtree(selectedId, internalClipboard);
        if (pasted) {
          selectedId = pasted.id;
          refreshAll(false);
          ensureNodeVisible(pasted.id);
          showToast('Ramo incollato!');
        }
      }
    });
  }

  // =========================================================================
  // MODALS: IMPORT FROM TEXT & EXPORT PDF / PRINT
  // =========================================================================

  function bindModalEvents() {
    // Close buttons and backdrop clicks
    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.modal-bg');
        if (modal) modal.hidden = true;
      });
    });

    document.querySelectorAll('.modal-bg').forEach((bg) => {
      bg.addEventListener('click', (e) => {
        if (e.target === bg) bg.hidden = true;
      });
    });

    // Import modal
    dom.impText.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = dom.impText.selectionStart;
        const end = dom.impText.selectionEnd;
        const val = dom.impText.value;
        dom.impText.value = val.slice(0, start) + '  ' + val.slice(end);
        dom.impText.selectionStart = dom.impText.selectionEnd = start + 2;
        updateImportPreview();
      }
    });

    dom.impText.addEventListener('input', debounce(updateImportPreview, 120));

    dom.impExample.addEventListener('click', () => {
      dom.impText.value = SAMPLE_OUTLINES[sampleIdx % SAMPLE_OUTLINES.length];
      sampleIdx++;
      updateImportPreview();
    });

    dom.impGo.addEventListener('click', () => {
      const raw = dom.impText.value.trim();
      if (!raw) {
        showToast('Scrivi o incolla almeno un concetto.', 'error');
        return;
      }
      const tree = parseOutline(raw);
      const inHome = dom.homeScreen && !dom.homeScreen.hidden;
      const mode = inHome || !store.getMap()
        ? 'new'
        : document.querySelector('input[name="imp-mode"]:checked')?.value || 'new';

      if (mode === 'new') {
        const m = store.createNewMap({ title: tree.text || 'Mappa da testo', root: tree }, currentRealFolderId());
        openMapInEditor(m.id);
        renderHomeScreen();
      } else if (mode === 'replace') {
        store.snapshot();
        const map = store.getMap();
        map.root = tree;
        map.title = tree.text || map.title;
        map.links = [];
        selectedId = map.root.id;
        store.persist();
        refreshAll(true);
      } else if (mode === 'append') {
        const target = selectedId || store.getMap().root.id;
        const pasted = store.pasteSubtree(target, tree);
        if (pasted) selectedId = pasted.id;
        refreshAll(true);
      }

      dom.modalImport.hidden = true;
      showToast('Mappa generata e incolonnata automaticamente!', 'ok');
    });

    // Export modal segmented controls
    dom.modalExport.querySelectorAll('.seg[data-opt]').forEach((seg) => {
      const optName = seg.getAttribute('data-opt');
      seg.querySelectorAll('button[data-v]').forEach((btn) => {
        btn.addEventListener('click', () => {
          exportOpts[optName] = btn.getAttribute('data-v');
          syncExportModalControls();
          updateExportPreview();
        });
      });
    });

    dom.expTitle.addEventListener('change', () => {
      exportOpts.includeTitle = dom.expTitle.checked;
      updateExportPreview();
    });

    dom.expMono.addEventListener('change', () => {
      exportOpts.forceMono = dom.expMono.checked;
      updateExportPreview();
    });

    dom.expExpand.addEventListener('change', () => {
      exportOpts.expandAll = dom.expExpand.checked;
      updateExportPreview();
    });

    dom.expPdf.addEventListener('click', () => {
      const map = getExportTargetMap();
      if (map) exportPdf(map, exportOpts);
    });

    dom.expPrint.addEventListener('click', () => {
      const map = getExportTargetMap();
      if (map) printMap(map, exportOpts);
    });

    dom.expPng.addEventListener('click', () => {
      const map = getExportTargetMap();
      if (map) exportPng(map, exportOpts);
    });

    dom.expSvg.addEventListener('click', () => {
      const map = getExportTargetMap();
      if (map) exportSvg(map, exportOpts);
    });

    dom.expJson?.addEventListener('click', () => {
      const map = getExportTargetMap();
      if (!map) return;
      const json = JSON.stringify(map, null, 2);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      downloadBlob(blob, sanitizeFilename(map.title) + '.json');
      showToast('File .json scaricato!', 'ok');
    });

    dom.expTxt?.addEventListener('click', () => {
      const map = getExportTargetMap();
      if (!map) return;
      const txt = treeToOutline(map.root);
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      downloadBlob(blob, sanitizeFilename(map.title) + '-scaletta.txt');
      showToast('Scaletta .txt scaricata!', 'ok');
    });
  }

  function openImportModal() {
    if (isMobileMode()) {
      showToast('La creazione di mappe è disponibile solo da computer.');
      return;
    }
    commitInlineEditor();
    if (!dom.impText.value.trim()) {
      dom.impText.value = SAMPLE_OUTLINES[0];
      sampleIdx = 1;
    }
    dom.modalImport.hidden = false;
    updateImportPreview();
    dom.impText.focus();
  }

  function updateImportPreview() {
    const raw = dom.impText.value.trim();
    if (!raw) {
      dom.impPreview.innerHTML = '';
      dom.impEmpty.hidden = false;
      dom.impStats.textContent = '0 concetti';
      return;
    }

    dom.impEmpty.hidden = true;
    const root = parseOutline(raw);
    const total = countNodesInTree(root);
    dom.impStats.textContent = `${total} concett${total === 1 ? 'o' : 'i'} rilevati`;

    const currentMap = store.getMap();
    const previewMap = {
      title: root.text,
      layout: currentMap?.layout || 'down',
      style: currentMap?.style || window.CMStore.defaultStyle(),
      root,
      links: []
    };

    const built = buildStandaloneSvg(previewMap, { transparentBg: true });
    dom.impPreview.setAttribute('viewBox', `${built.minX} ${built.minY} ${built.width} ${built.height}`);
    dom.impPreview.innerHTML = built.svg.replace(/^<svg[^>]*>|<\/svg>$/g, '');
  }

  function hasCollapsedNodes(node) {
    if (!node) return false;
    if (node.collapsed && node.children && node.children.length > 0) return true;
    for (const ch of node.children || []) {
      if (hasCollapsedNodes(ch)) return true;
    }
    return false;
  }

  function openExportModal(targetMapId = null) {
    commitInlineEditor();
    exportTargetMapId = targetMapId || null;
    const map = getExportTargetMap();
    if (!map) {
      showToast('Nessuna mappa selezionata da scaricare.', 'error');
      return;
    }
    dom.expExpandRow.hidden = !hasCollapsedNodes(map.root);
    syncExportModalControls();
    dom.modalExport.hidden = false;
    updateExportPreview();
  }

  function syncExportModalControls() {
    dom.modalExport.querySelectorAll('.seg[data-opt]').forEach((seg) => {
      const optName = seg.getAttribute('data-opt');
      const curVal = String(exportOpts[optName]);
      seg.querySelectorAll('button[data-v]').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-v') === curVal);
      });
    });
    dom.expTitle.checked = exportOpts.includeTitle;
    dom.expMono.checked = exportOpts.forceMono;
    dom.expExpand.checked = exportOpts.expandAll;
  }

  function updateExportPreview() {
    const map = getExportTargetMap();
    if (!map) return;
    const plan = computeExportPlan(map, exportOpts);
    const dataUrl = svgToDataUrl(plan.rendered.svg);

    const wrapRect = dom.expPreview.parentElement.getBoundingClientRect();
    const maxW = Math.max(260, (wrapRect.width || 560) - 44);
    const maxH = Math.max(260, (wrapRect.height || 440) - 44);

    const totalGridWmm = plan.pageWmm * plan.grid.cols;
    const totalGridHmm = plan.pageHmm * plan.grid.rows;
    const pxPerMm = Math.min(maxW / totalGridWmm, maxH / totalGridHmm);

    const pageWpx = Math.round(plan.pageWmm * pxPerMm);
    const pageHpx = Math.round(plan.pageHmm * pxPerMm);
    const marginPx = plan.marginMm * pxPerMm;
    const innerWpx = plan.innerWmm * pxPerMm;
    const innerHpx = plan.innerHmm * pxPerMm;

    dom.expPreview.style.gridTemplateColumns = `repeat(${plan.grid.cols}, ${pageWpx}px)`;
    dom.expPreview.innerHTML = '';

    for (let r = 0; r < plan.grid.rows; r++) {
      for (let c = 0; c < plan.grid.cols; c++) {
        const pageDiv = document.createElement('div');
        pageDiv.className = 'prev-page';
        pageDiv.style.width = `${pageWpx}px`;
        pageDiv.style.height = `${pageHpx}px`;

        const areaDiv = document.createElement('div');
        areaDiv.className = 'prev-area';
        areaDiv.style.left = `${marginPx}px`;
        areaDiv.style.top = `${marginPx}px`;
        areaDiv.style.width = `${innerWpx}px`;
        areaDiv.style.height = `${innerHpx}px`;

        const img = document.createElement('img');
        img.src = dataUrl;
        img.style.left = `${(plan.offsetXmm - c * plan.innerWmm) * pxPerMm}px`;
        img.style.top = `${(plan.offsetYmm - r * plan.innerHmm) * pxPerMm}px`;
        img.style.width = `${plan.drawWmm * pxPerMm}px`;
        img.style.height = `${plan.drawHmm * pxPerMm}px`;

        areaDiv.appendChild(img);
        pageDiv.appendChild(areaDiv);
        dom.expPreview.appendChild(pageDiv);
      }
    }

    const orientLabel = plan.isLandscape ? 'Orizzontale' : 'Verticale';
    const numPages = plan.grid.cols * plan.grid.rows;
    const pagesDesc = numPages === 1 ? '1 foglio' : `${numPages} fogli (${plan.grid.cols}×${plan.grid.rows} poster)`;

    if (plan.zoomPct < 55 && numPages === 1) {
      dom.expInfo.className = 'exp-info warn';
      dom.expInfo.innerHTML = `<b>${plan.paper.label} · ${orientLabel}</b> · Scala <b>${plan.zoomPct}%</b>.<br>La mappa è molto ampia: prova a selezionare <b>2</b> o <b>4 fogli</b> per stamparla più grande!`;
    } else {
      dom.expInfo.className = 'exp-info';
      dom.expInfo.innerHTML = `<b>${plan.paper.label} · ${orientLabel}</b> · ${pagesDesc} · Scala <b>${plan.zoomPct}%</b>`;
    }
  }

  // Start the app when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
