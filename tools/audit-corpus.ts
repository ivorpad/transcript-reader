#!/usr/bin/env bun
/**
 * Runs the Claude adapter over a real ~/.claude/projects tree and reports one
 * measurement per check. A check passes when its count is at or under its
 * limit; anything else is a defect with a number on it, not a judgement call.
 *
 *   bun tools/audit-corpus.ts                  # human table, exits 1 on failure
 *   bun tools/audit-corpus.ts --json           # machine output
 *   bun tools/audit-corpus.ts --root <dir>     # audit some other tree
 *   bun tools/audit-corpus.ts --only I1,I2     # run a subset
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { classifyLine } from '../src/adapters/claude/catalog';
import { parseClaudeSession } from '../src/adapters/claude/parser';
import { buildSessionView } from '../src/adapters/claude/session';
import type { NormalizedMessage } from '../src/types/reader';

interface Check {
  id: string;
  what: string;
  actual: number;
  limit: number;
  unit: string;
}

const LATCHED_TYPES = new Set([
  'mode',
  'permission-mode',
  'ai-title',
  'custom-title',
  'last-prompt',
  'atis-latch',
  'agent-setting',
  'agent-name'
]);

const TITLE_ENVELOPE =
  /^(<(command-name|command-message|local-command|system-reminder|user-prompt)|Caveat:|Claude Session)/;

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

const root = flag('--root') ?? `${process.env.HOME}/.claude/projects`;
const asJson = args.includes('--json');
const only = flag('--only')?.split(',').map(id => id.trim().toUpperCase());

const walk = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(path));
    } else if (entry.name.endsWith('.jsonl')) {
      found.push(path);
    }
  }
  return found;
};

const readLines = async (path: string): Promise<unknown[]> => {
  const text = await Bun.file(path).text();
  const lines: unknown[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      lines.push(line);
    }
  }
  return lines;
};

/**
 * True only when the row text really is a serialised object or array. A prefix
 * test is not enough: legitimate text such as "[Image #1]" or "[Truncated: ...]"
 * opens with a bracket without being JSON.
 */
const looksLikeJsonBlob = (text: string): boolean => {
  const head = text.trimStart();
  if (!head.startsWith('{') && !head.startsWith('[')) return false;
  try {
    const parsed = JSON.parse(head);
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
};

/**
 * C1 asks whether the parser inlined an image payload into a row's text instead
 * of exposing it as an image. Three text-matching proxies were tried and all
 * false-positived on content that merely mentions base64 — a Bash script, a Go
 * source file, a page of docs, an `ls` listing. Text cannot tell parser output
 * from transcript content, so compare the row against its own images: the
 * payload is inlined exactly when a URL the parser built also appears in
 * `text`.
 */
const inlinesItsOwnImage = (message: NormalizedMessage): boolean =>
  (message.images ?? []).some(image => message.text.includes(image.url));

/**
 * C9 asks whether a tool call was serialised rather than rendered. Precise by
 * construction: only the serialised form contains the row's own tool_use id.
 */
/**
 * C10: an empty thinking row whose request also carries the summary that
 * supersedes it. Empty rows whose request has no summary are not counted — they
 * are the only record that the turn reasoned at all.
 */
const supersededThinking = (
  message: NormalizedMessage,
  requestsWithSummary: Set<string>
): boolean =>
  message.channel === 'thinking' &&
  message.thinkingTextStored === false &&
  message.requestId !== undefined &&
  requestsWithSummary.has(message.requestId);

const serialisedToolCall = (message: NormalizedMessage): boolean => {
  if (message.channel !== 'tool_call' || !message.toolUseId) return false;
  if (!looksLikeJsonBlob(message.text)) return false;
  try {
    const parsed = JSON.parse(message.text.trimStart()) as { id?: unknown };
    return parsed.id === message.toolUseId;
  } catch {
    return false;
  }
};

/**
 * C2 asks whether the parser gave up and serialised a structured tool result.
 * An MCP tool that genuinely returns JSON is not a defect — SendMessage really
 * does answer `{"success":true,...}` — so compare against what serialising
 * would have produced rather than asking whether the text parses.
 */
const wasSerialised = (message: NormalizedMessage): boolean => {
  if (!looksLikeJsonBlob(message.text)) return false;
  const candidates = [message.toolUseResult, message.raw.toolUseResult];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    try {
      if (JSON.stringify(candidate, null, 2) === message.text) return true;
    } catch {
      // circular or otherwise unserialisable: not what the parser emitted
    }
  }
  return false;
};

let files = 0;
let totalLines = 0;
let nullFiles = 0;
let droppedLines = 0;
let filesWithDrops = 0;
let renderedRows = 0;
let eventRows = 0;
let jsonBlobEventRows = 0;
let maxLatchedRowsPerSession = 0;
let envelopeTitlesWithBetterAvailable = 0;
let base64Rows = 0;
let jsonBlobToolResults = 0;
let serialisedToolCalls = 0;
let supersededThinkingRows = 0;
let unbalancedLedgers = 0;
let worstImbalance = 0;
let turnlessSessions = 0;
let maxRowChars = 0;
let unknownClassLines = 0;
let foldOrPanelRows = 0;
let attachmentsUnreachable = 0;
let attachmentLines = 0;
let attachmentsReachable = 0;
const unknownClassTypes = new Map<string, number>();

const unknownTypes = new Map<string, number>();
const worstFiles: Array<{ file: string; lines: number; dropped: number }> = [];
const nullSamples: string[] = [];

for (const file of walk(root)) {
  const lines = await readLines(file);
  if (!lines.length) continue;
  files++;
  totalLines += lines.length;

  const parsed = parseClaudeSession(lines);
  if (!parsed) {
    nullFiles++;
    if (nullSamples.length < 10) nullSamples.push(file.replace(root, ''));
    for (const line of lines as Array<Record<string, unknown>>) {
      const type = typeof line?.type === 'string' ? line.type : '(no type)';
      unknownTypes.set(type, (unknownTypes.get(type) ?? 0) + 1);
    }
    continue;
  }

  const dropped = parsed.warnings.length;
  droppedLines += dropped;
  if (dropped > 0) {
    filesWithDrops++;
    worstFiles.push({ file: file.replace(root, ''), lines: lines.length, dropped });
    for (const warning of parsed.warnings) {
      const at = Number(/index (\d+)/.exec(warning)?.[1]);
      const line = Number.isInteger(at) ? (lines[at] as Record<string, unknown>) : undefined;
      const type = typeof line?.type === 'string' ? line.type : '(no type)';
      unknownTypes.set(type, (unknownTypes.get(type) ?? 0) + 1);
    }
  }

  // K1: the catalog places every line the corpus writes. Measured on the raw
  // line, before the parser has a say, so a new type cannot hide behind a
  // summariser.
  for (const line of lines) {
    if (classifyLine(line) !== 'unknown') continue;
    const record = line as Record<string, unknown> | null;
    if (!record || typeof record !== 'object') continue;
    unknownClassLines++;
    const key =
      record.type === 'attachment'
        ? `attachment:${String((record.attachment as Record<string, unknown> | undefined)?.type)}`
        : record.type === 'system'
          ? `system:${String(record.subtype)}`
          : String(record.type);
    unknownClassTypes.set(key, (unknownClassTypes.get(key) ?? 0) + 1);
  }
  attachmentLines += (lines as Array<Record<string, unknown>>).filter(
    line => line?.type === 'attachment'
  ).length;

  const view = buildSessionView(parsed, lines.length);

  // K2: a fold or panel line never draws a row. K3: every attachment is
  // reachable — drawn as its own row, folded onto a row, or routed to a panel.
  for (const message of parsed.conversation.messages) {
    if (message.lineClass === 'fold' || message.lineClass === 'panel') foldOrPanelRows++;
    if (message.lineType === 'attachment') attachmentsReachable++;
    for (const member of message.groupedMessages ?? []) {
      if (member.lineType === 'attachment' && member.id !== message.id) attachmentsReachable++;
    }
    for (const line of message.folded ?? []) {
      if (line.lineType === 'attachment') attachmentsReachable++;
    }
  }
  for (const line of parsed.conversation.folded) {
    if (line.lineType === 'attachment') attachmentsReachable++;
  }

  if (view.ledger.unaccountedLines !== 0) {
    unbalancedLedgers++;
    worstImbalance = Math.max(worstImbalance, Math.abs(view.ledger.unaccountedLines));
  }
  if (view.turns.length === 0 && lines.length > 0) turnlessSessions++;

  const requestsWithSummary = new Set<string>();
  for (const message of parsed.conversation.messages) {
    if (
      message.channel === 'thinking' &&
      message.thinkingTextStored === true &&
      message.requestId
    ) {
      requestsWithSummary.add(message.requestId);
    }
  }

  const latched = new Map<string, number>();
  for (const message of parsed.conversation.messages) {
    if (supersededThinking(message, requestsWithSummary)) supersededThinkingRows++;
    renderedRows++;
    maxRowChars = Math.max(maxRowChars, message.text.length);
    if (inlinesItsOwnImage(message)) base64Rows++;
    if (message.channel === 'event') {
      eventRows++;
      if (looksLikeJsonBlob(message.text)) jsonBlobEventRows++;
    }
    if (message.channel === 'tool_result' && wasSerialised(message)) {
      jsonBlobToolResults++;
    }
    if (serialisedToolCall(message)) {
      serialisedToolCalls++;
    }
    const lineType = message.lineType ?? '';
    if (LATCHED_TYPES.has(lineType)) {
      latched.set(lineType, (latched.get(lineType) ?? 0) + 1);
    }
  }
  for (const count of latched.values()) {
    maxLatchedRowsPerSession = Math.max(maxLatchedRowsPerSession, count);
  }

  const title = parsed.conversation.title;
  if (TITLE_ENVELOPE.test(title)) {
    const rows = lines as Array<Record<string, unknown>>;
    const better =
      rows.findLast(row => row?.type === 'custom-title')?.customTitle ??
      rows.findLast(row => row?.type === 'ai-title')?.aiTitle;
    if (typeof better === 'string' && better.trim()) envelopeTitlesWithBetterAvailable++;
  }
}

const eventRowShare = renderedRows ? eventRows / renderedRows : 0;
attachmentsUnreachable = Math.max(0, attachmentLines - attachmentsReachable);

const checks: Check[] = [
  { id: 'I1', what: 'lines dropped as unparseable', actual: droppedLines, limit: 0, unit: 'lines' },
  { id: 'I2', what: 'files the parser refuses entirely', actual: nullFiles, limit: 0, unit: 'files' },
  { id: 'E2', what: 'event rows rendered as raw JSON', actual: jsonBlobEventRows, limit: 0, unit: 'rows' },
  { id: 'N1', what: 'latched-state rows in one session', actual: maxLatchedRowsPerSession, limit: 1, unit: 'rows' },
  { id: 'N3', what: 'share of timeline that is event noise', actual: Math.round(eventRowShare * 100), limit: 25, unit: '%' },
  { id: 'T2', what: 'junk titles with a real title available', actual: envelopeTitlesWithBetterAvailable, limit: 0, unit: 'sessions' },
  { id: 'C1', what: 'rows inlining their own image payload', actual: base64Rows, limit: 0, unit: 'rows' },
  { id: 'C2', what: 'tool results the parser serialised', actual: jsonBlobToolResults, limit: 0, unit: 'rows' },
  { id: 'C9', what: 'tool calls the parser serialised', actual: serialisedToolCalls, limit: 0, unit: 'rows' },
  { id: 'C10', what: 'thinking rows a summary supersedes', actual: supersededThinkingRows, limit: 0, unit: 'rows' },
  { id: 'K1', what: 'lines the catalog cannot place', actual: unknownClassLines, limit: 0, unit: 'lines' },
  { id: 'K2', what: 'fold or panel lines drawn as rows', actual: foldOrPanelRows, limit: 0, unit: 'rows' },
  { id: 'K3', what: 'attachments unreachable from any view', actual: attachmentsUnreachable, limit: 0, unit: 'lines' },
  { id: 'L1', what: 'sessions whose ledger does not balance', actual: unbalancedLedgers, limit: 0, unit: 'sessions' },
  { id: 'L2', what: 'worst single-session imbalance', actual: worstImbalance, limit: 0, unit: 'lines' },
  { id: 'C8', what: 'longest single row', actual: maxRowChars, limit: 50_000, unit: 'chars' }
];

const selected = only ? checks.filter(check => only.includes(check.id)) : checks;
const failed = selected.filter(check => check.actual > check.limit);

worstFiles.sort((left, right) => right.dropped - left.dropped);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        root,
        corpus: { files, totalLines, renderedRows, filesWithDrops },
        checks: selected.map(check => ({ ...check, pass: check.actual <= check.limit })),
        unknownTypes: [...unknownTypes.entries()].sort((a, b) => b[1] - a[1]),
        unknownClassTypes: [...unknownClassTypes.entries()].sort((a, b) => b[1] - a[1]),
        worstFiles: worstFiles.slice(0, 15),
        nullSamples
      },
      null,
      2
    )
  );
} else {
  console.log(`corpus: ${files} files, ${totalLines} lines, ${renderedRows} rendered rows\n`);
  for (const check of selected) {
    const pass = check.actual <= check.limit;
    console.log(
      `${pass ? 'PASS' : 'FAIL'}  ${check.id.padEnd(3)} ${check.what.padEnd(42)} ` +
        `${String(check.actual).padStart(8)} ${check.unit} (limit ${check.limit})`
    );
  }
  if (unknownTypes.size) {
    console.log('\nline types the parser could not place:');
    for (const [type, count] of [...unknownTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log(`  ${String(count).padStart(7)}  ${type}`);
    }
  }
  if (unknownClassTypes.size) {
    console.log('\nline types the catalog cannot place:');
    for (const [type, count] of [...unknownClassTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log(`  ${String(count).padStart(7)}  ${type}`);
    }
  }
  if (nullSamples.length) {
    console.log('\nrefused files (sample):');
    for (const sample of nullSamples) console.log(`  ${sample}`);
  }
}

process.exit(failed.length ? 1 : 0);
