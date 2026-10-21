(function () {
  'use strict';

  const PATHS = {
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    child: '<rect x="8" y="2.5" width="8" height="5" rx="1.5"/><rect x="8" y="16.5" width="8" height="5" rx="1.5"/><path d="M12 7.5v9M9.5 14l2.5 2.5 2.5-2.5"/>',
    sibling: '<rect x="2.5" y="13" width="8" height="6" rx="1.5"/><rect x="13.5" y="13" width="8" height="6" rx="1.5"/><path d="M6.5 13V8.5h11V13M12 5v3.5"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>',
    layoutDown: '<rect x="8" y="2.5" width="8" height="4.5" rx="1.2"/><rect x="2" y="16.5" width="6" height="4.5" rx="1.2"/><rect x="9" y="16.5" width="6" height="4.5" rx="1.2"/><rect x="16" y="16.5" width="6" height="4.5" rx="1.2"/><path d="M12 7v5M5 16.5V12h14v4.5M12 12v4.5"/>',
    layoutRight: '<rect x="2.5" y="9.5" width="5" height="5" rx="1.2"/><rect x="16" y="3" width="5.5" height="4.2" rx="1.2"/><rect x="16" y="9.9" width="5.5" height="4.2" rx="1.2"/><rect x="16" y="16.8" width="5.5" height="4.2" rx="1.2"/><path d="M7.5 12H12M16 5.1H12v13.8h4M12 12h4"/>',
    layoutMind: '<rect x="8.5" y="9.5" width="7" height="5" rx="1.5"/><rect x="1.5" y="4" width="4.5" height="3.8" rx="1"/><rect x="1.5" y="16.2" width="4.5" height="3.8" rx="1"/><rect x="18" y="4" width="4.5" height="3.8" rx="1"/><rect x="18" y="16.2" width="4.5" height="3.8" rx="1"/><path d="M8.5 11 6 5.9M8.5 13 6 18.1M15.5 11 18 5.9M15.5 13 18 18.1"/>',
    zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>',
    zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>',
    fit: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><rect x="4" y="4" width="16" height="16" rx="3" stroke-dasharray="2 2"/>',
    fullscreen: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    exitFullscreen: '<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>',
    move: '<polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    text: '<path d="M17 6.1H3M21 12.1H7M15.1 18H3"/>',
    volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    help: '<circle cx="12" cy="12" r="9.5"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/>',
    sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    wand: '<path d="m15 4-1 1 6 6 1-1a2.83 2.83 0 1 0-4-4L15 4Z"/><path d="m13 6-9.5 9.5a2.12 2.12 0 0 0 3 3L16 9"/><path d="M6 3v3M4.5 4.5h3M19 16v3M17.5 17.5h3"/>',
    printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    expand: '<polyline points="6 9 12 15 18 9"/>',
    collapse: '<polyline points="18 15 12 9 6 15"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    cloudCheck: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="m9 13 2 2 4-4"/>',
    logOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    check: '<polyline points="20 6 9 17 4 12"/>'
  };

  function svgIcon(name, size = 18) {
    const p = PATHS[name] || '';
    return `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  }

  function hydrateIcons(root = document) {
    const els = root.querySelectorAll('[data-icon]');
    els.forEach((el) => {
      if (el.querySelector('svg.ic')) return;
      const name = el.getAttribute('data-icon');
      el.insertAdjacentHTML('afterbegin', svgIcon(name, 18));
    });
  }

  window.CMIcons = {
    svgIcon,
    hydrateIcons
  };
})();
