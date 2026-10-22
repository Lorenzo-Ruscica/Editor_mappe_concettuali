(function () {
  'use strict';

  const { sanitizeFilename, downloadBlob, setBusy, showToast } = window.CMUtil;
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

  function getGridForPages(pages, isLandscape) {
    const n = Number(pages) || 1;
    if (n === 1) return { cols: 1, rows: 1 };
    if (n === 2) return isLandscape ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
    if (n === 4) return { cols: 2, rows: 2 };
    if (n === 6) return isLandscape ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 };
    if (n === 9) return { cols: 3, rows: 3 };
    return { cols: 1, rows: 1 };
  }

  /**
   * Computes exact pagination geometry for the given map and export options.
   */
  function computeExportPlan(map, opts) {
    const rendered = buildStandaloneSvg(map, {
      includeTitle: opts.includeTitle,
      forceMono: opts.forceMono,
      expandAll: opts.expandAll
    });

    const paper = PAPER_SIZES_MM[opts.size] || PAPER_SIZES_MM.a4;
    const marginMm = MARGINS_MM[opts.margin] ?? 12;

    let orient = opts.orient;
    if (orient === 'auto') {
      orient = rendered.width >= rendered.height * 1.05 ? 'landscape' : 'portrait';
    }
    const isLandscape = orient === 'landscape';
    const pageWmm = isLandscape ? paper.h : paper.w;
    const pageHmm = isLandscape ? paper.w : paper.h;

    const innerWmm = Math.max(20, pageWmm - marginMm * 2);
    const innerHmm = Math.max(20, pageHmm - marginMm * 2);

    const grid = getGridForPages(opts.pages, isLandscape);
    const totalWmm = innerWmm * grid.cols;
    const totalHmm = innerHmm * grid.rows;

    // Fit map aspect ratio into total printable grid area
    const mapAspect = rendered.width / Math.max(1, rendered.height);
    const gridAspect = totalWmm / totalHmm;

    let drawWmm, drawHmm;
    if (mapAspect > gridAspect) {
      drawWmm = totalWmm;
      drawHmm = totalWmm / mapAspect;
    } else {
      drawHmm = totalHmm;
      drawWmm = totalHmm * mapAspect;
    }

    const offsetXmm = (totalWmm - drawWmm) / 2;
    const offsetYmm = (totalHmm - drawHmm) / 2;

    // Scale relative to 1:1 at 96 DPI (1 mm = 3.7795 px)
    const naturalWmm = rendered.width / 3.779527559;
    const zoomPct = Math.round((drawWmm / Math.max(1, naturalWmm)) * 100);

    return {
      rendered,
      paper,
      orient,
      isLandscape,
      pageWmm,
      pageHmm,
      marginMm,
      innerWmm,
      innerHmm,
      grid,
      totalWmm,
      totalHmm,
      drawWmm,
      drawHmm,
      offsetXmm,
      offsetYmm,
      zoomPct
    };
  }

  function svgToDataUrl(svgString) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
  }

  function loadSvgAsImage(svgString) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'sync';
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error('Impossibile renderizzare la mappa in immagine'));
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
    const offsets = [0]; // 1-indexed PDF object byte offsets

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

    // Object numbering:
    // 1: Catalog
    // 2: Pages
    // For each page i (0..N-1):
    //   pageObjId = 3 + i * 3
    //   contentObjId = 4 + i * 3
    //   imageObjId = 5 + i * 3
    // Info object = 3 + N * 3
    const n = pages.length;
    const infoObjId = 3 + n * 3;
    const totalObjs = infoObjId;

    // PDF Header with binary comment
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

    // Pages + Content streams + Image XObjects
    for (let i = 0; i < n; i++) {
      const p = pages[i];
      const pageObjId = 3 + i * 3;
      const contentObjId = 4 + i * 3;
      const imageObjId = 5 + i * 3;

      const wPt = p.pageWpt.toFixed(2);
      const hPt = p.pageHpt.toFixed(2);

      // Page object
      startObj(pageObjId);
      pushStr(
        `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${wPt} ${hPt} ] ` +
          `/Resources << /XObject << /Im0 ${imageObjId} 0 R >> >> ` +
          `/Contents ${contentObjId} 0 R >>`
      );
      endObj();

      // Content stream: draw Im0 across the entire page
      const streamCmd = `q\n${wPt} 0 0 ${hPt} 0 0 cm\n/Im0 Do\nQ\n`;
      const streamBytes = enc.encode(streamCmd);
      startObj(contentObjId);
      pushStr(`<< /Length ${streamBytes.length} >>\nstream\n`);
      pushBytes(streamBytes);
      pushStr(`\nendstream`);
      endObj();

      // Image XObject (DCTDecode = standard baseline JPEG)
      startObj(imageObjId);
      pushStr(
        `<< /Type /XObject /Subtype /Image /Width ${p.pixelW} /Height ${p.pixelH} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpegBytes.length} >>\nstream\n`
      );
      pushBytes(p.jpegBytes);
      pushStr(`\nendstream`);
      endObj();
    }

    // Info dictionary
    const safeTitle = String(title || 'Mappa Concettuale').replace(/[()\\]/g, '');
    startObj(infoObjId);
    pushStr(`<< /Title (${safeTitle}) /Creator (EduMap - Editor Mappe Concettuali) >>`);
    endObj();

    // Cross-reference table
    const xrefOffset = offset;
    pushStr(`xref\n0 ${totalObjs + 1}\n`);
    pushStr(`0000000000 65535 f \n`);
    for (let id = 1; id <= totalObjs; id++) {
      const offStr = String(offsets[id] || 0).padStart(10, '0');
      pushStr(`${offStr} 00000 n \n`);
    }

    // Trailer
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
   * Generates and downloads a crisp multi-page PDF of the concept map.
   */
  async function exportPdf(map, opts) {
    setBusy(true, 'Generazione del PDF in corso…');
    try {
      const plan = computeExportPlan(map, opts);
      const img = await loadSvgAsImage(plan.rendered.svg);

      // Conversion factors: 1 inch = 25.4 mm = 72 pt
      const mmToPt = 72 / 25.4;
      const dpi = opts.quality === 'high' ? 260 : 180;
      const mmToPx = dpi / 25.4;

      const pageWpt = plan.pageWmm * mmToPt;
      const pageHpt = plan.pageHmm * mmToPt;
      const pixelW = Math.round(plan.pageWmm * mmToPx);
      const pixelH = Math.round(plan.pageHmm * mmToPx);

      const pagesData = [];

      for (let r = 0; r < plan.grid.rows; r++) {
        for (let c = 0; c < plan.grid.cols; c++) {
          const canvas = document.createElement('canvas');
          canvas.width = pixelW;
          canvas.height = pixelH;
          const ctx = canvas.getContext('2d');

          // White paper background
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, pixelW, pixelH);

          // Clip to printable area inside margins
          const marginPx = plan.marginMm * mmToPx;
          const innerWpx = plan.innerWmm * mmToPx;
          const innerHpx = plan.innerHmm * mmToPx;

          ctx.save();
          ctx.beginPath();
          ctx.rect(marginPx, marginPx, innerWpx, innerHpx);
          ctx.clip();

          // Position the full map image so slice (c, r) lands in the printable area
          const drawXpx = marginPx + (plan.offsetXmm - c * plan.innerWmm) * mmToPx;
          const drawYpx = marginPx + (plan.offsetYmm - r * plan.innerHmm) * mmToPx;
          const drawWpx = plan.drawWmm * mmToPx;
          const drawHpx = plan.drawHmm * mmToPx;

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, drawXpx, drawYpx, drawWpx, drawHpx);
          ctx.restore();

          // Optional subtle page crop/number indicator on multi-page posters
          if (plan.grid.cols * plan.grid.rows > 1) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = `${Math.round(8 * (dpi / 72))}px sans-serif`;
            ctx.textAlign = 'right';
            ctx.fillText(
              `Foglio ${r * plan.grid.cols + c + 1}/${plan.grid.cols * plan.grid.rows} (${r + 1},${c + 1})`,
              pixelW - marginPx,
              pixelH - Math.max(6, marginPx * 0.35)
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
   * Prepares #print-root with exact millimeter pages and invokes browser native print dialog.
   */
  async function printMap(map, opts) {
    setBusy(true, 'Preparazione della stampa…');
    try {
      const plan = computeExportPlan(map, opts);
      const dataUrl = svgToDataUrl(plan.rendered.svg);
      await loadSvgAsImage(plan.rendered.svg);

      let dynStyle = document.getElementById('dynamic-print-page-style');
      if (!dynStyle) {
        dynStyle = document.createElement('style');
        dynStyle.id = 'dynamic-print-page-style';
        document.head.appendChild(dynStyle);
      }
      dynStyle.textContent = `@media print { @page { size: ${plan.pageWmm}mm ${plan.pageHmm}mm; margin: 0; } }`;

      const printRoot = document.getElementById('print-root');
      printRoot.innerHTML = '';

      for (let r = 0; r < plan.grid.rows; r++) {
        for (let c = 0; c < plan.grid.cols; c++) {
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
          imgEl.style.left = `${plan.offsetXmm - c * plan.innerWmm}mm`;
          imgEl.style.top = `${plan.offsetYmm - r * plan.innerHmm}mm`;
          imgEl.style.width = `${plan.drawWmm}mm`;
          imgEl.style.height = `${plan.drawHmm}mm`;

          areaEl.appendChild(imgEl);
          pageEl.appendChild(areaEl);
          printRoot.appendChild(pageEl);
        }
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
