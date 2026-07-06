export type ThemeMode = 'light' | 'dark' | 'system';
export type DarkVariant = 'slate' | 'warm';

const MODE_KEY = 'prism-theme-mode';
const VARIANT_KEY = 'prism-theme-variant';
const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)';

let hasMediaListener = false;

const isThemeMode = (value: string | null): value is ThemeMode =>
  value === 'light' || value === 'dark' || value === 'system';

const isDarkVariant = (value: string | null): value is DarkVariant =>
  value === 'slate' || value === 'warm';

const getPreferenceQuery = (): MediaQueryList | null => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }

  return window.matchMedia(COLOR_SCHEME_QUERY);
};

const readStorage = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
};

const resolveTheme = (mode: ThemeMode): 'light' | 'dark' => {
  if (mode === 'system') {
    return getPreferenceQuery()?.matches ? 'dark' : 'light';
  }

  return mode;
};

const handleSystemThemeChange = (): void => {
  const mode = getMode();
  if (mode === 'system') {
    applyTheme(mode, getVariant());
  }
};

export function applyTheme(mode: ThemeMode, variant: DarkVariant): void {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(mode);
  root.dataset.darkVariant = variant;
}

export function initTheme(): void {
  applyTheme(getMode(), getVariant());

  const preferenceQuery = getPreferenceQuery();
  if (!preferenceQuery || hasMediaListener) {
    return;
  }

  preferenceQuery.addEventListener('change', handleSystemThemeChange);
  hasMediaListener = true;
}

export function setMode(mode: ThemeMode): void {
  writeStorage(MODE_KEY, mode);
  applyTheme(mode, getVariant());
}

export function setVariant(variant: DarkVariant): void {
  writeStorage(VARIANT_KEY, variant);
  applyTheme(getMode(), variant);
}

export function getMode(): ThemeMode {
  const storedMode = readStorage(MODE_KEY);
  return isThemeMode(storedMode) ? storedMode : 'system';
}

export function getVariant(): DarkVariant {
  const storedVariant = readStorage(VARIANT_KEY);
  return isDarkVariant(storedVariant) ? storedVariant : 'slate';
}
