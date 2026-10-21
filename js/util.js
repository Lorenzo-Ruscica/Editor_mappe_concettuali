(function () {
  'use strict';

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');

  function uid(prefix = 'n') {
    return prefix + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function debounce(fn, ms = 200) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeXml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function sanitizeFilename(name) {
    const cleaned = String(name || 'mappa-concettuale')
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/\s+/g, ' ')
      .slice(0, 80);
    return cleaned || 'mappa-concettuale';
  }

  function formatDate(ts) {
    try {
      const d = new Date(ts);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      if (sameDay) {
        return 'Oggi, ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      }
      return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return '';
    }
  }

  function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return { r: 255, g: 255, b: 255 };
    let h = hex.replace('#', '').trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const num = parseInt(h, 16);
    if (isNaN(num)) return { r: 255, g: 255, b: 255 };
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function rgbToHex(r, g, b) {
    const toHex = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  function mixColors(hex1, hex2, weight = 0.5) {
    const c1 = hexToRgb(hex1);
    const c2 = hexToRgb(hex2);
    return rgbToHex(
      c1.r * (1 - weight) + c2.r * weight,
      c1.g * (1 - weight) + c2.g * weight,
      c1.b * (1 - weight) + c2.b * weight
    );
  }

  function luminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    const a = [r, g, b].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  }

  function contrastText(bgHex) {
    return luminance(bgHex) > 0.44 ? '#0f172a' : '#ffffff';
  }

  function darken(hex, amount = 0.18) {
    return mixColors(hex, '#0f172a', amount);
  }

  function lighten(hex, amount = 0.85) {
    return mixColors(hex, '#ffffff', amount);
  }

  /**
   * Strips inline formatting tags (<b>, <i>, <u>, <strong>, <em>) returning plain text.
   */
  function stripRichTags(str) {
    return String(str ?? '')
      .replace(/<\/?(?:b|strong|i|em|u)\b[^>]*>/gi, '')
      .replace(/&nbsp;/gi, ' ');
  }

  /**
   * Converts stored rich text (which may contain <b>, <i>, <u> and \n) into safe HTML for contenteditable.
   */
  function richTextToHtml(str) {
    const raw = String(str ?? '').replace(/\r\n/g, '\n');
    // Tokenize by allowed tags <b>, </b>, <i>, </i>, <u>, </u>
    const parts = raw.split(/(<\/?(?:b|i|u)>)/gi);
    return parts
      .map((part) => {
        if (/^<\/?(?:b|i|u)>$/i.test(part)) {
          return part.toLowerCase();
        }
        return escapeHtml(part).replace(/\n/g, '<br>');
      })
      .join('');
  }

  /**
   * Serializes a contenteditable DOM element into stored rich text with <b>, <i>, <u> and \n.
   */
  function htmlToRichText(rootEl) {
    if (!rootEl) return '';

    function walk(node, state) {
      if (node.nodeType === Node.TEXT_NODE) {
        const val = (node.nodeValue || '').replace(/\u00A0/g, ' ');
        if (!val) return '';
        let out = val;
        if (state.u) out = `<u>${out}</u>`;
        if (state.i) out = `<i>${out}</i>`;
        if (state.b) out = `<b>${out}</b>`;
        return out;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';

      const tag = node.tagName.toLowerCase();
      if (tag === 'br') return '\n';

      const nextState = {
        b: state.b || tag === 'b' || tag === 'strong' || node.style?.fontWeight === 'bold' || Number(node.style?.fontWeight) >= 700,
        i: state.i || tag === 'i' || tag === 'em' || node.style?.fontStyle === 'italic',
        u: state.u || tag === 'u' || (node.style?.textDecoration || '').includes('underline')
      };

      let inner = '';
      const children = node.childNodes;
      for (let idx = 0; idx < children.length; idx++) {
        inner += walk(children[idx], nextState);
      }

      const isBlock = tag === 'div' || tag === 'p' || tag === 'li';
      if (isBlock && node.previousSibling) {
        return '\n' + inner;
      }
      return inner;
    }

    let result = '';
    for (let i = 0; i < rootEl.childNodes.length; i++) {
      result += walk(rootEl.childNodes[i], { b: false, i: false, u: false });
    }

    // Merge adjacent identical tags like </b><b>
    result = result
      .replace(/<\/u>(\s*)<u>/g, '$1')
      .replace(/<\/i>(\s*)<i>/g, '$1')
      .replace(/<\/b>(\s*)<b>/g, '$1')
      .replace(/\n{3,}/g, '\n\n');

    return result;
  }

  /**
   * Parses a single paragraph with optional <b>, <i>, <u> tags into character/word segments.
   */
  function parseRichSegments(para, baseBold = false, baseItalic = false, baseUnderline = false) {
    const tokens = String(para ?? '').split(/(<\/?(?:b|strong|i|em|u)>)/gi);
    let b = baseBold;
    let i = baseItalic;
    let u = baseUnderline;
    const segments = [];

    for (const tok of tokens) {
      if (!tok) continue;
      const lower = tok.toLowerCase();
      if (lower === '<b>' || lower === '<strong>') { b = true; continue; }
      if (lower === '</b>' || lower === '</strong>') { b = baseBold; continue; }
      if (lower === '<i>' || lower === '<em>') { i = true; continue; }
      if (lower === '</i>' || lower === '</em>') { i = baseItalic; continue; }
      if (lower === '<u>') { u = true; continue; }
      if (lower === '</u>') { u = baseUnderline; continue; }
      segments.push({ text: tok, bold: b, italic: i, underline: u });
    }
    return segments;
  }

  function buildFontSpec(bold, italic, fontSize, fontFamily) {
    return `${italic ? 'italic ' : ''}${bold ? '700' : '500'} ${fontSize}px ${fontFamily}`;
  }

  function measureRichRuns(runs, fontSize, fontFamily) {
    let w = 0;
    for (const r of runs) {
      measureCtx.font = buildFontSpec(r.bold, r.italic, fontSize, fontFamily);
      w += measureCtx.measureText(r.text).width;
    }
    return w;
  }

  function mergeRuns(runs) {
    const out = [];
    for (const r of runs) {
      if (!r.text) continue;
      const prev = out[out.length - 1];
      if (prev && prev.bold === r.bold && prev.italic === r.italic && prev.underline === r.underline) {
        prev.text += r.text;
      } else {
        out.push({ text: r.text, bold: r.bold, italic: r.italic, underline: r.underline });
      }
    }
    return out;
  }

  /**
   * Wraps multi-paragraph rich text (supporting <b>, <i>, <u>) within maxWidth.
   */
  function wrapRichText(text, styleOpts, maxWidth) {
    const {
      fontSize = 14,
      fontFamily = 'sans-serif',
      bold: baseBold = false,
      italic: baseItalic = false,
      underline: baseUnderline = false
    } = styleOpts || {};

    const raw = String(text ?? '').replace(/\r\n/g, '\n');
    const paragraphs = raw.split('\n');
    const lines = [];
    const richLines = [];
    let maxLineW = 0;

    for (const para of paragraphs) {
      const plainTrim = stripRichTags(para).trim();
      if (!plainTrim) {
        lines.push('');
        richLines.push([]);
        continue;
      }

      const segs = parseRichSegments(para, baseBold, baseItalic, baseUnderline);
      // Break segments into word tokens preserving whitespace attachment
      const wordUnits = [];
      let currentWordRuns = [];

      for (const seg of segs) {
        const parts = seg.text.split(/(\s+)/);
        for (const p of parts) {
          if (!p) continue;
          if (/^\s+$/.test(p)) {
            if (currentWordRuns.length > 0) {
              wordUnits.push(mergeRuns(currentWordRuns));
              currentWordRuns = [];
            }
          } else {
            currentWordRuns.push({
              text: p,
              bold: seg.bold,
              italic: seg.italic,
              underline: seg.underline
            });
          }
        }
      }
      if (currentWordRuns.length > 0) {
        wordUnits.push(mergeRuns(currentWordRuns));
      }

      let curLineRuns = [];

      const pushLine = (runs) => {
        const merged = mergeRuns(runs);
        const w = measureRichRuns(merged, fontSize, fontFamily);
        maxLineW = Math.max(maxLineW, w);
        richLines.push(merged);
        lines.push(merged.map((r) => r.text).join(''));
      };

      for (const wordRuns of wordUnits) {
        const spaceRun = curLineRuns.length > 0
          ? [{
              text: ' ',
              bold: curLineRuns[curLineRuns.length - 1].bold,
              italic: curLineRuns[curLineRuns.length - 1].italic,
              underline: curLineRuns[curLineRuns.length - 1].underline
            }]
          : [];
        const candidateRuns = curLineRuns.concat(spaceRun, wordRuns);
        const candW = measureRichRuns(candidateRuns, fontSize, fontFamily);

        if (candW <= maxWidth || curLineRuns.length === 0) {
          if (candW > maxWidth && curLineRuns.length === 0) {
            // Single word wider than maxWidth: break character by character
            let chunkRuns = [];
            for (const wr of wordRuns) {
              for (const ch of wr.text) {
                const testRuns = chunkRuns.concat([{ text: ch, bold: wr.bold, italic: wr.italic, underline: wr.underline }]);
                if (measureRichRuns(testRuns, fontSize, fontFamily) > maxWidth && chunkRuns.length > 0) {
                  pushLine(chunkRuns);
                  chunkRuns = [{ text: ch, bold: wr.bold, italic: wr.italic, underline: wr.underline }];
                } else {
                  chunkRuns = testRuns;
                }
              }
            }
            curLineRuns = chunkRuns;
          } else {
            curLineRuns = candidateRuns;
          }
        } else {
          pushLine(curLineRuns);
          curLineRuns = wordRuns;
        }
      }

      if (curLineRuns.length > 0) {
        pushLine(curLineRuns);
      }
    }

    if (lines.length === 0) {
      lines.push('');
      richLines.push([]);
    }

    return {
      lines,
      richLines,
      width: Math.ceil(maxLineW)
    };
  }

  /**
   * Wraps multi-paragraph text into lines fitting within maxWidth, measuring accurately via 2D canvas.
   */
  function wrapText(text, fontSpec, maxWidth) {
    measureCtx.font = fontSpec;
    const raw = stripRichTags(text ?? '').replace(/\r\n/g, '\n');
    const paragraphs = raw.split('\n');
    const lines = [];
    let maxLineW = 0;

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) {
        lines.push('');
        continue;
      }
      const words = trimmed.split(/\s+/);
      let current = '';

      for (const word of words) {
        const candidate = current ? current + ' ' + word : word;
        const w = measureCtx.measureText(candidate).width;
        if (w <= maxWidth || !current) {
          if (w > maxWidth && !current) {
            // Word itself is longer than maxWidth: break by character
            let chunk = '';
            for (const ch of word) {
              if (measureCtx.measureText(chunk + ch).width > maxWidth && chunk) {
                lines.push(chunk);
                maxLineW = Math.max(maxLineW, measureCtx.measureText(chunk).width);
                chunk = ch;
              } else {
                chunk += ch;
              }
            }
            current = chunk;
          } else {
            current = candidate;
          }
        } else {
          lines.push(current);
          maxLineW = Math.max(maxLineW, measureCtx.measureText(current).width);
          current = word;
        }
      }
      if (current) {
        lines.push(current);
        maxLineW = Math.max(maxLineW, measureCtx.measureText(current).width);
      }
    }

    if (lines.length === 0) lines.push('');
    for (const l of lines) {
      maxLineW = Math.max(maxLineW, measureCtx.measureText(l).width);
    }
    return { lines, width: Math.ceil(maxLineW) };
  }

  function measureSingleLine(text, fontSpec) {
    measureCtx.font = fontSpec;
    return Math.ceil(measureCtx.measureText(String(text ?? '')).width);
  }

  let toastTimer = null;
  function showToast(msg, type = '') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.className = '';
    }, 2800);
  }

  function setBusy(busy, text = 'Preparazione…') {
    const el = document.getElementById('busy');
    const txt = document.getElementById('busy-text');
    if (!el) return;
    if (txt) txt.textContent = text;
    el.hidden = !busy;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 500);
  }

  function resizeImageFile(file, maxDim = 560, quality = 0.84) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Impossibile leggere il file immagine'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Formato immagine non valido'));
        img.onload = () => {
          let w = img.naturalWidth || img.width || 200;
          let h = img.naturalHeight || img.height || 150;
          if (w > maxDim || h > maxDim) {
            const scale = Math.min(maxDim / w, maxDim / h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = c.toDataURL('image/jpeg', quality);
          resolve({ src: dataUrl, w, h });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  window.CMUtil = {
    uid,
    clamp,
    deepClone,
    debounce,
    escapeHtml,
    escapeXml,
    sanitizeFilename,
    formatDate,
    hexToRgb,
    rgbToHex,
    mixColors,
    luminance,
    contrastText,
    darken,
    lighten,
    stripRichTags,
    richTextToHtml,
    htmlToRichText,
    wrapRichText,
    wrapText,
    measureSingleLine,
    showToast,
    setBusy,
    downloadBlob,
    resizeImageFile
  };
})();
