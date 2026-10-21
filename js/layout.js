(function () {
  'use strict';

  const { wrapText, wrapRichText, measureSingleLine } = window.CMUtil;
  const { getFontFamily, resolveNodeColors } = window.CMThemes;

  /**
   * Computes node visual dimensions, wrapped text lines, colors, and font specs.
   */
  function measureTree(root, map, options = {}) {
    const style = map.style || {};
    const fontFamily = getFontFamily(style.font);
    const forceMono = Boolean(options.forceMono);
    const expandAll = Boolean(options.expandAll);

    function visit(node, depth, branchIndex, parentItem = null) {
      const baseFontSize = node.fontSize || (depth === 0 ? 17 : depth === 1 ? 14.5 : 13.5);
      const isBold = typeof node.bold === 'boolean' ? node.bold : (depth === 0 || depth === 1);
      const isItalic = Boolean(node.italic);
      const isUnderline = Boolean(node.underline);
      const fontWeight = isBold ? '700' : '500';
      const fontStyle = isItalic ? 'italic ' : '';
      const fontSpec = `${fontStyle}${fontWeight} ${baseFontSize}px ${fontFamily}`;

      const defaultMaxTextW = depth === 0 ? 240 : depth === 1 ? 200 : 185;
      const minBoxW = depth === 0 ? 140 : depth === 1 ? 112 : 96;
      const padX = depth === 0 ? 22 : 16;
      const padY = depth === 0 ? 14 : 11;
      const lineHeight = Math.round(baseFontSize * 1.32);

      const hasCustomW = Number(node.customW) > 0;
      const hasCustomH = Number(node.customH) > 0;
      const maxTextW = hasCustomW
        ? Math.max(48, Number(node.customW) - padX * 2)
        : defaultMaxTextW;

      const wrapped = wrapRichText(
        node.text || ' ',
        {
          fontSize: baseFontSize,
          fontFamily,
          bold: isBold,
          italic: isItalic,
          underline: isUnderline
        },
        maxTextW
      );

      let imgW = 0;
      let imgH = 0;
      if (node.image && node.image.src) {
        const maxImgW = Math.min(maxTextW, 175);
        const maxImgH = 115;
        const ratio = Math.min(maxImgW / (node.image.w || 160), maxImgH / (node.image.h || 110), 1);
        imgW = Math.round((node.image.w || 160) * ratio);
        imgH = Math.round((node.image.h || 110) * ratio);
      }

      const contentW = Math.max(wrapped.width, imgW);
      const textBlockH = wrapped.lines.length * lineHeight;
      const contentH = textBlockH + (imgH > 0 ? imgH + 8 : 0);

      const autoW = Math.max(minBoxW, contentW + padX * 2);
      const autoH = Math.max(depth === 0 ? 48 : 38, contentH + padY * 2);

      const w = hasCustomW ? Math.max(72, Number(node.customW)) : autoW;
      const h = hasCustomH ? Math.max(34, Number(node.customH), contentH + 12) : autoH;

      // Measure link label pill if any
      let linkW = 0;
      let linkH = 0;
      let linkLines = [];
      const linkFontSize = 12;
      const linkFontSpec = `italic 600 ${linkFontSize}px ${fontFamily}`;
      if (depth > 0 && node.linkText && node.linkText.trim()) {
        const lw = wrapText(node.linkText.trim(), linkFontSpec, 150);
        linkLines = lw.lines;
        linkW = Math.max(36, lw.width + 16);
        linkH = lw.lines.length * 15 + 8;
      }

      const colors = resolveNodeColors(node, depth, branchIndex, style, forceMono);
      const rawShape = node.shape || (depth === 0 ? 'round' : style.shape || 'round');
      const shape = rawShape === 'line' ? 'round' : rawShape;

      const item = {
        id: node.id,
        node,
        parent: parentItem,
        depth,
        branchIndex,
        w,
        h,
        x: 0, // center X
        y: 0, // center Y
        lines: wrapped.lines,
        richLines: wrapped.richLines,
        lineHeight,
        fontSize: baseFontSize,
        fontWeight,
        fontStyle: isItalic ? 'italic' : 'normal',
        isBold,
        isItalic,
        isUnderline,
        fontFamily,
        imgW,
        imgH,
        linkText: depth > 0 ? (node.linkText || '').trim() : '',
        linkLines,
        linkW,
        linkH,
        colors,
        shape,
        side: 'down', // 'down' | 'right' | 'left'
        stackedColumn: false,
        children: [],
        hiddenCount: 0
      };

      const rawChildren = node.children || [];
      if (node.collapsed && !expandAll && rawChildren.length > 0) {
        item.hiddenCount = countDescendants(node);
      } else {
        item.children = rawChildren.map((ch, idx) => {
          const bIdx = depth === 0 ? idx : branchIndex;
          return visit(ch, depth + 1, bIdx, item);
        });
      }

      return item;
    }

    return visit(root, 0, 0, null);
  }

  function countDescendants(node) {
    let c = 0;
    for (const ch of node.children || []) {
      c += 1 + countDescendants(ch);
    }
    return c;
  }

  /**
   * Decides whether a parent node's children should be stacked vertically in a single column
   * (Algor style) rather than spread horizontally. Always active per user setting.
   */
  function shouldStackChildrenVertically(item) {
    const kids = item.children;
    if (kids.length < 2) return false;
    const allLeaves = kids.every((k) => k.children.length === 0);
    if (!allLeaves) return false;
    if (item.depth >= 1) return true;
    return false;
  }

  /**
   * Top-Down Hierarchical + Columnar Layout ('down')
   */
  function layoutTopDown(rootItem, style) {
    const hGap = Number(style.hGap) || 34;
    const vGap = Number(style.vGap) || 54;

    // 1. Bottom-up: compute subtreeWidth for each item
    function computeWidth(item) {
      item.side = 'down';
      const kids = item.children;
      if (kids.length === 0) {
        item.subtreeW = Math.max(item.w, (item.linkW || 0) + 16);
        return item.subtreeW;
      }

      if (shouldStackChildrenVertically(item)) {
        item.stackedColumn = true;
        const uniformW = Math.max(...kids.map((k) => k.w));
        const maxLinkW = Math.max(0, ...kids.map((k) => k.linkW || 0));
        for (const k of kids) {
          k.side = 'down';
          k.stackedInParent = true;
        }
        item.columnChildW = uniformW;
        // In place(), children are centered at item.x + 8, with spineX at (item.x + 8 - uniformW / 2 - 14).
        // Compute symmetric half-extent around item.x so stacked columns never overflow into neighboring subtrees!
        const leftReach = Math.max(item.w / 2, (item.linkW || 0) / 2 + 8, uniformW / 2 + 12, maxLinkW / 2 + 8);
        const rightReach = Math.max(item.w / 2, (item.linkW || 0) / 2 + 8, uniformW / 2 + 14, maxLinkW / 2 + 14);
        item.subtreeW = Math.ceil(Math.max(leftReach, rightReach) * 2);
        return item.subtreeW;
      }

      item.stackedColumn = false;
      let total = 0;
      for (let i = 0; i < kids.length; i++) {
        total += computeWidth(kids[i]);
        if (i > 0) total += hGap;
      }
      item.subtreeW = Math.max(item.w, (item.linkW || 0) + 16, total);
      return item.subtreeW;
    }

    computeWidth(rootItem);

    // 2. Top-down: assign (x, y) coordinates
    function place(item, centerX, topY) {
      item.x = centerX;
      item.y = topY + item.h / 2;

      const kids = item.children;
      if (kids.length === 0) return;

      // Extra vertical space if any child has a linking word
      const maxLinkH = Math.max(0, ...kids.map((k) => k.linkH || 0));
      const levelVGap = vGap + (maxLinkH > 0 ? Math.max(18, maxLinkH * 0.8) : 0);

      if (item.stackedColumn) {
        const uniformW = item.columnChildW || Math.max(...kids.map((k) => k.w));
        const childCenterX = item.x + 8;
        const childLeftX = childCenterX - uniformW / 2;
        const spineX = childLeftX - 14;
        item.spineX = spineX;

        let curTop = topY + item.h + Math.max(26, vGap * 0.55);
        for (const k of kids) {
          if (!k.node.customW) {
            k.w = uniformW;
          }
          if (k.linkH > 0) {
            curTop += k.linkH + 6;
          }
          k.x = childLeftX + k.w / 2;
          k.y = curTop + k.h / 2;
          curTop += k.h + 14;
        }
        return;
      }

      const nextTopY = topY + item.h + levelVGap;
      const childrenSpan = kids.reduce((acc, k) => acc + k.subtreeW, 0) + hGap * (kids.length - 1);
      let cursorLeft = centerX - childrenSpan / 2;

      for (const k of kids) {
        const childCenterX = cursorLeft + k.subtreeW / 2;
        place(k, childCenterX, nextTopY);
        cursorLeft += k.subtreeW + hGap;
      }
    }

    place(rootItem, 0, 0);
  }

  /**
   * Shifts an entire subtree horizontally by dx
   */
  function shiftSubtreeX(item, dx) {
    item.x += dx;
    if (typeof item.spineX === 'number') item.spineX += dx;
    for (const ch of item.children || []) {
      shiftSubtreeX(ch, dx);
    }
  }

  /**
   * Post-layout overlap guard for top-down layout: ensures no two boxes whose Y ranges overlap
   * can ever come closer than minGap horizontally.
   */
  function resolveTopDownCollisions(rootItem, hGap) {
    const minGap = Math.max(20, (Number(hGap) || 34) * 0.65);
    const items = [];
    function collectPreorder(it) {
      items.push(it);
      for (const ch of it.children || []) collectPreorder(ch);
    }
    collectPreorder(rootItem);

    function getAncestorPath(it) {
      const path = [];
      let cur = it;
      while (cur) {
        path.unshift(cur);
        cur = cur.parent;
      }
      return path;
    }

    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          // Check if vertical intervals overlap (including linking word badge above node)
          const aTop = a.y - a.h / 2 - (a.linkH || 0) - 6;
          const aBot = a.y + a.h / 2 + 6;
          const bTop = b.y - b.h / 2 - (b.linkH || 0) - 6;
          const bBot = b.y + b.h / 2 + 6;
          if (aBot < bTop || bBot < aTop) continue;

          // Find lowest common ancestor
          const pathA = getAncestorPath(a);
          const pathB = getAncestorPath(b);
          let lcaIdx = -1;
          const minLen = Math.min(pathA.length, pathB.length);
          for (let k = 0; k < minLen; k++) {
            if (pathA[k] === pathB[k]) lcaIdx = k;
            else break;
          }
          // Skip if one is an ancestor of the other
          if (lcaIdx === -1 || lcaIdx >= pathA.length - 1 || lcaIdx >= pathB.length - 1) continue;

          const lca = pathA[lcaIdx];
          if (lca.stackedColumn) continue;

          const branchA = pathA[lcaIdx + 1];
          const branchB = pathB[lcaIdx + 1];
          const idxA = lca.children.indexOf(branchA);
          const idxB = lca.children.indexOf(branchB);
          if (idxA === -1 || idxB === -1 || idxA === idxB) continue;

          const leftNode = idxA < idxB ? a : b;
          const rightNode = idxA < idxB ? b : a;
          const leftBranchIdx = Math.min(idxA, idxB);
          const rightBranchIdx = Math.max(idxA, idxB);

          const leftRightEdge = leftNode.x + Math.max(leftNode.w, leftNode.linkW || 0) / 2;
          const rightLeftEdge =
            rightNode.x -
            Math.max(rightNode.w, rightNode.linkW || 0) / 2 -
            (rightNode.stackedInParent ? 16 : 0);

          const overlap = leftRightEdge + minGap - rightLeftEdge;
          if (overlap > 0.5) {
            const half = overlap / 2;
            for (let c = 0; c <= leftBranchIdx; c++) {
              shiftSubtreeX(lca.children[c], -half);
            }
            for (let c = rightBranchIdx; c < lca.children.length; c++) {
              shiftSubtreeX(lca.children[c], +half);
            }
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
  }

  /**
   * Horizontal Left-to-Right Layout ('right') and Mind Map Layout ('mind')
   */
  function layoutHorizontalBranch(item, dir, hGap, vGap) {
    // dir: +1 (right) or -1 (left)
    function computeSpan(n) {
      n.side = dir > 0 ? 'right' : 'left';
      n.stackedColumn = false;
      const kids = n.children;
      if (kids.length === 0) {
        n.subtreeH = Math.max(n.h, n.linkH + 10);
        return n.subtreeH;
      }
      let total = 0;
      for (let i = 0; i < kids.length; i++) {
        total += computeSpan(kids[i]);
        if (i > 0) total += vGap * 0.55;
      }
      n.subtreeH = Math.max(n.h, total);
      return n.subtreeH;
    }

    computeSpan(item);

    function placeSub(n, edgeX, centerY) {
      n.x = edgeX + dir * (n.w / 2);
      n.y = centerY;
      const kids = n.children;
      if (kids.length === 0) return;

      const vStep = vGap * 0.55;
      const maxChildLinkW = Math.max(0, ...kids.map((k) => k.linkW || 0));
      const stepX = hGap + 42 + (maxChildLinkW > 0 ? Math.min(110, maxChildLinkW * 0.85) : 0);
      const nextEdgeX = edgeX + dir * (n.w + stepX);

      const totalH = kids.reduce((s, k) => s + k.subtreeH, 0) + vStep * (kids.length - 1);
      let curY = centerY - totalH / 2;
      for (const k of kids) {
        const cy = curY + k.subtreeH / 2;
        placeSub(k, nextEdgeX, cy);
        curY += k.subtreeH + vStep;
      }
    }

    return { placeSub };
  }

  function layoutRight(rootItem, style) {
    const hGap = Number(style.hGap) || 36;
    const vGap = Number(style.vGap) || 50;
    const helper = layoutHorizontalBranch(rootItem, +1, hGap, vGap);
    helper.placeSub(rootItem, -rootItem.w / 2, 0);
  }

  function layoutMind(rootItem, style) {
    const hGap = Number(style.hGap) || 36;
    const vGap = Number(style.vGap) || 50;
    rootItem.x = 0;
    rootItem.y = 0;
    rootItem.side = 'mind';

    const kids = rootItem.children;
    if (kids.length === 0) return;

    const rightKids = [];
    const leftKids = [];
    kids.forEach((k, idx) => {
      if (idx % 2 === 0) rightKids.push(k);
      else leftKids.push(k);
    });

    const vStep = vGap * 0.65;

    function placeSide(list, dir) {
      if (list.length === 0) return;
      const helpers = list.map((k) => layoutHorizontalBranch(k, dir, hGap, vGap));
      const totalH = list.reduce((s, k) => s + k.subtreeH, 0) + vStep * (list.length - 1);
      let curY = -totalH / 2;
      for (let i = 0; i < list.length; i++) {
        const k = list[i];
        const linkExtra = k.linkW ? Math.min(95, k.linkW * 0.8) : 0;
        const startEdgeX = dir * (rootItem.w / 2 + hGap + 38 + linkExtra);
        const cy = curY + k.subtreeH / 2;
        helpers[i].placeSub(k, startEdgeX, cy);
        curY += k.subtreeH + vStep;
      }
    }

    placeSide(rightKids, +1);
    placeSide(leftKids, -1);
  }

  /**
   * Builds adaptive edge between parent and child when in free-move mode or when nodes were manually positioned.
   */
  function buildAdaptiveEdge(parent, child, lineType) {
    const dx = child.x - parent.x;
    const dy = child.y - parent.y;

    const gapDown = (child.y - child.h / 2) - (parent.y + parent.h / 2);
    const gapUp = (parent.y - parent.h / 2) - (child.y + child.h / 2);
    const gapRight = (child.x - child.w / 2) - (parent.x + parent.w / 2);
    const gapLeft = (parent.x - parent.w / 2) - (child.x + child.w / 2);

    // Choose primary orientation based on clearest separation or dominant delta
    let mode = 'down';
    if (gapDown >= 12 && (gapDown >= Math.max(gapRight, gapLeft) * 0.55 || Math.abs(dy) >= Math.abs(dx) * 0.75)) {
      mode = 'down';
    } else if (gapUp >= 12 && (gapUp >= Math.max(gapRight, gapLeft) * 0.55 || Math.abs(dy) >= Math.abs(dx) * 0.75)) {
      mode = 'up';
    } else if (dx >= 0 && gapRight >= 8) {
      mode = 'right';
    } else if (dx < 0 && gapLeft >= 8) {
      mode = 'left';
    } else if (Math.abs(dy) >= Math.abs(dx)) {
      mode = dy >= 0 ? 'down' : 'up';
    } else {
      mode = dx >= 0 ? 'right' : 'left';
    }

    if (mode === 'down' || mode === 'up') {
      const signY = mode === 'down' ? 1 : -1;
      const x1 = parent.x;
      const y1 = parent.y + signY * (parent.h / 2);
      const x2 = child.x;
      const y2 = child.y - signY * (child.h / 2);
      const arrowDir = mode === 'down' ? 'down' : 'up';
      let d = '';
      let labelX = (x1 + x2) / 2;
      let labelY = (y1 + y2) / 2;

      if (lineType === 'straight' || signY * (y2 - y1) < 10) {
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
      } else if (lineType === 'curve') {
        const midY = y1 + (y2 - y1) * 0.5;
        d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
      } else {
        const midY = y1 + (y2 - y1) * 0.42;
        const r = Math.min(8, Math.abs(x2 - x1) / 2, Math.abs(y2 - midY) / 2, Math.abs(midY - y1) / 2);
        if (Math.abs(x2 - x1) < 1.5) {
          d = `M ${x1} ${y1} L ${x2} ${y2}`;
        } else {
          const sx = x2 > x1 ? 1 : -1;
          d = [
            `M ${x1} ${y1}`,
            `L ${x1} ${midY - signY * r}`,
            `Q ${x1} ${midY} ${x1 + sx * r} ${midY}`,
            `L ${x2 - sx * r} ${midY}`,
            `Q ${x2} ${midY} ${x2} ${midY + signY * r}`,
            `L ${x2} ${y2}`
          ].join(' ');
        }
        labelX = x2;
        labelY = midY + (y2 - midY) * 0.5;
      }

      return {
        id: `e_${parent.id}_${child.id}`,
        parent,
        child,
        path: d,
        color: child.colors.edgeColor,
        arrowDir,
        arrowX: x2,
        arrowY: y2,
        labelX,
        labelY
      };
    } else {
      const dir = mode === 'right' ? 1 : -1;
      const x1 = parent.x + dir * (parent.w / 2);
      const y1 = parent.y;
      const x2 = child.x - dir * (child.w / 2);
      const y2 = child.y;
      const arrowDir = mode === 'right' ? 'right' : 'left';
      let d = '';
      let labelX = (x1 + x2) / 2;
      let labelY = (y1 + y2) / 2;

      if (lineType === 'straight' || dir * (x2 - x1) < 10) {
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
      } else if (lineType === 'curve') {
        const midX = x1 + (x2 - x1) * 0.5;
        d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
      } else {
        const busX = x1 + (x2 - x1) * 0.38;
        const r = Math.min(8, Math.abs(y2 - y1) / 2, Math.abs(x2 - busX) / 2, Math.abs(busX - x1) / 2);
        if (Math.abs(y2 - y1) < 1.5) {
          d = `M ${x1} ${y1} L ${x2} ${y2}`;
        } else {
          const sy = y2 > y1 ? 1 : -1;
          d = [
            `M ${x1} ${y1}`,
            `L ${busX - dir * r} ${y1}`,
            `Q ${busX} ${y1} ${busX} ${y1 + sy * r}`,
            `L ${busX} ${y2 - sy * r}`,
            `Q ${busX} ${y2} ${busX + dir * r} ${y2}`,
            `L ${x2} ${y2}`
          ].join(' ');
        }
        labelX = busX + (x2 - busX) * 0.5;
        labelY = y2;
      }

      return {
        id: `e_${parent.id}_${child.id}`,
        parent,
        child,
        path: d,
        color: child.colors.edgeColor,
        arrowDir,
        arrowX: x2,
        arrowY: y2,
        labelX,
        labelY
      };
    }
  }

  /**
   * Builds SVG path and linking-word badge position for every parent->child edge
   */
  function buildEdges(rootItem, style) {
    const edges = [];
    const lineType = style.lineType || 'ortho';
    const isFreeMode = Boolean(style.freeMode);

    function visit(parent) {
      const kids = parent.children;
      if (kids.length === 0) return;

      const anyManual =
        isFreeMode ||
        parent.hasManualPos ||
        kids.some((k) => k.hasManualPos);

      if (parent.stackedColumn && !anyManual) {
        // Vertical spine on left side feeding stacked children
        const spineX = parent.spineX;
        const startY = parent.y + parent.h / 2;
        const parentLeft = parent.x - parent.w / 2 + 10;
        const parentRight = parent.x + parent.w / 2 - 10;
        const startX = Math.max(parentLeft, Math.min(parentRight, spineX));

        for (const child of kids) {
          const childLeft = child.x - child.w / 2;
          const endY = child.y;
          const r = 7;
          let d = '';
          if (Math.abs(startX - spineX) < 1.5) {
            d = `M ${spineX} ${startY} L ${spineX} ${endY - r} Q ${spineX} ${endY} ${spineX + r} ${endY} L ${childLeft} ${endY}`;
          } else {
            const dropY = startY + 10;
            const sx = spineX < startX ? -1 : 1;
            const r1 = Math.min(6, Math.abs(startX - spineX) / 2);
            d = [
              `M ${startX} ${startY}`,
              `L ${startX} ${dropY - r1}`,
              `Q ${startX} ${dropY} ${startX + sx * r1} ${dropY}`,
              `L ${spineX - sx * r1} ${dropY}`,
              `Q ${spineX} ${dropY} ${spineX} ${dropY + r1}`,
              `L ${spineX} ${endY - r}`,
              `Q ${spineX} ${endY} ${spineX + r} ${endY}`,
              `L ${childLeft} ${endY}`
            ].join(' ');
          }
          const labelX = child.x;
          const labelY = child.y - child.h / 2 - (child.linkH / 2) - 3;
          edges.push({
            id: `e_${parent.id}_${child.id}`,
            parent,
            child,
            path: d,
            color: child.colors.edgeColor,
            arrowDir: 'right',
            arrowX: childLeft,
            arrowY: endY,
            labelX,
            labelY
          });
          visit(child);
        }
        return;
      }

      for (const child of kids) {
        if (isFreeMode || parent.hasManualPos || child.hasManualPos) {
          edges.push(buildAdaptiveEdge(parent, child, lineType));
          visit(child);
          continue;
        }

        let d = '';
        let labelX = 0;
        let labelY = 0;
        let arrowDir = 'down';
        let arrowX = child.x;
        let arrowY = child.y - child.h / 2;

        if (child.side === 'down') {
          const x1 = parent.x;
          const y1 = parent.y + parent.h / 2;
          const x2 = child.x;
          const y2 = child.y - child.h / 2;
          arrowDir = 'down';
          arrowX = x2;
          arrowY = y2;

          if (lineType === 'straight') {
            d = `M ${x1} ${y1} L ${x2} ${y2}`;
            labelX = (x1 + x2) / 2;
            labelY = (y1 + y2) / 2;
          } else if (lineType === 'curve') {
            const midY = y1 + (y2 - y1) * 0.5;
            d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
            labelX = (x1 + x2) / 2;
            labelY = y1 + (y2 - y1) * 0.52;
          } else {
            // Orthogonal bus line (Algor style)
            const busY = y1 + Math.min(24, (y2 - y1) * 0.36);
            const r = Math.min(8, Math.abs(x2 - x1) / 2, (y2 - busY) / 2);
            if (Math.abs(x2 - x1) < 1.5) {
              d = `M ${x1} ${y1} L ${x2} ${y2}`;
            } else {
              const sx = x2 > x1 ? 1 : -1;
              d = [
                `M ${x1} ${y1}`,
                `L ${x1} ${busY - r}`,
                `Q ${x1} ${busY} ${x1 + sx * r} ${busY}`,
                `L ${x2 - sx * r} ${busY}`,
                `Q ${x2} ${busY} ${x2} ${busY + r}`,
                `L ${x2} ${y2}`
              ].join(' ');
            }
            labelX = x2;
            labelY = busY + (y2 - busY) * 0.48;
          }
        } else {
          // Horizontal ('right' or 'left')
          const dir = child.side === 'right' ? 1 : -1;
          const x1 = parent.x + dir * (parent.w / 2);
          const y1 = parent.y;
          const x2 = child.x - dir * (child.w / 2);
          const y2 = child.y;
          arrowDir = dir > 0 ? 'right' : 'left';
          arrowX = x2;
          arrowY = y2;

          if (lineType === 'straight') {
            d = `M ${x1} ${y1} L ${x2} ${y2}`;
            labelX = (x1 + x2) / 2;
            labelY = (y1 + y2) / 2;
          } else if (lineType === 'curve') {
            const midX = x1 + (x2 - x1) * 0.5;
            d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
            labelX = (x1 + x2) / 2;
            labelY = (y1 + y2) / 2;
          } else {
            const busX = x1 + dir * 24;
            const r = Math.min(8, Math.abs(y2 - y1) / 2, Math.abs(x2 - busX) / 2);
            if (Math.abs(y2 - y1) < 1.5) {
              d = `M ${x1} ${y1} L ${x2} ${y2}`;
            } else {
              const sy = y2 > y1 ? 1 : -1;
              d = [
                `M ${x1} ${y1}`,
                `L ${busX - dir * r} ${y1}`,
                `Q ${busX} ${y1} ${busX} ${y1 + sy * r}`,
                `L ${busX} ${y2 - sy * r}`,
                `Q ${busX} ${y2} ${busX + dir * r} ${y2}`,
                `L ${x2} ${y2}`
              ].join(' ');
            }
            labelX = busX + (x2 - busX) * 0.5;
            labelY = y2;
          }
        }

        edges.push({
          id: `e_${parent.id}_${child.id}`,
          parent,
          child,
          path: d,
          color: child.colors.edgeColor,
          arrowDir,
          arrowX,
          arrowY,
          labelX,
          labelY
        });

        visit(child);
      }
    }

    visit(rootItem);
    return edges;
  }

  /**
   * Computes curved dashed cross-links between arbitrary nodes
   */
  function buildCrossLinks(links, itemById, mapStyle) {
    const fontFamily = getFontFamily(mapStyle?.font);
    const fontSpec = `italic 600 12px ${fontFamily}`;
    const out = [];

    for (const lk of links || []) {
      const a = itemById.get(lk.from);
      const b = itemById.get(lk.to);
      if (!a || !b) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;

      // Find border intersection points on node A and node B rectangles
      const p1 = rectRayIntersection(a.x, a.y, a.w / 2 + 2, a.h / 2 + 2, dx, dy);
      const p2 = rectRayIntersection(b.x, b.y, b.w / 2 + 4, b.h / 2 + 4, -dx, -dy);

      // Slight perpendicular arc offset
      const nx = -dy / dist;
      const ny = dx / dist;
      const arc = Math.min(55, dist * 0.16);
      const cx = (p1.x + p2.x) / 2 + nx * arc;
      const cy = (p1.y + p2.y) / 2 + ny * arc;

      const labelX = 0.25 * p1.x + 0.5 * cx + 0.25 * p2.x;
      const labelY = 0.25 * p1.y + 0.5 * cy + 0.25 * p2.y;

      const text = (lk.text || '').trim();
      const w = text ? Math.max(40, measureSingleLine(text, fontSpec) + 16) : 0;
      const h = text ? 22 : 0;

      // Tangent angle at p2 for arrow
      const tx = p2.x - cx;
      const ty = p2.y - cy;
      const angleDeg = (Math.atan2(ty, tx) * 180) / Math.PI;

      out.push({
        id: lk.id,
        link: lk,
        fromItem: a,
        toItem: b,
        path: `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`,
        p2,
        angleDeg,
        labelX,
        labelY,
        labelW: w,
        labelH: h,
        text
      });
    }

    return out;
  }

  function rectRayIntersection(cx, cy, hw, hh, dx, dy) {
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
    const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);
    return { x: cx + dx * t, y: cy + dy * t };
  }

  /**
   * Main entry point: computes the complete layout for a map
   */
  function computeLayout(map, options = {}) {
    const style = map.style || {};
    const rootItem = measureTree(map.root, map, options);

    if (map.layout === 'right') {
      layoutRight(rootItem, style);
    } else if (map.layout === 'mind') {
      layoutMind(rootItem, style);
    } else {
      layoutTopDown(rootItem, style);
      if (!style.freeMode) {
        resolveTopDownCollisions(rootItem, style.hGap);
      }
    }

    const items = [];
    const itemById = new Map();
    function collect(it) {
      if (style.freeMode && typeof it.node.manualX === 'number' && typeof it.node.manualY === 'number') {
        it.x = it.node.manualX;
        it.y = it.node.manualY;
        it.hasManualPos = true;
      }
      items.push(it);
      itemById.set(it.id, it);
      for (const ch of it.children) collect(ch);
    }
    collect(rootItem);

    const edges = buildEdges(rootItem, style);
    const crossLinks = buildCrossLinks(map.links || [], itemById, style);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const it of items) {
      minX = Math.min(minX, it.x - it.w / 2);
      maxX = Math.max(maxX, it.x + it.w / 2);
      minY = Math.min(minY, it.y - it.h / 2);
      maxY = Math.max(maxY, it.y + it.h / 2 + (it.hiddenCount > 0 ? 18 : 0));
    }

    for (const e of edges) {
      if (e.child.linkW > 0) {
        minX = Math.min(minX, e.labelX - e.child.linkW / 2);
        maxX = Math.max(maxX, e.labelX + e.child.linkW / 2);
        minY = Math.min(minY, e.labelY - e.child.linkH / 2);
        maxY = Math.max(maxY, e.labelY + e.child.linkH / 2);
      }
    }

    for (const cl of crossLinks) {
      minX = Math.min(minX, cl.labelX - cl.labelW / 2);
      maxX = Math.max(maxX, cl.labelX + cl.labelW / 2);
      minY = Math.min(minY, cl.labelY - cl.labelH / 2);
      maxY = Math.max(maxY, cl.labelY + cl.labelH / 2);
    }

    if (!isFinite(minX)) {
      minX = -100;
      maxX = 100;
      minY = -50;
      maxY = 50;
    }

    const pad = 28;
    const bbox = {
      minX: minX - pad,
      minY: minY - pad,
      maxX: maxX + pad,
      maxY: maxY + pad,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2
    };

    return {
      rootItem,
      items,
      itemById,
      edges,
      crossLinks,
      bbox
    };
  }

  window.CMLayout = {
    computeLayout
  };
})();
