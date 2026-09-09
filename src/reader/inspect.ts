import type { NormalizedMessage, ReaderEntry } from '../types/prism';
import { humanBytes, shortId } from './format';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

type Field = [key: string, value: string];

const fmt = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 79)}…` : value;
  if (Array.isArray(value)) return `${value.length} items`;
  if (isRecord(value)) return `{${Object.keys(value).slice(0, 6).join(', ')}}`;
  return String(value);
};

const push = (fields: Field[], key: string, value: unknown) => {
  const text = fmt(value);
  if (text !== null) fields.push([key, text]);
};

/** The fields worth reading for a line, above the raw JSON. */
export const inspectorFields = (
  line: NormalizedMessage,
  entry: ReaderEntry | null
): Field[] => {
  const fields: Field[] = [];
  const raw = line.raw;
  const inner = isRecord(raw.message) ? raw.message : null;
  const usage = isRecord(inner?.usage) ? inner.usage : null;
  const attachment = isRecord(raw.attachment) ? raw.attachment : null;
  const toolUseResult = isRecord(line.toolUseResult) ? line.toolUseResult : null;

  push(fields, 'type', raw.type);
  if (raw.subtype) push(fields, 'subtype', raw.subtype);
  if (attachment) push(fields, 'attachment.type', attachment.type);
  if (line.lineClass) push(fields, 'class', `${line.lineClass}${line.disposition ? ` · ${line.disposition}` : ''}`);
  push(fields, 'line', line.lineIndex + 1);
  push(fields, 'uuid', shortId(line.uuid, 8, 4));
  push(fields, 'parentUuid', line.parentUuid ? shortId(line.parentUuid, 8, 4) : raw.parentUuid === null ? 'null' : null);
  push(fields, 'timestamp', line.timestamp);
  if (line.requestId) push(fields, 'requestId', shortId(line.requestId, 8, 4));
  if (raw.apiBlockIndex !== undefined) push(fields, 'apiBlockIndex', raw.apiBlockIndex);
  if (line.model) push(fields, 'model', line.model);
  if (inner?.stop_reason) push(fields, 'stop_reason', inner.stop_reason);
  if (line.effort) push(fields, 'effort', line.effort);
  if (line.promptSource) push(fields, 'promptSource', line.promptSource);
  if (raw.permissionMode) push(fields, 'permissionMode', raw.permissionMode);
  if (raw.entrypoint) push(fields, 'entrypoint', raw.entrypoint);
  if (line.interruptedMessageId) push(fields, 'interruptedMessageId', shortId(line.interruptedMessageId, 8, 4));
  if (raw.toolEndsTurn !== undefined) push(fields, 'toolEndsTurn', raw.toolEndsTurn);
  if (line.toolDenialKind) push(fields, 'toolDenialKind', line.toolDenialKind);
  if (line.agentName) push(fields, 'agentName', line.agentName);
  if (line.teamName) push(fields, 'teamName', line.teamName);
  if (line.attribution) {
    for (const [key, value] of Object.entries(line.attribution)) push(fields, `attribution.${key}`, value);
  }
  if (line.channel === 'thinking') {
    push(fields, 'signature', line.thinkingSignature ? 'present' : 'absent');
    push(fields, 'thinking', line.thinkingTextStored ? `${(line.fullText ?? line.text).length.toLocaleString()} chars` : 'not stored');
  }
  if (line.toolUseId) push(fields, 'tool_use.id', shortId(line.toolUseId, 10, 4));
  if (line.toolCaller) push(fields, 'caller', line.toolCaller);
  if (line.channel === 'tool_result') {
    const part = Array.isArray(inner?.content)
      ? (inner.content as unknown[]).find(
          (block): block is UnknownRecord => isRecord(block) && block.tool_use_id === line.toolUseId
        )
      : null;
    if (part) push(fields, 'is_error', part.is_error === true);
    if (toolUseResult) {
      push(fields, 'toolUseResult', `{${Object.keys(toolUseResult).slice(0, 6).join(', ')}}`);
      if (toolUseResult.interrupted !== undefined) push(fields, 'interrupted', toolUseResult.interrupted);
      if (toolUseResult.returnCodeInterpretation) push(fields, 'returnCode', toolUseResult.returnCodeInterpretation);
      if (toolUseResult.backgroundTaskId) push(fields, 'backgroundTaskId', toolUseResult.backgroundTaskId);
      if (toolUseResult.persistedOutputPath) push(fields, 'spilled to', toolUseResult.persistedOutputPath);
      if (toolUseResult.agentId) push(fields, 'agentId', toolUseResult.agentId);
      if (toolUseResult.status) push(fields, 'status', toolUseResult.status);
      const file = isRecord(toolUseResult.file) ? toolUseResult.file : null;
      if (file) {
        push(fields, 'totalLines', file.totalLines);
        push(fields, 'startLine', file.startLine);
      }
    }
    push(fields, 'output', humanBytes(line.truncatedFrom ?? line.text.length));
  }
  if (line.errorInfo) {
    push(fields, 'isApiErrorMessage', line.errorInfo.isApiError);
    push(fields, 'apiErrorStatus', line.errorInfo.apiErrorStatus);
    push(fields, 'error', line.errorInfo.message);
    push(fields, 'isAbortedMidStream', line.errorInfo.abortedMidStream);
    push(fields, 'supersedesUuids', line.errorInfo.supersedes?.length);
  }
  if (usage) {
    push(fields, 'input_tokens', usage.input_tokens);
    push(fields, 'cache_read', usage.cache_read_input_tokens);
    push(fields, 'cache_creation', usage.cache_creation_input_tokens);
    push(fields, 'output_tokens', usage.output_tokens);
    push(fields, 'service_tier', usage.service_tier);
  }
  if (attachment) {
    for (const [key, value] of Object.entries(attachment)) {
      if (key === 'type' || fields.length > 28) continue;
      push(fields, key, value);
    }
  } else if (line.channel === 'event' && !inner) {
    for (const [key, value] of Object.entries(raw)) {
      if (['type', 'uuid', 'parentUuid', 'sessionId', 'timestamp', 'subtype'].includes(key)) continue;
      if (fields.length > 28) break;
      push(fields, key, value);
    }
  }
  if (line.images?.length) push(fields, 'images', line.images.length);
  if (line.groupCount && line.groupCount > 1) push(fields, 'collapsed', `${line.groupCount} lines`);
  if (entry && entry.folded.length) push(fields, 'folded', entry.folded.length);
  if (line.hostId) push(fields, 'folded onto', shortId(line.hostId, 12, 6));
  return fields;
};

export const gapFields = (entry: ReaderEntry): Field[] => {
  const gap = entry.gap;
  if (!gap) return [];
  return [
    ['gap', `${Math.round(gap.ms / 1000).toLocaleString()} s`],
    ['threshold', '600 s'],
    ['from', gap.from],
    ['to', gap.to],
    ['lines between', '0']
  ];
};
