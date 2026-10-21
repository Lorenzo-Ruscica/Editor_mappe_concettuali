(function () {
  'use strict';

  const { uid, stripRichTags } = window.CMUtil;

  const SAMPLE_OUTLINES = [
    `La Fotosintesi Clorofilliana
  [avviene nelle] Piante verdi
    [in particolare nelle] Foglie
      [dentro i] Cloroplasti
        [che contengono] Clorofilla
  [utilizza] Reagenti
    - Acqua e sali minerali
      [assorbiti dalle] Radici
    - Anidride carbonica (CO2)
      [entra dagli] Stomi
    - Luce solare
      [fornisce] Energia
  [produce] Prodotti
    [nutrimento] Glucosio (zucchero)
    [gas vitale] Ossigeno (O2)
      [liberato nell'] Atmosfera`,
    `La Rivoluzione Francese (1789)
  [causata da] Crisi della Francia
    [sociale] Società divisa in tre stati
      - Clero (privilegiati)
      - Nobiltà (privilegiati)
      - Terzo Stato (98% della popolazione)
    [economica] Debito pubblico e carestia
    [culturale] Idee dell'Illuminismo
      [uguaglianza e] Sovranità popolare
  [inizia con] Eventi del 1789
    [maggio] Convocazione Stati Generali
    [14 luglio] Presa della Bastiglia
    [agosto] Dichiarazione dei Diritti dell'Uomo
  [fasi principali] Evoluzione politica
    [1789-1791] Monarchia costituzionale
    [1792-1794] Repubblica e Periodo del Terrore
      [guidato da] Robespierre
    [1795-1799] Direttorio
      [termina con] Ascesa di Napoleone`,
    `La Cellula
  [è l'] Unità fondamentale dei viventi
  [si divide in] Procariote
    [tipica di] Batteri
    [caratteristica] DNA libero nel citoplasma
  [si divide in] Eucariote
    [ha un] Nucleo ben definito
      [contiene] DNA
    [comprende] Organuli cellulari
      [producono energia] Mitocondri
      [sintetizzano proteine] Ribosomi
      [solo nelle piante] Cloroplasti e Parete cellulare`
  ];

  function createNode(text = 'Nuovo concetto', linkText = '', extras = {}) {
    return Object.assign(
      {
        id: uid('n'),
        text: String(text || 'Concetto').trim(),
        linkText: String(linkText || '').trim(),
        children: [],
        collapsed: false,
        color: '',
        textColor: '',
        shape: '',
        bold: null,
        italic: false,
        underline: false,
        fontSize: 0,
        manualX: null,
        manualY: null,
        customW: 0,
        customH: 0,
        image: null
      },
      extras
    );
  }

  /**
   * Extracts `[linkText] Concept` or `linkText -> Concept` or `linkText: Concept` (when short verb phrase).
   */
  function splitLinkAndConcept(rawLine) {
    let s = rawLine.trim();

    // Remove bullet / numbering prefix
    s = s.replace(/^(?:[-*•‣◦+]|\d+[.)]|[a-zA-Z][.)])\s+/, '').trim();

    let linkText = '';
    let text = s;

    // 1. [parola legame] Concetto
    const bracketMatch = s.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (bracketMatch) {
      linkText = bracketMatch[1].trim();
      text = bracketMatch[2].trim();
      return { linkText, text };
    }

    // 2. parola legame -> Concetto  OR  parola legame => Concetto
    const arrowMatch = s.match(/^([^=><]{1,36}?)\s*(?:->|=>|→)\s*(.+)$/);
    if (arrowMatch) {
      linkText = arrowMatch[1].trim();
      text = arrowMatch[2].trim();
      return { linkText, text };
    }

    return { linkText, text };
  }

  /**
   * Parses indented text, markdown headings, or bullet lists into a hierarchical tree.
   */
  function parseOutline(rawText) {
    const lines = String(rawText || '')
      .replace(/\r\n/g, '\n')
      .split('\n');

    const items = [];

    for (const raw of lines) {
      if (!raw.trim()) continue;

      // Check Markdown heading (#, ##, ###)
      const headingMatch = raw.match(/^\s*(#{1,6})\s+(.+)$/);
      let levelScore = 0;
      let content = raw;

      if (headingMatch) {
        levelScore = (headingMatch[1].length - 1) * 2;
        content = headingMatch[2];
      } else {
        // Count leading whitespace (tabs = 2 spaces)
        const leading = raw.match(/^[\t ]*/)[0];
        const spaces = leading.replace(/\t/g, '  ').length;
        levelScore = spaces + 100; // keep indented items below headings if mixed, or relative to each other
        content = raw.trim();
      }

      const { linkText, text } = splitLinkAndConcept(content);
      if (!text) continue;

      // Support inline colon children if leaf line like "Pianeti rocciosi: Mercurio, Venere, Terra, Marte"
      // Only trigger when right side has comma-separated short items and no brackets
      items.push({ indent: levelScore, text, linkText });
    }

    if (items.length === 0) {
      return createNode('Concetto principale');
    }

    // Normalize indentation levels
    // If there are multiple top-level items at the minimum indent, wrap them under a main root or promote the first one
    const minIndent = Math.min(...items.map((i) => i.indent));
    const topCount = items.filter((i) => i.indent === minIndent).length;

    let root;
    let stack = [];

    if (topCount === 1) {
      root = createNode(items[0].text, '');
      stack = [{ node: root, indent: items[0].indent }];
      for (let i = 1; i < items.length; i++) {
        const it = items[i];
        while (stack.length > 1 && stack[stack.length - 1].indent >= it.indent) {
          stack.pop();
        }
        const parent = stack[stack.length - 1].node;
        const child = createNode(it.text, it.linkText);
        parent.children.push(child);
        stack.push({ node: child, indent: it.indent });
      }
    } else {
      // Check if first line has no bullet and subsequent lines all have same indent: promote first line as root
      root = createNode(items[0].text, '');
      stack = [{ node: root, indent: minIndent - 1 }];
      for (let i = 1; i < items.length; i++) {
        const it = items[i];
        while (stack.length > 1 && stack[stack.length - 1].indent >= it.indent) {
          stack.pop();
        }
        const parent = stack[stack.length - 1].node;
        const child = createNode(it.text, it.linkText);
        parent.children.push(child);
        stack.push({ node: child, indent: it.indent });
      }
    }

    return root;
  }

  function parseOpml(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const body = doc.querySelector('body');
    if (!body) return createNode('Mappa importata');

    const topOutlines = Array.from(body.children).filter((el) => el.tagName.toLowerCase() === 'outline');
    if (topOutlines.length === 0) return createNode('Mappa importata');

    function walk(el, isRoot = false) {
      const raw = el.getAttribute('text') || el.getAttribute('title') || 'Concetto';
      const { linkText, text } = splitLinkAndConcept(raw);
      const n = createNode(text, isRoot ? '' : linkText);
      const kids = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'outline');
      n.children = kids.map((k) => walk(k, false));
      return n;
    }

    if (topOutlines.length === 1) {
      return walk(topOutlines[0], true);
    }

    const titleEl = doc.querySelector('head > title');
    const root = createNode(titleEl ? titleEl.textContent : 'Mappa concettuale');
    root.children = topOutlines.map((el) => walk(el, false));
    return root;
  }

  function treeToOutline(node, depth = 0) {
    const pad = '  '.repeat(depth);
    const prefix = depth > 0 && node.linkText ? `[${node.linkText}] ` : depth > 0 ? '- ' : '';
    const singleLineText = stripRichTags(node.text || '').replace(/\s*\n\s*/g, ' / ');
    let out = `${pad}${prefix}${singleLineText}\n`;
    for (const child of node.children || []) {
      out += treeToOutline(child, depth + 1);
    }
    return out;
  }

  function countNodesInTree(node) {
    if (!node) return 0;
    let c = 1;
    for (const k of node.children || []) c += countNodesInTree(k);
    return c;
  }

  window.CMOutline = {
    SAMPLE_OUTLINES,
    createNode,
    parseOutline,
    parseOpml,
    treeToOutline,
    countNodesInTree
  };
})();
