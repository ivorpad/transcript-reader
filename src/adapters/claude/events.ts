import type { PrismSeverity } from '../../types/prism';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const clip = (value: string, max = 240): string => {
  const flat = value.replace(/\s+/gu, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const join = (...parts: Array<string | null | undefined>): string =>
  parts.filter((part): part is string => Boolean(part && part.trim())).join(' · ');

const ms = (value: unknown): string | null => {
  const millis = num(value);
  if (millis === null) return null;
  if (millis < 1000) return `${Math.round(millis)}ms`;
  if (millis < 60_000) return `${(millis / 1000).toFixed(1)}s`;
  return `${Math.round(millis / 60_000)}m`;
};

const count = (values: string[], label: string): string | null =>
  values.length ? `${values.length} ${label}` : null;

/**
 * Last resort. Renders an object's own scalar fields as `key value` pairs so an
 * event type nobody has written a summariser for still reads as text rather
 * than as JSON — which is what 531,478 rows did before this existed.
 */
const scalars = (record: UnknownRecord, skip: string[] = []): string => {
  const omit = new Set(['type', 'uuid', 'parentUuid', 'sessionId', 'session_id', 'timestamp', ...skip]);
  const parts: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (omit.has(key) || parts.length >= 6) continue;
    if (typeof value === 'string') {
      if (value.trim()) parts.push(`${key} ${clip(value, 80)}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key} ${value}`);
    } else if (Array.isArray(value) && value.length) {
      parts.push(`${key} ${value.length}`);
    }
  }
  return parts.join(' · ');
};

export interface DescribedEvent {
  kind: string;
  severity: PrismSeverity;
  label: string;
  text: string;
}

const hookLine = (attachment: UnknownRecord): string =>
  join(
    str(attachment.hookName) ?? str(attachment.hookEvent),
    str(attachment.hookEvent) && str(attachment.hookName) ? str(attachment.hookEvent) : null,
    num(attachment.exitCode) === null ? null : `exit ${num(attachment.exitCode)}`,
    ms(attachment.durationMs),
    str(attachment.stderr) ? clip(String(attachment.stderr), 120) : null
  );

const ATTACHMENT_SUMMARY: Record<string, (a: UnknownRecord) => string> = {
  hook_success: hookLine,
  hook_non_blocking_error: hookLine,
  hook_cancelled: attachment =>
    join(hookLine(attachment), attachment.timedOut ? 'timed out' : null),
  hook_blocking_error: attachment =>
    join(
      str(attachment.hookName) ?? str(attachment.hookEvent),
      clip(String(attachment.blockingError ?? 'blocked'), 200)
    ),
  hook_system_message: attachment =>
    join(str(attachment.hookName), clip(String(attachment.content ?? ''), 200)),
  hook_additional_context: attachment =>
    join(str(attachment.hookName), clip(String(attachment.content ?? ''), 200)),
  async_hook_response: attachment =>
    join(
      str(attachment.hookName) ?? str(attachment.hookEvent),
      num(attachment.exitCode) === null ? null : `exit ${num(attachment.exitCode)}`,
      str(attachment.response) ? clip(String(attachment.response), 120) : null
    ),
  total_tokens_reminder: attachment => clip(String(attachment.text ?? ''), 160),
  silent_turn_reminder: attachment => clip(String(attachment.text ?? ''), 160),
  batching_reminder_sent: attachment =>
    join(str(attachment.model), clip(String(attachment.text ?? ''), 160)),
  task_reminder: attachment =>
    join(
      num(attachment.itemCount) === null ? null : `${num(attachment.itemCount)} items`,
      clip(String(attachment.content ?? ''), 160)
    ),
  deferred_tools_delta: attachment =>
    join(
      count(list(attachment.addedNames), 'added'),
      count(list(attachment.removedNames), 'removed'),
      count(list(attachment.readdedNames), 're-added'),
      count(list(attachment.failedMcpServers), 'failed servers'),
      count(list(attachment.pendingMcpServers), 'pending servers')
    ) || 'no change',
  mcp_instructions_delta: attachment =>
    join(count(list(attachment.addedNames), 'added'), count(list(attachment.removedNames), 'removed')) ||
    'no change',
  agent_listing_delta: attachment =>
    join(
      attachment.isInitial ? 'initial listing' : null,
      count(list(attachment.addedTypes), 'added'),
      count(list(attachment.removedTypes), 'removed')
    ) || 'no change',
  skill_listing: attachment =>
    join(
      num(attachment.skillCount) === null ? null : `${num(attachment.skillCount)} skills`,
      attachment.isInitial ? 'initial' : null,
      clip(list(attachment.names).slice(0, 8).join(', '), 160)
    ),
  invoked_skills: attachment => clip(list(attachment.skills).join(', '), 160) || 'none',
  dynamic_skill: attachment =>
    join(str(attachment.displayPath), clip(list(attachment.skillNames).join(', '), 120)),
  output_style: attachment => str(attachment.style) ?? 'default',
  auto_mode: attachment =>
    join(
      attachment.bashFirst ? 'bash first' : null,
      attachment.bypass ? 'bypass' : null,
      attachment.steerOnly ? 'steer only' : null,
      attachment.bashFirstSteer ? 'bash-first steer' : null
    ) || 'auto mode',
  queued_command: attachment =>
    join(str(attachment.commandMode), clip(String(attachment.prompt ?? ''), 200)),
  command_permissions: attachment => `${list(attachment.allowedTools).length} allowed tools`,
  bash_output_audience_note: attachment => str(attachment.toolUseID) ?? 'bash output note',
  edited_text_file: attachment =>
    join(str(attachment.filename), clip(String(attachment.snippet ?? ''), 120)),
  opened_file_in_ide: attachment => str(attachment.filename) ?? 'file opened',
  selected_lines_in_ide: attachment =>
    join(
      str(attachment.displayPath) ?? str(attachment.filename),
      num(attachment.lineStart) === null ? null : `lines ${num(attachment.lineStart)}-${num(attachment.lineEnd)}`,
      str(attachment.ideName)
    ),
  file: attachment => str(attachment.displayPath) ?? str(attachment.filename) ?? 'file',
  compact_file_reference: attachment => str(attachment.displayPath) ?? str(attachment.filename) ?? 'file',
  nested_memory: attachment => str(attachment.displayPath) ?? str(attachment.path) ?? 'memory',
  read_truncation_notice: attachment => clip(String(attachment.banner ?? 'output truncated'), 200),
  structured_output: attachment => join(str(attachment.toolUseID), 'structured output'),
  date_change: attachment => str(attachment.newDate) ?? 'date changed',
  date: attachment => str(attachment.date) ?? 'date',
  remote_session_change: attachment =>
    join(str(attachment.url), str(attachment.pr), str(attachment.commit)),
  goal_status: attachment =>
    join(
      attachment.met ? 'met' : 'not met',
      num(attachment.iterations) === null ? null : `${num(attachment.iterations)} iterations`,
      ms(attachment.durationMs),
      clip(String(attachment.reason ?? ''), 200)
    ),
  plan_mode: attachment =>
    join(
      attachment.isSubAgent ? 'subagent' : null,
      attachment.planExists ? 'plan exists' : 'no plan',
      str(attachment.planFilePath)
    ),
  plan_mode_exit: attachment =>
    join(attachment.planExists ? 'plan exists' : 'no plan', str(attachment.planFilePath)),
  plan_mode_reentry: attachment => str(attachment.planFilePath) ?? 'plan mode re-entered',
  team_context: attachment =>
    join(str(attachment.teamName), str(attachment.agentName), str(attachment.taskListPath)),
  workflow_size_guideline_change: attachment => str(attachment.size) ?? 'changed',
  workflow_keyword_request: () => 'workflow keyword requested',
  ultra_effort_enter: () => 'ultra effort on',
  ultra_effort_exit: () => 'ultra effort off',
  prompt_snapshot: attachment => `${list(attachment.tools).length} tools in prompt snapshot`,
  diagnostics: attachment => `${list(attachment.files).length} files`,
  instructions: attachment => `${list(attachment.files).length} instruction files`,
  model: attachment => str(attachment.identity) ?? str(attachment.text) ?? 'model',
  environment: () => 'environment snapshot',
  session_context: () => 'session context'
};

const ATTACHMENT_SEVERITY: Record<string, PrismSeverity> = {
  hook_blocking_error: 'error',
  hook_non_blocking_error: 'warning',
  hook_cancelled: 'warning',
  read_truncation_notice: 'notice',
  date_change: 'notice',
  remote_session_change: 'notice',
  goal_status: 'notice'
};

const SYSTEM_SUMMARY: Record<string, (event: UnknownRecord) => string> = {
  compact_boundary: event => {
    const meta = isRecord(event.compactMetadata) ? event.compactMetadata : {};
    return join(
      'context compacted',
      str(meta.trigger),
      num(meta.preTokens) === null ? null : `${num(meta.preTokens)} tokens before`
    );
  },
  turn_duration: event => ms(event.durationMs) ?? 'turn finished',
  stop_hook_summary: event =>
    join(
      num(event.hookCount) === null ? null : `${num(event.hookCount)} hooks`,
      Array.isArray(event.hookErrors) && event.hookErrors.length
        ? `${event.hookErrors.length} errors`
        : null,
      event.hasOutput ? 'produced output' : null,
      clip(String(event.content ?? ''), 160)
    ),
  away_summary: event => clip(String(event.content ?? ''), 240),
  local_command: event =>
    clip(String(event.content ?? event.prompt ?? 'local command'), 240),
  informational: event => clip(String(event.content ?? ''), 240),
  scheduled_task_fire: event =>
    join(str(event.taskKind), str(event.taskId), str(event.cron), str(event.cronKind)),
  model_refusal_fallback: event =>
    join(
      'refusal, falling back',
      str(event.originalModel),
      str(event.fallbackModel) ? `to ${str(event.fallbackModel)}` : null,
      str(event.apiRefusalCategory),
      clip(String(event.apiRefusalExplanation ?? ''), 160)
    ),
  model_refusal_no_fallback: event =>
    join(
      'refusal, no fallback',
      str(event.originalModel),
      str(event.apiRefusalCategory),
      clip(String(event.apiRefusalExplanation ?? ''), 160)
    ),
  model_consent_fallback: event =>
    join('consent fallback', str(event.originalModel), str(event.fallbackModel)),
  agents_killed: event =>
    join(
      'agents killed',
      num(event.pendingBackgroundAgentCount) === null
        ? null
        : `${num(event.pendingBackgroundAgentCount)} background pending`,
      num(event.pendingWorkflowCount) === null
        ? null
        : `${num(event.pendingWorkflowCount)} workflows pending`
    )
};

const SYSTEM_SEVERITY: Record<string, PrismSeverity> = {
  model_refusal_fallback: 'warning',
  model_refusal_no_fallback: 'error',
  model_consent_fallback: 'notice',
  agents_killed: 'warning',
  compact_boundary: 'notice'
};

const LEVEL_SEVERITY: Record<string, PrismSeverity> = {
  warning: 'warning',
  error: 'error',
  notice: 'notice',
  info: 'info',
  suggestion: 'info'
};

const usd = (value: unknown): string | null => {
  const amount = num(value);
  return amount === null ? null : `$${amount.toFixed(2)}`;
};

const LINE_SUMMARY: Record<string, (event: UnknownRecord) => string> = {
  mode: event => str(event.mode) ?? 'mode',
  'permission-mode': event => str(event.permissionMode) ?? 'permission mode',
  'ai-title': event => str(event.aiTitle) ?? 'title',
  'custom-title': event => str(event.customTitle) ?? 'title',
  'last-prompt': event => clip(String(event.lastPrompt ?? ''), 240),
  'atis-latch': event => str(event.atis) ?? 'cleared',
  'agent-name': event => str(event.agentName) ?? 'agent',
  'agent-setting': event => str(event.agentSetting) ?? 'setting',
  summary: event => clip(String(event.summary ?? ''), 240),
  'queue-operation': event =>
    join(str(event.operation), str(event.reason), clip(String(event.content ?? ''), 200)),
  'file-history-snapshot': event =>
    join(
      event.isSnapshotUpdate ? 'snapshot updated' : 'snapshot',
      str(event.messageId)
    ),
  'file-history-delta': event =>
    join('file changed', str(event.trackingPath), str(event.snapshotMessageId)),
  'cost-state': event =>
    join(
      usd(event.totalCostUSD),
      ms(event.totalDuration),
      num(event.totalLinesAdded) === null
        ? null
        : `+${num(event.totalLinesAdded)}/-${num(event.totalLinesRemoved)} lines`
    ),
  'frame-link': event => join(str(event.title), str(event.frameUrl)),
  'pr-link': event =>
    join(
      num(event.prNumber) === null ? null : `PR #${num(event.prNumber)}`,
      str(event.prRepository),
      str(event.prUrl)
    ),
  'bridge-session': event => join('bridged', str(event.bridgeSessionId)),
  relocated: event => join('relocated to', str(event.relocatedCwd)),
  'worktree-state': event => {
    const worktree = isRecord(event.worktreeSession) ? event.worktreeSession : {};
    return join(str(worktree.worktreeName), str(worktree.worktreeBranch), str(worktree.worktreePath));
  },
  // Workflow journals hold only these two, keyed by agentId. 612 such files
  // existed in the reference corpus and none of them would open at all.
  started: event => join('started', str(event.agentId), str(event.key)?.slice(0, 18)),
  result: event => {
    const result = isRecord(event.result) ? event.result : null;
    const preview = result
      ? Object.entries(result)
          .slice(0, 3)
          .map(([key, value]) =>
            typeof value === 'string'
              ? `${key} ${clip(value, 80)}`
              : isRecord(value)
                ? `${key} ${Object.keys(value).length} fields`
                : `${key} ${String(value).slice(0, 40)}`
          )
          .join(' · ')
      : str(event.result)
        ? clip(String(event.result), 160)
        : null;
    return join('result', str(event.agentId), preview);
  },
  'fork-context-ref': event =>
    join(
      'forked from',
      str(event.parentSessionId),
      num(event.contextLength) === null ? null : `${num(event.contextLength)} context`
    ),
  'artifact-autoreact-ledger': event =>
    `${Object.keys(isRecord(event.artifacts) ? event.artifacts : {}).length} artifacts`,
  'artifact-comment-monitor': event =>
    `${Object.keys(isRecord(event.artifacts) ? event.artifacts : {}).length} artifacts watched`,
  'history-suppression': event => join('history suppressed', str(event.cause))
};

const LINE_SEVERITY: Record<string, PrismSeverity> = {
  'history-suppression': 'notice',
  relocated: 'notice'
};

/**
 * Turns a non-conversational line into a kind, a severity and one line of text.
 * Never returns JSON: unrecognised shapes fall through to `scalars`.
 */
export const describeEvent = (event: UnknownRecord): DescribedEvent => {
  const type = str(event.type) ?? 'event';

  if (type === 'attachment') {
    const attachment = isRecord(event.attachment) ? event.attachment : {};
    const attachmentType = str(attachment.type) ?? 'attachment';
    const summarise = ATTACHMENT_SUMMARY[attachmentType];
    return {
      kind: `attachment:${attachmentType}`,
      severity: ATTACHMENT_SEVERITY[attachmentType] ?? 'info',
      label: attachmentType,
      text: (summarise ? summarise(attachment) : scalars(attachment)) || attachmentType
    };
  }

  if (type === 'system') {
    const subtype = str(event.subtype) ?? 'system';
    const summarise = SYSTEM_SUMMARY[subtype];
    const level = str(event.level);
    return {
      kind: `system:${subtype}`,
      severity:
        SYSTEM_SEVERITY[subtype] ?? (level ? LEVEL_SEVERITY[level] ?? 'info' : 'info'),
      label: subtype,
      text:
        (summarise ? summarise(event) : clip(String(event.content ?? '')) || scalars(event, ['level'])) ||
        subtype
    };
  }

  const summarise = LINE_SUMMARY[type];
  const known = summarise !== undefined;
  return {
    kind: known ? type : `unknown:${type}`,
    severity: LINE_SEVERITY[type] ?? 'info',
    label: type,
    text: (summarise ? summarise(event) : scalars(event)) || type
  };
};
