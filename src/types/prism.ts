export type PrismSource = 'claude-session';

export type PrismRole = 'user' | 'assistant' | 'system' | 'tool' | 'meta';

export type PrismSeverity = 'info' | 'notice' | 'warning' | 'error';

/**
 * The five reading classes. Every line type has one, and the class is a
 * lookup, so a type the reader has never seen falls to `unknown` rather than
 * breaking the page.
 */
export type LineClass = 'read' | 'fold' | 'mark' | 'panel' | 'unknown';

/**
 * Where a line goes when it does not draw a row of its own: folded onto the
 * row it names or follows, into a panel, a row of its own after all, or a
 * low-contrast mark in sequence.
 */
export type FoldDisposition = 'row' | 'panel' | 'own-row' | 'mark';

/** Which agent, skill, plugin or MCP tool a turn is attributable to. */
export interface PrismAttribution {
  agent?: string;
  skill?: string;
  plugin?: string;
  mcpServer?: string;
  mcpTool?: string;
}

/** Why an assistant turn failed, refused or was cut short. */
export interface PrismErrorInfo {
  isApiError?: boolean;
  apiErrorStatus?: string;
  message?: string;
  details?: unknown;
  abortedMidStream?: boolean;
  stopReason?: string;
  quotaLimits?: unknown;
  supersedes?: string[];
}

/** An image carried by a message, ready to put in an `<img src>`. */
export interface PrismImage {
  url: string;
  mediaType: string;
  /** Bytes of the decoded payload, when it came in as base64. */
  bytes?: number;
}

export type PrismChannel =
  | 'message'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'event';

export type ClaudeSessionLineType =
  // Observed across ~/.claude/projects for Claude Code 2.1.197 - 2.1.263.
  | 'user'
  | 'assistant'
  | 'attachment'
  | 'system'
  | 'last-prompt'
  | 'mode'
  | 'ai-title'
  | 'custom-title'
  | 'permission-mode'
  | 'atis-latch'
  | 'queue-operation'
  | 'file-history-snapshot'
  | 'file-history-delta'
  | 'agent-setting'
  | 'agent-name'
  | 'bridge-session'
  | 'relocated'
  | 'worktree-state'
  | 'started'
  | 'result'
  | 'cost-state'
  | 'frame-link'
  | 'pr-link'
  | 'artifact-autoreact-ledger'
  | 'artifact-comment-monitor'
  | 'history-suppression'
  | 'fork-context-ref'
  // Legacy: present in older transcripts, absent from the current corpus.
  | 'summary'
  | 'progress'
  | 'tag'
  | 'agent-color'
  | 'attribution-snapshot'
  | 'content-replacement'
  | 'marble-origami-commit'
  | 'marble-origami-snapshot'
  | 'turn_duration'
  // Anything Claude Code adds after this list was written.
  | string;

export interface NormalizedMessage {
  id: string;
  role: PrismRole;
  channel: PrismChannel;
  text: string;
  timestamp: string | null;
  /** Zero-based position of the source line in the file. */
  lineIndex: number;
  lineType?: ClaudeSessionLineType;
  /** What kind of non-conversational line this is, e.g. `attachment:hook_success`. */
  eventKind?: string;
  severity?: PrismSeverity;
  /** Reading class from the catalog. Decides whether the line draws a row. */
  lineClass?: LineClass;
  /** Where the line went when it drew no row of its own. */
  disposition?: FoldDisposition;
  /** >1 when this row stands for a collapsed run of identical events. */
  groupCount?: number;
  /** The rows a collapsed group stands for, for expansion in the reader. */
  groupedMessages?: NormalizedMessage[];
  /**
   * Lines folded onto this row: the hooks that fired for the tool call, the
   * reminders and notices written right after it. They never draw a row of
   * their own; the row carries their count.
   */
  folded?: NormalizedMessage[];
  /** For a folded line, the id of the row it was folded onto. */
  hostId?: string;
  /** Images carried by this message, kept out of `text` so no base64 is rendered. */
  images?: PrismImage[];
  /** Set when `text` was cut for rendering; holds the original length. */
  truncatedFrom?: number;
  /** The untruncated text, for an expand control. */
  fullText?: string;
  /** `caller` on a tool_use block, e.g. `direct`. */
  toolCaller?: string;
  /** `signature` on a thinking block. */
  thinkingSignature?: string;
  /**
   * False when a thinking block carried a signature but no text. Claude Code
   * stores the signature so the block can be replayed to the API and drops the
   * text: 0.1% of `apiBlockIndex` 0 blocks have any. Not the same as the model
   * having thought nothing.
   */
  thinkingTextStored?: boolean;
  /** Which agent, skill, plugin or MCP tool produced this assistant turn. */
  attribution?: PrismAttribution;
  /** Reasoning effort recorded on the assistant line. */
  effort?: string;
  /** Team and agent identity, present once a session runs teammates. */
  agentName?: string;
  teamName?: string;
  /** How the user's turn arrived: typed, system, sdk, queued, suggestion_accepted. */
  promptSource?: string;
  promptId?: string;
  /** Set when a tool call was denied, naming the kind of denial. */
  toolDenialKind?: string;
  /** Present when the person interrupted the turn this line belongs to. */
  interruptedMessageId?: string;
  /** Assistant error state, when the turn did not complete normally. */
  errorInfo?: PrismErrorInfo;
  uuid?: string;
  sessionId?: string | null;
  name?: string;
  recipient?: string;
  isSidechain: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  isVisibleInTranscriptOnly?: boolean;
  parentUuid: string | null;
  agentId?: string;
  slug?: string;
  requestId?: string;
  model?: string;
  toolUseId?: string;
  parentToolUseId?: string;
  sourceToolAssistantUUID?: string;
  toolUseResult?: unknown;
  /** The tool call's input, kept structured for renderers that need a field. */
  toolInput?: unknown;
  usage?: Record<string, unknown>;
  raw: Record<string, unknown>;
}

/** The session's own cost and duration accounting, from the `cost-state` line. */
export interface ClaudeSessionCost {
  totalCostUSD: number | null;
  totalDurationMs: number | null;
  totalApiDurationMs: number | null;
  totalToolDurationMs: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  hasUnknownModelCost: boolean;
  modelUsage: Array<{
    model: string;
    costUSD: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadInputTokens: number | null;
    cacheCreationInputTokens: number | null;
    webSearchRequests: number | null;
  }>;
}

export interface NormalizedConversation {
  id: string;
  source: PrismSource;
  sessionId: string | null;
  title: string;
  startedAt: string | null;
  /** Null when the session carries no `cost-state` line. */
  cost: ClaudeSessionCost | null;
  /** The rows drawn in sequence, in write order. */
  messages: NormalizedMessage[];
  /**
   * Lines routed to a panel rather than a row: latched state, file history,
   * listings, reminders. Every one is reachable from the Folded view.
   */
  folded: NormalizedMessage[];
  /** Lines that could not be parsed. Counted in the ledger, never drawn. */
  malformed: NormalizedMessage[];
  /**
   * Lines whose timestamp precedes the timestamped line written before them.
   * Rows are drawn in write order; this says how far that is from time order.
   */
  outOfOrderLines: number;
  metadata: Record<string, unknown>;
}

export interface ClaudeSessionStats {
  totalMessages: number;
  toolCalls: number;
  toolResults: number;
  eventMessages: number;
  thinkingMessages: number;
  summaryMessages: number;
  fileSnapshots: number;
  queueOperations: number;
  progressEvents: number;
  compactBoundaries: number;
  branchPoints: number;
  conversationBranchPoints: number;
  progressForks: number;
  titleEvents: number;
  metadataEvents: number;
  malformedLines: number;
  hasSidechain: boolean;
  hasCompact: boolean;
  hasToolUseResult: boolean;
}

/** One prompt and everything that followed it, up to the next prompt. */
export interface SessionTurn {
  index: number;
  label: string;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
  /** Quiet stretch before this turn opened, when it is long enough to draw. */
  gapBeforeMs: number | null;
  rowCount: number;
  toolCount: number;
  troubleCount: number;
  agentCount: number;
  /** Set when the person interrupted this turn. */
  interrupted: boolean;
  rows: NormalizedMessage[];
}

/**
 * Accounts for every line in the file. Lines and rows are different units and
 * are never added together: `drawnLines + foldedLines + malformedLines` equals
 * `parsedLines`, while `rowCount` reports how many rows those drawn lines made.
 */
export interface SessionLedger {
  parsedLines: number;
  drawnLines: number;
  rowCount: number;
  foldedLines: number;
  malformedLines: number;
  /** Zero when the ledger balances. Anything else is a bug worth surfacing. */
  unaccountedLines: number;
  unrecognisedTypes: Array<{ type: string; count: number }>;
  /** Lines the parser drew in write order that are out of timestamp order. */
  outOfOrderLines: number;
}

export interface SessionTrouble {
  total: number;
  apiErrors: number;
  refusals: number;
  hooksBlocked: number;
  toolFailures: number;
}

export interface SessionOutcome {
  state: 'finished' | 'interrupted' | 'incomplete';
  atTurn: number;
  turnCount: number;
}

/** A stretch of work between two gaps, in wall-clock and in active time. */
export interface SessionStretch {
  start: number;
  end: number;
  /** Active milliseconds elapsed before this stretch began. */
  activeStart: number;
}

export interface SessionTiming {
  startedAt: number | null;
  endedAt: number | null;
  wallMs: number | null;
  idleMs: number;
  activeMs: number | null;
  stretches: SessionStretch[];
}

export type ReaderEntryKind =
  | 'text'
  | 'thinking'
  | 'tool'
  | 'agent'
  | 'diff'
  | 'image'
  | 'event'
  | 'unknown'
  | 'gap';

export interface DiffLine {
  number: number | null;
  sign: ' ' | '+' | '-';
  text: string;
}

/**
 * One row of the reader. A tool call and its result are one row; a gap
 * between two lines is a row; a folded line is never a row.
 */
export interface ReaderEntry {
  id: string;
  kind: ReaderEntryKind;
  turnIndex: number;
  lineClass: LineClass;
  severity: PrismSeverity;
  message: NormalizedMessage | null;
  /** The tool result paired with a tool call. */
  result: NormalizedMessage | null;
  /** Everything folded onto this row, from the call and the result together. */
  folded: NormalizedMessage[];
  at: number | null;
  /** `+11s` inside a working stretch; `Wed 09:00` after a gap. */
  timeLabel: string;
  /** Always the weekday and clock time, for the absolute setting. */
  clockLabel: string;
  /** Call to result for a tool row; the gap's length for a gap row. */
  durationMs: number | null;
  tag: string;
  sub: string;
  badge: string | null;
  images: PrismImage[];
  diff: DiffLine[] | null;
  /** Lines of the diff that were not drawn, when it was cut. */
  diffOmitted: number;
  gap: { ms: number; from: string; to: string } | null;
  agentId: string | null;
  agentType: string | null;
  agentAsk: string | null;
}

export interface SessionStateEntry {
  key: string;
  value: string;
  writes: number;
  changes: number;
}

export interface SessionFileChange {
  path: string;
  added: number;
  removed: number;
  edits: number;
}

export interface SessionContextPoint {
  at: number | null;
  tokens: number;
  hostId: string | null;
}

export interface SessionCrumbs {
  sessionId: string | null;
  cwd: string | null;
  branch: string | null;
  version: string | null;
  entrypoint: string | null;
  startedAt: number | null;
}

/** What the panels hold: state that answers a question about the session, not a moment in it. */
export interface SessionPanels {
  state: SessionStateEntry[];
  files: SessionFileChange[];
  context: SessionContextPoint[];
  crumbs: SessionCrumbs;
}

export interface FoldedItem {
  message: NormalizedMessage;
  hostId: string | null;
  hostLabel: string;
  at: string;
  payload: string;
  bytes: number;
}

/** One kind of line that drew no row, with everywhere it went. */
export interface FoldedType {
  key: string;
  count: number;
  lineClass: LineClass;
  disposition: FoldDisposition;
  items: FoldedItem[];
}

export interface SessionBandMark {
  text: string;
  tone: 'plain' | 'tool' | 'trouble' | 'agent' | 'mark' | 'edit' | 'link';
}

/** One band per turn for a long session: what the turn did, not every row it drew. */
export interface SessionBand {
  turnIndex: number;
  tag: 'you' | 'turn' | 'gap' | 'system';
  label: string;
  timeLabel: string;
  durationMs: number | null;
  severity: PrismSeverity;
  hasAgents: boolean;
  marks: SessionBandMark[];
  entries: ReaderEntry[];
}

export interface SessionView {
  turns: SessionTurn[];
  entries: ReaderEntry[];
  bands: SessionBand[];
  panels: SessionPanels;
  folds: FoldedType[];
  ledger: SessionLedger;
  trouble: SessionTrouble;
  outcome: SessionOutcome;
  timing: SessionTiming;
}

export type FleetStatus =
  | 'finished'
  | 'stopped'
  | 'failed'
  | 'running'
  | 'launched'
  | 'unknown';

/** One agent of the session's fleet. Every one exists because of an Agent call here. */
export interface FleetAgent {
  entryId: string | null;
  toolUseId: string | null;
  agentId: string | null;
  type: string;
  name: string | null;
  description: string;
  depth: number;
  parentAgentId: string | null;
  status: FleetStatus;
  startedAt: number | null;
  endedAt: number | null;
  costUSD: number | null;
  rowCount: number | null;
  model: string | null;
  worktree: string | null;
  /** Key of the loaded transcript, when the subagent's file was loaded too. */
  recordKey: string | null;
  note: string | null;
}

export interface FleetView {
  agents: FleetAgent[];
}

export interface ClaudeSessionParseResult {
  conversation: NormalizedConversation;
  stats: ClaudeSessionStats;
  warnings: string[];
}

export interface ClaudeMetaSummary {
  /**
   * No `.meta.json` in the corpus carries an agentId — it is the filename — so
   * upstream's read of the field was always null. Derived from the file name.
   */
  agentId: string | null;
  agentType: string | null;
  description: string | null;
  /** The parent's `Task` tool_use id. This is what nests a subagent in place. */
  toolUseId: string | null;
  name: string | null;
  model: string | null;
  parentAgentId: string | null;
  spawnDepth: number | null;
  isFork: boolean;
  spawnedWithWorktree: boolean;
  stoppedByUser: boolean;
  worktreePath: string | null;
  worktreeBranch: string | null;
  inheritedWorktreePath: string | null;
  raw: Record<string, unknown>;
}
