import type { NormalizedMessage } from '../types/reader';

export const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/gu, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export const humanBytes = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export const usd = (value: number | null | undefined): string | null =>
  value === null || value === undefined ? null : `$${value.toFixed(2)}`;

export const shortId = (id: string | null | undefined, head = 8, tail = 4): string => {
  if (!id) return '';
  if (id.length <= head + tail + 1) return id;
  return tail > 0 ? `${id.slice(0, head)}…${id.slice(-tail)}` : `${id.slice(0, head)}…`;
};

export const shortModel = (model: string | null | undefined): string =>
  (model ?? '').replace(/^claude-/u, '').replace(/-\d{8}$/u, '');

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** Long strings are elided, so a raw line with an image never puts base64 in the DOM. */
const MAX_RAW_STRING = 400;
const MAX_RAW_CHARS = 24_000;

const elide = (value: unknown, depth: number): unknown => {
  if (typeof value === 'string') {
    return value.length > MAX_RAW_STRING
      ? `${value.slice(0, MAX_RAW_STRING)}… (${value.length.toLocaleString()} chars)`
      : value;
  }
  if (Array.isArray(value)) {
    return depth > 6 ? `[array of ${value.length}]` : value.map(item => elide(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    if (depth > 6) return `{${Object.keys(value).length} keys}`;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = elide(inner, depth + 1);
    return out;
  }
  return value;
};

export const safeRawJson = (raw: unknown): string => {
  try {
    const text = JSON.stringify(elide(raw, 0), null, 2);
    return text.length > MAX_RAW_CHARS
      ? `${text.slice(0, MAX_RAW_CHARS)}\n… (${text.length.toLocaleString()} chars)`
      : text;
  } catch {
    return String(raw);
  }
};

export const rawSize = (message: NormalizedMessage): number => {
  try {
    return JSON.stringify(message.raw).length;
  } catch {
    return 0;
  }
};

/** One line of a folded entry for the count list under a row. */
export const foldedDetail = (line: NormalizedMessage): string => clip(line.text, 140);

export const foldedMeta = (line: NormalizedMessage): string => {
  const attachment =
    typeof line.raw.attachment === 'object' && line.raw.attachment !== null
      ? (line.raw.attachment as Record<string, unknown>)
      : null;
  const duration = attachment?.durationMs;
  if (typeof duration === 'number') return `${Math.round(duration)} ms`;
  if (line.eventKind?.startsWith('system:')) return 'sys';
  if (line.lineType === 'attachment') return 'att';
  return line.lineType ?? '';
};
