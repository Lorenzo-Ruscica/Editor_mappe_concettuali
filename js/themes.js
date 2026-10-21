(function () {
  'use strict';

  const { mixColors, contrastText, darken, lighten } = window.CMUtil;

  const THEMES = {
    algor: {
      id: 'algor',
      name: 'Algor Vivace',
      bg: '#ffffff',
      rootFill: '#1e3a8a',
      rootText: '#ffffff',
      rootStroke: '#172554',
      branchPalette: [
        '#2563eb', // blu
        '#f59e0b', // ambra
        '#10b981', // smeraldo
        '#8b5cf6', // viola
        '#ef4444', // corallo
        '#06b6d4', // ciano
        '#ec4899', // rosa
        '#84cc16'  // lime
      ],
      childStyle: 'tinted', // level 1 bold/medium, level >=2 soft tint with colored border
      edgeColor: 'branch',
      labelBg: '#ffffff',
      labelText: '#334155',
      labelBorder: '#cbd5e1'
    },
    pastello: {
      id: 'pastello',
      name: 'Pastello Dolce',
      bg: '#ffffff',
      rootFill: '#312e81',
      rootText: '#ffffff',
      rootStroke: '#1e1b4b',
      branchPalette: [
        '#60a5fa',
        '#fbbf24',
        '#34d399',
        '#a78bfa',
        '#fb7185',
        '#38bdf8',
        '#f472b6',
        '#a3e635'
      ],
      childStyle: 'pastel',
      edgeColor: 'branch',
      labelBg: '#ffffff',
      labelText: '#334155',
      labelBorder: '#dbeafe'
    },
    scuola: {
      id: 'scuola',
      name: 'Quaderno',
      bg: '#fffdf9',
      rootFill: '#0f766e',
      rootText: '#ffffff',
      rootStroke: '#115e59',
      branchPalette: [
        '#0284c7',
        '#ea580c',
        '#16a34a',
        '#7c3aed',
        '#dc2626',
        '#ca8a04',
        '#0891b2',
        '#be185d'
      ],
      childStyle: 'tinted',
      edgeColor: 'branch',
      labelBg: '#fffdf9',
      labelText: '#1e293b',
      labelBorder: '#cbd5e1'
    },
    accademico: {
      id: 'accademico',
      name: 'Classico Blu',
      bg: '#ffffff',
      rootFill: '#1e293b',
      rootText: '#ffffff',
      rootStroke: '#0f172a',
      branchPalette: [
        '#1d4ed8',
        '#0369a1',
        '#0f766e',
        '#4338ca',
        '#1e40af',
        '#0e7490'
      ],
      childStyle: 'tinted',
      edgeColor: '#475569',
      labelBg: '#ffffff',
      labelText: '#334155',
      labelBorder: '#cbd5e1'
    },
    natura: {
      id: 'natura',
      name: 'Natura',
      bg: '#ffffff',
      rootFill: '#14532d',
      rootText: '#ffffff',
      rootStroke: '#052e16',
      branchPalette: [
        '#16a34a',
        '#ca8a04',
        '#0d9488',
        '#65a30d',
        '#d97706',
        '#0284c7'
      ],
      childStyle: 'tinted',
      edgeColor: 'branch',
      labelBg: '#ffffff',
      labelText: '#1e293b',
      labelBorder: '#cbd5e1'
    },
    stampa: {
      id: 'stampa',
      name: 'Bianco e Nero',
      bg: '#ffffff',
      rootFill: '#111827',
      rootText: '#ffffff',
      rootStroke: '#000000',
      branchPalette: [
        '#1f2937',
        '#374151',
        '#111827',
        '#4b5563'
      ],
      childStyle: 'mono',
      edgeColor: '#1f2937',
      labelBg: '#ffffff',
      labelText: '#111827',
      labelBorder: '#6b7280'
    }
  };

  const NODE_SWATCHES = [
    '#1e3a8a',
    '#2563eb',
    '#0891b2',
    '#10b981',
    '#84cc16',
    '#f59e0b',
    '#ea580c',
    '#ef4444',
    '#ec4899',
    '#8b5cf6',
    '#475569',
    '#ffffff',
    '#fef3c7',
    '#dcfce7'
  ];

  const LINK_CHIPS = [
    'è',
    'ha',
    'è formato da',
    'comprende',
    'si divide in',
    'causa',
    'produce',
    'serve per',
    'avviene in',
    'ad esempio',
    'dipende da',
    'porta a'
  ];

  const FONTS = [
    { id: 'sans', label: 'Moderna (Sans)', family: '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif' },
    { id: 'rounded', label: 'Arrotondata (Verdana)', family: 'Verdana, "Trebuchet MS", "Segoe UI", sans-serif' },
    { id: 'serif', label: 'Classica (Georgia)', family: 'Georgia, "Times New Roman", serif' },
    { id: 'legible', label: 'Alta leggibilità (Tahoma)', family: 'Tahoma, Verdana, Arial, sans-serif' }
  ];

  function getTheme(themeId, forceMono = false) {
    if (forceMono) return THEMES.stampa;
    return THEMES[themeId] || THEMES.algor;
  }

  function getFontFamily(fontId) {
    const found = FONTS.find((f) => f.id === fontId);
    return found ? found.family : FONTS[0].family;
  }

  /**
   * Resolves fill, stroke, textColor, strokeWidth, and branchBase color for a node.
   */
  function resolveNodeColors(node, depth, branchIndex, mapStyle, forceMono = false) {
    const theme = getTheme(mapStyle?.theme, forceMono);
    const palette = theme.branchPalette;
    const branchColor = depth === 0
      ? theme.rootFill
      : palette[Math.abs(branchIndex) % palette.length];

    if (forceMono) {
      if (depth === 0) {
        return {
          fill: '#111827',
          stroke: '#000000',
          text: '#ffffff',
          strokeWidth: 2.4,
          branchColor: '#111827',
          edgeColor: '#1f2937'
        };
      }
      return {
        fill: '#ffffff',
        stroke: '#111827',
        text: '#111827',
        strokeWidth: depth === 1 ? 2.1 : 1.5,
        branchColor: '#111827',
        edgeColor: '#1f2937'
      };
    }

    // Custom node color override
    if (node.color) {
      const fill = node.color;
      const isVeryLight = fill.toLowerCase() === '#ffffff' || contrastText(fill) === '#0f172a';
      const stroke = isVeryLight ? darken(branchColor, 0.05) : darken(fill, 0.22);
      const text = node.textColor || contrastText(fill);
      return {
        fill,
        stroke: fill.toLowerCase() === '#ffffff' ? branchColor : stroke,
        text,
        strokeWidth: depth === 0 ? 2.5 : depth === 1 ? 2.1 : 1.7,
        branchColor: fill.toLowerCase() === '#ffffff' ? branchColor : fill,
        edgeColor: theme.edgeColor === 'branch' ? branchColor : theme.edgeColor
      };
    }

    if (depth === 0) {
      return {
        fill: theme.rootFill,
        stroke: theme.rootStroke,
        text: node.textColor || theme.rootText,
        strokeWidth: 2.5,
        branchColor: theme.rootFill,
        edgeColor: theme.rootFill
      };
    }

    if (theme.childStyle === 'mono') {
      return {
        fill: '#ffffff',
        stroke: '#1f2937',
        text: node.textColor || '#111827',
        strokeWidth: depth === 1 ? 2.1 : 1.5,
        branchColor: '#1f2937',
        edgeColor: '#1f2937'
      };
    }

    if (depth === 1) {
      const fill = theme.childStyle === 'pastel'
        ? lighten(branchColor, 0.72)
        : lighten(branchColor, 0.84);
      const stroke = branchColor;
      return {
        fill,
        stroke,
        text: node.textColor || '#0f172a',
        strokeWidth: 2.2,
        branchColor,
        edgeColor: theme.edgeColor === 'branch' ? branchColor : theme.edgeColor
      };
    }

    // Depth >= 2
    const tintAmount = Math.min(0.95, 0.90 + (depth - 2) * 0.02);
    const fill = lighten(branchColor, tintAmount);
    const stroke = mixColors(branchColor, '#94a3b8', 0.15);
    return {
      fill,
      stroke,
      text: node.textColor || '#1e293b',
      strokeWidth: 1.6,
      branchColor,
      edgeColor: theme.edgeColor === 'branch' ? branchColor : theme.edgeColor
    };
  }

  window.CMThemes = {
    THEMES,
    NODE_SWATCHES,
    LINK_CHIPS,
    FONTS,
    getTheme,
    getFontFamily,
    resolveNodeColors
  };
})();
