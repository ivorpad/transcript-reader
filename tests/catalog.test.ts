import { describe, expect, test } from 'vitest';

import {
  CATALOG,
  catalogInventory,
  classifyAttachment,
  classifyContentBlock,
  classifyLine,
  classifyMessage,
  classifySystemSubtype,
  classifyTopLevel,
  dispositionOfAttachment,
  dispositionOfMessage,
  typeNameOf
} from '../src/adapters/claude/catalog';
import { parseClaudeSession } from '../src/adapters/claude/parser';
import { buildSessionView } from '../src/adapters/claude/session';
import type { NormalizedMessage } from '../src/types/reader';

/**
 * The inventory measured across ~/.claude/projects on 2026-09-09: 3,286 files,
 * 999,522 lines, Claude Code 2.1.193 through 2.1.263. A type that appears in
 * the corpus and falls to `unknown` is a defect; a type that is not here and
 * falls to `unknown` is the design working.
 */
const OBSERVED_TOP_LEVEL = [
  'attachment', 'assistant', 'user', 'last-prompt', 'mode', 'ai-title',
  'permission-mode', 'system', 'atis-latch', 'queue-operation',
  'file-history-snapshot', 'agent-setting', 'bridge-session',
  'file-history-delta', 'agent-name', 'relocated', 'worktree-state', 'started',
  'result', 'cost-state', 'frame-link', 'custom-title', 'pr-link',
  'artifact-autoreact-ledger', 'history-suppression', 'artifact-comment-monitor',
  'fork-context-ref'
];

const OBSERVED_SYSTEM_SUBTYPES = [
  'stop_hook_summary', 'turn_duration', 'away_summary', 'local_command',
  'informational', 'scheduled_task_fire', 'model_refusal_fallback',
  'agents_killed', 'model_refusal_no_fallback', 'compact_boundary',
  'model_consent_fallback'
];

const OBSERVED_ATTACHMENTS = [
  'hook_success', 'total_tokens_reminder', 'task_reminder',
  'deferred_tools_delta', 'skill_listing', 'output_style', 'queued_command',
  'mcp_instructions_delta', 'async_hook_response', 'bash_output_audience_note',
  'agent_listing_delta', 'batching_reminder_sent', 'edited_text_file',
  'auto_mode', 'hook_additional_context', 'hook_blocking_error',
  'hook_system_message', 'command_permissions', 'hook_non_blocking_error',
  'date_change', 'silent_turn_reminder', 'structured_output',
  'remote_session_change', 'goal_status', 'plan_mode', 'opened_file_in_ide',
  'hook_cancelled', 'plan_mode_exit', 'file', 'nested_memory',
  'selected_lines_in_ide', 'read_truncation_notice', 'ultra_effort_enter',
  'prompt_snapshot', 'compact_file_reference', 'workflow_size_guideline_change',
  'workflow_keyword_request', 'instructions', 'session_context', 'date',
  'environment', 'model', 'team_context', 'deferred_tools_record',
  'dynamic_skill', 'invoked_skills', 'plan_mode_reentry', 'diagnostics',
  'ultra_effort_exit'
];

const OBSERVED_CONTENT_BLOCKS = [
  'tool_result', 'tool_use', 'thinking', 'text', 'image', 'fallback', 'document',
  'tool_reference'
];

describe('the five-class catalog', () => {
  test('places every top-level type the corpus writes', () => {
    expect(OBSERVED_TOP_LEVEL).toHaveLength(27);
    const unplaced = OBSERVED_TOP_LEVEL.filter(
      type =>
        type !== 'attachment' &&
        type !== 'system' &&
        classifyTopLevel(type) === 'unknown'
    );
    expect(unplaced).toEqual([]);
    expect(catalogInventory().topLevel).toEqual([...OBSERVED_TOP_LEVEL].sort());
  });

  test('places every system subtype the corpus writes', () => {
    expect(OBSERVED_SYSTEM_SUBTYPES).toHaveLength(11);
    expect(
      OBSERVED_SYSTEM_SUBTYPES.filter(subtype => classifySystemSubtype(subtype) === 'unknown')
    ).toEqual([]);
    expect(catalogInventory().systemSubtypes).toEqual([...OBSERVED_SYSTEM_SUBTYPES].sort());
  });

  test('places every attachment type the corpus writes', () => {
    expect(OBSERVED_ATTACHMENTS).toHaveLength(49);
    expect(
      OBSERVED_ATTACHMENTS.filter(type => classifyAttachment(type) === 'unknown')
    ).toEqual([]);
    expect(catalogInventory().attachmentTypes).toEqual([...OBSERVED_ATTACHMENTS].sort());
  });

  test('places every content block type', () => {
    expect(OBSERVED_CONTENT_BLOCKS).toHaveLength(8);
    expect(
      OBSERVED_CONTENT_BLOCKS.filter(type => classifyContentBlock(type) === 'unknown')
    ).toEqual([]);
  });

  test('is a lookup: anything unseen falls to unknown rather than throwing', () => {
    expect(classifyTopLevel('signal-relay')).toBe('unknown');
    expect(classifySystemSubtype('brand_new')).toBe('unknown');
    expect(classifyAttachment('brand_new_thing')).toBe('unknown');
    expect(classifyContentBlock('hologram')).toBe('unknown');
    expect(classifyLine({ type: 'signal-relay' })).toBe('unknown');
    expect(classifyLine({ type: 'attachment', attachment: { type: 'nope' } })).toBe('unknown');
    expect(classifyLine('not even an object')).toBe('unknown');
    expect(classifyLine({ type: 'system', subtype: 'compact_boundary' })).toBe('read');
    expect(classifyLine({ type: 'attachment', attachment: { type: 'hook_success' } })).toBe('fold');
    expect(classifyLine({ type: 'mode' })).toBe('panel');
  });

  test('the design hand-places two dispositions', () => {
    expect(dispositionOfAttachment('hook_blocking_error')).toBe('own-row');
    expect(dispositionOfAttachment('total_tokens_reminder')).toBe('row');
    expect(dispositionOfAttachment('hook_success')).toBe('row');
    expect(dispositionOfAttachment('skill_listing')).toBe('panel');
    expect(dispositionOfAttachment('queued_command')).toBe('mark');
    expect(dispositionOfAttachment('never_seen')).toBe('own-row');
  });

  test('every class has members and a rule', () => {
    expect(CATALOG.map(entry => entry.name)).toEqual(['read', 'fold', 'mark', 'panel', 'unknown']);
    for (const entry of CATALOG) {
      expect(entry.items.length).toBeGreaterThan(0);
      expect(entry.rule.length).toBeGreaterThan(20);
    }
    const placed = CATALOG.filter(entry => entry.name !== 'unknown').flatMap(entry => entry.items);
    expect(new Set(placed).size).toBe(placed.length);
    // 25 named top-level types + 8 blocks + 11 subtypes + 49 attachments.
    expect(placed).toHaveLength(25 + 8 + 11 + 49);
  });
});

describe('classifying normalised rows', () => {
  const session = (extra: Array<Record<string, unknown>>) =>
    parseClaudeSession([
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:00.000Z',
        message: { role: 'user', content: 'hello' }
      },
      ...extra
    ]);

  const everyLine = (parsed: ReturnType<typeof parseClaudeSession>): NormalizedMessage[] => {
    const lines: NormalizedMessage[] = [];
    for (const message of parsed?.conversation.messages ?? []) {
      lines.push(message, ...(message.groupedMessages ?? []), ...(message.folded ?? []));
    }
    lines.push(...(parsed?.conversation.folded ?? []), ...(parsed?.conversation.malformed ?? []));
    return lines;
  };

  test('conversational rows are read; a thinking block with no stored text is a mark', () => {
    const parsed = session([
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        sessionId: 's1',
        requestId: 'req_1',
        timestamp: '2026-09-08T10:00:01.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '', signature: 'sig' },
            { type: 'text', text: 'answer' },
            { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }
          ]
        }
      },
      {
        type: 'assistant',
        uuid: 'a2',
        parentUuid: 'a1',
        sessionId: 's1',
        requestId: 'req_2',
        timestamp: '2026-09-08T10:00:02.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'a summary', signature: 'sig' }]
        }
      }
    ]);

    const rows = parsed?.conversation.messages ?? [];
    const byChannel = (channel: string) => rows.filter(row => row.channel === channel);
    expect(byChannel('message').every(row => row.lineClass === 'read')).toBe(true);
    expect(byChannel('tool_call')[0].lineClass).toBe('read');
    const thinking = byChannel('thinking');
    expect(thinking).toHaveLength(2);
    expect(thinking.find(row => row.thinkingTextStored === false)?.lineClass).toBe('mark');
    expect(thinking.find(row => row.thinkingTextStored === true)?.lineClass).toBe('read');
  });

  test('every event carries the class and disposition the catalog gives it', () => {
    const parsed = session([
      { type: 'mode', mode: 'plan', sessionId: 's1', uuid: 'm1' },
      {
        type: 'attachment',
        uuid: 'h1',
        sessionId: 's1',
        attachment: { type: 'hook_success', hookName: 'x', exitCode: 0 }
      },
      {
        type: 'attachment',
        uuid: 'q1',
        sessionId: 's1',
        attachment: { type: 'queued_command', prompt: 'later', commandMode: 'prompt' }
      },
      { type: 'system', subtype: 'compact_boundary', uuid: 'c1', sessionId: 's1', compactMetadata: {} },
      { type: 'signal-relay', uuid: 'x1', sessionId: 's1', relayId: 'r' }
    ]);

    const byUuid = new Map(everyLine(parsed).map(line => [line.uuid, line]));
    const expectClass = (uuid: string, lineClass: string, disposition: string) => {
      const line = byUuid.get(uuid) as NormalizedMessage;
      expect(classifyMessage(line)).toBe(lineClass);
      expect(line.lineClass).toBe(lineClass);
      expect(dispositionOfMessage(line)).toBe(disposition);
      expect(line.disposition).toBe(disposition);
    };
    expectClass('m1', 'panel', 'panel');
    expectClass('h1', 'fold', 'row');
    expectClass('q1', 'mark', 'mark');
    expectClass('c1', 'read', 'own-row');
    expectClass('x1', 'unknown', 'own-row');

    expect(typeNameOf(byUuid.get('h1') as NormalizedMessage)).toBe('hook_success');
    expect(typeNameOf(byUuid.get('c1') as NormalizedMessage)).toBe('system:compact_boundary');
    expect(typeNameOf(byUuid.get('m1') as NormalizedMessage)).toBe('mode');
    expect(typeNameOf(byUuid.get('x1') as NormalizedMessage)).toBe('signal-relay');
  });

  test('only read, mark and unknown lines draw rows', () => {
    const parsed = session([
      { type: 'mode', mode: 'plan', sessionId: 's1', uuid: 'm1' },
      { type: 'permission-mode', permissionMode: 'default', sessionId: 's1', uuid: 'p1' },
      {
        type: 'attachment',
        uuid: 'h1',
        sessionId: 's1',
        attachment: { type: 'hook_success', hookName: 'x', exitCode: 0 }
      },
      {
        type: 'attachment',
        uuid: 'q1',
        sessionId: 's1',
        attachment: { type: 'queued_command', prompt: 'later', commandMode: 'prompt' }
      },
      { type: 'system', subtype: 'turn_duration', uuid: 't1', sessionId: 's1', durationMs: 12 }
    ]);

    const drawn = parsed?.conversation.messages ?? [];
    expect(drawn.every(row => row.lineClass === 'read' || row.lineClass === 'mark' || row.lineClass === 'unknown')).toBe(true);
    expect(drawn.map(row => row.uuid)).toEqual(['u1', 'q1']);
    expect(parsed?.conversation.folded.map(line => line.uuid).sort()).toEqual(['m1', 'p1', 't1']);
    expect(drawn[0].folded?.map(line => line.uuid)).toEqual(['h1']);
  });
});

describe('user lines the person did not type', () => {
  const session = (text: string, extra: Record<string, unknown> = {}) =>
    parseClaudeSession([
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:00.000Z',
        message: { role: 'user', content: 'real prompt' }
      },
      {
        type: 'user',
        uuid: 'u2',
        parentUuid: 'u1',
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:01.000Z',
        message: { role: 'user', content: text },
        ...extra
      }
    ]);

  test.each([
    ['[Request interrupted by user]', 'interrupt'],
    ['[Request interrupted by user for tool use]', 'interrupt'],
    ['<task-notification>\n<task-id>x</task-id>\n</task-notification>', 'notification'],
    ['<local-command-stdout>Compacted</local-command-stdout>', 'local']
  ])('%s is a mark, not a prompt', (text, tag) => {
    const parsed = session(text);
    const rows = parsed?.conversation.messages ?? [];
    expect(rows[1].lineClass).toBe('mark');
    expect(rows[0].lineClass).toBe('read');

    const view = buildSessionView(parsed as NonNullable<typeof parsed>, 2);
    expect(view.turns).toHaveLength(1);
    expect(view.entries[1].kind).toBe('event');
    expect(view.entries[1].tag).toBe(tag);
  });

  test('injected context marked isMeta is a mark, clipped behind an expand control', () => {
    const parsed = session('x'.repeat(2000), { isMeta: true, promptSource: 'system' });
    expect(parsed?.conversation.messages[1].lineClass).toBe('mark');
    const view = buildSessionView(parsed as NonNullable<typeof parsed>, 2);
    expect(view.turns).toHaveLength(1);
    expect(view.entries[1].tag).toBe('meta');
    expect(view.entries[1].sub).toBe('injected context · system');
    expect(view.entries[1].message?.text.length).toBe(400);
    expect(view.entries[1].message?.truncatedFrom).toBe(2000);
  });

  test('a compaction summary stays a read row even though it is marked meta', () => {
    const parsed = session('This session is being continued from a previous conversation.', {
      isMeta: true,
      isCompactSummary: true
    });
    expect(parsed?.conversation.messages[1].lineClass).toBe('read');
  });

  test('a slash command with an argument is still a prompt', () => {
    const parsed = session('<command-message>artifact-design</command-message>\n<command-args>make it</command-args>');
    expect(parsed?.conversation.messages[1].lineClass).toBe('read');
  });
});
