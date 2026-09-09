import type {
  ClaudeMetaSummary,
  FleetAgent,
  FleetStatus,
  FleetView,
  ReaderEntry,
  SessionView
} from '../../types/prism';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

const str = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** What the app knows about a subagent transcript loaded next to the session. */
export interface LinkedAgentRecord {
  recordKey: string;
  /** The parent's Task tool_use id, from the meta file. */
  toolUseId: string | null;
  agentId: string | null;
  meta: ClaudeMetaSummary | null;
  view: SessionView;
  costUSD: number | null;
  rowCount: number;
}

/**
 * Workflow journals (journal.jsonl under subagents/workflows) hold only `started`
 * and `result` keyed by agentId, with no timestamps. A journal with a result
 * for an agent marks it finished and nothing else.
 */
export interface JournalRecord {
  started: Set<string>;
  finished: Set<string>;
}

const statusFromResult = (
  entry: ReaderEntry,
  linked: LinkedAgentRecord | undefined,
  journal: JournalRecord | undefined,
  agentId: string | null
): { status: FleetStatus; note: string | null } => {
  const result = entry.result;
  const toolUseResult = isRecord(result?.toolUseResult) ? result.toolUseResult : null;

  if (linked?.meta?.stoppedByUser) {
    return { status: 'stopped', note: 'stoppedByUser is true in the meta file.' };
  }
  if (result?.severity === 'warning' || result?.severity === 'error') {
    return { status: 'failed', note: 'The parent’s tool_result is is_error true.' };
  }
  if (linked) {
    if (linked.view.outcome.state === 'interrupted') {
      return { status: 'stopped', note: 'The subagent transcript ends on an interrupt.' };
    }
    if (linked.view.outcome.state === 'finished') {
      return { status: 'finished', note: null };
    }
    return {
      status: 'running',
      note: 'The subagent transcript has no closing assistant message.'
    };
  }
  if (agentId && journal?.finished.has(agentId)) {
    return { status: 'finished', note: 'A workflow journal holds its result.' };
  }
  const status = str(toolUseResult?.status);
  if (status === 'async_launched') {
    return {
      status: 'launched',
      note: 'Launched in the background; its transcript is not loaded.'
    };
  }
  if (status === 'completed' || status === 'success' || toolUseResult?.content !== undefined) {
    return { status: 'finished', note: null };
  }
  if (!result) {
    return { status: 'running', note: 'The call has no result in this transcript.' };
  }
  return { status: 'unknown', note: null };
};

const depthOf = (
  linked: LinkedAgentRecord | undefined,
  parentDepth: number
): number => {
  const spawnDepth = linked?.meta?.spawnDepth;
  return typeof spawnDepth === 'number' ? spawnDepth : parentDepth + 1;
};

/**
 * The fleet is a view inside the session, not a level above it. Every agent
 * exists because an Agent call in this transcript asked for it, so the list
 * is built from those calls and only then enriched from whatever else was
 * loaded: the result the call got, the subagent's own transcript and meta
 * file, a workflow journal.
 */
export const buildFleet = (
  view: SessionView,
  linked: LinkedAgentRecord[] = [],
  journal?: JournalRecord,
  depth = 0
): FleetView => {
  const linkedByToolUseId = new Map<string, LinkedAgentRecord>();
  const linkedByAgentId = new Map<string, LinkedAgentRecord>();
  for (const record of linked) {
    if (record.toolUseId) linkedByToolUseId.set(record.toolUseId, record);
    if (record.agentId) linkedByAgentId.set(record.agentId, record);
  }

  const agents: FleetAgent[] = [];

  for (const entry of view.entries) {
    if (entry.kind !== 'agent' || !entry.message) continue;
    const toolUseId = entry.message.toolUseId ?? null;
    const toolUseResult = isRecord(entry.result?.toolUseResult)
      ? entry.result.toolUseResult
      : null;
    const agentId =
      entry.agentId ?? str(toolUseResult?.agentId) ?? str(toolUseResult?.agent_id);
    const record =
      (toolUseId ? linkedByToolUseId.get(toolUseId) : undefined) ??
      (agentId ? linkedByAgentId.get(agentId) : undefined);
    const input = isRecord(entry.message.toolInput) ? entry.message.toolInput : {};
    const { status, note } = statusFromResult(entry, record, journal, agentId);

    const endedAt =
      record?.view.timing.endedAt ??
      (status === 'finished' || status === 'failed' ? (entry.result?.timestamp ? Date.parse(entry.result.timestamp) : null) : null);

    const worktree =
      record?.meta?.worktreeBranch ??
      record?.meta?.worktreePath ??
      (str(input.isolation) === 'worktree' ? 'worktree' : null);

    agents.push({
      entryId: entry.id,
      toolUseId,
      agentId: agentId ?? record?.agentId ?? null,
      type:
        entry.agentType ??
        record?.meta?.agentType ??
        str(toolUseResult?.agentType) ??
        'agent',
      name: str(input.name) ?? record?.meta?.name ?? null,
      description:
        entry.agentAsk ?? record?.meta?.description ?? str(input.description) ?? '',
      depth: depthOf(record, depth),
      parentAgentId: record?.meta?.parentAgentId ?? null,
      status,
      startedAt: entry.at,
      endedAt,
      costUSD: record?.costUSD ?? null,
      rowCount: record?.rowCount ?? null,
      model:
        str(input.model) ??
        str(toolUseResult?.resolvedModel) ??
        record?.meta?.model ??
        null,
      worktree,
      recordKey: record?.recordKey ?? null,
      note
    });
  }

  return { agents };
};

/** Total wall-clock covered by the agent, when both ends are known. */
export const agentDurationMs = (agent: FleetAgent): number | null =>
  agent.startedAt !== null && agent.endedAt !== null
    ? Math.max(0, agent.endedAt - agent.startedAt)
    : null;

export const fleetSummary = (fleet: FleetView) => {
  const count = (status: FleetStatus) =>
    fleet.agents.filter(agent => agent.status === status).length;
  return {
    total: fleet.agents.length,
    finished: count('finished'),
    stopped: count('stopped'),
    failed: count('failed'),
    running: count('running') + count('launched'),
    cost: fleet.agents.reduce((sum, agent) => sum + (agent.costUSD ?? 0), 0)
  };
};

export const journalFromLines = (lines: unknown[]): JournalRecord => {
  const started = new Set<string>();
  const finished = new Set<string>();
  for (const line of lines) {
    if (!isRecord(line)) continue;
    const agentId = str(line.agentId);
    if (!agentId) continue;
    if (line.type === 'started') started.add(agentId);
    if (line.type === 'result') finished.add(agentId);
  }
  return { started, finished };
};

