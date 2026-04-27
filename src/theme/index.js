// Design system — inspired by Depop, Lyst, ASOS dark-light hybrid
// Warm charcoal bg, high contrast text, electric accent — feels premium not gloomy
export const Colors = {
  bg:        '#111318',   // warm dark, not pure black
  bg2:       '#181c24',
  bg3:       '#1e2330',
  border:    'rgba(255,255,255,0.09)',
  text:      '#f0f2f5',   // near-white, warm
  text2:     '#9aa3b2',
  text3:     '#5a6478',
  card:      '#181c24',
  cardBorder:'rgba(255,255,255,0.08)',
  accent:    '#3b6ef8',   // electric blue
  accent2:   '#6cb4f8',   // lighter blue
  accentBg:  'rgba(59,110,248,0.12)',
  purple:    '#7c5fe6',
  success:   '#3ecf8e',
  error:     '#f76b6b',
  warning:   '#f5a623',
  overlay:   'rgba(0,0,0,0.75)',
  inpBg:     'rgba(255,255,255,0.06)',
  inpBorder: 'rgba(255,255,255,0.1)',
  tabBar:    'rgba(14,17,24,0.97)',
};

export const Gradients = {
  header:  ['#111318', '#181c28'],
  accent:  ['#3b6ef8', '#7c5fe6'],
  blue:    ['#3b6ef8', '#2250d4'],
  card:    ['#181c24', '#141820'],
};

export const Spacing = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
};

export const Radius = {
  sm: 8, md: 12, lg: 16, xl: 24, full: 9999,
};

export const Typography = {
  h1:      { fontSize: 30, fontWeight: '700', color: '#f0f2f5', letterSpacing: -0.8 },
  h2:      { fontSize: 24, fontWeight: '700', color: '#f0f2f5', letterSpacing: -0.4 },
  h3:      { fontSize: 18, fontWeight: '600', color: '#f0f2f5' },
  body:    { fontSize: 15, color: '#f0f2f5', lineHeight: 22 },
  caption: { fontSize: 13, color: '#9aa3b2' },
  micro:   { fontSize: 11, color: '#5a6478', letterSpacing: 0.4 },
  label:   { fontSize: 11, fontWeight: '700', color: '#5a6478', textTransform: 'uppercase', letterSpacing: 1.2 },
};

export const Shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  fab: {
    shadowColor: '#3b6ef8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 16,
  },
};
