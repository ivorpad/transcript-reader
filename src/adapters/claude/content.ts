import type { PrismImage } from '../../types/prism';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

const str = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** Rendering cap. A single Read result in the reference corpus reached 681 KB. */
export const MAX_ROW_CHARS = 50_000;

export interface RenderedContent {
  text: string;
  images: PrismImage[];
}

const base64Bytes = (data: string): number => Math.floor((data.length * 3) / 4);

/**
 * Turns an image or document block into something renderable. Upstream ran
 * these through JSON.stringify, which put megabytes of base64 into a `<pre>`.
 */
export const toImage = (block: UnknownRecord): PrismImage | null => {
  const source = isRecord(block.source) ? block.source : null;
  if (!source) return null;

  const mediaType = str(source.media_type) ?? 'image/png';
  const url = str(source.url);
  if (url) return { url, mediaType };

  const data = str(source.data);
  if (!data) return null;

  return {
    url: `data:${mediaType};base64,${data}`,
    mediaType,
    bytes: base64Bytes(data)
  };
};

const humanBytes = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const describeDocument = (block: UnknownRecord): string => {
  const source = isRecord(block.source) ? block.source : {};
  const mediaType = str(source.media_type) ?? 'document';
  const data = str(source.data);
  const size = data ? ` · ${humanBytes(base64Bytes(data))}` : '';
  return `[document ${mediaType}${size}]`;
};

const modelOf = (value: unknown): string | null =>
  isRecord(value) ? str(value.model) : str(value);

/**
 * Renders one content block to text, collecting images rather than inlining
 * them. Returns null when the block contributes no text of its own.
 */
const renderBlock = (
  block: UnknownRecord,
  images: PrismImage[],
  options: { includeToolResults: boolean; includeThinking: boolean }
): string | null => {
  const type = str(block.type);

  if (type === 'image') {
    const image = toImage(block);
    if (image) {
      images.push(image);
      return image.bytes
        ? `[image ${image.mediaType} · ${humanBytes(image.bytes)}]`
        : `[image ${image.mediaType}]`;
    }
    return '[image]';
  }

  if (type === 'document') {
    return describeDocument(block);
  }

  if (type === 'tool_reference') {
    return `[tool reference: ${str(block.tool_name) ?? 'unknown tool'}]`;
  }

  if (type === 'fallback') {
    const from = modelOf(block.from);
    const to = modelOf(block.to);
    return `[model fallback: ${from ?? 'unknown'} → ${to ?? 'unknown'}]`;
  }

  if (type === 'tool_result' && !options.includeToolResults) {
    return null;
  }

  if (
    (type === 'thinking' || type === 'redacted_thinking') &&
    !options.includeThinking
  ) {
    return null;
  }

  if (typeof block.text === 'string') return block.text;
  if (typeof block.thinking === 'string') return block.thinking;

  if (type === 'tool_result' || Array.isArray(block.content)) {
    const nested = renderContent(block.content, images, options);
    return nested || null;
  }

  if (typeof block.content === 'string') return block.content;
  if (type === 'redacted_thinking' && typeof block.data === 'string') {
    return '[thinking redacted]';
  }

  return null;
};

export const renderContent = (
  content: unknown,
  images: PrismImage[],
  options: { includeToolResults?: boolean; includeThinking?: boolean } = {}
): string => {
  const resolved = {
    includeToolResults: options.includeToolResults ?? true,
    includeThinking: options.includeThinking ?? true
  };

  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .filter(isRecord)
    .map(block => renderBlock(block, images, resolved))
    .filter((part): part is string => Boolean(part))
    .join('\n');
};

/** Convenience wrapper that allocates its own image list. */
export const renderToText = (
  content: unknown,
  options: { includeToolResults?: boolean; includeThinking?: boolean } = {}
): RenderedContent => {
  const images: PrismImage[] = [];
  const text = renderContent(content, images, options);
  return { text, images };
};

export interface TruncatedText {
  text: string;
  truncatedFrom?: number;
  fullText?: string;
}

export const truncateForRow = (text: string): TruncatedText => {
  if (text.length <= MAX_ROW_CHARS) return { text };
  return {
    text: `${text.slice(0, MAX_ROW_CHARS - 1)}…`,
    truncatedFrom: text.length,
    fullText: text
  };
};

const clip = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/**
 * Renders a top-level `toolUseResult` as text. Upstream stringified it, which
 * is 7,118 rows of raw JSON in the reference corpus. Falls back to naming the
 * object's own scalar fields rather than serialising it.
 */
export const describeToolUseResult = (
  result: unknown,
  images: PrismImage[]
): string => {
  if (result === null || result === undefined) return '';
  if (typeof result === 'string') return result;
  if (typeof result === 'number' || typeof result === 'boolean') {
    return String(result);
  }
  if (Array.isArray(result)) {
    return renderContent(result, images);
  }
  if (!isRecord(result)) return '';

  const parts: string[] = [];
  const stdout = str(result.stdout);
  const stderr = str(result.stderr);
  if (stdout) parts.push(stdout);
  if (stderr) parts.push(`stderr: ${stderr}`);
  if (parts.length) {
    if (result.interrupted === true) parts.push('[interrupted]');
    return parts.join('\n');
  }

  if (Array.isArray(result.content) || typeof result.content === 'string') {
    const rendered = renderContent(result.content, images);
    if (rendered) return rendered;
  }

  const fields: string[] = [];
  for (const [key, value] of Object.entries(result)) {
    if (fields.length >= 8) break;
    if (typeof value === 'string') {
      if (value.trim()) fields.push(`${key}: ${clip(value, 400)}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      fields.push(`${key}: ${value}`);
    } else if (Array.isArray(value)) {
      fields.push(`${key}: ${value.length} items`);
    } else if (isRecord(value)) {
      fields.push(`${key}: ${Object.keys(value).length} fields`);
    }
  }
  return fields.join('\n');
};

/**
 * The field that says what a tool call actually does, in the order worth trying.
 * A Bash call is its command; an Edit is its path. Everything else falls back to
 * listing fields.
 */
const HEADLINE_INPUT_KEYS = [
  'command',
  'file_path',
  'path',
  'pattern',
  'query',
  'url',
  'prompt',
  'description',
  'text',
  'content'
];

/**
 * Renders a tool call's input as readable lines. Upstream stringified the whole
 * block — id, name and input — so every one of the 143,589 tool calls in the
 * reference corpus opened with a `toolu_` id nobody reads.
 */
export const describeToolInput = (name: string, input: unknown): string => {
  if (typeof input === 'string') return input;
  if (!isRecord(input)) return name;

  const entries = Object.entries(input);
  if (entries.length === 0) return name;

  const headlineKey = HEADLINE_INPUT_KEYS.find(
    key => typeof input[key] === 'string' && (input[key] as string).trim() !== ''
  );

  const lines: string[] = [];
  if (headlineKey) lines.push(clip(String(input[headlineKey]), 4000));

  for (const [key, value] of entries) {
    if (key === headlineKey) continue;
    if (typeof value === 'string') {
      if (value.trim()) lines.push(`${key}: ${clip(value, 600)}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else if (Array.isArray(value)) {
      lines.push(`${key}: ${value.length} items`);
    } else if (isRecord(value)) {
      lines.push(`${key}: ${Object.keys(value).join(', ')}`);
    }
  }

  return lines.join('\n') || name;
};
