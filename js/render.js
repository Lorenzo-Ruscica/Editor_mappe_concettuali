(function () {
  'use strict';

  const { escapeXml } = window.CMUtil;
  const { getTheme, getFontFamily } = window.CMThemes;

  function arrowPolygon(x, y, dir, color) {
    // Small crisp triangle pointing toward (x,y)
    let pts = '';
    if (dir === 'down') {
      pts = `${x},${y} ${x - 5},${y - 8.5} ${x + 5},${y - 8.5}`;
    } else if (dir === 'right') {
      pts = `${x},${y} ${x - 8.5},${y - 5} ${x - 8.5},${y + 5}`;
    } else if (dir === 'left') {
      pts = `${x},${y} ${x + 8.5},${y - 5} ${x + 8.5},${y + 5}`;
    } else {
      pts = `${x},${y} ${x - 5},${y + 8.5} ${x + 5},${y + 8.5}`;
    }
    return `<polygon points="${pts}" fill="${color}"/>`;
  }

  function renderNodeShape(it, isSelected, dropMode) {
    const x = it.x - it.w / 2;
    const y = it.y - it.h / 2;
    const { fill, stroke, strokeWidth } = it.colors;
    const shape = it.shape || 'round';

    let selRing = '';
    if (isSelected) {
      const rx = shape === 'pill' ? it.h / 2 + 4 : shape === 'rect' ? 6 : 14;
      selRing = `<rect x="${x - 4}" y="${y - 4}" width="${it.w + 8}" height="${it.h + 8}" rx="${rx}" fill="none" stroke="#2563eb" stroke-width="2.4" stroke-dasharray="${dropMode ? '4 3' : 'none'}" opacity="0.9"/>`;
    }

    if (dropMode) {
      if (dropMode === 'inside') {
        selRing += `<rect x="${x - 5}" y="${y - 5}" width="${it.w + 10}" height="${it.h + 10}" rx="14" fill="rgba(37,99,235,0.12)" stroke="#2563eb" stroke-width="2.5"/>`;
      } else if (dropMode === 'before') {
        const lx = it.side === 'down' ? x - 6 : x;
        const ly1 = it.side === 'down' ? y : y - 6;
        const lx2 = it.side === 'down' ? x - 6 : x + it.w;
        const ly2 = it.side === 'down' ? y + it.h : y - 6;
        selRing += `<line x1="${lx}" y1="${ly1}" x2="${lx2}" y2="${ly2}" stroke="#2563eb" stroke-width="4" stroke-linecap="round"/>`;
      } else if (dropMode === 'after') {
        const lx = it.side === 'down' ? x + it.w + 6 : x;
        const ly1 = it.side === 'down' ? y : y + it.h + 6;
        const lx2 = it.side === 'down' ? x + it.w + 6 : x + it.w;
        const ly2 = it.side === 'down' ? y + it.h : y + it.h + 6;
        selRing += `<line x1="${lx}" y1="${ly1}" x2="${lx2}" y2="${ly2}" stroke="#2563eb" stroke-width="4" stroke-linecap="round"/>`;
      }
    }

    const rx = shape === 'pill' ? it.h / 2 : shape === 'rect' ? 3 : 11;
    const shadow = `<rect x="${x}" y="${y + 2}" width="${it.w}" height="${it.h}" rx="${rx}" fill="rgba(15,23,42,0.06)" stroke="none"/>`;
    const box = `<rect x="${x}" y="${y}" width="${it.w}" height="${it.h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    return shadow + box + selRing;
  }

  function renderRichLineMarkup(it, lineIndex, yPos) {
    const runs = it.richLines && it.richLines[lineIndex];
    if (!runs || runs.length === 0) {
      const plain = it.lines[lineIndex] || '';
      if (!plain) return '';
      return `<text x="${it.x}" y="${yPos}" text-anchor="middle" fill="${it.colors.text}" font-family="${escapeXml(it.fontFamily)}" font-size="${it.fontSize}" font-weight="${it.fontWeight}" font-style="${it.fontStyle}"${it.isUnderline ? ' text-decoration="underline"' : ''}>${escapeXml(plain)}</text>`;
    }

    const tspans = runs
      .map((r) => {
        const fw = r.bold ? '700' : '500';
        const fs = r.italic ? 'italic' : 'normal';
        const td = r.underline ? ' text-decoration="underline"' : '';
        return `<tspan font-weight="${fw}" font-style="${fs}"${td}>${escapeXml(r.text)}</tspan>`;
      })
      .join('');

    return `<text x="${it.x}" y="${yPos}" text-anchor="middle" fill="${it.colors.text}" font-family="${escapeXml(it.fontFamily)}" font-size="${it.fontSize}">${tspans}</text>`;
  }

  function renderSceneGroupMarkup(layout, map, state = {}) {
    const style = map.style || {};
    const theme = getTheme(style.theme, state.forceMono);
    const fontFamily = getFontFamily(style.font);
    const interactive = Boolean(state.interactive);
    const selectedId = state.selectedId || null;
    const selectedLinkId = state.selectedLinkId || null;
    const editingKey = state.editingKey || null; // e.g. 'node:id' or 'edge:id' or 'xlink:id'
    const dropTarget = state.dropTarget || null; // { id, mode }

    const parts = [];

    // 1. Hierarchical edges (lines)
    for (const e of layout.edges) {
      const strokeW = e.parent.depth === 0 ? 2.3 : 1.9;
      parts.push(`<g class="edge" data-child-id="${e.child.id}">`);
      parts.push(
        `<path d="${e.path}" fill="none" stroke="${e.color}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"/>`
      );
      if (style.arrows) {
        parts.push(arrowPolygon(e.arrowX, e.arrowY, e.arrowDir, e.color));
      }
      if (interactive) {
        parts.push(
          `<path class="edge-hit" data-edge-child="${e.child.id}" d="${e.path}" fill="none" stroke="transparent" stroke-width="14"/>`
        );
      }
      parts.push(`</g>`);
    }

    // 2. Cross-links
    for (const cl of layout.crossLinks) {
      const isSel = selectedLinkId === cl.id;
      const col = state.forceMono ? '#374151' : isSel ? '#2563eb' : '#7c3aed';
      parts.push(`<g class="xlink-group" data-xlink-id="${cl.id}">`);
      parts.push(
        `<path d="${cl.path}" fill="none" stroke="${col}" stroke-width="${isSel ? 2.5 : 1.8}" stroke-dasharray="6 4" stroke-linecap="round"/>`
      );
      parts.push(
        `<g transform="translate(${cl.p2.x},${cl.p2.y}) rotate(${cl.angleDeg})"><polygon points="0,0 -8.5,-4.5 -8.5,4.5" fill="${col}"/></g>`
      );
      if (interactive) {
        parts.push(
          `<path class="xlink-hit" data-xlink-id="${cl.id}" d="${cl.path}" fill="none" stroke="transparent" stroke-width="14"/>`
        );
      }
      if (cl.text && editingKey !== `xlink:${cl.id}`) {
        const bx = cl.labelX - cl.labelW / 2;
        const by = cl.labelY - cl.labelH / 2;
        parts.push(
          `<g class="xlink-hit" data-xlink-id="${cl.id}">` +
            `<rect x="${bx}" y="${by}" width="${cl.labelW}" height="${cl.labelH}" rx="10" fill="#ffffff" stroke="${col}" stroke-width="1.3"/>` +
            `<text x="${cl.labelX}" y="${cl.labelY + 4}" text-anchor="middle" fill="${col}" font-family="${escapeXml(fontFamily)}" font-size="12" font-style="italic" font-weight="600">${escapeXml(cl.text)}</text>` +
          `</g>`
        );
      }
      parts.push(`</g>`);
    }

    // 3. Edge linking-word labels (drawn above lines so lines never cross through text)
    for (const e of layout.edges) {
      const ch = e.child;
      if (ch.linkW > 0 && editingKey !== `edge:${ch.id}`) {
        const bx = e.labelX - ch.linkW / 2;
        const by = e.labelY - ch.linkH / 2;
        parts.push(`<g class="edge-label" data-edge-child="${ch.id}">`);
        parts.push(
          `<rect x="${bx}" y="${by}" width="${ch.linkW}" height="${ch.linkH}" rx="8" fill="${theme.labelBg}" stroke="${theme.labelBorder}" stroke-width="1.1"/>`
        );
        const startY = e.labelY - ((ch.linkLines.length - 1) * 15) / 2 + 4;
        ch.linkLines.forEach((ln, idx) => {
          parts.push(
            `<text x="${e.labelX}" y="${startY + idx * 15}" text-anchor="middle" fill="${theme.labelText}" font-family="${escapeXml(fontFamily)}" font-size="12" font-style="italic" font-weight="600">${escapeXml(ln)}</text>`
          );
        });
        parts.push(`</g>`);
      } else if (interactive && selectedId === ch.id && !ch.linkText && editingKey !== `edge:${ch.id}`) {
        // Subtle prompt badge on the active node's incoming edge so user sees they can click to add a linking word
        const hintW = 92;
        const hintH = 20;
        parts.push(
          `<g class="edge-label" data-edge-child="${ch.id}" opacity="0.88">` +
            `<rect x="${e.labelX - hintW / 2}" y="${e.labelY - hintH / 2}" width="${hintW}" height="${hintH}" rx="9" fill="#ffffff" stroke="#93c5fd" stroke-dasharray="3 2" stroke-width="1.2"/>` +
            `<text x="${e.labelX}" y="${e.labelY + 3.8}" text-anchor="middle" fill="#2563eb" font-family="${escapeXml(fontFamily)}" font-size="11" font-style="italic">+ parola legame</text>` +
          `</g>`
        );
      }
    }

    // 4. Concept nodes
    const uiOverlayParts = [];

    for (const it of layout.items) {
      const isSelected = interactive && selectedId === it.id;
      const dropMode = dropTarget && dropTarget.id === it.id ? dropTarget.mode : null;
      parts.push(
        `<g class="node${isSelected ? ' selected' : ''}" data-node-id="${it.id}">`
      );
      parts.push(renderNodeShape(it, isSelected, dropMode));

      let textCenterY = it.y;
      if (it.imgH > 0 && it.node.image?.src) {
        const topY = it.y - it.h / 2 + (it.depth === 0 ? 12 : 10);
        const imgX = it.x - it.imgW / 2;
        parts.push(
          `<image href="${it.node.image.src}" x="${imgX}" y="${topY}" width="${it.imgW}" height="${it.imgH}" preserveAspectRatio="xMidYMid meet"/>`
        );
        const textAreaTop = topY + it.imgH + 6;
        const textAreaBottom = it.y + it.h / 2 - (it.depth === 0 ? 10 : 8);
        textCenterY = (textAreaTop + textAreaBottom) / 2;
      }

      if (editingKey !== `node:${it.id}`) {
        const totalTextH = (it.lines.length - 1) * it.lineHeight;
        const firstLineY = textCenterY - totalTextH / 2 + it.fontSize * 0.35;
        for (let i = 0; i < it.lines.length; i++) {
          const lineSvg = renderRichLineMarkup(it, i, firstLineY + i * it.lineHeight);
          if (lineSvg) parts.push(lineSvg);
        }
      }

      parts.push(`</g>`);

      // Build UI buttons and resize handles in top overlay so they are never covered by lines or neighboring boxes
      const hasRawChildren = (it.node.children || []).length > 0;
      const showQuickActions = isSelected && !editingKey;
      const outDist = style.freeMode && showQuickActions ? 19 : 13;

      if (hasRawChildren && (interactive || it.hiddenCount > 0)) {
        // When both (-) and (+) are visible on the selected node, place them side-by-side along the border
        // so they never overlap each other or the outgoing connection line!
        const pairOffset = showQuickActions ? 16 : 0;
        let bx = it.x - pairOffset;
        let by = it.y + it.h / 2 + outDist;
        if (it.side === 'right' || it.side === 'mind') {
          bx = it.x + it.w / 2 + outDist;
          by = it.y - pairOffset;
        } else if (it.side === 'left') {
          bx = it.x - it.w / 2 - outDist;
          by = it.y - pairOffset;
        }

        if (it.hiddenCount > 0) {
          const bw = Math.max(24, String(it.hiddenCount).length * 7 + 14);
          uiOverlayParts.push(
            `<g class="ui-btn" data-action="toggle-collapse" data-node-id="${it.id}">` +
              `<title>Espandi (${it.hiddenCount} nascosti)</title>` +
              `<rect x="${bx - bw / 2}" y="${by - 9}" width="${bw}" height="18" rx="9" fill="${it.colors.branchColor}" stroke="#ffffff" stroke-width="1.5"/>` +
              `<text x="${bx}" y="${by + 3.8}" text-anchor="middle" fill="#ffffff" font-family="${escapeXml(fontFamily)}" font-size="11" font-weight="700">+${it.hiddenCount}</text>` +
            `</g>`
          );
        } else if (interactive) {
          uiOverlayParts.push(
            `<g class="ui-btn ui-collapse${isSelected ? ' is-selected' : ''}" data-action="toggle-collapse" data-node-id="${it.id}">` +
              `<title>Comprimi sotto-concetti</title>` +
              `<circle cx="${bx}" cy="${by}" r="8.5" fill="#ffffff" stroke="${it.colors.stroke}" stroke-width="1.6"/>` +
              `<line x1="${bx - 3.8}" y1="${by}" x2="${bx + 3.8}" y2="${by}" stroke="#334155" stroke-width="1.8" stroke-linecap="round"/>` +
            `</g>`
          );
        }
      }

      if (showQuickActions) {
        // Add Child (+) button: offset to the opposite side of (-) when hasRawChildren
        const childOffset = hasRawChildren ? 16 : 0;
        let cx = it.x + childOffset;
        let cy = it.y + it.h / 2 + outDist;
        if (it.side === 'right' || it.side === 'mind') {
          cx = it.x + it.w / 2 + outDist;
          cy = it.y + childOffset;
        } else if (it.side === 'left') {
          cx = it.x - it.w / 2 - outDist;
          cy = it.y + childOffset;
        }
        uiOverlayParts.push(
          `<g class="ui-btn" data-action="quick-child" data-node-id="${it.id}">` +
            `<title>Aggiungi concetto figlio (Tab)</title>` +
            `<circle cx="${cx}" cy="${cy}" r="9.5" fill="#2563eb" stroke="#ffffff" stroke-width="2"/>` +
            `<path d="M${cx - 4} ${cy}h8M${cx} ${cy - 4}v8" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>` +
          `</g>`
        );

        // Add Sibling button (for non-root nodes)
        if (it.depth > 0) {
          const sibDist = style.freeMode ? 19 : 14;
          let sx = it.x + it.w / 2 + sibDist;
          let sy = it.y;
          if (it.side !== 'down') {
            sx = it.x;
            sy = it.y + it.h / 2 + sibDist;
          }
          uiOverlayParts.push(
            `<g class="ui-btn" data-action="quick-sibling" data-node-id="${it.id}">` +
              `<title>Aggiungi concetto fratello (Invio)</title>` +
              `<circle cx="${sx}" cy="${sy}" r="9" fill="#ffffff" stroke="#2563eb" stroke-width="1.8"/>` +
              `<path d="M${sx - 3.6} ${sy}h7.2M${sx} ${sy - 3.6}v7.2" stroke="#2563eb" stroke-width="1.8" stroke-linecap="round"/>` +
            `</g>`
          );
        }

        // 8 Resize Handles when freeMode is active
        if (style.freeMode) {
          const x0 = it.x - it.w / 2 - 4;
          const x1 = it.x;
          const x2 = it.x + it.w / 2 + 4;
          const y0 = it.y - it.h / 2 - 4;
          const y1 = it.y;
          const y2 = it.y + it.h / 2 + 4;
          const handles = [
            { dir: 'nw', x: x0, y: y0 },
            { dir: 'n',  x: x1, y: y0 },
            { dir: 'ne', x: x2, y: y0 },
            { dir: 'e',  x: x2, y: y1 },
            { dir: 'se', x: x2, y: y2 },
            { dir: 's',  x: x1, y: y2 },
            { dir: 'sw', x: x0, y: y2 },
            { dir: 'w',  x: x0, y: y1 }
          ];
          for (const hd of handles) {
            uiOverlayParts.push(
              `<rect class="resize-handle" data-resize-dir="${hd.dir}" data-node-id="${it.id}" x="${hd.x - 4.5}" y="${hd.y - 4.5}" width="9" height="9" rx="2"/>`
            );
          }
        }
      }
    }

    if (uiOverlayParts.length > 0) {
      parts.push(`<g class="ui-overlay">${uiOverlayParts.join('')}</g>`);
    }

    // 5. Temporary linking line when user is in "Collega" mode
    if (interactive && state.linkingFrom && state.pointerWorld) {
      const src = layout.itemById.get(state.linkingFrom);
      if (src) {
        parts.push(
          `<line x1="${src.x}" y1="${src.y}" x2="${state.pointerWorld.x}" y2="${state.pointerWorld.y}" stroke="#7c3aed" stroke-width="2.2" stroke-dasharray="5 4" pointer-events="none"/>`
        );
      }
    }

    return parts.join('');
  }

  /**
   * Builds a standalone SVG string for export (PDF, Print, PNG, SVG) or mini preview
   */
  function buildStandaloneSvg(map, options = {}) {
    const layout = window.CMLayout.computeLayout(map, {
      forceMono: Boolean(options.forceMono),
      expandAll: Boolean(options.expandAll)
    });

    const theme = getTheme(map.style?.theme, Boolean(options.forceMono));
    const fontFamily = getFontFamily(map.style?.font);
    const includeTitle = Boolean(options.includeTitle && map.title);
    const titleH = includeTitle ? 48 : 0;

    const minX = Math.floor(layout.bbox.minX);
    const minY = Math.floor(layout.bbox.minY - titleH);
    const width = Math.ceil(layout.bbox.width);
    const height = Math.ceil(layout.bbox.height + titleH);

    const bgRect = options.transparentBg
      ? ''
      : `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${options.forceMono ? '#ffffff' : theme.bg}"/>`;

    let titleMarkup = '';
    if (includeTitle) {
      const tx = minX + width / 2;
      const ty = layout.bbox.minY - 16;
      titleMarkup = `<text x="${tx}" y="${ty}" text-anchor="middle" fill="${options.forceMono ? '#111827' : '#0f172a'}" font-family="${escapeXml(fontFamily)}" font-size="22" font-weight="800">${escapeXml(map.title)}</text>`;
    }

    const scene = renderSceneGroupMarkup(layout, map, {
      interactive: false,
      forceMono: Boolean(options.forceMono)
    });

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">${bgRect}${titleMarkup}${scene}</svg>`;

    return {
      svg,
      width,
      height,
      minX,
      minY,
      layout
    };
  }

  window.CMRender = {
    renderSceneGroupMarkup,
    buildStandaloneSvg
  };
})();
