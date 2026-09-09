import { foldByClass } from './collapse';
import {
  describeToolInput,
  describeToolUseResult,
  renderToText,
  toImage,
  truncateForRow
} from './content';
import { describeEvent } from './events';
import { stripPromptEnvelopes } from './prompts';
import type {
  ClaudeMetaSummary,
  ClaudeSessionCost,
  ClaudeSessionLineType,
  ClaudeSessionParseResult,
  ClaudeSessionStats,
  NormalizedConversation,
  NormalizedMessage,
  MessageAttribution,
  MessageChannel,
  MessageErrorInfo,
  MessageImage,
  MessageRole,
  Severity
} from '../../types/reader';

type UnknownRecord = Record<string, unknown>;

/**
 * Line types Claude Code is known to write, as observed across a 3.2 GB
 * ~/.claude/projects corpus (3,281 files, 995,835 lines, versions 2.1.197
 * through 2.1.259).
 *
 * Membership does not gate parsing. `isClaudeEvent` accepts any object carrying
 * a string `type`, so a line type introduced after this list was written still
 * renders instead of becoming a warning — which is how the previous allowlist
 * silently dropped 28,196 lines. The set only decides whether a file with no
 * user or assistant lines is recognisable as a Claude session at all.
 */
const CLAUDE_KNOWN_LINE_TYPES = new Set([
  'agent-name',
  'agent-setting',
  'ai-title',
  'artifact-autoreact-ledger',
  'artifact-comment-monitor',
  'assistant',
  'atis-latch',
  'attachment',
  'bridge-session',
  'cost-state',
  'custom-title',
  'file-history-delta',
  'file-history-snapshot',
  'fork-context-ref',
  'frame-link',
  'history-suppression',
  'last-prompt',
  'mode',
  'permission-mode',
  'pr-link',
  'queue-operation',
  'relocated',
  'result',
  'started',
  'system',
  'user',
  'worktree-state'
]);

/**
 * Types the upstream parser listed that match nothing in the current corpus.
 * `summary` is the consequential one: sessions now carry `ai-title` and
 * `custom-title` instead, which is why titles regressed. `turn_duration` moved
 * to a `system` subtype. Kept only so historical transcripts still identify as
 * Claude sessions.
 */
const CLAUDE_LEGACY_LINE_TYPES = new Set([
  'agent-color',
  'attribution-snapshot',
  'content-replacement',
  'marble-origami-commit',
  'marble-origami-snapshot',
  'progress',
  'summary',
  'tag',
  'turn_duration'
]);

export const isKnownClaudeLineType = (type: string): boolean =>
  CLAUDE_KNOWN_LINE_TYPES.has(type) || CLAUDE_LEGACY_LINE_TYPES.has(type);

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

const asRecord = (value: unknown): UnknownRecord | null =>
  isRecord(value) ? value : null;

const asString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

const firstString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    const stringValue = asString(value);
    if (stringValue) {
      return stringValue;
    }
  }

  return undefined;
};

const stringify = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const isClaudeEvent = (value: unknown): value is UnknownRecord => {
  const record = asRecord(value);
  if (!record) {
    return false;
  }

  const type = asString(record.type);
  if (!type) {
    return false;
  }

  if (type === 'user' || type === 'assistant') {
    return isRecord(record.message);
  }

  return true;
};

const getSessionId = (events: UnknownRecord[]): string | null => {
  for (const event of events) {
    const sessionId = asString(event.sessionId);
    if (sessionId) {
      return sessionId;
    }
  }

  return null;
};

const getStartedAt = (events: UnknownRecord[]): string | null => {
  for (const event of events) {
    const timestamp = asString(event.timestamp);
    if (timestamp) {
      return timestamp;
    }
  }

  return null;
};

const firstLine = (text: string): string =>
  text.split('\n')[0].slice(0, 80).trim();

/**
 * Sessions no longer carry `summary` lines — zero in 995,835 — so the upstream
 * order resolved every title through the first user message, which is usually a
 * slash-command envelope. `custom-title` and `ai-title` are what Claude Code
 * writes now, and 304 sessions had one sitting unread.
 */
const getTitle = (events: UnknownRecord[], sessionId: string | null): string => {
  const lastOf = (type: string, field: string): string | null => {
    for (let at = events.length - 1; at >= 0; at--) {
      if (events[at].type !== type) continue;
      const value = asString(events[at][field])?.trim();
      if (value) return value;
    }
    return null;
  };

  const customTitle = lastOf('custom-title', 'customTitle');
  if (customTitle) {
    return firstLine(customTitle);
  }

  const aiTitle = lastOf('ai-title', 'aiTitle');
  if (aiTitle) {
    return firstLine(aiTitle);
  }

  // Legacy transcripts only.
  const summary = events.find(event => event.type === 'summary');
  const summaryText = asString(summary?.summary)?.trim();
  if (summaryText) {
    return firstLine(summaryText);
  }

  for (const event of events) {
    if (event.type !== 'user' || event.isMeta || event.isCompactSummary) {
      continue;
    }

    const message = asRecord(event.message);
    const raw = extractTextFromContent(message?.content, {
      includeToolResults: false,
      includeThinking: false
    });
    const text = stripPromptEnvelopes(raw);
    if (text) {
      return firstLine(text);
    }
  }

  const agentIds = new Set(
    events
      .filter(event => event.type === 'started' || event.type === 'result')
      .map(event => asString(event.agentId))
      .filter((id): id is string => Boolean(id))
  );
  if (agentIds.size > 0) {
    const results = events.filter(event => event.type === 'result').length;
    return `Workflow run · ${agentIds.size} agents · ${results} results`;
  }

  if (sessionId) {
    return `Claude Session ${sessionId.slice(0, 8)}`;
  }

  return 'Claude Session';
};

const extractTextFromContent = (
  content: unknown,
  options: {
    includeToolResults?: boolean;
    includeThinking?: boolean;
  } = {}
): string => renderToText(content, options).text;

const buildMessage = ({
  id,
  role,
  channel,
  text,
  timestamp,
  event,
  name,
  recipient,
  toolUseId,
  toolUseResult,
  eventKind,
  severity,
  images,
  toolCaller,
  thinkingSignature,
  thinkingTextStored,
  lineIndex,
  toolInput
}: {
  id: string;
  role: MessageRole;
  channel: MessageChannel;
  text: string;
  timestamp: string | null;
  event: UnknownRecord;
  name?: string;
  recipient?: string;
  toolUseId?: string;
  toolUseResult?: unknown;
  eventKind?: string;
  severity?: Severity;
  images?: MessageImage[];
  toolCaller?: string;
  thinkingSignature?: string;
  thinkingTextStored?: boolean;
  lineIndex: number;
  toolInput?: unknown;
}): NormalizedMessage => ({
  id,
  role,
  channel,
  lineIndex,
  ...truncateForRow(text),
  toolInput,
  images: images && images.length > 0 ? images : undefined,
  toolCaller,
  thinkingSignature,
  thinkingTextStored,
  attribution: getAttribution(event),
  effort: asString(event.effort) ?? undefined,
  agentName: asString(event.agentName) ?? undefined,
  teamName: asString(event.teamName) ?? undefined,
  promptSource: asString(event.promptSource) ?? undefined,
  promptId: asString(event.promptId) ?? undefined,
  toolDenialKind: asString(event.toolDenialKind) ?? undefined,
  interruptedMessageId: asString(event.interruptedMessageId) ?? undefined,
  errorInfo: getErrorInfo(event),
  timestamp,
  lineType: (asString(event.type) ?? undefined) as
    | ClaudeSessionLineType
    | undefined,
  eventKind,
  severity: severity ?? (getErrorInfo(event) ? 'error' : undefined),
  uuid: asString(event.uuid) ?? undefined,
  sessionId: asString(event.sessionId),
  name,
  recipient,
  isSidechain: Boolean(event.isSidechain),
  isMeta: asBoolean(event.isMeta),
  isCompactSummary: asBoolean(event.isCompactSummary),
  isVisibleInTranscriptOnly: asBoolean(event.isVisibleInTranscriptOnly),
  parentUuid: asString(event.parentUuid),
  agentId: asString(event.agentId) ?? undefined,
  slug: asString(event.slug) ?? undefined,
  requestId: asString(event.requestId) ?? undefined,
  model: asString(asRecord(event.message)?.model) ?? undefined,
  toolUseId,
  parentToolUseId: firstString(event.parent_tool_use_id, event.parentToolUseId),
  sourceToolAssistantUUID: asString(event.sourceToolAssistantUUID) ?? undefined,
  toolUseResult,
  usage: asRecord(asRecord(event.message)?.usage) ?? undefined,
  raw: event
});

const getMessageId = (
  event: UnknownRecord,
  index: number,
  suffix: string
): string => {
  const uuid = asString(event.uuid);
  return uuid ? `${uuid}:${suffix}` : `${index}-${suffix}`;
};

const asStringList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string');
  return items.length ? items : undefined;
};

/** Attribution fields Claude Code writes on assistant lines. */
const getAttribution = (event: UnknownRecord): MessageAttribution | undefined => {
  const attribution: MessageAttribution = {
    agent: asString(event.attributionAgent) ?? undefined,
    skill: asString(event.attributionSkill) ?? undefined,
    plugin: asString(event.attributionPlugin) ?? undefined,
    mcpServer: asString(event.attributionMcpServer) ?? undefined,
    mcpTool: asString(event.attributionMcpTool) ?? undefined
  };

  return Object.values(attribution).some(Boolean) ? attribution : undefined;
};

/** Error, refusal and abort state on an assistant line. */
const getErrorInfo = (event: UnknownRecord): MessageErrorInfo | undefined => {
  const message = asRecord(event.message);
  const stopReason = asString(message?.stop_reason);
  const info: MessageErrorInfo = {
    isApiError: asBoolean(event.isApiErrorMessage),
    apiErrorStatus:
      asString(event.apiErrorStatus) ??
      (typeof event.apiErrorStatus === 'number'
        ? String(event.apiErrorStatus)
        : undefined),
    message: asString(event.error) ?? undefined,
    details: event.errorDetails,
    abortedMidStream: asBoolean(event.isAbortedMidStream),
    stopReason: stopReason === 'refusal' ? stopReason : undefined,
    quotaLimits: event.quotaLimits,
    supersedes: asStringList(event.supersedesUuids)
  };

  return Object.values(info).some(value => value !== undefined)
    ? info
    : undefined;
};

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Reads the session's own accounting off the last `cost-state` line. Claude Code
 * rewrites it as the session grows, so the last one is the running total.
 */
const getSessionCost = (events: UnknownRecord[]): ClaudeSessionCost | null => {
  let latest: UnknownRecord | null = null;
  for (const event of events) {
    if (event.type === 'cost-state') latest = event;
  }
  if (!latest) return null;

  const usage = asRecord(latest.modelUsage) ?? {};
  return {
    totalCostUSD: asNumber(latest.totalCostUSD),
    totalDurationMs: asNumber(latest.totalDuration),
    totalApiDurationMs: asNumber(latest.totalAPIDuration),
    totalToolDurationMs: asNumber(latest.totalToolDuration),
    linesAdded: asNumber(latest.totalLinesAdded),
    linesRemoved: asNumber(latest.totalLinesRemoved),
    hasUnknownModelCost: Boolean(latest.hasUnknownModelCost),
    modelUsage: Object.entries(usage).map(([model, raw]) => {
      const stats = asRecord(raw) ?? {};
      return {
        model,
        costUSD: asNumber(stats.costUSD),
        inputTokens: asNumber(stats.inputTokens),
        outputTokens: asNumber(stats.outputTokens),
        cacheReadInputTokens: asNumber(stats.cacheReadInputTokens),
        cacheCreationInputTokens: asNumber(stats.cacheCreationInputTokens),
        webSearchRequests: asNumber(stats.webSearchRequests)
      };
    })
  };
};

interface ToolUseInfo {
  name: string;
  assistantUuid?: string;
  input?: unknown;
}

const getToolInfoFromUserContentPart = (
  part: UnknownRecord,
  toolUseMap: Map<string, ToolUseInfo>
): ToolUseInfo | undefined => {
  const toolUseId = asString(part.tool_use_id);
  if (!toolUseId) {
    return undefined;
  }

  return toolUseMap.get(toolUseId);
};

const parseAssistantMessage = (
  event: UnknownRecord,
  index: number
): NormalizedMessage[] => {
  const message = asRecord(event.message);
  const content = Array.isArray(message?.content) ? message?.content : [];
  const timestamp = asString(event.timestamp);
  const messages: NormalizedMessage[] = [];

  // Blocks that get a row of their own, so they must not also land in the
  // assistant's visible text.
  const OWN_ROW = new Set([
    'thinking',
    'redacted_thinking',
    'tool_use',
    'server_tool_use',
    'image',
    'fallback',
    'web_search_tool_result'
  ]);

  const visibleText = renderToText(
    content.filter(isRecord).filter(part => !OWN_ROW.has(asString(part.type) ?? ''))
  ).text;

  if (visibleText) {
    messages.push(
      buildMessage({
        id: getMessageId(event, index, 'assistant'),
        role: 'assistant',
        channel: 'message',
        text: visibleText,
        timestamp,
        event,
        lineIndex: index
      })
    );
  }

  content.filter(isRecord).forEach((part, partIndex) => {
    if (part.type === 'thinking' || part.type === 'redacted_thinking') {
      const thinkingText =
        typeof part.thinking === 'string' && part.thinking.trim() !== ''
          ? part.thinking
          : null;
      messages.push(
        buildMessage({
          id: getMessageId(event, index, `thinking-${partIndex}`),
          role: 'assistant',
          channel: 'thinking',
          text:
            thinkingText ??
            (part.type === 'redacted_thinking'
              ? '[thinking redacted]'
              : '[thinking text not stored]'),
          timestamp,
          event,
          lineIndex: index,
          thinkingSignature: asString(part.signature) ?? undefined,
          thinkingTextStored: thinkingText !== null
        })
      );
    }

    if (part.type === 'tool_use' || part.type === 'server_tool_use') {
      const toolName = asString(part.name) ?? asString(part.type) ?? 'tool';
      const toolUseId = asString(part.id) ?? undefined;
      messages.push(
        buildMessage({
          id: getMessageId(event, index, `tool-call-${partIndex}`),
          role: 'tool',
          channel: 'tool_call',
          text: describeToolInput(toolName, part.input),
          timestamp,
          event,
          lineIndex: index,
          name: toolName,
          recipient: toolName,
          toolUseId,
          toolInput: part.input,
          toolCaller:
            asString(asRecord(part.caller)?.type) ??
            asString(part.caller) ??
            undefined
        })
      );
    }

    if (part.type === 'web_search_tool_result') {
      const rendered = renderToText(part.content);
      messages.push(
        buildMessage({
          id: getMessageId(event, index, `tool-result-${partIndex}`),
          role: 'tool',
          channel: 'tool_result',
          text: rendered.text || describeToolUseResult(part, rendered.images),
          timestamp,
          event,
          lineIndex: index,
          name: 'web_search_tool_result',
          recipient: 'web_search',
          images: rendered.images
        })
      );
    }

    if (part.type === 'image') {
      const image = toImage(part);
      messages.push(
        buildMessage({
          id: getMessageId(event, index, `image-${partIndex}`),
          role: 'assistant',
          channel: 'message',
          text: image ? `[image ${image.mediaType}]` : '[image]',
          timestamp,
          event,
          lineIndex: index,
          name: 'image',
          images: image ? [image] : undefined
        })
      );
    }

    if (part.type === 'fallback') {
      messages.push(
        buildMessage({
          id: getMessageId(event, index, `fallback-${partIndex}`),
          role: 'system',
          channel: 'event',
          text: renderToText([part]).text,
          timestamp,
          event,
          lineIndex: index,
          name: 'model_fallback',
          eventKind: 'content:fallback',
          severity: 'notice'
        })
      );
    }
  });

  return messages;
};

const parseUserMessageWithToolMap = (
  event: UnknownRecord,
  index: number,
  toolUseMap: Map<string, ToolUseInfo>
): NormalizedMessage[] => {
  const message = asRecord(event.message);
  const content = message?.content;
  const timestamp = asString(event.timestamp);
  const messages: NormalizedMessage[] = [];

  const directText = extractTextFromContent(content, {
    includeToolResults: false,
    includeThinking: false
  }).trim();
  if (directText) {
    messages.push(
      buildMessage({
        id: getMessageId(event, index, 'user'),
        role: 'user',
        channel: 'message',
        text: directText,
        timestamp,
        event,
        lineIndex: index
      })
    );
  }

  if (Array.isArray(content)) {
    content.filter(isRecord).forEach((part, partIndex) => {
      if (part.type === 'tool_result') {
        const toolUseId = asString(part.tool_use_id) ?? undefined;
        const toolInfo = getToolInfoFromUserContentPart(part, toolUseMap);
        const topLevelToolResult = hasOwn(event, 'toolUseResult')
          ? event.toolUseResult
          : undefined;
        const toolName =
          toolInfo?.name ??
          asString(asRecord(topLevelToolResult)?.type) ??
          toolUseId;
        const rendered = renderToText(part.content);
        const text =
          rendered.text ||
          describeToolUseResult(topLevelToolResult, rendered.images) ||
          (part.is_error === true ? '[tool error, no output]' : '[no output]');
        messages.push(
          buildMessage({
            id: getMessageId(event, index, `tool-result-${partIndex}`),
            role: 'tool',
            channel: 'tool_result',
            text,
            timestamp,
            event,
            lineIndex: index,
            name: toolName,
            recipient: toolName,
            toolUseId,
            toolUseResult: topLevelToolResult,
            images: rendered.images,
            severity: part.is_error === true ? 'warning' : undefined
          })
        );
      }
    });
  }

  const topLevelToolResult = hasOwn(event, 'toolUseResult')
    ? event.toolUseResult
    : undefined;
  const hasToolResultPart =
    Array.isArray(content) &&
    content.filter(isRecord).some(part => part.type === 'tool_result');

  if (topLevelToolResult !== undefined && !hasToolResultPart) {
    const images: MessageImage[] = [];
    messages.push(
      buildMessage({
        id: getMessageId(event, index, 'top-level-tool-result'),
        role: 'tool',
        channel: 'tool_result',
        text: describeToolUseResult(topLevelToolResult, images) || '[no output]',
        timestamp,
        event,
        lineIndex: index,
        name: asString(asRecord(topLevelToolResult)?.type) ?? undefined,
        recipient: asString(event.sourceToolAssistantUUID) ?? undefined,
        toolUseResult: topLevelToolResult,
        images
      })
    );
  }

  return messages;
};

const collectToolUseMap = (events: UnknownRecord[]): Map<string, ToolUseInfo> => {
  const toolUseMap = new Map<string, ToolUseInfo>();

  for (const event of events) {
    if (event.type !== 'assistant') {
      continue;
    }

    const message = asRecord(event.message);
    const content = Array.isArray(message?.content) ? message?.content : [];
    for (const part of content.filter(isRecord)) {
      if (part.type !== 'tool_use' && part.type !== 'server_tool_use') {
        continue;
      }

      const id = asString(part.id);
      const name = asString(part.name);
      if (id && name) {
        toolUseMap.set(id, {
          name,
          assistantUuid: asString(event.uuid) ?? undefined,
          input: part.input
        });
      }
    }
  }

  return toolUseMap;
};

const parseEventRow = (event: UnknownRecord, index: number): NormalizedMessage => {
  const timestamp = asString(event.timestamp);
  const topLevelType = asString(event.type) ?? 'event';
  const described = describeEvent(event);
  const summaryText = asString(event.summary);

  return buildMessage({
    id:
      asString(event.uuid) ??
      (summaryText
        ? `summary-${asString(event.leafUuid) ?? index}`
        : `${index}-event`),
    role:
      topLevelType === 'permission-mode' ||
      topLevelType === 'summary' ||
      topLevelType === 'last-prompt'
        ? 'meta'
        : 'system',
    channel: 'event',
    text: described.text,
    timestamp,
    event,
    lineIndex: index,
    name: described.label,
    eventKind: described.kind,
    severity: described.severity
  });
};

const parseUnsupportedLine = (
  line: unknown,
  index: number
): NormalizedMessage => {
  const raw =
    asRecord(line) ??
    ({
      original: typeof line === 'string' ? line : stringify(line)
    } satisfies UnknownRecord);

  return buildMessage({
    id: `${index}-parse-warning`,
    role: 'meta',
    channel: 'event',
    text: `Skipped unsupported or malformed line at index ${index}.\n\n${stringify(line)}`,
    timestamp: null,
    lineIndex: index,
    event: {
      type: 'parse_warning',
      lineIndex: index,
      ...raw
    }
  });
};

const incrementCount = (
  counts: Record<string, number>,
  key: string | null
): void => {
  if (!key) {
    return;
  }

  counts[key] = (counts[key] ?? 0) + 1;
};

const collectUniqueStrings = (
  events: UnknownRecord[],
  field: string
): string[] => [
  ...new Set(
    events
      .map(event => asString(event[field]))
      .filter((value): value is string => Boolean(value))
  )
];

const buildChildrenByParentUuid = (
  events: UnknownRecord[],
  options: { conversationOnly?: boolean } = {}
): Record<string, string[]> => {
  const childrenByParentUuid: Record<string, string[]> = {};

  for (const event of events) {
    if (
      options.conversationOnly &&
      event.type !== 'user' &&
      event.type !== 'assistant'
    ) {
      continue;
    }

    const uuid = asString(event.uuid);
    const parentUuid = asString(event.parentUuid);
    if (!uuid || !parentUuid) {
      continue;
    }

    childrenByParentUuid[parentUuid] = [
      ...(childrenByParentUuid[parentUuid] ?? []),
      uuid
    ];
  }

  return childrenByParentUuid;
};

const collectBranchPoints = (
  childrenByParentUuid: Record<string, string[]>
): Array<{ uuid: string; children: string[] }> =>
  Object.entries(childrenByParentUuid)
    .filter(([, children]) => children.length > 1)
    .map(([uuid, children]) => ({ uuid, children }));

const countProgressForks = (events: UnknownRecord[]): number => {
  const childrenByParentUuid = buildChildrenByParentUuid(events);
  const eventByUuid = new Map(
    events.flatMap(event => {
      const uuid = asString(event.uuid);
      return uuid ? [[uuid, event]] : [];
    })
  );

  return collectBranchPoints(childrenByParentUuid).filter(branch =>
    branch.children.some(childUuid => eventByUuid.get(childUuid)?.type === 'progress')
  ).length;
};

const collectToolResultsByToolUseId = (
  events: UnknownRecord[]
): Record<string, string> => {
  const toolResultsByToolUseId: Record<string, string> = {};

  for (const event of events) {
    if (event.type !== 'user') {
      continue;
    }

    const content = asRecord(event.message)?.content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content.filter(isRecord)) {
      const toolUseId = asString(part.tool_use_id);
      const uuid = asString(event.uuid);
      if (part.type === 'tool_result' && toolUseId && uuid) {
        toolResultsByToolUseId[toolUseId] = uuid;
      }
    }
  }

  return toolResultsByToolUseId;
};

const collectContentBlockTypeCounts = (
  events: UnknownRecord[]
): Record<string, number> => {
  const contentBlockTypeCounts: Record<string, number> = {};

  for (const event of events) {
    const content = asRecord(event.message)?.content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content.filter(isRecord)) {
      incrementCount(contentBlockTypeCounts, asString(part.type));
    }
  }

  return contentBlockTypeCounts;
};

const buildMetadata = ({
  events,
  messages,
  metaSummary,
  stats,
  toolUseMap,
  warnings
}: {
  events: UnknownRecord[];
  messages: NormalizedMessage[];
  metaSummary: ClaudeMetaSummary | null;
  stats: ClaudeSessionStats;
  toolUseMap: Map<string, ToolUseInfo>;
  warnings: string[];
}): Record<string, unknown> => {
  const topLevelTypeCounts: Record<string, number> = {};
  events.forEach(event => incrementCount(topLevelTypeCounts, asString(event.type)));

  const childrenByParentUuid = buildChildrenByParentUuid(events);
  const conversationChildrenByParentUuid = buildChildrenByParentUuid(events, {
    conversationOnly: true
  });
  const branchPoints = collectBranchPoints(childrenByParentUuid);
  const conversationBranchPoints = collectBranchPoints(
    conversationChildrenByParentUuid
  );

  const uuidIndex = events.flatMap(event => {
    const uuid = asString(event.uuid);
    if (!uuid) {
      return [];
    }

    return [
      {
        uuid,
        type: asString(event.type),
        parentUuid: asString(event.parentUuid),
        sessionId: asString(event.sessionId),
        timestamp: asString(event.timestamp),
        isSidechain: Boolean(event.isSidechain),
        isMeta: Boolean(event.isMeta),
        isCompactSummary: Boolean(event.isCompactSummary),
        parentToolUseId: firstString(
          event.parent_tool_use_id,
          event.parentToolUseId
        ),
        agentId: asString(event.agentId),
        slug: asString(event.slug)
      }
    ];
  });

  const toolUseIndex = [...toolUseMap.entries()].map(([toolUseId, info]) => ({
    toolUseId,
    ...info
  }));

  return {
    sessionId: collectUniqueStrings(events, 'sessionId')[0] ?? null,
    importedMeta: metaSummary,
    stats,
    warnings,
    claudeFields: {
      sessionIds: collectUniqueStrings(events, 'sessionId'),
      cwd: collectUniqueStrings(events, 'cwd'),
      versions: collectUniqueStrings(events, 'version'),
      gitBranches: collectUniqueStrings(events, 'gitBranch'),
      userTypes: collectUniqueStrings(events, 'userType'),
      entrypoints: collectUniqueStrings(events, 'entrypoint'),
      permissionModes: collectUniqueStrings(events, 'permissionMode'),
      slugs: collectUniqueStrings(events, 'slug'),
      agentIds: collectUniqueStrings(events, 'agentId')
    },
    claudeIndexes: {
      topLevelTypeCounts,
      contentBlockTypeCounts: collectContentBlockTypeCounts(events),
      uuidIndex,
      childrenByParentUuid,
      branchPoints,
      conversationChildrenByParentUuid,
      conversationBranchPoints,
      progressForks: countProgressForks(events),
      toolUseIndex,
      toolResultsByToolUseId: collectToolResultsByToolUseId(events),
      summaries: events
        .filter(event => event.type === 'summary')
        .map(event => ({
          summary: asString(event.summary),
          leafUuid: asString(event.leafUuid)
        })),
      compactBoundaries: events
        .filter(
          event =>
            event.type === 'system' &&
            asString(event.subtype) === 'compact_boundary'
        )
        .map(event => ({
          uuid: asString(event.uuid),
          timestamp: asString(event.timestamp),
          logicalParentUuid: asString(event.logicalParentUuid),
          compactMetadata: event.compactMetadata
        }))
    },
    normalizedMessageCount: messages.length
  };
};

export const isClaudeSessionJSONL = (rawLines: unknown[]): boolean => {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    return false;
  }

  const events = rawLines.filter(isClaudeEvent);
  if (events.length === 0) {
    return false;
  }

  // A transcript is unambiguous as soon as it carries a turn.
  if (events.some(event => event.type === 'user' || event.type === 'assistant')) {
    return true;
  }

  // Otherwise every line has to be something Claude Code is known to write, or
  // to carry session identity. Workflow journals under subagents/workflows are
  // the case this exists for: they hold only `started` and `result` lines, and
  // the old 60% ratio gate refused all 612 of them.
  return events.every(event => {
    const type = asString(event.type) ?? '';
    return (
      isKnownClaudeLineType(type) ||
      typeof event.sessionId === 'string' ||
      typeof event.uuid === 'string'
    );
  });
};

export const parseClaudeMeta = (
  json: unknown,
  fileName?: string
): ClaudeMetaSummary | null => {
  const record = asRecord(json);
  if (!record) {
    return null;
  }

  // `<agentId>.meta.json` sits next to `<agentId>.jsonl`; the id is the stem.
  const agentIdFromFile = fileName
    ? (/([^/\\]+?)(?:\.meta)?\.(?:json|jsonl)$/u.exec(fileName)?.[1] ?? null)
    : null;

  return {
    agentId: asString(record.agentId) ?? agentIdFromFile,
    agentType: asString(record.agentType),
    description: asString(record.description),
    toolUseId: firstString(record.toolUseId, record.toolUseID) ?? null,
    name: asString(record.name),
    model: asString(record.model),
    parentAgentId: asString(record.parentAgentId),
    spawnDepth:
      typeof record.spawnDepth === 'number' ? record.spawnDepth : null,
    isFork: record.isFork === true,
    spawnedWithWorktree: record.spawnedWithWorktree === true,
    stoppedByUser: record.stoppedByUser === true,
    worktreePath: asString(record.worktreePath),
    worktreeBranch: asString(record.worktreeBranch),
    inheritedWorktreePath: asString(record.inheritedWorktreePath),
    raw: record
  };
};

export const parseClaudeSession = (
  rawLines: unknown[],
  meta?: unknown,
  metaFileName?: string
): ClaudeSessionParseResult | null => {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    return null;
  }

  const warnings: string[] = [];
  const events: UnknownRecord[] = [];
  const eventLineIndexes: number[] = [];
  const malformed: NormalizedMessage[] = [];

  rawLines.forEach((line, index) => {
    if (isClaudeEvent(line)) {
      events.push(line);
      eventLineIndexes.push(index);
      return;
    }

    warnings.push(`Skipped unsupported or malformed line at index ${index}.`);
    malformed.push(parseUnsupportedLine(line, index));
  });

  if (!isClaudeSessionJSONL(events)) {
    return null;
  }

  const toolUseMap = collectToolUseMap(events);
  const drafted: NormalizedMessage[] = [];

  // Rows are drawn in write order. Sorting by timestamp put every line without
  // one at the top and hid how far the file is from time order; the footer
  // reports that distance instead: a line counts when its timestamp precedes
  // the timestamped line written just before it. In the reference session that
  // is 756 of 5,624, mostly hooks stamped at their start and written after the
  // tool result they belong to.
  let outOfOrderLines = 0;
  let previousTime: number | null = null;

  events.forEach((event, at) => {
    const index = eventLineIndexes[at];
    const time = asString(event.timestamp) ? Date.parse(asString(event.timestamp) as string) : NaN;
    if (!Number.isNaN(time)) {
      if (previousTime !== null && time < previousTime) outOfOrderLines++;
      previousTime = time;
    }
    switch (event.type) {
      case 'assistant':
        drafted.push(...parseAssistantMessage(event, index));
        break;
      case 'user':
        drafted.push(
          ...parseUserMessageWithToolMap(event, index, toolUseMap)
        );
        break;
      default:
        drafted.push(parseEventRow(event, index));
        break;
    }
  });

  const { rows, folded } = foldByClass(drafted);
  const messages: NormalizedMessage[] = rows;

  const childrenByParentUuid = buildChildrenByParentUuid(events);
  const conversationChildrenByParentUuid = buildChildrenByParentUuid(events, {
    conversationOnly: true
  });
  const compactBoundaries = events.filter(
    event =>
      event.type === 'system' && asString(event.subtype) === 'compact_boundary'
  );
  const titleEventTypes = new Set(['custom-title', 'ai-title', 'last-prompt']);
  const conversationLineTypes = new Set(['user', 'assistant']);

  const stats: ClaudeSessionStats = {
    totalMessages: messages.length,
    toolCalls: messages.filter(message => message.channel === 'tool_call').length,
    toolResults: messages.filter(message => message.channel === 'tool_result')
      .length,
    eventMessages: messages.filter(message => message.channel === 'event').length,
    thinkingMessages: messages.filter(message => message.channel === 'thinking')
      .length,
    summaryMessages: events.filter(event => event.type === 'summary').length,
    fileSnapshots: events.filter(event => event.type === 'file-history-snapshot')
      .length,
    queueOperations: events.filter(event => event.type === 'queue-operation')
      .length,
    progressEvents: events.filter(event => event.type === 'progress').length,
    compactBoundaries: compactBoundaries.length,
    branchPoints: collectBranchPoints(childrenByParentUuid).length,
    conversationBranchPoints: collectBranchPoints(conversationChildrenByParentUuid)
      .length,
    progressForks: countProgressForks(events),
    titleEvents: events.filter(event =>
      titleEventTypes.has(asString(event.type) ?? '')
    ).length,
    metadataEvents: events.filter(
      event => !conversationLineTypes.has(asString(event.type) ?? '')
    ).length,
    malformedLines: warnings.length,
    hasSidechain:
      messages.some(message => message.isSidechain) ||
      events.some(event => Boolean(event.isSidechain)),
    hasCompact:
      compactBoundaries.length > 0 ||
      events.some(event => Boolean(event.isCompactSummary)),
    hasToolUseResult: events.some(event => hasOwn(event, 'toolUseResult'))
  };

  const sessionId = getSessionId(events);
  const metaSummary = meta ? parseClaudeMeta(meta, metaFileName) : null;

  const conversation: NormalizedConversation = {
    id: sessionId ?? `claude-session-${Date.now()}`,
    source: 'claude-session',
    sessionId,
    title: getTitle(events, sessionId),
    startedAt: getStartedAt(events),
    cost: getSessionCost(events),
    messages,
    folded,
    malformed,
    outOfOrderLines,
    metadata: buildMetadata({
      events,
      messages,
      metaSummary,
      stats,
      toolUseMap,
      warnings
    })
  };

  return {
    conversation,
    stats,
    warnings
  };
};
