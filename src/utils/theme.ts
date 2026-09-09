export type ThemeMode = 'light' | 'dark' | 'system';

const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)';

let current: ThemeMode = 'system';
let hasMediaListener = false;

const getPreferenceQuery = (): MediaQueryList | null => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  return window.matchMedia(COLOR_SCHEME_QUERY);
};

const resolveTheme = (mode: ThemeMode): 'light' | 'dark' => {
  if (mode === 'system') return getPreferenceQuery()?.matches ? 'dark' : 'light';
  return mode;
};

export function applyTheme(mode: ThemeMode): void {
  current = mode;
  document.documentElement.dataset.theme = resolveTheme(mode);
}

export function initTheme(mode: ThemeMode): void {
  applyTheme(mode);
  const preferenceQuery = getPreferenceQuery();
  if (!preferenceQuery || hasMediaListener) return;
  preferenceQuery.addEventListener('change', () => {
    if (current === 'system') applyTheme('system');
  });
  hasMediaListener = true;
}
