export const Colors = {
  bg:       '#080c14',
  bg2:      '#0f1521',
  bg3:      'rgba(255,255,255,0.03)',
  border:   'rgba(255,255,255,0.07)',
  text:     '#e2e8f0',
  text2:    '#94a3b8',
  text3:    '#475569',
  card:     '#0f1521',
  accent:   '#1d4ed8',
  accent2:  '#7dd3fc',
  purple:   '#7c3aed',
  success:  '#4ade80',
  error:    '#f87171',
  warning:  '#fbbf24',
  overlay:  'rgba(0,0,0,0.75)',
  inpBg:    'rgba(255,255,255,0.05)',
  inpBorder:'rgba(255,255,255,0.1)',
};

export const Gradients = {
  header:  ['#0a0f1e', '#0f1729', '#1a2f52', '#1e3a5f'],
  accent:  ['#1d4ed8', '#7c3aed'],
  purple:  ['#7c3aed', '#4f46e5'],
  card:    ['#0f1521', '#0a0e18'],
};

export const Spacing = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
};

export const Radius = {
  sm: 8, md: 12, lg: 16, xl: 20, full: 9999,
};

export const Typography = {
  h1: { fontSize: 26, fontWeight: '700', color: Colors.text, letterSpacing: -0.5 },
  h2: { fontSize: 20, fontWeight: '700', color: Colors.text },
  h3: { fontSize: 17, fontWeight: '600', color: Colors.text },
  body: { fontSize: 14, color: Colors.text, lineHeight: 21 },
  caption: { fontSize: 12, color: Colors.text2 },
  micro: { fontSize: 11, color: Colors.text3 },
  label: { fontSize: 12, fontWeight: '600', color: Colors.text2, textTransform: 'uppercase', letterSpacing: 0.5 },
};

export const Shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  fab: {
    shadowColor: '#1d4ed8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 12,
  },
};
