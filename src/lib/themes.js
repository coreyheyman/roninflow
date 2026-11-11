// Colour themes. A theme is { id, name, base: 'dark'|'light', colors: { key: '#rrggbb' } }.
// Every key maps to one CSS variable; tints (P&L backgrounds, row gradients, card glows) are derived in CSS
// from these with color-mix, so a theme only needs its base colours.

export const COLOR_GROUPS = [
  {
    id: 'surfaces', label: 'Surfaces', keys: [
      ['bg', '--bg', 'Page background', 'Behind everything'],
      ['sidebar', '--sidebar', 'Sidebar', 'Left navigation'],
      ['panel', '--panel', 'Panels', 'Big sections and tiles'],
      ['card', '--card', 'Cards', 'Cards, modals and menus'],
      ['card2', '--card-2', 'Raised', 'Table headers, chips, inner boxes'],
      ['card3', '--card-3', 'Raised (strong)', 'Selected chips, pressed controls'],
      ['hover', '--hover', 'Hover', 'Rows and buttons under the mouse'],
      ['input', '--input', 'Inputs', 'Text fields and selects'],
    ],
  },
  {
    id: 'lines', label: 'Lines', keys: [
      ['border', '--border', 'Borders', 'Panel and table lines'],
      ['border2', '--border-2', 'Borders (strong)', 'Buttons, inputs, dividers'],
    ],
  },
  {
    id: 'text', label: 'Text', keys: [
      ['fg', '--fg', 'Text', 'Headings and values'],
      ['fg2', '--fg-2', 'Text (soft)', 'Body text'],
      ['muted', '--muted', 'Muted', 'Labels and captions'],
      ['muted2', '--muted-2', 'Faint', 'Placeholders, empty states'],
    ],
  },
  {
    id: 'accent', label: 'Accent & buttons', keys: [
      ['primary', '--primary', 'Accent', 'Primary buttons, active nav, toggles'],
      ['primary2', '--primary-2', 'Accent (hover)', 'Accent on hover'],
      ['primaryInk', '--primary-ink', 'Text on accent', 'Text inside accent buttons'],
      ['btnBg', '--white-btn-bg', 'Main button', 'High-contrast buttons (Add, Save)'],
      ['btnFg', '--white-btn-fg', 'Main button text', 'Text on those buttons'],
    ],
  },
  {
    id: 'pnl', label: 'P&L & status', keys: [
      ['pos', '--pos', 'Profit text', 'Green numbers'],
      ['posStrong', '--pos-strong', 'Profit fill', 'Green bars, calendar days, charts'],
      ['neg', '--neg', 'Loss', 'Red numbers, bars and calendar days'],
      ['negStrong', '--neg-strong', 'Loss (strong)', 'Danger buttons, deep red'],
      ['warn', '--warn', 'Warning', 'Due reviews, unreviewed dots, pending'],
      ['info', '--info', 'Info', 'Passed / funded accounts'],
    ],
  },
];

export const COLOR_KEYS = COLOR_GROUPS.flatMap((g) => g.keys);

export const TEMPLATES = [
  {
    id: 'ronin', name: 'Ronin', base: 'dark', font: 'jetbrains', blurb: 'Pure black, violet accent · default',
    colors: {
      bg: '#000000', sidebar: '#0e0e0e', panel: '#0a0a0a', card: '#0f0f0f', card2: '#141414', card3: '#1a1a1a', hover: '#181818', input: '#0c0c0c',
      border: '#1e1e1e', border2: '#2a2a2a',
      fg: '#f4f4f5', fg2: '#d4d4d8', muted: '#8b8b8f', muted2: '#5c5c60',
      primary: '#7452ff', primary2: '#8b6dff', primaryInk: '#ffffff', btnBg: '#ffffff', btnFg: '#000000',
      pos: '#2bc48a', posStrong: '#1aa87f', neg: '#e5484d', negStrong: '#c0343f', warn: '#e8b043', info: '#4da3e5',
    },
  },
  {
    id: 'obsidian', name: 'Obsidian', base: 'dark', blurb: 'Pure black, emerald accent',
    colors: {
      bg: '#000000', sidebar: '#0e0e0e', panel: '#0a0a0a', card: '#0f0f0f', card2: '#141414', card3: '#1a1a1a', hover: '#181818', input: '#0c0c0c',
      border: '#1e1e1e', border2: '#2a2a2a',
      fg: '#f4f4f5', fg2: '#d4d4d8', muted: '#8b8b8f', muted2: '#5c5c60',
      primary: '#1aa87f', primary2: '#22c08f', primaryInk: '#ffffff', btnBg: '#ffffff', btnFg: '#000000',
      pos: '#2bc48a', posStrong: '#1aa87f', neg: '#e5484d', negStrong: '#c0343f', warn: '#e8b043', info: '#4da3e5',
    },
  },
  {
    id: 'graphite', name: 'Graphite', base: 'dark', blurb: 'Warm charcoal, amber accent',
    colors: {
      bg: '#111113', sidebar: '#17171a', panel: '#151517', card: '#1b1b1e', card2: '#212124', card3: '#2a2a2e', hover: '#252528', input: '#131315',
      border: '#2a2a2e', border2: '#38383d',
      fg: '#eeeef0', fg2: '#cdcdd2', muted: '#909097', muted2: '#64646b',
      primary: '#e3a43b', primary2: '#f0b656', primaryInk: '#1b1306', btnBg: '#f1f1f3', btnFg: '#111113',
      pos: '#45d095', posStrong: '#2fb47a', neg: '#f0625f', negStrong: '#c94442', warn: '#e3a43b', info: '#6aa8f0',
    },
  },
  {
    id: 'deepsea', name: 'Deep Sea', base: 'dark', blurb: 'Midnight navy, cyan accent',
    colors: {
      bg: '#060a13', sidebar: '#0a111e', panel: '#09101b', card: '#0d1523', card2: '#121c2d', card3: '#182438', hover: '#142033', input: '#09101d',
      border: '#1a2639', border2: '#26354d',
      fg: '#e9eff8', fg2: '#c4d0e1', muted: '#7e8ca4', muted2: '#526079',
      primary: '#38bdf8', primary2: '#62cdfb', primaryInk: '#03111b', btnBg: '#e9eff8', btnFg: '#060a13',
      pos: '#34d3a0', posStrong: '#1fb88a', neg: '#f2566b', negStrong: '#c93a50', warn: '#f5b94a', info: '#8b93f8',
    },
  },
  {
    id: 'daylight', name: 'Daylight', base: 'light', blurb: 'Clean white, emerald accent',
    colors: {
      bg: '#f6f6f7', sidebar: '#ffffff', panel: '#ffffff', card: '#ffffff', card2: '#f7f7f8', card3: '#efeff1', hover: '#f1f1f3', input: '#ffffff',
      border: '#e6e6e9', border2: '#d9d9de',
      fg: '#0b0b0c', fg2: '#2a2a2e', muted: '#6c6c72', muted2: '#a0a0a6',
      primary: '#1aa87f', primary2: '#22c08f', primaryInk: '#ffffff', btnBg: '#0b0b0c', btnFg: '#ffffff',
      pos: '#0f9a6e', posStrong: '#1aa87f', neg: '#d63a40', negStrong: '#c0343f', warn: '#c98a12', info: '#2f86d0',
    },
  },
  {
    id: 'linen', name: 'Linen', base: 'light', blurb: 'Warm paper, deep teal accent',
    colors: {
      bg: '#f3eee5', sidebar: '#fbf8f2', panel: '#fffdf8', card: '#fffdf8', card2: '#f7f2e9', card3: '#eee7da', hover: '#f2ebdf', input: '#fffdf8',
      border: '#e5dccc', border2: '#d6cab5',
      fg: '#29231b', fg2: '#4a4136', muted: '#85796a', muted2: '#b1a694',
      primary: '#2f6f62', primary2: '#3a8475', primaryInk: '#ffffff', btnBg: '#29231b', btnFg: '#fbf8f2',
      pos: '#2c7a58', posStrong: '#3a8f69', neg: '#c0453a', negStrong: '#a3372e', warn: '#b7791f', info: '#3b6fb6',
    },
  },
];

// Fonts (Google Fonts). Each loads the 400–800 weights the app uses, so titles stay bolder than body text.
// track = letter-spacing tuned per font.
export const FONTS = [
  { id: 'inter', name: 'Inter', family: 'Inter', w: '400;500;600;700;800', track: '-0.011em', note: 'Crisp and neutral' },
  { id: 'geist', name: 'Geist', family: 'Geist', w: '400;500;600;700;800', track: '-0.01em', note: 'Modern, Vercel-style' },
  { id: 'manrope', name: 'Manrope', family: 'Manrope', w: '400;500;600;700;800', track: '-0.005em', note: 'Rounded geometric' },
  { id: 'jakarta', name: 'Plus Jakarta Sans', family: 'Plus Jakarta Sans', w: '400;500;600;700;800', track: '-0.008em', note: 'Friendly, premium' },
  { id: 'dmsans', name: 'DM Sans', family: 'DM Sans', w: '400;500;600;700;800', track: '-0.01em', note: 'Low-contrast, clean' },
  { id: 'figtree', name: 'Figtree', family: 'Figtree', w: '400;500;600;700;800', track: '-0.005em', note: 'Warm and clear' },
  { id: 'outfit', name: 'Outfit', family: 'Outfit', w: '400;500;600;700;800', track: '0em', note: 'Geometric, airy' },
  { id: 'sora', name: 'Sora', family: 'Sora', w: '400;500;600;700;800', track: '-0.015em', note: 'Wide, techy' },
  { id: 'spacegrotesk', name: 'Space Grotesk', family: 'Space Grotesk', w: '400;500;600;700', track: '-0.01em', note: 'Quirky grotesk' },
  { id: 'plex', name: 'IBM Plex Sans', family: 'IBM Plex Sans', w: '400;500;600;700', track: '0em', note: 'Engineered, terminal feel' },
  { id: 'lexend', name: 'Lexend', family: 'Lexend', w: '400;500;600;700;800', track: '-0.01em', note: 'Very readable' },
  { id: 'urbanist', name: 'Urbanist', family: 'Urbanist', w: '400;500;600;700;800', track: '0em', note: 'Sleek, narrow' },
  { id: 'jetbrains', name: 'JetBrains Mono', family: 'JetBrains Mono', w: '400;500;600;700;800', track: '-0.02em', note: 'Default · monospace, trading-desk look' },
  { id: 'system', name: 'System', family: null, track: '0em', note: 'Your device\'s own font, no download' },
];
const FALLBACK = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
export const findFont = (id) => FONTS.find((f) => f.id === id) || FONTS[0];
export const fontStack = (f) => (f.family ? `'${f.family}', ${f.id === 'jetbrains' ? "ui-monospace, 'Cascadia Mono', Consolas, 'DejaVu Sans Mono', monospace" : FALLBACK}` : FALLBACK);
const fontUrl = (fonts) => `https://fonts.googleapis.com/css2?${fonts.filter((f) => f.family).map((f) => `family=${f.family.replace(/ /g, '+')}:wght@${f.w}`).join('&')}&display=swap`;
/** Add the stylesheet for one or more fonts (once each). Inter and JetBrains Mono are already in index.html. */
const loaded = new Set(['inter', 'jetbrains']);
export function loadFonts(fonts) {
  const need = fonts.filter((f) => f.family && !loaded.has(f.id));
  if (!need.length) return;
  need.forEach((f) => loaded.add(f.id));
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = fontUrl(need);
  document.head.appendChild(link);
}

const defaultFor = (base) => (base === 'light' ? 'daylight' : 'ronin');

/** The active theme id (older data only has settings.theme = 'dark' | 'light'). */
export const activeThemeId = (settings) => settings.themeId || defaultFor(settings.theme);

export function findTheme(settings, id = activeThemeId(settings)) {
  const t = TEMPLATES.find((x) => x.id === id) || (settings.customThemes || []).find((x) => x.id === id) || TEMPLATES.find((x) => x.id === defaultFor(settings.theme));
  // fill any key missing from an older custom theme from its template
  const fallback = TEMPLATES.find((x) => x.id === t.from) || TEMPLATES.find((x) => x.id === defaultFor(t.base));
  return { ...t, font: t.font || 'inter', colors: { ...fallback.colors, ...t.colors } };
}

/** Put a theme on the page. */
export function applyTheme(theme) {
  const el = document.documentElement;
  el.dataset.theme = theme.base;
  for (const [key, cssVar] of COLOR_KEYS) if (theme.colors[key]) el.style.setProperty(cssVar, theme.colors[key]);
  const f = findFont(theme.font);
  loadFonts([f]);
  el.style.setProperty('--font', fontStack(f));
  el.style.setProperty('--track', f.track);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors.bg);
}

/** Settings patch that switches to a theme (keeps settings.theme in step for anything that reads dark/light). */
export const themeSettings = (theme) => ({ themeId: theme.id, theme: theme.base, [theme.base === 'light' ? 'lastLight' : 'lastDark']: theme.id });

export const HEX = /^#[0-9a-f]{6}$/i;
export function normHex(v) {
  let s = String(v || '').trim();
  if (!s.startsWith('#')) s = `#${s}`;
  if (/^#[0-9a-f]{3}$/i.test(s)) s = `#${s.slice(1).split('').map((c) => c + c).join('')}`;
  return HEX.test(s) ? s.toLowerCase() : null;
}
