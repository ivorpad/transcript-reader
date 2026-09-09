import { buildFleet, journalFromLines, type JournalRecord, type LinkedAgentRecord } from '../adapters/claude/fleet';
import {
  isClaudeSessionJSONL,
  parseClaudeSession
} from '../adapters/claude/parser';
import { buildSessionView } from '../adapters/claude/session';
import type {
  ClaudeMetaSummary,
  ClaudeSessionParseResult,
  FleetView,
  NormalizedConversation,
  SessionView
} from '../types/reader';

export interface LoadedTextFile {
  /** Full path when the browser supplies one, so same-named files stay apart. */
  name: string;
  text: string;
}

/**
 * `webkitRelativePath` is set for a directory pick and empty otherwise. Keying
 * on `file.name` alone collides: every Claude project directory holds a
 * `<sessionId>.jsonl`, and subagent transcripts repeat across sessions.
 */
export const readLoadedFile = async (
  file: File & { webkitRelativePath?: string }
): Promise<LoadedTextFile> => ({
  name: file.webkitRelativePath || file.name,
  text: await file.text()
});

/** The directory-relative stem a `.jsonl` and its `.meta.json` share. */
export const pairingStem = (name: string): string =>
  name.replace(/\.meta\.json$/u, '').replace(/\.jsonl$/u, '');

export const baseName = (name: string): string => name.split('/').pop() ?? name;

export const parseJSONLText = (text: string): unknown[] =>
  text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return line;
      }
    });

const safeParseJSON = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

export interface LoadedRecord {
  key: string;
  fileName: string;
  fileText: string;
  lineCount: number;
  conversation: NormalizedConversation;
  parseResult: ClaudeSessionParseResult;
  view: SessionView;
  meta: ClaudeMetaSummary | null;
  /** Key of the conversation whose Agent call spawned this one, if loaded. */
  parentKey?: string;
  /** The parent tool call this subagent hangs off. */
  parentToolUseId?: string;
  /** A workflow journal: only `started` and `result` lines. */
  isJournal: boolean;
}

const parseConversationFiles = (
  files: LoadedTextFile[],
  parsedMetaFiles: Array<{ name: string; raw: Record<string, unknown> }>
): LoadedRecord[] => {
  const parsedMetaByStem = new Map(
    parsedMetaFiles.map(file => [pairingStem(file.name), file.raw])
  );
  const fallbackMeta =
    files.filter(file => file.name.endsWith('.jsonl')).length === 1 &&
    parsedMetaFiles.length === 1
      ? parsedMetaFiles[0]?.raw
      : undefined;

  return files
    .filter(file => file.name.endsWith('.jsonl'))
    .flatMap(file => {
      const sessionLines = parseJSONLText(file.text);
      if (!isClaudeSessionJSONL(sessionLines)) return [];

      const stem = pairingStem(file.name);
      const matchedMetaFile = parsedMetaFiles.find(
        candidate => pairingStem(candidate.name) === stem
      );
      const matchedMeta = parsedMetaByStem.get(stem) ?? fallbackMeta;
      const parseResult = parseClaudeSession(
        sessionLines,
        matchedMeta,
        matchedMetaFile?.name ?? file.name
      );
      if (!parseResult) return [];

      const conversation = parseResult.conversation;
      const messages = conversation.messages;
      const isJournal =
        messages.length > 0 &&
        messages.every(message => message.lineType === 'started' || message.lineType === 'result');

      return [
        {
          key: `${file.name}:${conversation.sessionId ?? conversation.id}`,
          fileName: file.name,
          fileText: file.text,
          lineCount: sessionLines.length,
          conversation,
          parseResult,
          view: buildSessionView(parseResult, sessionLines.length),
          meta: (conversation.metadata.importedMeta as ClaudeMetaSummary | null) ?? null,
          isJournal
        }
      ];
    });
};

/**
 * `<sessionId>/custom-title.json` sits beside the transcript and names the
 * session.
 */
const applyTitleSidecars = (
  records: LoadedRecord[],
  files: LoadedTextFile[]
): LoadedRecord[] => {
  const titleByDir = new Map<string, string>();
  for (const file of files) {
    if (!file.name.endsWith('custom-title.json')) continue;
    const parsed = safeParseJSON(file.text);
    const title =
      typeof parsed === 'string'
        ? parsed
        : typeof (parsed as { customTitle?: unknown })?.customTitle === 'string'
          ? (parsed as { customTitle: string }).customTitle
          : null;
    if (!title) continue;
    titleByDir.set(file.name.replace(/\/custom-title\.json$/u, ''), title);
  }
  if (titleByDir.size === 0) return records;

  return records.map(record => {
    const title = titleByDir.get(pairingStem(record.fileName));
    return title
      ? { ...record, conversation: { ...record.conversation, title } }
      : record;
  });
};

/**
 * A `.meta.json` names the parent's `Task` tool_use id. That is the only link
 * between a subagent transcript and the call that spawned it.
 */
const linkSubagents = (records: LoadedRecord[]): LoadedRecord[] => {
  const ownerByToolUseId = new Map<string, string>();
  for (const record of records) {
    for (const message of record.conversation.messages) {
      if (message.channel === 'tool_call' && message.toolUseId) {
        ownerByToolUseId.set(message.toolUseId, record.key);
      }
    }
  }

  return records.map(record => {
    const toolUseId = record.meta?.toolUseId;
    const parentKey = toolUseId ? ownerByToolUseId.get(toolUseId) : undefined;
    return parentKey && parentKey !== record.key
      ? { ...record, parentKey, parentToolUseId: toolUseId ?? undefined }
      : record;
  });
};

/**
 * A large tool result is written to `<sessionId>/tool-results/<id>.txt` and
 * referenced from the transcript. When that file is loaded too, put the real
 * output back on the row instead of leaving a path.
 */
const resolveSpilledOutput = (
  records: LoadedRecord[],
  spilledOutput: Map<string, string>
): LoadedRecord[] => {
  if (spilledOutput.size === 0) return records;
  const reference = /saved to:\s*(\S+?\/tool-results\/(\S+?))(?:\s|$)/u;

  return records.map(record => {
    let touched = false;
    const messages = record.conversation.messages.map(message => {
      const match = reference.exec(message.text);
      const spilled = match ? spilledOutput.get(match[2]) : undefined;
      if (!spilled) return message;
      touched = true;
      const full = `${message.fullText ?? message.text}\n\n${spilled}`;
      return {
        ...message,
        text: full.length > 50_000 ? `${full.slice(0, 49_999)}…` : full,
        truncatedFrom: full.length > 50_000 ? full.length : undefined,
        fullText: full.length > 50_000 ? full : undefined
      };
    });
    if (!touched) return record;
    const conversation = { ...record.conversation, messages };
    const parseResult = { ...record.parseResult, conversation };
    return {
      ...record,
      conversation,
      parseResult,
      view: buildSessionView(parseResult, record.lineCount)
    };
  });
};

/** Every file dropped, turned into linked records with their views built. */
export const buildRecords = (files: LoadedTextFile[]): LoadedRecord[] => {
  const parsedMetaFiles = files
    .filter(file => file.name.endsWith('.meta.json'))
    .map(file => ({ name: file.name, raw: safeParseJSON(file.text) }))
    .filter(
      (file): file is { name: string; raw: Record<string, unknown> } =>
        file.raw !== null && typeof file.raw === 'object'
    );
  const spilledOutput = new Map(
    files
      .filter(file => file.name.includes('tool-results/'))
      .map(file => [baseName(file.name), file.text])
  );

  return linkSubagents(
    applyTitleSidecars(
      resolveSpilledOutput(parseConversationFiles(files, parsedMetaFiles), spilledOutput),
      files
    )
  );
};

export const rootRecords = (records: LoadedRecord[]): LoadedRecord[] =>
  records.filter(record => !record.parentKey && !record.isJournal);

export const childrenOf = (records: LoadedRecord[], key: string): LoadedRecord[] =>
  records.filter(record => record.parentKey === key);

const journalsUnder = (records: LoadedRecord[], record: LoadedRecord): JournalRecord => {
  const prefix = `${pairingStem(record.fileName)}/`;
  const started = new Set<string>();
  const finished = new Set<string>();
  for (const candidate of records) {
    if (!candidate.isJournal || !candidate.fileName.startsWith(prefix)) continue;
    const journal = journalFromLines(parseJSONLText(candidate.fileText));
    for (const id of journal.started) started.add(id);
    for (const id of journal.finished) finished.add(id);
  }
  return { started, finished };
};

/**
 * The fleet of a session: its Agent calls, enriched by whatever else was
 * loaded. An agent whose transcript was loaded may have spawned agents of its
 * own; those follow it in the list at their depth, so the tree reads top down.
 */
export const fleetFor = (
  records: LoadedRecord[],
  record: LoadedRecord,
  seen = new Set<string>()
): FleetView => {
  seen.add(record.key);
  const children = childrenOf(records, record.key);
  const linked: LinkedAgentRecord[] = children.map(child => ({
    recordKey: child.key,
    toolUseId: child.parentToolUseId ?? child.meta?.toolUseId ?? null,
    agentId: child.meta?.agentId ?? null,
    meta: child.meta,
    view: child.view,
    costUSD: child.conversation.cost?.totalCostUSD ?? null,
    rowCount: child.view.ledger.rowCount
  }));
  const depth = record.meta?.spawnDepth ?? 0;
  const own = buildFleet(record.view, linked, journalsUnder(records, record), depth);

  const agents = own.agents.flatMap(agent => {
    const child = agent.recordKey ? children.find(candidate => candidate.key === agent.recordKey) : undefined;
    if (!child || seen.has(child.key)) return [agent];
    return [agent, ...fleetFor(records, child, seen).agents];
  });
  return { agents };
};

/** The parsed meta of a record, for the header of a subagent transcript. */
export const spawnLine = (records: LoadedRecord[], record: LoadedRecord): string | null => {
  if (!record.parentKey) return null;
  const parent = records.find(candidate => candidate.key === record.parentKey);
  const meta = record.meta;
  const parts = [
    parent ? `spawned by ${parent.conversation.title}` : 'spawned subagent',
    meta?.agentType ?? null,
    meta?.spawnDepth !== null && meta?.spawnDepth !== undefined ? `depth ${meta.spawnDepth}` : null,
    meta?.isFork ? 'fork' : null,
    meta?.worktreeBranch ? `worktree ${meta.worktreeBranch}` : null,
    meta?.stoppedByUser ? 'stopped by user' : null
  ].filter((part): part is string => Boolean(part));
  return parts.join(' · ');
};
