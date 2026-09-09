import { noteForType, typeNameOf } from './catalog';
import { innerText, stripPromptEnvelopes, userLineKind } from './prompts';
import type {
  ClaudeSessionParseResult,
  DiffLine,
  FoldDisposition,
  FoldedItem,
  FoldedType,
  LineClass,
  NormalizedConversation,
  NormalizedMessage,
  MessageImage,
  Severity,
  ReaderEntry,
  ReaderEntryKind,
  SessionBand,
  SessionBandMark,
  SessionContextPoint,
  SessionCrumbs,
  SessionFileChange,
  SessionLedger,
  SessionOutcome,
  SessionPanels,
  SessionStateEntry,
  SessionStretch,
  SessionTiming,
  SessionTrouble,
  SessionTurn,
  SessionView
} from '../../types/reader';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

const str = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** A quiet stretch worth drawing as a row rather than hiding. */
export const GAP_THRESHOLD_MS = 10 * 60 * 1000;

/** Above this many rows the reader opens collapsed, one band per turn. */
export const LONG_SESSION_ROWS = 400;

/** Below this many lines the rail, the filter bar and the docked inspector are withheld. */
export const SMALL_SESSION_LINES = 40;

const SEVERITY_ORDER: Severity[] = ['info', 'notice', 'warning', 'error'];

const worse = (left: Severity, right: Severity): Severity =>
  SEVERITY_ORDER.indexOf(right) > SEVERITY_ORDER.indexOf(left) ? right : left;

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const pad = (value: number): string => String(value).padStart(2, '0');

/** `48.2s`, `4m 12s`, `18h 40m`, `2d 3h`. */
export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ${pad(Math.round((ms % 60_000) / 1000))}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${pad(minutes % 60)}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
};

/** `+11s`, `+4m12s`, `+1h04m`: an offset inside a working stretch. */
export const formatElapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `+${seconds}s`;
  if (seconds < 3600) return `+${Math.floor(seconds / 60)}m${pad(seconds % 60)}s`;
  if (seconds < 86_400) {
    return `+${Math.floor(seconds / 3600)}h${pad(Math.floor((seconds % 3600) / 60))}m`;
  }
  return `+${Math.floor(seconds / 86_400)}d${pad(Math.floor((seconds % 86_400) / 3600))}h`;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Wed 09:00`: absolute with weekday, for anything after a gap. */
export const formatClock = (ms: number): string => {
  const date = new Date(ms);
  return `${WEEKDAYS[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** `Tue 8 Sep · 14:20`: the ends of a gap. */
export const formatDayClock = (ms: number): string => {
  const date = new Date(ms);
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} · ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const at = (message: NormalizedMessage | null | undefined): number | null => {
  if (!message?.timestamp) return null;
  const time = Date.parse(message.timestamp);
  return Number.isNaN(time) ? null : time;
};

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

/**
 * A turn opens at a prompt the person actually made. Tool results also arrive
 * on `user` lines, and so do injected meta messages, so neither starts a turn.
 */
const opensTurn = (message: NormalizedMessage): boolean =>
  message.role === 'user' &&
  message.channel === 'message' &&
  message.lineClass !== 'mark' &&
  !message.isMeta &&
  !message.isCompactSummary;

const firstTime = (messages: NormalizedMessage[]): number | null => {
  for (const message of messages) {
    const time = at(message);
    if (time !== null) return time;
  }
  return null;
};

const lastTime = (messages: NormalizedMessage[]): number | null => {
  for (let index = messages.length - 1; index >= 0; index--) {
    const time = at(messages[index]);
    if (time !== null) return time;
  }
  return null;
};

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/gu, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** A prompt as the person typed it: slash-command and reminder envelopes stripped. */
export const promptLabel = (text: string, max: number): string =>
  clip(stripPromptEnvelopes(text) || text, max);

const label = (message: NormalizedMessage | undefined): string => {
  const text = promptLabel(message?.text ?? '', 72);
  return text || 'Session start';
};

const countTools = (rows: NormalizedMessage[]): number =>
  rows.filter(row => row.channel === 'tool_call').length;

const countTrouble = (rows: NormalizedMessage[]): number =>
  rows.filter(row => row.severity === 'error' || row.severity === 'warning')
    .length;

const isAgentCall = (row: NormalizedMessage): boolean =>
  row.channel === 'tool_call' && (row.name === 'Agent' || row.name === 'Task');

const countAgents = (rows: NormalizedMessage[]): number =>
  rows.filter(isAgentCall).length;

const buildTurns = (messages: NormalizedMessage[]): SessionTurn[] => {
  const turns: SessionTurn[] = [];
  let current: NormalizedMessage[] = [];
  let opener: NormalizedMessage | undefined;

  const flush = () => {
    if (current.length === 0 && !opener) return;
    const rows = current;
    const start = firstTime(rows);
    const end = lastTime(rows);
    const previous = turns[turns.length - 1];
    const gapBefore =
      previous?.endedAt !== null && previous?.endedAt !== undefined && start !== null
        ? start - previous.endedAt
        : null;

    turns.push({
      index: turns.length + 1,
      label: label(opener),
      startedAt: start,
      endedAt: end,
      durationMs: start !== null && end !== null ? end - start : null,
      gapBeforeMs: gapBefore !== null && gapBefore >= GAP_THRESHOLD_MS ? gapBefore : null,
      rowCount: rows.length,
      toolCount: countTools(rows),
      troubleCount: countTrouble(rows),
      agentCount: countAgents(rows),
      interrupted: rows.some(row => row.interruptedMessageId !== undefined),
      rows
    });
    current = [];
    opener = undefined;
  };

  for (const message of messages) {
    if (opensTurn(message)) {
      flush();
      opener = message;
    }
    current.push(message);
  }
  flush();

  return turns;
};

// ---------------------------------------------------------------------------
// Entries: the rows the reader draws
// ---------------------------------------------------------------------------

const DIFF_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const MAX_DIFF_LINES = 80;

const shortToolName = (name: string | undefined): string => {
  if (!name) return 'tool';
  const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/u.exec(name);
  if (mcp) return `${mcp[1]}/${mcp[2]}`;
  return name.toLowerCase();
};

const shortModel = (model: string | undefined): string | null =>
  model ? model.replace(/^claude-/u, '').replace(/-\d{8}$/u, '') : null;

const shortPath = (path: string, cwd: string | null): string => {
  if (cwd && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  const home = /^\/Users\/[^/]+\//u.exec(path);
  return home ? `~/${path.slice(home[0].length)}` : path;
};

const humanBytes = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const lineCount = (text: string): number =>
  text.length === 0 ? 0 : text.split('\n').length;

const patchToDiff = (patch: unknown): { lines: DiffLine[]; omitted: number } | null => {
  if (!Array.isArray(patch)) return null;
  const lines: DiffLine[] = [];
  let omitted = 0;
  for (const hunk of patch) {
    if (!isRecord(hunk) || !Array.isArray(hunk.lines)) continue;
    let oldLine = num(hunk.oldStart) ?? 0;
    let newLine = num(hunk.newStart) ?? 0;
    for (const raw of hunk.lines) {
      if (typeof raw !== 'string') continue;
      const sign = raw[0] === '+' ? '+' : raw[0] === '-' ? '-' : ' ';
      const text = raw.slice(1);
      let number: number | null = null;
      if (sign === '-') number = oldLine++;
      else if (sign === '+') number = newLine++;
      else {
        number = newLine;
        oldLine++;
        newLine++;
      }
      if (lines.length >= MAX_DIFF_LINES) omitted++;
      else lines.push({ number, sign, text });
    }
  }
  return lines.length || omitted ? { lines, omitted } : null;
};

const writeToDiff = (content: string): { lines: DiffLine[]; omitted: number } => {
  const all = content.split('\n');
  const shown = all.slice(0, MAX_DIFF_LINES);
  return {
    lines: shown.map((text, index) => ({ number: index + 1, sign: '+', text })),
    omitted: all.length - shown.length
  };
};

const diffCounts = (diff: DiffLine[] | null, omitted: number) => {
  let added = 0;
  let removed = 0;
  for (const line of diff ?? []) {
    if (line.sign === '+') added++;
    else if (line.sign === '-') removed++;
  }
  return { added: added + (diff?.length ? 0 : omitted), removed };
};

export const outputMeta = (result: NormalizedMessage | null): string => {
  if (!result) return 'no result';
  const toolUseResult = isRecord(result.toolUseResult) ? result.toolUseResult : null;
  const size = humanBytes(result.truncatedFrom ?? result.text.length);
  const lines = lineCount(result.text);
  if (toolUseResult) {
    if (str(toolUseResult.stdout) !== null || str(toolUseResult.stderr) !== null) {
      const parts = [
        str(toolUseResult.stdout) ? 'stdout' : null,
        str(toolUseResult.stderr) ? 'stderr' : null
      ].filter(Boolean);
      return `${parts.join(' + ') || 'output'} · ${lines} ${lines === 1 ? 'line' : 'lines'} · ${size}`;
    }
    const file = isRecord(toolUseResult.file) ? toolUseResult.file : null;
    if (file) {
      const total = num(file.totalLines);
      const shown = num(file.numLines);
      return total !== null && shown !== null && shown < total
        ? `file · ${total} lines · ${shown} shown`
        : `file · ${total ?? lines} lines`;
    }
    const numFiles = num(toolUseResult.numFiles);
    if (numFiles !== null) return `${numFiles} ${numFiles === 1 ? 'file' : 'files'}`;
  }
  if (result.text === '[no output]') return 'no output';
  return `${lines} ${lines === 1 ? 'line' : 'lines'} · ${size}`;
};

const tagForEvent = (message: NormalizedMessage): string => {
  const kind = message.eventKind ?? '';
  if (kind.startsWith('attachment:hook_')) return 'hook';
  if (kind.startsWith('attachment:')) return kind.slice('attachment:'.length).replace(/_/gu, ' ');
  if (kind.startsWith('system:')) return 'system';
  if (kind === 'content:fallback') return 'fallback';
  if (kind.startsWith('unknown:')) return kind.slice('unknown:'.length);
  return message.lineType ?? 'event';
};

const subForEvent = (message: NormalizedMessage): string => {
  const kind = message.eventKind ?? '';
  if (kind.startsWith('system:')) return kind.slice('system:'.length);
  if (kind.startsWith('attachment:')) return kind.slice('attachment:'.length);
  if (kind.startsWith('unknown:')) return 'unrecognised type';
  return message.name ?? '';
};

const errorLabel = (message: NormalizedMessage): string | null => {
  const error = message.errorInfo;
  if (!error) return null;
  if (error.stopReason === 'refusal') return 'refusal';
  if (error.abortedMidStream) return 'aborted';
  if (error.apiErrorStatus) return `${error.apiErrorStatus}`;
  if (error.isApiError) return 'api error';
  return null;
};

const isRealError = (message: NormalizedMessage): boolean => {
  const error = message.errorInfo;
  return Boolean(
    error &&
      (error.isApiError || error.apiErrorStatus || error.abortedMidStream || error.stopReason === 'refusal' || error.message)
  );
};

interface EntryContext {
  cwd: string | null;
  turnOf: Map<string, number>;
  sessionStart: number | null;
}

const baseEntry = (
  message: NormalizedMessage,
  kind: ReaderEntryKind,
  context: EntryContext
): ReaderEntry => ({
  id: message.id,
  kind,
  turnIndex: context.turnOf.get(message.id) ?? 0,
  lineClass: message.lineClass ?? 'read',
  severity: message.severity ?? 'info',
  message,
  result: null,
  folded: [...(message.folded ?? [])],
  at: at(message),
  timeLabel: '',
  clockLabel: '',
  durationMs: null,
  tag: '',
  sub: '',
  badge: null,
  images: [...(message.images ?? [])],
  diff: null,
  diffOmitted: 0,
  gap: null,
  agentId: null,
  agentType: null,
  agentAsk: null
});

const USER_MARK_TAG: Record<string, string> = {
  interrupt: 'interrupt',
  notification: 'notification',
  'command-output': 'local',
  meta: 'meta'
};

/** A mark is one line; anything longer is behind an expand control. */
const MARK_PREVIEW_CHARS = 400;

const buildTextEntry = (message: NormalizedMessage, context: EntryContext): ReaderEntry => {
  const entry = baseEntry(message, message.name === 'image' ? 'image' : 'text', context);
  if (message.role === 'user' && message.lineClass === 'mark') {
    const kind = message.isMeta && userLineKind(message.text) === 'prompt' ? 'meta' : userLineKind(message.text);
    entry.kind = 'event';
    entry.tag = USER_MARK_TAG[kind] ?? 'meta';
    entry.sub =
      kind === 'interrupt'
        ? 'the person stopped the turn'
        : kind === 'notification'
          ? 'background task'
          : kind === 'meta'
            ? `injected context · ${message.promptSource ?? 'system'}`
            : 'local command output';
    entry.severity = kind === 'interrupt' ? 'notice' : 'info';
    const full =
      kind === 'interrupt'
        ? 'Request interrupted by user'
        : kind === 'meta'
          ? message.fullText ?? message.text
          : innerText(message.text) || message.text;
    entry.message =
      full.length > MARK_PREVIEW_CHARS
        ? { ...message, text: `${full.slice(0, MARK_PREVIEW_CHARS - 1)}…`, fullText: full, truncatedFrom: full.length }
        : { ...message, text: full, fullText: undefined, truncatedFrom: undefined };
    return entry;
  }
  if (message.role === 'user') {
    entry.tag = message.isCompactSummary ? 'summary' : message.isMeta ? 'meta' : 'you';
    entry.sub = [
      message.promptSource ?? str(message.raw.entrypoint),
      str(message.raw.permissionMode)
    ]
      .filter(Boolean)
      .join(' · ');
    if (message.interruptedMessageId) entry.badge = 'interrupt';
    if (message.toolDenialKind) entry.badge = `denied ${message.toolDenialKind}`;
  } else if (isRealError(message)) {
    entry.kind = 'event';
    entry.tag = 'api error';
    entry.sub = errorLabel(message) ?? '';
    entry.severity = 'error';
    entry.badge = message.errorInfo?.supersedes?.length ? 'retried' : null;
  } else {
    entry.tag = message.role === 'assistant' ? 'claude' : message.role;
    const out = num(message.usage?.output_tokens);
    entry.sub = [
      shortModel(message.model),
      out !== null ? `${out.toLocaleString()} out` : null,
      message.attribution?.skill ? `skill ${message.attribution.skill}` : null,
      message.attribution?.agent ? `agent ${message.attribution.agent}` : null
    ]
      .filter(Boolean)
      .join(' · ');
    if (message.agentName) entry.sub = `${message.agentName} · ${entry.sub}`;
  }
  return entry;
};

const buildThinkingEntry = (message: NormalizedMessage, context: EntryContext): ReaderEntry => {
  const entry = baseEntry(message, 'thinking', context);
  entry.tag = 'thinking';
  entry.sub =
    message.thinkingTextStored === false
      ? 'text not stored'
      : `summary, ${(message.fullText ?? message.text).length.toLocaleString()} chars`;
  return entry;
};

const buildToolEntry = (
  call: NormalizedMessage,
  result: NormalizedMessage | null,
  context: EntryContext
): ReaderEntry => {
  const name = call.name ?? 'tool';
  const input = isRecord(call.toolInput) ? call.toolInput : {};
  const toolUseResult = isRecord(result?.toolUseResult) ? result.toolUseResult : null;
  const kind: ReaderEntryKind = isAgentCall(call) ? 'agent' : DIFF_TOOLS.has(name) ? 'diff' : 'tool';
  const entry = baseEntry(call, kind, context);
  entry.result = result;
  entry.folded = [...(call.folded ?? []), ...(result?.folded ?? [])];
  entry.images = [...(call.images ?? []), ...(result?.images ?? [])];
  entry.severity = worse(call.severity ?? 'info', result?.severity ?? 'info');
  entry.tag = shortToolName(name);
  const callAt = at(call);
  const resultAt = at(result);
  entry.durationMs = callAt !== null && resultAt !== null ? Math.max(0, resultAt - callAt) : null;

  const filePath = str(input.file_path) ?? str(input.path) ?? str(input.notebook_path);
  if (name === 'Bash') {
    const interpretation = str(toolUseResult?.returnCodeInterpretation);
    entry.sub = result
      ? result.severity === 'warning'
        ? 'failed'
        : interpretation
          ? `exit · ${clip(interpretation, 40)}`
          : toolUseResult?.interrupted === true
            ? 'interrupted'
            : 'exit 0'
      : 'no result';
    if (toolUseResult?.backgroundTaskId) entry.sub = 'background';
  } else if (filePath) {
    entry.sub = shortPath(filePath, context.cwd);
  } else {
    entry.sub = clip(
      str(input.pattern) ?? str(input.query) ?? str(input.url) ?? str(input.description) ?? '',
      80
    );
  }

  if (result?.severity === 'warning' || result?.severity === 'error') entry.badge = 'is_error';
  else if (result?.toolDenialKind) entry.badge = `denied ${result.toolDenialKind}`;
  else if (
    toolUseResult?.persistedOutputPath ||
    /Full output saved to:/u.test(result?.text ?? '')
  ) {
    entry.badge = 'spilled';
  } else if (toolUseResult?.backgroundTaskId) entry.badge = 'background';

  if (kind === 'diff') {
    const patch = patchToDiff(toolUseResult?.structuredPatch);
    const written =
      !patch && name === 'Write' && typeof input.content === 'string'
        ? writeToDiff(input.content)
        : null;
    const diff = patch ?? written;
    entry.diff = diff?.lines ?? null;
    entry.diffOmitted = diff?.omitted ?? 0;
    if (!entry.diff) entry.kind = 'tool';
  }

  if (kind === 'agent') {
    entry.agentType = str(input.subagent_type) ?? str(toolUseResult?.agentType) ?? 'agent';
    entry.agentAsk = str(input.description) ?? clip(str(input.prompt) ?? '', 200);
    entry.agentId = str(toolUseResult?.agentId) ?? str(toolUseResult?.agent_id) ?? null;
    entry.sub = str(input.name) ?? entry.agentType;
  }

  return entry;
};

const buildEventEntry = (message: NormalizedMessage, context: EntryContext): ReaderEntry => {
  const entry = baseEntry(message, message.lineClass === 'unknown' ? 'unknown' : 'event', context);
  entry.tag = tagForEvent(message);
  entry.sub = subForEvent(message);
  if (message.raw.type === 'parse_warning') entry.kind = 'unknown';
  return entry;
};

/** One row per drawn line, tool calls paired with their results, gaps drawn between rows. */
const buildEntries = (
  messages: NormalizedMessage[],
  turns: SessionTurn[],
  cwd: string | null
): ReaderEntry[] => {
  const turnOf = new Map<string, number>();
  for (const turn of turns) for (const row of turn.rows) turnOf.set(row.id, turn.index);
  const context: EntryContext = { cwd, turnOf, sessionStart: firstTime(messages) };

  const resultByToolUseId = new Map<string, NormalizedMessage>();
  for (const message of messages) {
    if (message.channel === 'tool_result' && message.toolUseId && !resultByToolUseId.has(message.toolUseId)) {
      resultByToolUseId.set(message.toolUseId, message);
    }
  }
  const paired = new Set<string>();

  const drafted: ReaderEntry[] = [];
  for (const message of messages) {
    if (message.channel === 'tool_result' && paired.has(message.id)) continue;
    if (message.channel === 'tool_call') {
      const result = message.toolUseId ? resultByToolUseId.get(message.toolUseId) ?? null : null;
      if (result) paired.add(result.id);
      drafted.push(buildToolEntry(message, result, context));
      continue;
    }
    if (message.channel === 'tool_result') {
      drafted.push(buildToolEntry({ ...message, name: message.name ?? 'result' }, null, context));
      continue;
    }
    if (message.channel === 'thinking') {
      drafted.push(buildThinkingEntry(message, context));
      continue;
    }
    if (message.channel === 'event') {
      drafted.push(buildEventEntry(message, context));
      continue;
    }
    drafted.push(buildTextEntry(message, context));
  }

  // Gaps are rows. Everything after the first one carries absolute time.
  const entries: ReaderEntry[] = [];
  let previousAt: number | null = null;
  let afterGap = false;
  const start = context.sessionStart;
  for (const entry of drafted) {
    if (entry.at !== null && previousAt !== null && entry.at - previousAt >= GAP_THRESHOLD_MS) {
      const ms = entry.at - previousAt;
      entries.push({
        ...baseEntry(entry.message as NormalizedMessage, 'gap', context),
        id: `gap:${entry.id}`,
        message: null,
        folded: [],
        images: [],
        lineClass: 'read',
        severity: 'info',
        turnIndex: entry.turnIndex,
        at: previousAt,
        durationMs: ms,
        tag: 'gap',
        sub: '',
        timeLabel: '',
        clockLabel: '',
        gap: { ms, from: formatDayClock(previousAt), to: formatDayClock(entry.at) }
      });
      afterGap = true;
    }
    if (entry.at !== null) {
      entry.clockLabel = formatClock(entry.at);
      entry.timeLabel =
        afterGap || start === null ? entry.clockLabel : formatElapsed(entry.at - start);
      previousAt = entry.at;
    }
    entries.push(entry);
  }

  return entries;
};

// ---------------------------------------------------------------------------
// Bands: one per turn for a long session
// ---------------------------------------------------------------------------

const worstOf = (entries: ReaderEntry[]): Severity =>
  entries.reduce<Severity>((acc, entry) => worse(acc, entry.severity), 'info');

const turnSummary = (entries: ReaderEntry[]): string => {
  const said = entries.find(
    entry => entry.kind === 'text' && entry.message?.role === 'assistant'
  );
  if (said?.message) {
    const first = said.message.text.split('\n').find(line => line.trim()) ?? '';
    return clip(first.replace(/^[#>*-]+\s*/u, ''), 96);
  }
  const tools = entries.filter(entry => entry.kind === 'tool' || entry.kind === 'diff' || entry.kind === 'agent');
  if (tools.length) {
    const names = new Map<string, number>();
    for (const tool of tools) names.set(tool.tag, (names.get(tool.tag) ?? 0) + 1);
    const top = [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return `${tools.length} tool ${tools.length === 1 ? 'call' : 'calls'} · ${top.map(([name, count]) => `${name} ×${count}`).join(', ')}`;
  }
  const event = entries.find(entry => entry.kind === 'event' || entry.kind === 'unknown');
  return event?.message ? clip(event.message.text, 96) : 'no rows';
};

const bandMarks = (entries: ReaderEntry[]): SessionBandMark[] => {
  const marks: SessionBandMark[] = [];
  const tools = entries.filter(entry => entry.kind === 'tool' || entry.kind === 'diff').length;
  const agents = entries.filter(entry => entry.kind === 'agent').length;
  const edits = entries.filter(entry => entry.kind === 'diff').length;
  const trouble = entries.filter(entry => entry.severity === 'warning' || entry.severity === 'error').length;
  if (tools) marks.push({ text: `${tools} ${tools === 1 ? 'tool' : 'tools'}`, tone: 'tool' });
  if (edits) marks.push({ text: `${edits} ${edits === 1 ? 'edit' : 'edits'}`, tone: 'edit' });
  if (agents) marks.push({ text: `${agents} ${agents === 1 ? 'agent' : 'agents'}`, tone: 'agent' });
  if (trouble) marks.push({ text: `${trouble} trouble`, tone: 'trouble' });
  if (entries.some(entry => entry.badge === 'spilled')) marks.push({ text: 'spill', tone: 'link' });
  if (entries.some(entry => entry.message?.eventKind === 'system:compact_boundary')) {
    marks.push({ text: 'compact', tone: 'mark' });
  }
  if (entries.some(entry => entry.message?.eventKind?.startsWith('attachment:hook_blocking_error'))) {
    marks.push({ text: 'hook blocked', tone: 'trouble' });
  }
  if (entries.some(entry => entry.tag === 'interrupt')) marks.push({ text: 'interrupt', tone: 'mark' });
  for (const entry of entries) {
    if (entry.message?.lineType === 'pr-link') marks.push({ text: 'pr-link', tone: 'link' });
  }
  return marks;
};

const buildBands = (turns: SessionTurn[], entries: ReaderEntry[]): SessionBand[] => {
  const bands: SessionBand[] = [];
  const byTurn = new Map<number, ReaderEntry[]>();
  for (const entry of entries) {
    const list = byTurn.get(entry.turnIndex);
    if (list) list.push(entry);
    else byTurn.set(entry.turnIndex, [entry]);
  }

  for (const turn of turns) {
    const own = byTurn.get(turn.index) ?? [];
    const gaps = own.filter(entry => entry.kind === 'gap');
    for (const gap of gaps) {
      bands.push({
        turnIndex: turn.index,
        tag: 'gap',
        label: `${formatDuration(gap.gap?.ms ?? 0)} — no lines written`,
        timeLabel: gap.gap?.from ?? '',
        durationMs: gap.gap?.ms ?? null,
        severity: 'info',
        hasAgents: false,
        marks: [],
        entries: [gap]
      });
    }
    const rows = own.filter(entry => entry.kind !== 'gap');
    const opener = rows.find(entry => entry.kind === 'text' && entry.message?.role === 'user' && entry.tag === 'you');
    if (opener) {
      bands.push({
        turnIndex: turn.index,
        tag: 'you',
        label: promptLabel(opener.message?.text ?? '', 110),
        timeLabel: opener.timeLabel,
        durationMs: null,
        severity: 'info',
        hasAgents: false,
        marks: turn.interrupted ? [{ text: 'interrupt', tone: 'mark' }] : [],
        entries: [opener]
      });
    }
    const rest = rows.filter(entry => entry !== opener);
    if (rest.length) {
      bands.push({
        turnIndex: turn.index,
        tag: 'turn',
        label: turnSummary(rest),
        timeLabel: rest[0].timeLabel,
        durationMs: turn.durationMs,
        severity: worstOf(rest),
        hasAgents: rest.some(entry => entry.kind === 'agent'),
        marks: bandMarks(rest),
        entries: rest
      });
    }
  }
  return bands;
};

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

const LATCHED: Array<[type: string, key: string]> = [
  ['mode', 'mode'],
  ['permission-mode', 'permissionMode'],
  ['ai-title', 'aiTitle'],
  ['custom-title', 'customTitle'],
  ['last-prompt', 'lastPrompt'],
  ['atis-latch', 'atisLatch'],
  ['agent-setting', 'agentSetting'],
  ['agent-name', 'agentName']
];

const buildState = (folded: NormalizedMessage[]): SessionStateEntry[] => {
  const state: SessionStateEntry[] = [];
  for (const [type, key] of LATCHED) {
    const writes = folded.filter(line => line.lineType === type);
    if (writes.length === 0) continue;
    let changes = 0;
    for (let index = 1; index < writes.length; index++) {
      if (writes[index].text !== writes[index - 1].text) changes++;
    }
    state.push({ key, value: clip(writes[writes.length - 1].text, 80), writes: writes.length, changes });
  }
  return state;
};

const buildFiles = (
  entries: ReaderEntry[],
  folded: NormalizedMessage[],
  cwd: string | null
): SessionFileChange[] => {
  const files = new Map<string, SessionFileChange>();
  const touch = (path: string) => {
    const short = shortPath(path, cwd);
    const existing = files.get(short);
    if (existing) return existing;
    const entry = { path: short, added: 0, removed: 0, edits: 0 };
    files.set(short, entry);
    return entry;
  };
  for (const entry of entries) {
    if (entry.kind !== 'diff' && !(entry.kind === 'tool' && DIFF_TOOLS.has(entry.message?.name ?? ''))) continue;
    const input = isRecord(entry.message?.toolInput) ? entry.message.toolInput : {};
    const path = str(input.file_path) ?? str(input.notebook_path);
    if (!path) continue;
    const file = touch(path);
    const counts = diffCounts(entry.diff, entry.diffOmitted);
    file.added += counts.added;
    file.removed += counts.removed;
    file.edits += 1;
  }
  const deltas = new Map<string, number>();
  for (const line of folded) {
    if (line.lineType !== 'file-history-delta') continue;
    const path = str(line.raw.trackingPath);
    if (!path) continue;
    deltas.set(path, (deltas.get(path) ?? 0) + 1);
  }
  for (const [path, count] of deltas) {
    const short = shortPath(path, cwd);
    if (!files.has(short)) files.set(short, { path: short, added: 0, removed: 0, edits: count });
  }
  return [...files.values()].sort((a, b) => b.edits - a.edits || a.path.localeCompare(b.path));
};

const TOKENS_LEFT = /<total_tokens>(\d+)\s*tokens left<\/total_tokens>/u;

const buildContext = (lines: NormalizedMessage[]): SessionContextPoint[] => {
  const points: SessionContextPoint[] = [];
  for (const line of lines) {
    if (line.eventKind !== 'attachment:total_tokens_reminder') continue;
    const attachment = isRecord(line.raw.attachment) ? line.raw.attachment : {};
    const match = TOKENS_LEFT.exec(str(attachment.text) ?? '');
    if (!match) continue;
    points.push({ at: at(line), tokens: Number(match[1]), hostId: line.hostId ?? null });
  }
  return points;
};

const buildCrumbs = (conversation: NormalizedConversation, startedAt: number | null): SessionCrumbs => {
  const fields = isRecord(conversation.metadata.claudeFields) ? conversation.metadata.claudeFields : {};
  const last = (value: unknown): string | null =>
    Array.isArray(value) && value.length ? str(value[value.length - 1]) : null;
  const first = (value: unknown): string | null =>
    Array.isArray(value) && value.length ? str(value[0]) : null;
  return {
    sessionId: conversation.sessionId,
    cwd: first(fields.cwd),
    branch: last(fields.gitBranches),
    version: last(fields.versions),
    entrypoint: first(fields.entrypoints),
    startedAt
  };
};

// ---------------------------------------------------------------------------
// Folds: everything that drew no row, and where it went
// ---------------------------------------------------------------------------

const allFolded = (
  messages: NormalizedMessage[],
  panel: NormalizedMessage[]
): NormalizedMessage[] => {
  const lines: NormalizedMessage[] = [];
  for (const message of messages) {
    for (const line of message.folded ?? []) lines.push(line);
  }
  lines.push(...panel);
  return lines;
};

const payloadOf = (line: NormalizedMessage): string => clip(line.text, 160);

const rawBytes = (line: NormalizedMessage): number => {
  try {
    return JSON.stringify(line.raw).length;
  } catch {
    return 0;
  }
};

const buildFolds = (
  messages: NormalizedMessage[],
  panel: NormalizedMessage[],
  entries: ReaderEntry[],
  sessionStart: number | null
): FoldedType[] => {
  const hostLabel = new Map<string, string>();
  for (const entry of entries) {
    const text = `${entry.tag}${entry.sub ? ` · ${clip(entry.sub, 40)}` : ''}`;
    if (entry.message) hostLabel.set(entry.message.id, text);
    if (entry.result) hostLabel.set(entry.result.id, text);
  }

  const groups = new Map<string, { lineClass: LineClass; disposition: FoldDisposition; items: FoldedItem[] }>();
  for (const line of allFolded(messages, panel)) {
    const key = typeNameOf(line);
    const time = at(line);
    const item: FoldedItem = {
      message: line,
      hostId: line.hostId ?? null,
      hostLabel: line.hostId ? hostLabel.get(line.hostId) ?? line.hostId : '(no host row)',
      at: time !== null && sessionStart !== null ? formatElapsed(time - sessionStart) : '',
      payload: payloadOf(line),
      bytes: rawBytes(line)
    };
    const group = groups.get(key);
    if (group) group.items.push(item);
    else {
      groups.set(key, {
        lineClass: line.lineClass ?? 'unknown',
        disposition: line.disposition ?? 'panel',
        items: [item]
      });
    }
  }

  return [...groups.entries()]
    .map(([key, group]) => ({ key, count: group.items.length, ...group }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
};

export const foldNote = (fold: FoldedType): string => noteForType(fold.key, fold.disposition);

// ---------------------------------------------------------------------------
// Ledger, trouble, outcome, timing
// ---------------------------------------------------------------------------

/**
 * Accounts for every line in the file. Rows and lines are different units: one
 * line can draw several rows, and one row can stand for several lines, so both
 * are reported and only lines are summed.
 */
const buildLedger = (
  conversation: NormalizedConversation,
  parsedLines: number,
  rowCount: number
): SessionLedger => {
  const drawn = new Set<object>();
  const folded = new Set<object>();
  const unrecognisedTypes = new Map<string, number>();

  const counted = new Set<object>();
  const note = (message: NormalizedMessage, into: Set<object>) => {
    into.add(message.raw);
    const kind = message.eventKind;
    if (kind?.startsWith('unknown:') && !counted.has(message.raw)) {
      counted.add(message.raw);
      const type = kind.slice('unknown:'.length);
      unrecognisedTypes.set(type, (unrecognisedTypes.get(type) ?? 0) + 1);
    }
  };

  for (const message of conversation.messages) {
    note(message, drawn);
    for (const member of message.groupedMessages ?? []) note(member, folded);
    for (const line of message.folded ?? []) note(line, folded);
  }
  for (const line of conversation.folded) note(line, folded);

  // A group's own leader is in both sets; it was drawn, so it is not folded.
  let foldedLines = 0;
  for (const raw of folded) if (!drawn.has(raw)) foldedLines++;

  const drawnLines = drawn.size;
  const malformedLines = conversation.malformed.length;

  return {
    parsedLines,
    drawnLines,
    rowCount,
    foldedLines,
    malformedLines,
    unaccountedLines: parsedLines - drawnLines - foldedLines - malformedLines,
    unrecognisedTypes: [...unrecognisedTypes.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([type, count]) => ({ type, count })),
    outOfOrderLines: conversation.outOfOrderLines
  };
};

const buildTrouble = (conversation: NormalizedConversation): SessionTrouble => {
  let apiErrors = 0;
  let refusals = 0;
  let hooksBlocked = 0;
  let toolFailures = 0;

  const rows: NormalizedMessage[] = [];
  for (const message of conversation.messages) {
    rows.push(message, ...(message.groupedMessages ?? []), ...(message.folded ?? []));
  }
  rows.push(...conversation.folded);

  for (const row of rows) {
    if (row.errorInfo?.stopReason === 'refusal') refusals++;
    else if (row.eventKind?.startsWith('system:model_refusal')) refusals++;
    else if (row.errorInfo?.isApiError || row.errorInfo?.apiErrorStatus) apiErrors++;
    if (row.eventKind === 'attachment:hook_blocking_error') hooksBlocked++;
    if (row.channel === 'tool_result' && row.severity === 'warning') toolFailures++;
  }

  return {
    total: apiErrors + refusals + hooksBlocked + toolFailures,
    apiErrors,
    refusals,
    hooksBlocked,
    toolFailures
  };
};

/**
 * How the session ended, and where. `interruptedMessageId` is the only
 * unambiguous interrupt marker in the transcript; everything else is inferred
 * from the last conversational row, so it is reported as `incomplete` rather
 * than guessed at.
 */
const buildOutcome = (
  messages: NormalizedMessage[],
  turns: SessionTurn[]
): SessionOutcome => {
  const interruptTurn = turns.find(turn => turn.interrupted);
  if (interruptTurn) {
    return {
      state: 'interrupted',
      atTurn: interruptTurn.index,
      turnCount: turns.length
    };
  }

  const conversational = messages.filter(
    message =>
      message.channel === 'message' ||
      message.channel === 'tool_call' ||
      message.channel === 'tool_result'
  );
  const last = conversational[conversational.length - 1];

  if (last?.role === 'assistant' && last.channel === 'message') {
    return { state: 'finished', atTurn: turns.length, turnCount: turns.length };
  }

  return { state: 'incomplete', atTurn: turns.length, turnCount: turns.length };
};

/**
 * Wall clock is the span from first to last line. Active time excludes the
 * gaps, which is what separates a session that ran for two hours from one that
 * sat open for two days. Stretches map any timestamp to active time.
 */
const buildTiming = (entries: ReaderEntry[]): SessionTiming => {
  const times = entries.map(entry => entry.at).filter((time): time is number => time !== null);
  const start = times.length ? times[0] : null;
  const end = times.length ? times[times.length - 1] : null;

  const stretches: SessionStretch[] = [];
  let idleMs = 0;
  let stretchStart = start;
  let activeStart = 0;
  for (const entry of entries) {
    if (entry.kind !== 'gap' || entry.at === null || entry.gap === null) continue;
    if (stretchStart !== null) {
      stretches.push({ start: stretchStart, end: entry.at, activeStart });
      activeStart += entry.at - stretchStart;
    }
    idleMs += entry.gap.ms;
    stretchStart = entry.at + entry.gap.ms;
  }
  if (stretchStart !== null && end !== null) {
    stretches.push({ start: stretchStart, end: Math.max(end, stretchStart), activeStart });
  }

  const wallMs = start !== null && end !== null ? end - start : null;
  return {
    startedAt: start,
    endedAt: end,
    wallMs,
    idleMs,
    activeMs: wallMs === null ? null : Math.max(0, wallMs - idleMs),
    stretches
  };
};

/** Active milliseconds elapsed at `time`, skipping the gaps. */
export const activeOffset = (timing: SessionTiming, time: number): number => {
  let offset = 0;
  for (const stretch of timing.stretches) {
    if (time < stretch.start) return stretch.activeStart;
    if (time <= stretch.end) return stretch.activeStart + (time - stretch.start);
    offset = stretch.activeStart + (stretch.end - stretch.start);
  }
  return offset;
};

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export const buildSessionView = (
  parseResult: ClaudeSessionParseResult,
  parsedLines: number
): SessionView => {
  const conversation = parseResult.conversation;
  const messages = conversation.messages;
  const turns = buildTurns(messages);
  const timingStart = firstTime(messages);
  const crumbs = buildCrumbs(conversation, timingStart);
  const entries = buildEntries(messages, turns, crumbs.cwd);
  const rowCount = entries.filter(entry => entry.kind !== 'gap').length;
  const contextLines = allFolded(messages, conversation.folded);

  return {
    turns,
    entries,
    bands: buildBands(turns, entries),
    panels: {
      state: buildState(conversation.folded),
      files: buildFiles(entries, conversation.folded, crumbs.cwd),
      context: buildContext(contextLines),
      crumbs
    },
    folds: buildFolds(messages, conversation.folded, entries, timingStart),
    ledger: buildLedger(conversation, parsedLines, rowCount),
    trouble: buildTrouble(conversation),
    outcome: buildOutcome(messages, turns),
    timing: buildTiming(entries)
  };
};

/** The images a row can decode, for a renderer that holds one at a time. */
export const entryImages = (entry: ReaderEntry): MessageImage[] => entry.images;

export type { SessionPanels };
