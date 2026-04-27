export const Colors = {
  bg:        '#07090f',
  bg2:       '#0a0e1a',
  bg3:       'rgba(255,255,255,0.03)',
  border:    'rgba(255,255,255,0.07)',
  text:      '#e8edf5',
  text2:     '#8b95a8',
  text3:     '#3d4a5c',
  card:      '#0d1220',
  accent:    '#1d4ed8',
  accent2:   '#7dd3fc',
  purple:    '#6d28d9',
  success:   '#34d399',
  error:     '#f87171',
  warning:   '#fbbf24',
  overlay:   'rgba(0,0,0,0.8)',
  inpBg:     'rgba(255,255,255,0.04)',
  inpBorder: 'rgba(255,255,255,0.08)',
};

export const Gradients = {
  header:  ['#07090f', '#0a0f1e'],
  accent:  ['#1d4ed8', '#6d28d9'],
  purple:  ['#6d28d9', '#4f46e5'],
  card:    ['#0d1220', '#090d18'],
};

export const Spacing = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
};

export const Radius = {
  sm: 8, md: 12, lg: 16, xl: 24, full: 9999,
};

export const Typography = {
  h1: { fontSize: 28, fontWeight: '700', color: '#e8edf5', letterSpacing: -0.8 },
  h2: { fontSize: 22, fontWeight: '700', color: '#e8edf5', letterSpacing: -0.4 },
  h3: { fontSize: 17, fontWeight: '600', color: '#e8edf5' },
  body: { fontSize: 14, color: '#e8edf5', lineHeight: 22 },
  caption: { fontSize: 12, color: '#8b95a8' },
  micro: { fontSize: 10, color: '#3d4a5c', letterSpacing: 0.5 },
  label: { fontSize: 10, fontWeight: '700', color: '#3d4a5c', textTransform: 'uppercase', letterSpacing: 1 },
};

export const Shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  fab: {
    shadowColor: '#1d4ed8',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 14,
  },
};
