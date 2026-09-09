import type { ThemeMode } from '../utils/theme';

export interface ReaderSettings {
  density: 'comfortable' | 'compact';
  /** Marks are the low-contrast lines; `hidden` keeps only conversation. */
  bookkeeping: 'marked' | 'hidden';
  timeDisplay: 'elapsed' | 'absolute';
  showThinking: boolean;
  markdown: boolean;
  theme: ThemeMode;
}

const KEY = 'transcript-reader-settings';

export const DEFAULT_SETTINGS: ReaderSettings = {
  density: 'comfortable',
  bookkeeping: 'marked',
  timeDisplay: 'elapsed',
  showThinking: true,
  markdown: false,
  theme: 'system'
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const loadSettings = (): ReaderSettings => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    if (!isRecord(parsed)) return { ...DEFAULT_SETTINGS };
    return {
      density: parsed.density === 'compact' ? 'compact' : 'comfortable',
      bookkeeping: parsed.bookkeeping === 'hidden' ? 'hidden' : 'marked',
      timeDisplay: parsed.timeDisplay === 'absolute' ? 'absolute' : 'elapsed',
      showThinking: parsed.showThinking !== false,
      markdown: parsed.markdown === true,
      theme:
        parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system'
          ? parsed.theme
          : 'system'
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const saveSettings = (settings: ReaderSettings): void => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage may be unavailable; the setting still applies for the page */
  }
};
