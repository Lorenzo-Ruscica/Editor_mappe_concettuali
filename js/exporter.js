(function () {
  'use strict';

  const { sanitizeFilename, downloadBlob, setBusy, showToast, deepClone } = window.CMUtil;
  const { buildStandaloneSvg } = window.CMRender;

  // Paper dimensions in millimeters (portrait base)
  const PAPER_SIZES_MM = {
    a4: { w: 210, h: 297, label: 'A4 (210 × 297 mm)' },
    a3: { w: 297, h: 420, label: 'A3 (297 × 420 mm)' },
    a5: { w: 148, h: 210, label: 'A5 (148 × 210 mm)' },
    letter: { w: 215.9, h: 279.4, label: 'Letter (216 × 279 mm)' }
  };

  const MARGINS_MM = {
    narrow: 6,
    normal: 12,
    wide: 20
  };

  /**
   * Tags all nodes in a cloned tree with their original top-level branch index
   * so split sub-maps preserve the exact same branch colors as the full map.
   * Also normalizes collapsed state according to expandAll.
   */
  function prepareClonedRoot(root, expandAll) {
    const copy = deepClone(root);
    function visit(node, depth, branchIdx) {
      if (depth > 0) {
        node._origBranchIndex = branchIdx;
      }
      const rawKids = Array.isArray(node.children) ? node.children : [];
      if (node.collapsed && !expandAll) {
        node.children = [];
        return;
      }
      node.collapsed = false;
      node.children = rawKids.map((ch, idx) => {
        const bIdx = depth === 0 ? idx : branchIdx;
        visit(ch, depth + 1, bIdx);
        return ch;
      });
    }
    visit(copy, 0, 0);
    return copy;
  }

  /**
   * Estimates the horizontal column weight of a subtree so branches can be
   * partitioned into visually balanced sheets.
   */
  function computeSubtreeWeight(node, depth = 1) {
    const kids = node.children || [];
    if (kids.length === 0) return 1;
    const allLeaves = kids.every((k) => !k.children || k.children.length === 0);
    // In layout.js, depth >= 1 nodes whose children are all leaves stack them in 1 vertical column
    if (allLeaves && depth >= 1 && kids.length >= 2) {
      return 1 + Math.min(1.5, kids.length * 0.15);
    }
    let sum = 0;
    for (const k of kids) {
      sum += computeSubtreeWeight(k, depth + 1);
    }
    return Math.max(1, sum);
  }

  /**
   * Optimal contiguous K-partition of an array of items with positive weights.
   * Minimizes the maximum group weight first, and variance between groups second.
   */
  function partitionContiguous(items, weights, k) {
    const n = items.length;
    const numGroups = Math.max(1, Math.min(n, k));
    if (numGroups === 1) return [items.slice()];
    if (numGroups >= n) return items.map((it) => [it]);

    const prefix = new Array(n + 1).fill(0);
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + weights[i];
    const total = prefix[n];
    const ideal = total / numGroups;

    const rangeSum = (i, j) => prefix[j] - prefix[i];

    // dp[g][i] = best { maxW, sqDiff, prev } for partitioning first i items into g groups
    const dp = Array.from({ length: numGroups + 1 }, () => new Array(n + 1).fill(null));
    dp[0][0] = { maxW: 0, sqDiff: 0, prev: -1 };

    for (let g = 1; g <= numGroups; g++) {
      for (let i = g; i <= n - (numGroups - g); i++) {
        let best = null;
        for (let p = g - 1; p < i; p++) {
          const prev = dp[g - 1][p];
          if (!prev) continue;
          const segW = rangeSum(p, i);
          const maxW = Math.max(prev.maxW, segW);
          const sqDiff = prev.sqDiff + (segW - ideal) * (segW - ideal);
          if (
            !best ||
            maxW < best.maxW - 1e-6 ||
            (Math.abs(maxW - best.maxW) <= 1e-6 && sqDiff < best.sqDiff)
          ) {
            best = { maxW, sqDiff, prev: p };
          }
        }
        dp[g][i] = best;
      }
    }

    const groups = [];
    let cur = n;
    for (let g = numGroups; g >= 1; g--) {
      const p = dp[g][cur] ? dp[g][cur].prev : g - 1;
      groups.unshift(items.slice(p, cur));
      cur = p;
    }
    return groups;
  }

  /**
   * Finds the first node (walking down single-child chains from root) that can be split into columns/branches.
   */
  function findSplittablePivot(rootNode) {
    let cur = rootNode;
    let depth = 0;
    const pathIds = [];
    while (cur && Array.isArray(cur.children) && cur.children.length === 1) {
      pathIds.push(cur.id);
      cur = cur.children[0];
      depth++;
    }
    if (!cur || !Array.isArray(cur.children) || cur.children.length < 2) {
      return null;
    }
    return { pivot: cur, depth, pathIds };
  }

  /**
   * Clones rootTree and replaces the children of the node at `pathIds + pivotId` with `childrenSubset`.
   */
  function buildTreeWithSubsetAtPivot(rootTree, pivotId, childrenSubset) {
    const copy = deepClone(rootTree);
    function replaceIn(node) {
      if (node.id === pivotId) {
        node.children = deepClone(childrenSubset);
        return true;
      }
      for (const ch of node.children || []) {
        if (replaceIn(ch)) return true;
      }
      return false;
    }
    replaceIn(copy);
    return copy;
  }

  /**
   * Collects all node IDs present in a tree.
   */
  function collectNodeIds(node, set = new Set()) {
    if (!node) return set;
    set.add(node.id);
    for (const ch of node.children || []) collectNodeIds(ch, set);
    return set;
  }

  /**
   * Splits a concept map into `targetSheets` distinct, self-contained sub-maps.
   * Each sub-map preserves the root concept (and any single-child ancestor path),
   * distributes the columns/branches evenly, and disables freeMode when split
   * so each sheet auto-centers and adapts cleanly to the page.
   */
  function splitMapIntoSubMaps(map, targetSheets, expandAll = false) {
    const cleanRoot = prepareClonedRoot(map.root, expandAll);
    const numTarget = Math.max(1, Number(targetSheets) || 1);

    if (numTarget === 1) {
      return [map];
    }

    const firstSplit = findSplittablePivot(cleanRoot);
    if (!firstSplit) {
      return [map];
    }

    // Start by partitioning the primary branching node into min(children.length, numTarget) groups
    const initialPivot = firstSplit.pivot;
    const initialWeights = initialPivot.children.map((ch) =>
      computeSubtreeWeight(ch, firstSplit.depth + 1)
    );
    const initialK = Math.min(initialPivot.children.length, numTarget);
    const initialGroups = partitionContiguous(initialPivot.children, initialWeights, initialK);

    let rootTrees = initialGroups.map((grp) =>
      buildTreeWithSubsetAtPivot(cleanRoot, initialPivot.id, grp)
    );

    // If user requested more sheets than top-level branches (e.g. 2 main branches, 4 sheets),
    // iteratively split the heaviest sheet that has a splittable sub-branch!
    let guard = 0;
    while (rootTrees.length < numTarget && guard < 20) {
      guard++;
      let bestIdx = -1;
      let bestWeight = -1;
      let bestPivotInfo = null;

      for (let i = 0; i < rootTrees.length; i++) {
        const pInfo = findSplittablePivot(rootTrees[i]);
        if (!pInfo || pInfo.pivot.children.length < 2) continue;
        // Avoid splitting a small vertical leaf stack unless it has at least 4 items
        const allLeaves = pInfo.pivot.children.every((k) => !k.children || k.children.length === 0);
        if (allLeaves && pInfo.depth >= 1 && pInfo.pivot.children.length < 4) continue;

        const w = computeSubtreeWeight(rootTrees[i], 0);
        if (w > bestWeight) {
          bestWeight = w;
          bestIdx = i;
          bestPivotInfo = pInfo;
        }
      }

      if (bestIdx === -1 || !bestPivotInfo) break;

      const targetTree = rootTrees[bestIdx];
      const piv = bestPivotInfo.pivot;
      const needed = numTarget - rootTrees.length + 1;
      const splitWays = Math.min(piv.children.length, needed, 2);
      const wts = piv.children.map((ch) => computeSubtreeWeight(ch, bestPivotInfo.depth + 1));
      const subGroups = partitionContiguous(piv.children, wts, splitWays);

      const replacements = subGroups.map((grp) =>
        buildTreeWithSubsetAtPivot(targetTree, piv.id, grp)
      );
      rootTrees.splice(bestIdx, 1, ...replacements);
    }

    const totalSheets = rootTrees.length;
    if (totalSheets <= 1) {
      return [map];
    }

    return rootTrees.map((rt, idx) => {
      const presentIds = collectNodeIds(rt);
      const validLinks = (map.links || []).filter(
        (l) => presentIds.has(l.from) && presentIds.has(l.to)
      );
      const baseTitle = map.title || 'Mappa concettuale';
      return {
        ...map,
        title: `${baseTitle} (${idx + 1}/${totalSheets})`,
        style: {
          ...(map.style || {}),
          freeMode: false // Auto-layout each sheet so its columns center and adapt to the page
        },
        root: rt,
        links: validLinks
      };
    });
  }

  /**
   * Computes fit geometry for a rendered SVG inside a printable area (innerWmm x innerHmm).
   */
  function fitRenderedToPage(rendered, innerWmm, innerHmm) {
    const mapAspect = rendered.width / Math.max(1, rendered.height);
    const pageAspect = innerWmm / innerHmm;

    let drawWmm, drawHmm;
    if (mapAspect > pageAspect) {
      drawWmm = innerWmm;
      drawHmm = innerWmm / mapAspect;
    } else {
      drawHmm = innerHmm;
      drawWmm = innerHmm * mapAspect;
    }

    // Do not upscale small sub-maps beyond 135% of their natural 96-DPI size so boxes don't look giant
    const naturalWmm = rendered.width / 3.779527559;
    const naturalHmm = rendered.height / 3.779527559;
    const maxWmm = naturalWmm * 1.35;
    const maxHmm = naturalHmm * 1.35;
    if (drawWmm > maxWmm || drawHmm > maxHmm) {
      const capScale = Math.min(maxWmm / drawWmm, maxHmm / drawHmm);
      drawWmm *= capScale;
      drawHmm *= capScale;
    }

    const offsetXmm = (innerWmm - drawWmm) / 2;
    const offsetYmm = (innerHmm - drawHmm) / 2;
    const zoomPct = Math.round((drawWmm / Math.max(1, naturalWmm)) * 100);

    return {
      rendered,
      drawWmm,
      drawHmm,
      offsetXmm,
      offsetYmm,
      zoomPct
    };
  }

  /**
   * Helper to build all sheets for a specific page count and orientation setting.
   */
  function buildSheetsPlan(map, opts, requestedPages) {
    const subMaps = splitMapIntoSubMaps(map, requestedPages, Boolean(opts.expandAll));
    const renderedList = subMaps.map((sm) =>
      buildStandaloneSvg(sm, {
        includeTitle: opts.includeTitle,
        forceMono: opts.forceMono,
        expandAll: opts.expandAll
      })
    );

    const paper = PAPER_SIZES_MM[opts.size] || PAPER_SIZES_MM.a4;
    const marginMm = MARGINS_MM[opts.margin] ?? 12;

    let orient = opts.orient;
    if (orient === 'auto') {
      // Pick orientation that maximizes the average readable scale across the sheets
      const avgRatio =
        renderedList.reduce((acc, r) => acc + r.width / Math.max(1, r.height), 0) /
        renderedList.length;
      orient = avgRatio >= 1.05 ? 'landscape' : 'portrait';
    }

    const isLandscape = orient === 'landscape';
    const pageWmm = isLandscape ? paper.h : paper.w;
    const pageHmm = isLandscape ? paper.w : paper.h;
    const innerWmm = Math.max(20, pageWmm - marginMm * 2);
    const innerHmm = Math.max(20, pageHmm - marginMm * 2);

    const sheets = renderedList.map((rend, idx) => {
      const fit = fitRenderedToPage(rend, innerWmm, innerHmm);
      return {
        index: idx,
        total: renderedList.length,
        subMap: subMaps[idx],
        ...fit
      };
    });

    const avgZoomPct = Math.round(
      sheets.reduce((acc, s) => acc + s.zoomPct, 0) / Math.max(1, sheets.length)
    );
    const minZoomPct = Math.min(...sheets.map((s) => s.zoomPct));

    // Layout grid for the preview panel (side-by-side cards)
    const count = sheets.length;
    const previewCols = count === 1 ? 1 : count === 2 || count === 4 ? 2 : 3;
    const previewRows = Math.ceil(count / previewCols);

    return {
      sheets,
      rendered: sheets[0].rendered,
      paper,
      orient,
      isLandscape,
      pageWmm,
      pageHmm,
      marginMm,
      innerWmm,
      innerHmm,
      grid: { cols: previewCols, rows: previewRows },
      totalWmm: innerWmm,
      totalHmm: innerHmm,
      drawWmm: sheets[0].drawWmm,
      drawHmm: sheets[0].drawHmm,
      offsetXmm: sheets[0].offsetXmm,
      offsetYmm: sheets[0].offsetYmm,
      zoomPct: avgZoomPct,
      minZoomPct,
      requestedPages
    };
  }

  /**
   * Computes pagination plan: either for a fixed number of sheets (1, 2, 3, 4, 6)
   * or 'auto' which automatically chooses the number of sheets so the map is legible.
   */
  function computeExportPlan(map, opts) {
    if (opts.pages === 'auto') {
      const candidates = [1, 2, 3, 4, 6];
      let bestPlan = null;
      for (const c of candidates) {
        const plan = buildSheetsPlan(map, opts, c);
        if (!bestPlan || plan.sheets.length > bestPlan.sheets.length) {
          bestPlan = plan;
        }
        // Stop as soon as the minimum scale across all sheets is comfortably readable (>= 68%)
        if (plan.minZoomPct >= 68) {
          return plan;
        }
      }
      return bestPlan;
    }

    const req = Math.max(1, Number(opts.pages) || 1);
    return buildSheetsPlan(map, opts, req);
  }

  function svgToDataUrl(svgString) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
  }

  function loadSvgAsImage(svgString) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'sync';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Impossibile renderizzare la mappa in immagine'));
      img.src = svgToDataUrl(svgString);
    });
  }

  /**
   * Renders a multi-page PDF 1.4 binary file directly in JavaScript from an array of JPEG page images.
   * Each page entry: { jpegBytes: Uint8Array, pixelW, pixelH, pageWpt, pageHpt }
   */
  function buildPdfBytes(pages, title = 'Mappa Concettuale') {
    const enc = new TextEncoder();
    const chunks = [];
    let offset = 0;
    const offsets = [0];

    function pushStr(s) {
      const b = enc.encode(s);
      chunks.push(b);
      offset += b.length;
    }

    function pushBytes(b) {
      chunks.push(b);
      offset += b.length;
    }

    function startObj(id) {
      offsets[id] = offset;
      pushStr(`${id} 0 obj\n`);
    }

    function endObj() {
      pushStr(`\nendobj\n`);
    }

    const n = pages.length;
    const infoObjId = 3 + n * 3;
    const totalObjs = infoObjId;

    pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

    // 1: Catalog
    startObj(1);
    pushStr('<< /Type /Catalog /Pages 2 0 R >>');
    endObj();

    // 2: Pages
    const kidsRefs = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    startObj(2);
    pushStr(`<< /Type /Pages /Kids [ ${kidsRefs} ] /Count ${n} >>`);
    endObj();

    for (let i = 0; i < n; i++) {
      const p = pages[i];
      const pageObjId = 3 + i * 3;
      const contentObjId = 4 + i * 3;
      const imageObjId = 5 + i * 3;

      const wPt = p.pageWpt.toFixed(2);
      const hPt = p.pageHpt.toFixed(2);

      startObj(pageObjId);
      pushStr(
        `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${wPt} ${hPt} ] ` +
          `/Resources << /XObject << /Im0 ${imageObjId} 0 R >> >> ` +
          `/Contents ${contentObjId} 0 R >>`
      );
      endObj();

      const streamCmd = `q\n${wPt} 0 0 ${hPt} 0 0 cm\n/Im0 Do\nQ\n`;
      const streamBytes = enc.encode(streamCmd);
      startObj(contentObjId);
      pushStr(`<< /Length ${streamBytes.length} >>\nstream\n`);
      pushBytes(streamBytes);
      pushStr(`\nendstream`);
      endObj();

      startObj(imageObjId);
      pushStr(
        `<< /Type /XObject /Subtype /Image /Width ${p.pixelW} /Height ${p.pixelH} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpegBytes.length} >>\nstream\n`
      );
      pushBytes(p.jpegBytes);
      pushStr(`\nendstream`);
      endObj();
    }

    const safeTitle = String(title || 'Mappa Concettuale').replace(/[()\\]/g, '');
    startObj(infoObjId);
    pushStr(`<< /Title (${safeTitle}) /Creator (EduMap - Editor Mappe Concettuali) >>`);
    endObj();

    const xrefOffset = offset;
    pushStr(`xref\n0 ${totalObjs + 1}\n`);
    pushStr(`0000000000 65535 f \n`);
    for (let id = 1; id <= totalObjs; id++) {
      const offStr = String(offsets[id] || 0).padStart(10, '0');
      pushStr(`${offStr} 00000 n \n`);
    }

    pushStr(
      `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R /Info ${infoObjId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
    );

    return new Blob(chunks, { type: 'application/pdf' });
  }

  function dataUrlToUint8Array(dataUrl) {
    const base64 = dataUrl.split(',')[1] || '';
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Generates and downloads a crisp PDF where each page is a distinct, complete sub-map sheet.
   */
  async function exportPdf(map, opts) {
    setBusy(true, 'Generazione del PDF in corso…');
    try {
      const plan = computeExportPlan(map, opts);

      const mmToPt = 72 / 25.4;
      const dpi = opts.quality === 'high' ? 260 : 180;
      const mmToPx = dpi / 25.4;

      const pageWpt = plan.pageWmm * mmToPt;
      const pageHpt = plan.pageHmm * mmToPt;
      const pixelW = Math.round(plan.pageWmm * mmToPx);
      const pixelH = Math.round(plan.pageHmm * mmToPx);
      const marginPx = plan.marginMm * mmToPx;

      const pagesData = [];

      for (let i = 0; i < plan.sheets.length; i++) {
        const sheet = plan.sheets[i];
        const img = await loadSvgAsImage(sheet.rendered.svg);

        const canvas = document.createElement('canvas');
        canvas.width = pixelW;
        canvas.height = pixelH;
        const ctx = canvas.getContext('2d');

        // White paper background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pixelW, pixelH);

        const drawXpx = marginPx + sheet.offsetXmm * mmToPx;
        const drawYpx = marginPx + sheet.offsetYmm * mmToPx;
        const drawWpx = sheet.drawWmm * mmToPx;
        const drawHpx = sheet.drawHmm * mmToPx;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, drawXpx, drawYpx, drawWpx, drawHpx);

        if (plan.sheets.length > 1) {
          ctx.fillStyle = '#64748b';
          ctx.font = `600 ${Math.round(8.5 * (dpi / 72))}px sans-serif`;
          ctx.textAlign = 'right';
          ctx.fillText(
            `Scheda ${i + 1} di ${plan.sheets.length}`,
            pixelW - marginPx,
            pixelH - Math.max(8, marginPx * 0.38)
          );
        }

        const jpegUrl = canvas.toDataURL('image/jpeg', opts.quality === 'high' ? 0.95 : 0.90);
        pagesData.push({
          jpegBytes: dataUrlToUint8Array(jpegUrl),
          pixelW,
          pixelH,
          pageWpt,
          pageHpt
        });
      }

      const pdfBlob = buildPdfBytes(pagesData, map.title);
      const filename = sanitizeFilename(map.title) + '.pdf';
      downloadBlob(pdfBlob, filename);
      showToast('PDF scaricato con successo!', 'ok');
    } catch (err) {
      console.error(err);
      showToast('Errore durante la creazione del PDF: ' + err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Prepares #print-root with distinct sub-map sheets and invokes browser native print dialog.
   */
  async function printMap(map, opts) {
    setBusy(true, 'Preparazione della stampa…');
    try {
      const plan = computeExportPlan(map, opts);

      let dynStyle = document.getElementById('dynamic-print-page-style');
      if (!dynStyle) {
        dynStyle = document.createElement('style');
        dynStyle.id = 'dynamic-print-page-style';
        document.head.appendChild(dynStyle);
      }
      dynStyle.textContent = `@media print { @page { size: ${plan.pageWmm}mm ${plan.pageHmm}mm; margin: 0; } }`;

      const printRoot = document.getElementById('print-root');
      printRoot.innerHTML = '';

      for (let i = 0; i < plan.sheets.length; i++) {
        const sheet = plan.sheets[i];
        const dataUrl = svgToDataUrl(sheet.rendered.svg);
        await loadSvgAsImage(sheet.rendered.svg);

        const pageEl = document.createElement('div');
        pageEl.className = 'print-page';
        pageEl.style.width = `${plan.pageWmm}mm`;
        pageEl.style.height = `${plan.pageHmm}mm`;

        const areaEl = document.createElement('div');
        areaEl.className = 'print-area';
        areaEl.style.left = `${plan.marginMm}mm`;
        areaEl.style.top = `${plan.marginMm}mm`;
        areaEl.style.width = `${plan.innerWmm}mm`;
        areaEl.style.height = `${plan.innerHmm}mm`;

        const imgEl = document.createElement('img');
        imgEl.src = dataUrl;
        imgEl.style.left = `${sheet.offsetXmm}mm`;
        imgEl.style.top = `${sheet.offsetYmm}mm`;
        imgEl.style.width = `${sheet.drawWmm}mm`;
        imgEl.style.height = `${sheet.drawHmm}mm`;

        areaEl.appendChild(imgEl);
        pageEl.appendChild(areaEl);
        printRoot.appendChild(pageEl);
      }

      setBusy(false);
      setTimeout(() => {
        window.print();
      }, 80);
    } catch (err) {
      setBusy(false);
      console.error(err);
      showToast('Errore preparazione stampa: ' + err.message, 'error');
    }
  }

  /**
   * Downloads a high-DPI PNG image of the concept map.
   */
  async function exportPng(map, opts) {
    setBusy(true, 'Generazione immagine PNG…');
    try {
      const rendered = buildStandaloneSvg(map, {
        includeTitle: opts.includeTitle,
        forceMono: opts.forceMono,
        expandAll: opts.expandAll
      });
      const img = await loadSvgAsImage(rendered.svg);
      const scale = opts.quality === 'high' ? 3 : 2;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(rendered.width * scale);
      canvas.height = Math.round(rendered.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        if (blob) {
          downloadBlob(blob, sanitizeFilename(map.title) + '.png');
          showToast('Immagine PNG scaricata!', 'ok');
        }
        setBusy(false);
      }, 'image/png');
    } catch (err) {
      setBusy(false);
      showToast('Errore esportazione PNG: ' + err.message, 'error');
    }
  }

  /**
   * Downloads a vector SVG file of the concept map.
   */
  function exportSvg(map, opts) {
    const rendered = buildStandaloneSvg(map, {
      includeTitle: opts.includeTitle,
      forceMono: opts.forceMono,
      expandAll: opts.expandAll
    });
    const blob = new Blob([rendered.svg], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(blob, sanitizeFilename(map.title) + '.svg');
    showToast('File vettoriale SVG scaricato!', 'ok');
  }

  window.CMExporter = {
    PAPER_SIZES_MM,
    computeExportPlan,
    svgToDataUrl,
    exportPdf,
    printMap,
    exportPng,
    exportSvg
  };
})();
