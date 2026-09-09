import type {
  FoldDisposition,
  LineClass,
  NormalizedMessage
} from '../../types/prism';
import { userLineKind } from './prompts';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

const str = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/**
 * Every line type has one of five classes, and the class is a lookup, so a
 * type the reader has never seen falls to `unknown` rather than breaking.
 *
 *   read     gets a row: what was asked, said, run, and what came back
 *   fold     never a row; attaches to the row it names or follows
 *   mark     one low-contrast line in sequence; it changed the run's conditions
 *   panel    answers a question about the session, not a moment in it
 *   unknown  the default for anything not in the tables below
 *
 * The tables place the 27 top-level types, 11 system subtypes, 49 attachment
 * types and 8 content blocks observed across ~/.claude/projects for Claude
 * Code 2.1.193 through 2.1.263. `tests/catalog.test.ts` holds that inventory
 * and fails when any of it drifts to `unknown`.
 */
export const LINE_CLASSES: readonly LineClass[] = [
  'read',
  'fold',
  'mark',
  'panel',
  'unknown'
];

/** `attachment` and `system` carry their class on the inner type. */
export const CONTAINER_TYPES: readonly string[] = ['attachment', 'system'];

export const TOP_LEVEL_CLASS: Readonly<Record<string, LineClass>> = {
  user: 'read',
  assistant: 'read',
  // Workflow journals hold only these two; for that file they are the story.
  started: 'read',
  result: 'read',

  'queue-operation': 'mark',
  'frame-link': 'mark',
  'pr-link': 'mark',
  'worktree-state': 'mark',
  relocated: 'mark',
  'fork-context-ref': 'mark',
  'history-suppression': 'mark',

  mode: 'panel',
  'permission-mode': 'panel',
  'ai-title': 'panel',
  'custom-title': 'panel',
  'last-prompt': 'panel',
  'atis-latch': 'panel',
  'agent-setting': 'panel',
  'agent-name': 'panel',
  'bridge-session': 'panel',
  'cost-state': 'panel',
  'file-history-snapshot': 'panel',
  'file-history-delta': 'panel',
  'artifact-autoreact-ledger': 'panel',
  'artifact-comment-monitor': 'panel'
};

/** Types the upstream parser listed that the current corpus never writes. */
export const LEGACY_TOP_LEVEL_CLASS: Readonly<Record<string, LineClass>> = {
  summary: 'panel',
  progress: 'mark',
  turn_duration: 'panel',
  tag: 'panel',
  'agent-color': 'panel',
  'attribution-snapshot': 'panel',
  'content-replacement': 'panel',
  'marble-origami-commit': 'panel',
  'marble-origami-snapshot': 'panel'
};

export const SYSTEM_SUBTYPE_CLASS: Readonly<Record<string, LineClass>> = {
  compact_boundary: 'read',
  away_summary: 'read',
  scheduled_task_fire: 'read',

  local_command: 'mark',
  informational: 'mark',
  agents_killed: 'mark',
  model_refusal_fallback: 'mark',
  model_refusal_no_fallback: 'mark',
  model_consent_fallback: 'mark',

  turn_duration: 'panel',
  stop_hook_summary: 'panel'
};

export const ATTACHMENT_CLASS: Readonly<Record<string, LineClass>> = {
  hook_success: 'fold',
  async_hook_response: 'fold',
  hook_additional_context: 'fold',
  hook_system_message: 'fold',
  hook_non_blocking_error: 'fold',
  hook_cancelled: 'fold',
  bash_output_audience_note: 'fold',
  read_truncation_notice: 'fold',
  structured_output: 'fold',

  hook_blocking_error: 'mark',
  queued_command: 'mark',
  date_change: 'mark',
  plan_mode: 'mark',
  plan_mode_exit: 'mark',
  plan_mode_reentry: 'mark',
  output_style: 'mark',
  auto_mode: 'mark',
  remote_session_change: 'mark',
  opened_file_in_ide: 'mark',
  selected_lines_in_ide: 'mark',
  edited_text_file: 'mark',
  nested_memory: 'mark',
  file: 'mark',
  invoked_skills: 'mark',
  dynamic_skill: 'mark',
  team_context: 'mark',
  goal_status: 'mark',
  ultra_effort_enter: 'mark',
  ultra_effort_exit: 'mark',
  workflow_size_guideline_change: 'mark',
  workflow_keyword_request: 'mark',

  total_tokens_reminder: 'panel',
  task_reminder: 'panel',
  silent_turn_reminder: 'panel',
  batching_reminder_sent: 'panel',
  skill_listing: 'panel',
  deferred_tools_delta: 'panel',
  deferred_tools_record: 'panel',
  mcp_instructions_delta: 'panel',
  agent_listing_delta: 'panel',
  command_permissions: 'panel',
  prompt_snapshot: 'panel',
  environment: 'panel',
  instructions: 'panel',
  session_context: 'panel',
  date: 'panel',
  model: 'panel',
  diagnostics: 'panel',
  compact_file_reference: 'panel'
};

export const CONTENT_BLOCK_CLASS: Readonly<Record<string, LineClass>> = {
  text: 'read',
  thinking: 'read',
  tool_use: 'read',
  tool_result: 'read',
  image: 'read',
  document: 'read',
  fallback: 'read',
  tool_reference: 'panel'
};

/**
 * Where an attachment goes. Derived from its class except for two cases the
 * design settles by hand: a blocking hook changed what happened, so it takes a
 * row of its own; a token reminder feeds the header's context curve but still
 * folds onto the row nearest it, because that is where you look for it.
 */
const DISPOSITION_OVERRIDES: Readonly<Record<string, FoldDisposition>> = {
  hook_blocking_error: 'own-row',
  total_tokens_reminder: 'row'
};

const dispositionForClass = (lineClass: LineClass): FoldDisposition => {
  switch (lineClass) {
    case 'fold':
      return 'row';
    case 'panel':
      return 'panel';
    case 'mark':
      return 'mark';
    case 'read':
    case 'unknown':
      return 'own-row';
  }
};

export const dispositionOfAttachment = (attachmentType: string): FoldDisposition =>
  DISPOSITION_OVERRIDES[attachmentType] ??
  dispositionForClass(ATTACHMENT_CLASS[attachmentType] ?? 'unknown');

export const classifyAttachment = (attachmentType: string): LineClass =>
  ATTACHMENT_CLASS[attachmentType] ?? 'unknown';

export const classifySystemSubtype = (subtype: string): LineClass =>
  SYSTEM_SUBTYPE_CLASS[subtype] ?? 'unknown';

export const classifyTopLevel = (type: string): LineClass =>
  TOP_LEVEL_CLASS[type] ?? LEGACY_TOP_LEVEL_CLASS[type] ?? 'unknown';

export const classifyContentBlock = (blockType: string): LineClass =>
  CONTENT_BLOCK_CLASS[blockType] ?? 'unknown';

/** Class of a raw JSONL line, before the parser has touched it. */
export const classifyLine = (line: unknown): LineClass => {
  if (!isRecord(line)) return 'unknown';
  const type = str(line.type);
  if (!type) return 'unknown';
  if (type === 'attachment') {
    const attachment = isRecord(line.attachment) ? line.attachment : null;
    return classifyAttachment(str(attachment?.type) ?? '');
  }
  if (type === 'system') return classifySystemSubtype(str(line.subtype) ?? '');
  return classifyTopLevel(type);
};

/** The name a line is filed under: attachment type, `system:subtype`, or line type. */
export const typeNameOf = (message: NormalizedMessage): string => {
  const kind = message.eventKind;
  if (kind?.startsWith('attachment:')) return kind.slice('attachment:'.length);
  if (kind?.startsWith('system:')) return kind;
  if (kind?.startsWith('unknown:')) return kind.slice('unknown:'.length);
  if (kind === 'content:fallback') return 'fallback';
  if (message.channel === 'thinking') return 'thinking';
  if (message.channel === 'tool_call') return 'tool_use';
  if (message.channel === 'tool_result') return 'tool_result';
  return message.lineType ?? kind ?? 'line';
};

const classifyKind = (
  eventKind: string | undefined,
  lineType: string | undefined
): LineClass => {
  if (eventKind?.startsWith('attachment:')) {
    return classifyAttachment(eventKind.slice('attachment:'.length));
  }
  if (eventKind?.startsWith('system:')) {
    return classifySystemSubtype(eventKind.slice('system:'.length));
  }
  if (eventKind === 'content:fallback') return 'read';
  if (eventKind?.startsWith('unknown:')) return 'unknown';
  return classifyTopLevel(lineType ?? eventKind ?? '');
};

/**
 * Class of a normalised row. Conversational rows are `read`, with two
 * exceptions that are marks: a thinking block whose text was never stored,
 * because it is the only record that the model reasoned there; and a `user`
 * line the person did not type: the interrupt marker, a task notification,
 * the echoed output of a local command, or injected context marked `isMeta`.
 */
export const classifyMessage = (message: NormalizedMessage): LineClass => {
  if (message.raw.type === 'parse_warning') return 'unknown';
  switch (message.channel) {
    case 'message':
      return message.role === 'user' &&
        !message.isCompactSummary &&
        (message.isMeta === true || userLineKind(message.text) !== 'prompt')
        ? 'mark'
        : 'read';
    case 'tool_call':
    case 'tool_result':
      return 'read';
    case 'thinking':
      return message.thinkingTextStored === false ? 'mark' : 'read';
    case 'event':
      return classifyKind(message.eventKind, message.lineType);
  }
};

export const dispositionOfMessage = (message: NormalizedMessage): FoldDisposition => {
  const kind = message.eventKind;
  if (kind?.startsWith('attachment:')) {
    return dispositionOfAttachment(kind.slice('attachment:'.length));
  }
  return dispositionForClass(classifyMessage(message));
};

export interface CatalogClass {
  name: LineClass;
  rule: string;
  specimen: string;
  items: string[];
}

const itemsOfClass = (
  table: Readonly<Record<string, LineClass>>,
  lineClass: LineClass,
  prefix = ''
): string[] =>
  Object.entries(table)
    .filter(([, value]) => value === lineClass)
    .map(([key]) => `${prefix}${key}`);

const membersOf = (lineClass: LineClass): string[] => [
  ...itemsOfClass(TOP_LEVEL_CLASS, lineClass),
  ...itemsOfClass(CONTENT_BLOCK_CLASS, lineClass),
  ...itemsOfClass(SYSTEM_SUBTYPE_CLASS, lineClass, 'system:'),
  ...itemsOfClass(ATTACHMENT_CLASS, lineClass)
];

/** The five classes, for the Catalog view. */
export const CATALOG: readonly CatalogClass[] = [
  {
    name: 'read',
    rule: 'Gets a row. This is what happened: what was asked, what was said, what ran, what came back.',
    specimen:
      'you       Fix the flaky test in tests/queue_spec.rb\nclaude    I will reproduce it at 200 runs first.\nbash      rspec … --seed 41213            exit 1  3.4s',
    items: membersOf('read')
  },
  {
    name: 'fold',
    rule: 'Never a row. Attaches to the tool call it names in toolUseID, shows as a count on that row, and is listed in full under Folded.',
    specimen:
      'bash      bundle exec rspec …             exit 0  48.2s\n          ▸ stdout · 1 line          (3 folded)\n            hook_success PreToolUse 41 ms\n            total_tokens_reminder  31,402 / 200,000',
    items: membersOf('fold')
  },
  {
    name: 'mark',
    rule: 'One low-contrast line in sequence. It changed the conditions of the run, so it reads, but it is not conversation.',
    specimen:
      'hook      guard-no-timeout-edits blocked Edit\nsystem    model_refusal_fallback  opus-5 → sonnet-5\nthinking  text not stored',
    items: membersOf('mark')
  },
  {
    name: 'panel',
    rule: 'Answers a question about the session, not about a moment in it. Lives in the header, the rail or a panel, with a rewrite count where the value is latched.',
    specimen:
      'Session state    mode          plan        ×203\n                 permission    acceptEdits ×203\nFiles changed    lib/queue.rb  +14 −3\nCost             $2.14  opus-5 $1.91 · sonnet-5 $0.23',
    items: membersOf('panel')
  },
  {
    name: 'unknown',
    rule: 'The fallback for any type not in the table above. Drawn once at its file position with its type name and key list, repeats collapsed, counted in the footer. Nothing is dropped and nothing is guessed.',
    specimen:
      '?         signal-relay · 4 keys\n          relayId, channel, payloadBytes, ts        ×3\n\nfooter:   1 unrecognised type: signal-relay',
    items: [
      'any new top-level type',
      'any new attachment.type',
      'any new system subtype',
      'any new content block',
      'malformed line (counted, not drawn)'
    ]
  }
];

/** What the tables place, for the inventory test and the Catalog view. */
export const catalogInventory = () => ({
  topLevel: [...Object.keys(TOP_LEVEL_CLASS), ...CONTAINER_TYPES].sort(),
  legacyTopLevel: Object.keys(LEGACY_TOP_LEVEL_CLASS).sort(),
  systemSubtypes: Object.keys(SYSTEM_SUBTYPE_CLASS).sort(),
  attachmentTypes: Object.keys(ATTACHMENT_CLASS).sort(),
  contentBlocks: Object.keys(CONTENT_BLOCK_CLASS).sort()
});

/** A sentence per folded type for the Folded view. Falls back to the disposition's rule. */
const TYPE_NOTES: Readonly<Record<string, string>> = {
  hook_success:
    'Matched to its tool call by toolUseID and shown as part of that row’s folded count. Expanding the count lists the hook name, event and duration. A hook that blocked is a different type and does get a row.',
  total_tokens_reminder:
    'Written after most turns to record context use. It never changes what happened, so it folds onto the row nearest it and surfaces only as part of that row’s folded count. The session’s context curve in the rail is drawn from these.',
  'file-history-delta':
    'One line per file change. These are the source of the Files changed panel in the rail; they are never drawn in sequence because a file changing many times is a state, not many events.',
  'file-history-snapshot':
    'A snapshot of tracked files at a message. Feeds the Files changed panel with file-history-delta; never a row.',
  read_truncation_notice:
    'Says a read returned less than the file holds. It folds onto that read row so a partial read never looks complete.',
  hook_blocking_error:
    'The exception. A blocking hook stopped a tool from running, which changed the conditions of the run, so it is the one attachment class that takes a row in sequence.',
  queued_command:
    'A command typed while the model was working. It is drawn as a low-contrast mark at the point it was queued, not at the point it ran, because the two are different facts.',
  invoked_skills:
    'Records which skill prompt was loaded for a turn.',
  structured_output:
    'A tool result that arrived as JSON rather than text. It folds onto its tool row.',
  bash_output_audience_note:
    'Says a Bash result was written for the model, not the person. Folds onto the call it names.',
  'system:stop_hook_summary':
    'What the Stop hooks did at the end of a turn. A count per turn, never a row.',
  'system:turn_duration':
    'How long the turn took. The rail’s outline carries it; it is not a row.',
  task_reminder:
    'The task list re-sent to the model. State, not an event.',
  skill_listing:
    'The skills available to the model, re-sent as they change. The last listing is the state.',
  deferred_tools_delta:
    'Tools added to or removed from the deferred set. State, not an event.',
  mode: 'Latched on most turns. Only the final value and its rewrite count appear, in the rail.',
  'permission-mode':
    'Latched on most turns. Only the final value and its rewrite count appear, in the rail.',
  'last-prompt':
    'Latched on most turns. Only the final value and its rewrite count appear, in the rail.',
  'ai-title': 'The session’s generated title. It is the header, not a row.',
  'custom-title': 'The title the person gave the session. It is the header, not a row.',
  'cost-state':
    'The session’s running cost and duration, rewritten as it grows. The last one is the header’s Cost.'
};

const DISPOSITION_RULES: Readonly<Record<FoldDisposition, string>> = {
  row: 'Folds onto the row it names by toolUseID, or the row it was written after, and shows as part of that row’s folded count.',
  panel: 'Lives in a panel: it answers a question about the session, not about a moment in it. Where the value is latched, only the last value and its rewrite count appear.',
  'own-row': 'Takes a row of its own in sequence.',
  mark: 'Drawn as one low-contrast mark in sequence at the point it was written.'
};

export const noteForType = (key: string, disposition: FoldDisposition): string =>
  TYPE_NOTES[key] ?? DISPOSITION_RULES[disposition];
