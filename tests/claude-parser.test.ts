import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  isClaudeSessionJSONL,
  parseClaudeMeta,
  parseClaudeSession
} from '../src/adapters/claude/parser';
import { buildSessionView } from '../src/adapters/claude/session';
import type {
  ClaudeSessionParseResult,
  NormalizedMessage
} from '../src/types/prism';

/**
 * A line can be a drawn row, a member of a collapsed run, folded onto a row,
 * routed to a panel, or malformed. A test about one line looks everywhere.
 */
const everyLine = (
  result: ClaudeSessionParseResult | null | undefined
): NormalizedMessage[] => {
  const conversation = result?.conversation;
  if (!conversation) return [];
  const seen = new Set<string>();
  const lines: NormalizedMessage[] = [];
  const visit = (message: NormalizedMessage) => {
    if (!seen.has(message.id)) {
      seen.add(message.id);
      lines.push(message);
    }
    for (const member of message.groupedMessages ?? []) visit(member);
    for (const folded of message.folded ?? []) visit(folded);
  };
  for (const message of conversation.messages) visit(message);
  for (const message of conversation.folded) visit(message);
  for (const message of conversation.malformed) visit(message);
  return lines;
};

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8');

const parseJSONLLines = (name: string) =>
  fixture(name)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as unknown);

describe('Claude session detection', () => {
  test('detects a main Claude session JSONL file', () => {
    const lines = parseJSONLLines('main-session.jsonl');

    expect(isClaudeSessionJSONL(lines)).toBe(true);
  });

  test('detects a subagent Claude session JSONL file', () => {
    const lines = parseJSONLLines('subagent-session.jsonl');

    expect(isClaudeSessionJSONL(lines)).toBe(true);
  });
});

describe('Claude session parsing', () => {
  test('parses a main session into a normalized conversation', () => {
    const lines = parseJSONLLines('main-session.jsonl');

    const result = parseClaudeSession(lines);

    expect(result).not.toBeNull();
    expect(result?.conversation.source).toBe('claude-session');
    expect(result?.conversation.sessionId).toBe(
      'd3d74cf2-b10e-47d5-a5ee-45ee2e113a0a'
    );
    expect(result?.conversation.messages.length).toBeGreaterThan(20);
    expect(result?.stats.hasSidechain).toBe(false);
    expect(result?.stats.eventMessages).toBeGreaterThan(0);
  });

  test('keeps sidechain markers and tool call/result channels', () => {
    const lines = parseJSONLLines('subagent-session.jsonl');

    const result = parseClaudeSession(lines);
    const channels = new Set(result?.conversation.messages.map(m => m.channel));
    const sidechainMessages =
      result?.conversation.messages.filter(m => m.isSidechain) ?? [];
    const recipients = new Set(
      result?.conversation.messages
        .map(message => message.recipient)
        .filter(Boolean) ?? []
    );

    expect(result).not.toBeNull();
    expect(sidechainMessages.length).toBeGreaterThan(0);
    expect(channels.has('tool_call')).toBe(true);
    expect(channels.has('tool_result')).toBe(true);
    expect(recipients.has('Bash')).toBe(true);
  });

  test('classifies attachment and system rows as event messages', () => {
    const lines = parseJSONLLines('main-session.jsonl');

    const result = parseClaudeSession(lines);
    const eventMessages =
      result?.conversation.messages.filter(message => message.channel === 'event') ??
      [];

    expect(eventMessages.length).toBeGreaterThan(0);
    expect(
      eventMessages.some(message =>
        String(message.raw.type).includes('attachment')
      )
    ).toBe(true);
    expect(
      eventMessages.some(message => String(message.raw.type).includes('system'))
    ).toBe(true);
  });

  test('preserves malformed lines as raw meta events and records a warning', () => {
    const brokenLines = `${fixture('main-session.jsonl')}\n{not-json}\n`;
    const parsed = brokenLines
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return line;
        }
      });

    const result = parseClaudeSession(parsed);

    expect(result).not.toBeNull();
    expect(result?.warnings.length).toBeGreaterThan(0);
    expect(
      everyLine(result).some(
        message =>
          message.role === 'meta' &&
          message.raw.type === 'parse_warning' &&
          String(message.text).includes('{not-json}')
      )
    ).toBe(true);
    expect(result?.conversation.messages.length).toBeGreaterThan(20);
  });

  test('aligns Claude session fields, summaries, compact markers, and tool results', () => {
    const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const lines = [
      {
        type: 'summary',
        summary: 'Synthetic summary title',
        leafUuid: 'assistant-1'
      },
      {
        parentUuid: null,
        isSidechain: false,
        type: 'user',
        message: { role: 'user', content: 'hello prism' },
        uuid: 'user-1',
        timestamp: '2026-04-24T01:00:00.000Z',
        userType: 'external',
        entrypoint: 'cli',
        cwd: '/tmp/prism',
        sessionId,
        version: '2.1.101',
        gitBranch: 'main',
        slug: 'synthetic-slug'
      },
      {
        parentUuid: 'user-1',
        isSidechain: false,
        type: 'assistant',
        message: {
          model: 'claude-opus-4-6',
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will inspect it.' },
            { type: 'redacted_thinking', data: 'encrypted-thinking' },
            {
              type: 'server_tool_use',
              id: 'srv_1',
              name: 'WebSearch',
              input: { query: 'Claude Code session fields' }
            }
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation: {
              ephemeral_5m_input_tokens: 2,
              ephemeral_1h_input_tokens: 0
            }
          }
        },
        requestId: 'req_synthetic',
        uuid: 'assistant-1',
        timestamp: '2026-04-24T01:00:01.000Z',
        userType: 'external',
        entrypoint: 'cli',
        cwd: '/tmp/prism',
        sessionId,
        version: '2.1.101',
        gitBranch: 'main',
        slug: 'synthetic-slug'
      },
      {
        parentUuid: 'assistant-1',
        isSidechain: false,
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'srv_1',
              content: 'search result text',
              is_error: false
            }
          ]
        },
        toolUseResult: {
          query: 'Claude Code session fields',
          results: [{ title: 'Result', url: 'https://example.com' }]
        },
        sourceToolAssistantUUID: 'assistant-1',
        uuid: 'tool-result-1',
        timestamp: '2026-04-24T01:00:02.000Z',
        userType: 'external',
        entrypoint: 'cli',
        cwd: '/tmp/prism',
        sessionId,
        version: '2.1.101',
        gitBranch: 'main',
        slug: 'synthetic-slug'
      },
      {
        type: 'system',
        subtype: 'compact_boundary',
        uuid: 'compact-1',
        logicalParentUuid: 'tool-result-1',
        parentUuid: 'tool-result-1',
        content: 'Conversation compacted',
        compactMetadata: { trigger: 'manual', preTokens: 1234 },
        timestamp: '2026-04-24T01:00:03.000Z',
        sessionId,
        cwd: '/tmp/prism',
        version: '2.1.101',
        gitBranch: 'main'
      },
      {
        type: 'queue-operation',
        operation: 'enqueue',
        content: 'queued prompt',
        sessionId,
        timestamp: '2026-04-24T01:00:04.000Z'
      },
      {
        type: 'progress',
        parentUuid: 'tool-result-1',
        uuid: 'progress-1',
        sessionId,
        timestamp: '2026-04-24T01:00:05.000Z',
        message: 'working'
      },
      {
        type: 'custom-title',
        customTitle: 'Synthetic renamed session',
        sessionId,
        timestamp: '2026-04-24T01:00:06.000Z'
      }
    ];

    const result = parseClaudeSession(lines);

    expect(result).not.toBeNull();
    // The fixture carries both a `summary` and a `custom-title`. Upstream
    // resolved `summary` first, which is why 304 real sessions showed a
    // slash-command envelope instead of the title sitting in the file.
    expect(result?.conversation.title).toBe('Synthetic renamed session');
    expect(result?.stats.summaryMessages).toBe(1);
    expect(result?.stats.compactBoundaries).toBe(1);
    expect(result?.stats.queueOperations).toBe(1);
    expect(result?.stats.progressEvents).toBe(1);
    expect(result?.stats.titleEvents).toBe(1);
    expect(result?.stats.metadataEvents).toBeGreaterThan(0);
    expect(result?.stats.progressForks).toBe(1);
    expect(result?.stats.branchPoints).toBe(1);
    expect(result?.stats.conversationBranchPoints).toBe(0);
    expect(result?.stats.hasCompact).toBe(true);
    expect(result?.stats.hasToolUseResult).toBe(true);

    const toolResults =
      result?.conversation.messages.filter(
        message => message.channel === 'tool_result'
      ) ?? [];
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toMatchObject({
      uuid: 'tool-result-1',
      sessionId,
      lineType: 'user',
      toolUseId: 'srv_1',
      name: 'WebSearch',
      sourceToolAssistantUUID: 'assistant-1'
    });
    expect(toolResults[0].toolUseResult).toEqual({
      query: 'Claude Code session fields',
      results: [{ title: 'Result', url: 'https://example.com' }]
    });

    const toolCall = result?.conversation.messages.find(
      message => message.channel === 'tool_call'
    );
    expect(toolCall).toMatchObject({
      uuid: 'assistant-1',
      sessionId,
      requestId: 'req_synthetic',
      model: 'claude-opus-4-6',
      toolUseId: 'srv_1',
      name: 'WebSearch'
    });

    const duplicateUserToolText =
      result?.conversation.messages.filter(
        message =>
          message.channel === 'message' &&
          Array.isArray(
            (message.raw.message as { content?: unknown } | undefined)?.content
          ) &&
          (
            (message.raw.message as { content: Array<{ type?: string }> })
              .content
          ).every(part => part.type === 'tool_result')
      ) ?? [];
    expect(duplicateUserToolText).toHaveLength(0);

    const metadata = result?.conversation.metadata as {
      claudeFields: { sessionIds: string[]; versions: string[] };
      claudeIndexes: {
        childrenByParentUuid: Record<string, string[]>;
        conversationBranchPoints: Array<{ uuid: string; children: string[] }>;
        progressForks: number;
        toolResultsByToolUseId: Record<string, string>;
      };
    };
    expect(metadata.claudeFields.sessionIds).toContain(sessionId);
    expect(metadata.claudeFields.versions).toContain('2.1.101');
    expect(metadata.claudeIndexes.childrenByParentUuid['user-1']).toContain(
      'assistant-1'
    );
    expect(metadata.claudeIndexes.conversationBranchPoints).toHaveLength(0);
    expect(metadata.claudeIndexes.progressForks).toBe(1);
    expect(metadata.claudeIndexes.toolResultsByToolUseId.srv_1).toBe(
      'tool-result-1'
    );
  });

  test('accepts newer session metadata entries and parent tool use linkage', () => {
    const lines = [
      {
        type: 'custom-title',
        customTitle: 'Named session',
        sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        timestamp: '2026-04-24T01:00:00.000Z'
      },
      {
        type: 'content-replacement',
        uuid: 'replacement-1',
        sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        timestamp: '2026-04-24T01:00:01.000Z',
        replacement: { kind: 'tool-output' }
      },
      {
        parentUuid: null,
        parent_tool_use_id: 'toolu_parent',
        isSidechain: true,
        agentId: 'agent-1',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'subagent result' }]
        },
        uuid: 'sidechain-assistant-1',
        timestamp: '2026-04-24T01:00:02.000Z',
        sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      }
    ];

    const result = parseClaudeSession(lines);
    const assistantMessage = result?.conversation.messages.find(
      message => message.role === 'assistant'
    );

    expect(result).not.toBeNull();
    expect(result?.stats.titleEvents).toBe(1);
    expect(result?.stats.metadataEvents).toBe(2);
    expect(assistantMessage?.parentToolUseId).toBe('toolu_parent');
    expect(assistantMessage?.agentId).toBe('agent-1');
  });

  test('keeps string toolUseResult as the structured tool result payload', () => {
    const lines = [
      {
        parentUuid: null,
        isSidechain: false,
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_error',
              content: 'Error: failed',
              is_error: true
            }
          ]
        },
        toolUseResult: 'Error: Exit code 128',
        uuid: 'string-result',
        timestamp: '2026-04-24T01:00:00.000Z',
        sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      }
    ];

    const result = parseClaudeSession(lines);
    const toolResult = result?.conversation.messages.find(
      message => message.channel === 'tool_result'
    );

    expect(toolResult?.toolUseResult).toBe('Error: Exit code 128');
    expect(result?.stats.hasToolUseResult).toBe(true);
  });
});

describe('Claude meta parsing', () => {
  test('summarizes a .meta.json file without pretending it is a session', () => {
    const meta = JSON.parse(fixture('subagent-session.meta.json')) as unknown;

    const summary = parseClaudeMeta(meta);

    expect(summary).not.toBeNull();
    expect(summary?.agentId).toBeNull();
    expect(summary?.agentType).toBe('general-purpose');
    expect(summary?.description).toContain('Search lab conversation logs');
  });
});

describe('claude session ingestion tolerance', () => {
  test('accepts a workflow journal that carries no user or assistant lines', () => {
    // subagents/workflows/wf_*/journal.jsonl holds only these two types. The
    // old 60% ratio gate refused all 612 of them in the reference corpus.
    const journal = [
      { type: 'started', key: 'v2:abc', agentId: 'a1b2c3' },
      {
        type: 'result',
        key: 'v2:abc',
        agentId: 'a1b2c3',
        result: { sections: { users: 'a finding' } }
      }
    ];

    expect(isClaudeSessionJSONL(journal)).toBe(true);

    const parsed = parseClaudeSession(journal);
    expect(parsed).not.toBeNull();
    expect(parsed?.warnings).toEqual([]);
    expect(everyLine(parsed)).toHaveLength(2);
    expect(everyLine(parsed).map(message => message.lineType)).toEqual([
      'started',
      'result'
    ]);
  });

  test('renders a line type it has never seen instead of dropping it', () => {
    const session = [
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:00.000Z',
        message: { role: 'user', content: 'hello' }
      },
      {
        type: 'not-a-real-type',
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:01.000Z',
        somethingNew: 42
      }
    ];

    const parsed = parseClaudeSession(session);
    expect(parsed?.warnings).toEqual([]);

    const unknown = parsed?.conversation.messages.find(
      message => message.lineType === 'not-a-real-type'
    );
    expect(unknown).toBeDefined();
    expect(unknown?.channel).toBe('event');
    expect(unknown?.raw.somethingNew).toBe(42);
  });

  test('keeps the twelve types the previous allowlist discarded', () => {
    const dropped = [
      'atis-latch',
      'bridge-session',
      'file-history-delta',
      'relocated',
      'started',
      'result',
      'cost-state',
      'frame-link',
      'artifact-autoreact-ledger',
      'history-suppression',
      'artifact-comment-monitor',
      'fork-context-ref'
    ];

    const session = [
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: null,
        sessionId: 's1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }
      },
      ...dropped.map((type, index) => ({
        type,
        sessionId: 's1',
        uuid: `e${index}`
      }))
    ];

    const parsed = parseClaudeSession(session);
    expect(parsed?.warnings).toEqual([]);
    const seen = new Set(
      everyLine(parsed).map(message => message.lineType)
    );
    for (const type of dropped) {
      expect(seen.has(type)).toBe(true);
    }
  });

  test('still warns about lines that are genuinely malformed', () => {
    const session = [
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        sessionId: 's1',
        message: { role: 'user', content: 'hello' }
      },
      'not json at all',
      { noTypeField: true },
      { type: 'assistant', uuid: 'a1', parentUuid: null }
    ];

    const parsed = parseClaudeSession(session);
    expect(parsed?.warnings).toHaveLength(3);
  });

  test('treats turn_duration as a system subtype, not a line type', () => {
    const session = [
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        sessionId: 's1',
        message: { role: 'user', content: 'hello' }
      },
      {
        type: 'system',
        subtype: 'turn_duration',
        uuid: 'e1',
        parentUuid: 'u1',
        sessionId: 's1',
        durationMs: 4200
      }
    ];

    const parsed = parseClaudeSession(session);
    const row = everyLine(parsed).find(message => message.lineType === 'system');
    expect(row?.name).toBe('turn_duration');
    expect(row?.eventKind).toBe('system:turn_duration');
    expect(row?.lineClass).toBe('panel');
    expect(parsed?.warnings).toEqual([]);
  });
});

describe('event classification', () => {
  const wrap = (rows: Array<Record<string, unknown>>) =>
    parseClaudeSession([
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        sessionId: 's1',
        message: { role: 'user', content: 'hello' }
      },
      ...rows
    ]);

  const eventFor = (rows: Array<Record<string, unknown>>, uuid: string) =>
    everyLine(wrap(rows)).find(
      message => message.uuid === uuid
    );

  test('summarises a hook attachment instead of stringifying it', () => {
    const row = eventFor(
      [
        {
          type: 'attachment',
          uuid: 'e1',
          sessionId: 's1',
          attachment: {
            type: 'hook_success',
            hookName: 'format-on-write',
            hookEvent: 'PostToolUse',
            exitCode: 0,
            durationMs: 240,
            stdout: ''
          }
        }
      ],
      'e1'
    );

    expect(row?.eventKind).toBe('attachment:hook_success');
    expect(row?.severity).toBe('info');
    expect(row?.text).toBe('format-on-write · PostToolUse · exit 0 · 240ms');
  });

  test('marks a blocking hook as an error', () => {
    const row = eventFor(
      [
        {
          type: 'attachment',
          uuid: 'e1',
          sessionId: 's1',
          attachment: {
            type: 'hook_blocking_error',
            hookName: 'guard',
            hookEvent: 'PreToolUse',
            blockingError: 'refused to write outside the repo'
          }
        }
      ],
      'e1'
    );

    expect(row?.severity).toBe('error');
    expect(row?.text).toContain('refused to write outside the repo');
  });

  test('gives all eleven system subtypes a distinct kind', () => {
    const subtypes = [
      'compact_boundary',
      'turn_duration',
      'stop_hook_summary',
      'away_summary',
      'local_command',
      'informational',
      'scheduled_task_fire',
      'model_refusal_fallback',
      'model_refusal_no_fallback',
      'model_consent_fallback',
      'agents_killed'
    ];

    const parsed = wrap(
      subtypes.map((subtype, index) => ({
        type: 'system',
        subtype,
        uuid: `e${index}`,
        sessionId: 's1',
        content: `${subtype} happened`,
        durationMs: 1500
      }))
    );

    const rows = everyLine(parsed);
    const kinds = subtypes.map(
      subtype =>
        rows.find(message => message.eventKind === `system:${subtype}`)?.eventKind
    );
    expect(kinds).toEqual(subtypes.map(subtype => `system:${subtype}`));
    expect(new Set(kinds).size).toBe(subtypes.length);
  });

  test('escalates a refusal with no fallback to error severity', () => {
    const row = eventFor(
      [
        {
          type: 'system',
          subtype: 'model_refusal_no_fallback',
          uuid: 'e1',
          sessionId: 's1',
          originalModel: 'claude-opus-5',
          apiRefusalCategory: 'policy'
        }
      ],
      'e1'
    );

    expect(row?.severity).toBe('error');
    expect(row?.text).toContain('claude-opus-5');
  });

  test('lets system level drive severity', () => {
    const levels: Array<[string, string]> = [
      ['warning', 'warning'],
      ['notice', 'notice'],
      ['info', 'info'],
      ['suggestion', 'info']
    ];

    for (const [level, expected] of levels) {
      const row = eventFor(
        [
          {
            type: 'system',
            subtype: 'unlabelled',
            level,
            uuid: 'e1',
            sessionId: 's1',
            content: 'something happened'
          }
        ],
        'e1'
      );
      expect(row?.severity).toBe(expected);
    }
  });

  test('falls back to readable fields for an attachment it has never seen', () => {
    const row = eventFor(
      [
        {
          type: 'attachment',
          uuid: 'e1',
          sessionId: 's1',
          attachment: { type: 'brand_new_thing', label: 'a label', count: 3 }
        }
      ],
      'e1'
    );

    expect(row?.eventKind).toBe('attachment:brand_new_thing');
    expect(row?.text).toBe('label a label · count 3');
    expect(() => JSON.parse(row?.text ?? '')).toThrow();
  });

  test('flags a line type it has never seen as unknown', () => {
    const row = eventFor(
      [{ type: 'brand-new-line', uuid: 'e1', sessionId: 's1', detail: 'x' }],
      'e1'
    );

    expect(row?.eventKind).toBe('unknown:brand-new-line');
    expect(row?.text).toBe('detail x');
  });

  test('renders cost-state as money and time', () => {
    const row = eventFor(
      [
        {
          type: 'cost-state',
          uuid: 'e1',
          sessionId: 's1',
          totalCostUSD: 23.115844,
          totalDuration: 4445340,
          totalLinesAdded: 12,
          totalLinesRemoved: 4
        }
      ],
      'e1'
    );

    expect(row?.text).toBe('$23.12 · 74m · +12/-4 lines');
  });
});

describe('class-driven folding', () => {
  const turn = (uuid: string, text: string) => ({
    type: 'user' as const,
    uuid,
    parentUuid: null,
    sessionId: 's1',
    timestamp: '2026-09-08T10:00:00.000Z',
    message: { role: 'user', content: text }
  });

  test('routes latched state to the panel and counts its rewrites', () => {
    const modes = ['normal', 'normal', 'plan', 'plan', 'normal'];
    const lines = [
      turn('u1', 'hello'),
      ...modes.map((mode, index) => ({
        type: 'mode',
        mode,
        sessionId: 's1',
        uuid: `m${index}`
      }))
    ];
    const parsed = parseClaudeSession(lines);

    expect(
      parsed?.conversation.messages.filter(message => message.lineType === 'mode')
    ).toHaveLength(0);
    const routed = parsed?.conversation.folded.filter(line => line.lineType === 'mode');
    expect(routed).toHaveLength(5);
    expect(routed?.every(line => line.lineClass === 'panel')).toBe(true);

    const view = buildSessionView(parsed as ClaudeSessionParseResult, lines.length);
    expect(view.panels.state).toEqual([
      { key: 'mode', value: 'normal', writes: 5, changes: 2 }
    ]);
  });

  test('folds ten hook attachments onto the row written before them', () => {
    const parsed = parseClaudeSession([
      turn('u1', 'hello'),
      ...Array.from({ length: 10 }, (_, index) => ({
        type: 'attachment',
        uuid: `h${index}`,
        sessionId: 's1',
        timestamp: `2026-09-08T10:00:${String(index + 1).padStart(2, '0')}.000Z`,
        attachment: {
          type: 'hook_success',
          hookName: 'format',
          hookEvent: 'PostToolUse',
          exitCode: 0,
          durationMs: 10
        }
      }))
    ]);

    const events = parsed?.conversation.messages.filter(
      message => message.channel === 'event'
    );
    expect(events).toHaveLength(0);

    const host = parsed?.conversation.messages[0];
    expect(host?.role).toBe('user');
    expect(host?.folded).toHaveLength(10);
    expect(host?.folded?.every(line => line.hostId === host.id)).toBe(true);
    expect(host?.folded?.[0].disposition).toBe('row');
  });

  test('folds a tool-scoped hook onto the tool call it names', () => {
    const parsed = parseClaudeSession([
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: null,
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:00.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }
          ]
        }
      },
      {
        type: 'user',
        uuid: 'u2',
        parentUuid: 'a1',
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a.txt' }]
        },
        toolUseResult: { stdout: 'a.txt', stderr: '', interrupted: false }
      },
      {
        type: 'attachment',
        uuid: 'h1',
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:02.000Z',
        attachment: {
          type: 'hook_success',
          hookName: 'audit-bash',
          hookEvent: 'PostToolUse',
          exitCode: 0,
          durationMs: 12,
          toolUseID: 'toolu_1'
        }
      }
    ]);

    const events = parsed?.conversation.messages.filter(
      message => message.channel === 'event'
    );
    expect(events).toHaveLength(0);

    const call = parsed?.conversation.messages.find(
      message => message.channel === 'tool_call'
    );
    expect(call?.folded).toHaveLength(1);
    expect(call?.folded?.[0].text).toContain('audit-bash');
  });

  test('folds a reminder onto the line it was written under by parentUuid', () => {
    const parsed = parseClaudeSession([
      turn('u1', 'first'),
      turn('u2', 'second'),
      {
        type: 'attachment',
        uuid: 'r1',
        parentUuid: 'u1',
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:03.000Z',
        attachment: {
          type: 'total_tokens_reminder',
          text: '<total_tokens>150000 tokens left</total_tokens>'
        }
      }
    ]);

    const first = parsed?.conversation.messages.find(message => message.uuid === 'u1');
    const second = parsed?.conversation.messages.find(message => message.uuid === 'u2');
    expect(first?.folded).toHaveLength(1);
    expect(second?.folded).toBeUndefined();
    expect(first?.folded?.[0].lineClass).toBe('panel');
    expect(first?.folded?.[0].disposition).toBe('row');
  });

  test('sends a folded line with no row before it to the panel list', () => {
    const parsed = parseClaudeSession([
      {
        type: 'attachment',
        uuid: 'h0',
        sessionId: 's1',
        timestamp: '2026-09-08T09:59:59.000Z',
        attachment: { type: 'hook_success', hookName: 'early', exitCode: 0 }
      },
      turn('u1', 'hello')
    ]);

    expect(parsed?.conversation.messages).toHaveLength(1);
    expect(parsed?.conversation.folded.map(line => line.uuid)).toEqual(['h0']);
  });

  test('leaves a blocking hook on the timeline even when it names a tool', () => {
    const parsed = parseClaudeSession([
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: null,
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }]
        }
      },
      {
        type: 'attachment',
        uuid: 'h1',
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:02.000Z',
        attachment: {
          type: 'hook_blocking_error',
          hookName: 'guard',
          blockingError: 'nope',
          toolUseID: 'toolu_1'
        }
      }
    ]);

    const events = parsed?.conversation.messages.filter(
      message => message.channel === 'event'
    );
    expect(events).toHaveLength(1);
    expect(events?.[0].severity).toBe('error');
    expect(events?.[0].disposition).toBe('own-row');
  });

  test('draws an unknown type once and collapses its repeats', () => {
    const parsed = parseClaudeSession([
      turn('u1', 'hello'),
      ...Array.from({ length: 3 }, (_, index) => ({
        type: 'signal-relay',
        uuid: `s${index}`,
        sessionId: 's1',
        timestamp: `2026-09-08T10:00:0${index + 1}.000Z`,
        relayId: `rl_${index}`,
        channel: 'ide'
      }))
    ]);

    const rows = parsed?.conversation.messages.filter(
      message => message.channel === 'event'
    );
    expect(rows).toHaveLength(1);
    expect(rows?.[0].lineClass).toBe('unknown');
    expect(rows?.[0].groupCount).toBe(3);
    expect(rows?.[0].text).toContain('3 ×');
  });

  test('draws malformed lines nowhere and keeps them for the ledger', () => {
    const parsed = parseClaudeSession([turn('u1', 'hello'), 'not json at all']);

    expect(parsed?.conversation.messages).toHaveLength(1);
    expect(parsed?.conversation.malformed).toHaveLength(1);
    expect(parsed?.warnings).toHaveLength(1);
  });

  test('keeps write order and counts lines out of timestamp order', () => {
    const parsed = parseClaudeSession([
      turn('u1', 'first'),
      { ...turn('u2', 'second'), timestamp: '2026-09-08T09:00:00.000Z' },
      { ...turn('u3', 'third'), timestamp: '2026-09-08T11:00:00.000Z' }
    ]);

    expect(parsed?.conversation.messages.map(message => message.uuid)).toEqual([
      'u1',
      'u2',
      'u3'
    ]);
    expect(parsed?.conversation.outOfOrderLines).toBe(1);
  });

  test('never collapses a conversational row', () => {
    const parsed = parseClaudeSession([
      turn('u1', 'first'),
      turn('u2', 'second'),
      turn('u3', 'third'),
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u3',
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:03.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'hmm', signature: 'sig' },
            { type: 'text', text: 'answer' }
          ]
        }
      }
    ]);

    const channels = parsed?.conversation.messages.map(message => message.channel);
    expect(channels?.filter(channel => channel === 'message')).toHaveLength(4);
    expect(channels?.filter(channel => channel === 'thinking')).toHaveLength(1);
  });
});

describe('title resolution', () => {
  const session = (extra: Array<Record<string, unknown>>, prompt: string) => [
    {
      type: 'user' as const,
      uuid: 'u1',
      parentUuid: null,
      sessionId: 'abcdef12-0000-0000-0000-000000000000',
      timestamp: '2026-09-08T10:00:00.000Z',
      message: { role: 'user', content: prompt }
    },
    ...extra
  ];

  const titleOf = (lines: Array<Record<string, unknown>>) =>
    parseClaudeSession(lines)?.conversation.title;

  test('prefers custom-title over everything else', () => {
    expect(
      titleOf(
        session(
          [
            { type: 'ai-title', aiTitle: 'a generated title', sessionId: 's1' },
            { type: 'custom-title', customTitle: 'what I named it', sessionId: 's1' }
          ],
          'the original prompt'
        )
      )
    ).toBe('what I named it');
  });

  test('falls to ai-title when there is no custom title', () => {
    expect(
      titleOf(
        session(
          [{ type: 'ai-title', aiTitle: 'Design redesign consideration', sessionId: 's1' }],
          '<command-message>artifact-design</command-message>'
        )
      )
    ).toBe('Design redesign consideration');
  });

  test('takes the latest ai-title, not the first', () => {
    expect(
      titleOf(
        session(
          [
            { type: 'ai-title', aiTitle: 'early guess', sessionId: 's1' },
            { type: 'ai-title', aiTitle: 'what it became', sessionId: 's1' }
          ],
          'prompt'
        )
      )
    ).toBe('what it became');
  });

  test('still honours a legacy summary line', () => {
    expect(
      titleOf(session([{ type: 'summary', summary: 'an old summary', leafUuid: 'x' }], 'prompt'))
    ).toBe('an old summary');
  });

  test.each([
    ['<command-name>/clear</command-name>', '/clear'],
    ['<command-message>artifact-design</command-message>', 'artifact-design'],
    ['<local-command-stdout>noise</local-command-stdout>real prompt', 'real prompt'],
    ['<system-reminder>ignore me</system-reminder>the actual ask', 'the actual ask'],
    ['Caveat: this session was continued.\n\nthe real question', 'the real question']
  ])('strips %s down to the prompt', (prompt, expected) => {
    expect(titleOf(session([], prompt))).toBe(expected);
  });

  test('keeps the argument of a slash command', () => {
    expect(
      titleOf(
        session(
          [],
          '<command-name>/review</command-name><command-args>the auth module</command-args>'
        )
      )
    ).toBe('/review the auth module');
  });

  test('falls back to the session id when nothing names the session', () => {
    expect(
      titleOf([
        { type: 'mode', mode: 'normal', sessionId: 'abcdef12-0000-0000-0000-000000000000' }
      ])
    ).toBe('Claude Session abcdef12');
  });
});

describe('content blocks', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const assistant = (content: unknown[]) => ({
    type: 'assistant' as const,
    uuid: 'a1',
    parentUuid: null,
    sessionId: 's1',
    timestamp: '2026-09-08T10:00:00.000Z',
    message: { role: 'assistant', content }
  });

  test('exposes an assistant image instead of inlining its payload', () => {
    const parsed = parseClaudeSession([
      assistant([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }])
    ]);

    const row = parsed?.conversation.messages.find(message => message.images?.length);
    expect(row?.images?.[0].url).toBe(`data:image/png;base64,${PNG}`);
    expect(row?.images?.[0].mediaType).toBe('image/png');
    expect(row?.text).not.toContain(PNG);
    expect(row?.text).toContain('[image image/png]');
  });

  test('renders an image-only tool result as an image, not as JSON', () => {
    const parsed = parseClaudeSession([
      assistant([{ type: 'tool_use', id: 'toolu_1', name: 'Screenshot', input: {} }]),
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: 'a1',
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:01.000Z',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }
              ]
            }
          ]
        }
      }
    ]);

    const row = parsed?.conversation.messages.find(
      message => message.channel === 'tool_result'
    );
    expect(row?.images).toHaveLength(1);
    expect(row?.text).not.toContain(PNG);
    expect(() => JSON.parse(row?.text ?? '')).toThrow();
  });

  test('handles a mixed text and image tool result', () => {
    const parsed = parseClaudeSession([
      assistant([{ type: 'tool_use', id: 'toolu_1', name: 'Browser', input: {} }]),
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: 'a1',
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:01.000Z',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: [
                { type: 'text', text: 'page loaded' },
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }
              ]
            }
          ]
        }
      }
    ]);

    const row = parsed?.conversation.messages.find(
      message => message.channel === 'tool_result'
    );
    expect(row?.text).toContain('page loaded');
    expect(row?.images).toHaveLength(1);
  });

  test('renders a tool_reference block instead of dropping it', () => {
    const parsed = parseClaudeSession([
      assistant([{ type: 'tool_use', id: 'toolu_1', name: 'SendMessage', input: {} }]),
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: 'a1',
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:01.000Z',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: [{ type: 'tool_reference', tool_name: 'SendMessage' }]
            }
          ]
        }
      }
    ]);

    const row = parsed?.conversation.messages.find(
      message => message.channel === 'tool_result'
    );
    expect(row?.text).toBe('[tool reference: SendMessage]');
  });

  test('captures tool_use caller and thinking signature', () => {
    const parsed = parseClaudeSession([
      assistant([
        { type: 'thinking', thinking: 'weighing it up', signature: 'sig-abc' },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'Bash',
          input: {},
          caller: { type: 'direct' }
        }
      ])
    ]);

    const thinking = parsed?.conversation.messages.find(
      message => message.channel === 'thinking'
    );
    const call = parsed?.conversation.messages.find(
      message => message.channel === 'tool_call'
    );
    expect(thinking?.thinkingSignature).toBe('sig-abc');
    expect(call?.toolCaller).toBe('direct');
  });

  test('renders a fallback block as a model-fallback event', () => {
    const parsed = parseClaudeSession([
      assistant([
        { type: 'fallback', from: { model: 'claude-fable-5' }, to: { model: 'claude-opus-4-8' } }
      ])
    ]);

    const row = parsed?.conversation.messages.find(
      message => message.eventKind === 'content:fallback'
    );
    expect(row?.severity).toBe('notice');
    expect(row?.text).toBe('[model fallback: claude-fable-5 → claude-opus-4-8]');
  });

  test('names a document block rather than serialising it', () => {
    const parsed = parseClaudeSession([
      assistant([
        {
          type: 'text',
          text: 'here it is'
        },
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjcK' }
        }
      ])
    ]);

    const row = parsed?.conversation.messages.find(
      message => message.channel === 'message'
    );
    expect(row?.text).toContain('[document application/pdf');
    expect(row?.text).not.toContain('JVBERi0xLjcK');
  });

  test('caps an oversized row and keeps the rest for expansion', () => {
    const huge = 'x'.repeat(120_000);
    const parsed = parseClaudeSession([
      assistant([{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }]),
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: 'a1',
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: huge }]
        }
      }
    ]);

    const row = parsed?.conversation.messages.find(
      message => message.channel === 'tool_result'
    );
    expect(row?.text).toHaveLength(50_000);
    expect(row?.truncatedFrom).toBe(120_000);
    expect(row?.fullText).toHaveLength(120_000);
  });
});

describe('assistant and user fields', () => {
  const assistantLine = (extra: Record<string, unknown>) => ({
    type: 'assistant' as const,
    uuid: 'a1',
    parentUuid: null,
    sessionId: 's1',
    timestamp: '2026-09-08T10:00:00.000Z',
    message: {
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'text', text: 'answer' }]
    },
    ...extra
  });

  const rowOf = (extra: Record<string, unknown>) =>
    parseClaudeSession([assistantLine(extra)])?.conversation.messages[0];

  test('carries every attribution field', () => {
    const row = rowOf({
      attributionAgent: 'Explore',
      attributionSkill: 'artifact-design',
      attributionPlugin: 'hookify',
      attributionMcpServer: 'context7',
      attributionMcpTool: 'query-docs'
    });

    expect(row?.attribution).toEqual({
      agent: 'Explore',
      skill: 'artifact-design',
      plugin: 'hookify',
      mcpServer: 'context7',
      mcpTool: 'query-docs'
    });
  });

  test('leaves attribution undefined when the line has none', () => {
    expect(rowOf({}).attribution).toBeUndefined();
  });

  test('carries effort, agent name and team name', () => {
    const row = rowOf({ effort: 'high', agentName: 'reviewer', teamName: 'wasm-renderer' });
    expect(row?.effort).toBe('high');
    expect(row?.agentName).toBe('reviewer');
    expect(row?.teamName).toBe('wasm-renderer');
  });

  test.each([
    [{ isApiErrorMessage: true, apiErrorStatus: '529' }, 'apiErrorStatus', '529'],
    [{ isAbortedMidStream: true }, 'abortedMidStream', true],
    [{ error: 'overloaded' }, 'message', 'overloaded']
  ])('raises %o to error severity', (extra, field, expected) => {
    const row = rowOf(extra);
    expect(row?.severity).toBe('error');
    expect(row?.errorInfo?.[field as keyof typeof row.errorInfo]).toBe(expected);
  });

  test('treats a refusal stop reason as an error', () => {
    const parsed = parseClaudeSession([
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: null,
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:00.000Z',
        message: {
          role: 'assistant',
          stop_reason: 'refusal',
          content: [{ type: 'text', text: 'no' }]
        }
      }
    ]);

    const row = parsed?.conversation.messages[0];
    expect(row?.severity).toBe('error');
    expect(row?.errorInfo?.stopReason).toBe('refusal');
  });

  test('records quota limits and superseded turns', () => {
    const row = rowOf({
      quotaLimits: { resetsAt: '2026-09-08T11:00:00.000Z' },
      supersedesUuids: ['a0', 'a00']
    });
    expect(row?.errorInfo?.quotaLimits).toEqual({
      resetsAt: '2026-09-08T11:00:00.000Z'
    });
    expect(row?.errorInfo?.supersedes).toEqual(['a0', 'a00']);
  });

  test('carries user provenance onto the message', () => {
    const parsed = parseClaudeSession([
      {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:00.000Z',
        promptId: 'prompt-1',
        promptSource: 'typed',
        toolDenialKind: 'permission',
        agentName: 'lead',
        teamName: 'fleet',
        message: { role: 'user', content: 'do the thing' }
      }
    ]);

    const row = parsed?.conversation.messages[0];
    expect(row?.promptSource).toBe('typed');
    expect(row?.promptId).toBe('prompt-1');
    expect(row?.toolDenialKind).toBe('permission');
    expect(row?.agentName).toBe('lead');
  });

  test.each([
    'claude-opus-5',
    'claude-fable-5',
    'claude-fable-5-1',
    'claude-sonnet-5',
    'claude-opus-4-8',
    'claude-haiku-4-5-20251001',
    '<synthetic>'
  ])('records model %s', model => {
    const parsed = parseClaudeSession([
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: null,
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:00.000Z',
        message: { role: 'assistant', model, content: [{ type: 'text', text: 'x' }] }
      }
    ]);
    expect(parsed?.conversation.messages[0].model).toBe(model);
  });
});

describe('session cost', () => {
  const costLine = {
    type: 'cost-state',
    sessionId: 's1',
    totalCostUSD: 23.115844999999997,
    totalAPIDuration: 2_227_350,
    totalToolDuration: 410_992,
    totalDuration: 4_445_340,
    totalLinesAdded: 12,
    totalLinesRemoved: 4,
    hasUnknownModelCost: false,
    modelUsage: {
      'claude-opus-5': {
        inputTokens: 1400,
        outputTokens: 150_812,
        cacheReadInputTokens: 33_335_268,
        cacheCreationInputTokens: 266_984,
        webSearchRequests: 0,
        costUSD: 23.114773999999997
      }
    }
  };

  const turn = {
    type: 'user' as const,
    uuid: 'u1',
    parentUuid: null,
    sessionId: 's1',
    timestamp: '2026-09-08T10:00:00.000Z',
    message: { role: 'user', content: 'hello' }
  };

  test('reads the accounting off the cost-state line', () => {
    const cost = parseClaudeSession([turn, costLine])?.conversation.cost;

    expect(cost?.totalCostUSD).toBeCloseTo(23.1158, 4);
    expect(cost?.totalDurationMs).toBe(4_445_340);
    expect(cost?.totalApiDurationMs).toBe(2_227_350);
    expect(cost?.totalToolDurationMs).toBe(410_992);
    expect(cost?.linesAdded).toBe(12);
    expect(cost?.linesRemoved).toBe(4);
    expect(cost?.hasUnknownModelCost).toBe(false);
    expect(cost?.modelUsage).toEqual([
      {
        model: 'claude-opus-5',
        costUSD: 23.114773999999997,
        inputTokens: 1400,
        outputTokens: 150_812,
        cacheReadInputTokens: 33_335_268,
        cacheCreationInputTokens: 266_984,
        webSearchRequests: 0
      }
    ]);
  });

  test('takes the last cost-state line, since it is a running total', () => {
    const cost = parseClaudeSession([
      turn,
      { ...costLine, totalCostUSD: 1 },
      { ...costLine, totalCostUSD: 9 }
    ])?.conversation.cost;

    expect(cost?.totalCostUSD).toBe(9);
  });

  test('surfaces incomplete cost data rather than hiding it', () => {
    const cost = parseClaudeSession([
      turn,
      { ...costLine, hasUnknownModelCost: true }
    ])?.conversation.cost;

    expect(cost?.hasUnknownModelCost).toBe(true);
  });

  test('leaves cost null for a session that never wrote one', () => {
    expect(parseClaudeSession([turn])?.conversation.cost).toBeNull();
  });
});

describe('companion files', () => {
  test('derives agentId from the filename, since no meta.json carries it', () => {
    const meta = parseClaudeMeta(
      { agentType: 'general-purpose', description: 'Decide the spike', spawnDepth: 1 },
      'sessions/abc/subagents/a1b2c3d4e5f6.meta.json'
    );

    expect(meta?.agentId).toBe('a1b2c3d4e5f6');
    expect(meta?.agentType).toBe('general-purpose');
  });

  test('keeps every meta field the viewer can use', () => {
    const meta = parseClaudeMeta(
      {
        agentType: 'Explore',
        description: 'Sweep the parser',
        name: 'sweeper',
        model: 'claude-sonnet-5',
        toolUseId: 'toolu_01GwWUeXeRyQ6zK8sSAQRtzM',
        parentAgentId: 'aparent',
        spawnDepth: 2,
        isFork: true,
        spawnedWithWorktree: true,
        stoppedByUser: true,
        worktreePath: '/repo/.claude/worktrees/x',
        worktreeBranch: 'worktree-x',
        inheritedWorktreePath: '/repo/.claude/worktrees/y'
      },
      'a9f6aba853e77d597.meta.json'
    );

    expect(meta).toMatchObject({
      agentId: 'a9f6aba853e77d597',
      agentType: 'Explore',
      description: 'Sweep the parser',
      name: 'sweeper',
      model: 'claude-sonnet-5',
      toolUseId: 'toolu_01GwWUeXeRyQ6zK8sSAQRtzM',
      parentAgentId: 'aparent',
      spawnDepth: 2,
      isFork: true,
      spawnedWithWorktree: true,
      stoppedByUser: true,
      worktreePath: '/repo/.claude/worktrees/x',
      worktreeBranch: 'worktree-x',
      inheritedWorktreePath: '/repo/.claude/worktrees/y'
    });
  });

  test('defaults the optional flags rather than leaving them undefined', () => {
    const meta = parseClaudeMeta({ agentType: 'general-purpose' }, 'a1.meta.json');
    expect(meta?.isFork).toBe(false);
    expect(meta?.spawnedWithWorktree).toBe(false);
    expect(meta?.stoppedByUser).toBe(false);
    expect(meta?.toolUseId).toBeNull();
    expect(meta?.spawnDepth).toBeNull();
  });

  test('names a workflow journal by its agents', () => {
    const parsed = parseClaudeSession([
      { type: 'started', key: 'v2:a', agentId: 'a1' },
      { type: 'started', key: 'v2:b', agentId: 'a2' },
      { type: 'result', key: 'v2:a', agentId: 'a1', result: { verdict: 'ship it' } }
    ]);

    expect(parsed?.conversation.title).toBe('Workflow run · 2 agents · 1 results');
    const rows = everyLine(parsed);
    expect(rows.find(row => row.lineType === 'result')?.text).toContain('ship it');
  });
});

describe('tool call rendering', () => {
  const callWith = (name: string, input: unknown) =>
    parseClaudeSession([
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: null,
        sessionId: 's1',
        timestamp: '2026-09-08T10:00:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_01Ke', name, input }]
        }
      }
    ])?.conversation.messages.find(message => message.channel === 'tool_call');

  test('leads with the command and never prints the tool_use id', () => {
    const row = callWith('Bash', {
      command: 'cd /repo && ls -la',
      description: 'Inspect repo layout'
    });

    expect(row?.text).toBe('cd /repo && ls -la\ndescription: Inspect repo layout');
    expect(row?.text).not.toContain('toolu_01Ke');
    expect(row?.toolUseId).toBe('toolu_01Ke');
    expect(() => JSON.parse(row?.text ?? '')).toThrow();
  });

  test('leads with the path for a file edit', () => {
    const row = callWith('Edit', {
      file_path: '/repo/src/parser.ts',
      old_string: 'before',
      new_string: 'after',
      replace_all: false
    });

    expect(row?.text.split('\n')[0]).toBe('/repo/src/parser.ts');
    expect(row?.text).toContain('old_string: before');
    expect(row?.text).toContain('replace_all: false');
  });

  test('summarises nested and list values rather than serialising them', () => {
    const row = callWith('Workflow', {
      script: 'export const meta = {}',
      args: [1, 2, 3],
      opts: { label: 'x', phase: 'y' }
    });

    expect(row?.text).toContain('args: 3 items');
    expect(row?.text).toContain('opts: label, phase');
  });

  test('falls back to the tool name for an empty input', () => {
    expect(callWith('ListAgents', {})?.text).toBe('ListAgents');
  });

  test('keeps the name chip so the row still says which tool ran', () => {
    const row = callWith('Bash', { command: 'ls' });
    expect(row?.name).toBe('Bash');
    expect(row?.recipient).toBe('Bash');
  });
});

describe('thinking blocks', () => {
  // Claude Code writes one assistant line per content block. A reasoning turn
  // is an empty signature-only block at apiBlockIndex 0 and, sometimes, a
  // summary at index 1 — two lines sharing a requestId.
  let clock = 0;
  const line = (
    uuid: string,
    apiBlockIndex: number,
    requestId: string,
    thinking: string
  ) => ({
    type: 'assistant' as const,
    uuid,
    parentUuid: null,
    sessionId: 's1',
    requestId,
    apiBlockIndex,
    // Blocks are written in the order they stream, not by block index.
    timestamp: new Date(Date.parse('2026-09-09T10:00:00.000Z') + clock++ * 1000)
      .toISOString(),
    message: {
      role: 'assistant',
      content: [{ type: 'thinking', thinking, signature: 'CAIS2goK' }]
    }
  });

  test('says the text was not stored, not that thinking was empty', () => {
    const row = parseClaudeSession([line('a1', 0, 'req_1', '')])
      ?.conversation.messages[0];

    expect(row?.channel).toBe('thinking');
    expect(row?.text).toBe('[thinking text not stored]');
    expect(row?.thinkingTextStored).toBe(false);
    expect(row?.thinkingSignature).toBe('CAIS2goK');
  });

  test('drops the empty block when its request also carries the summary', () => {
    const parsed = parseClaudeSession([
      line('a1', 0, 'req_1', ''),
      line('a2', 1, 'req_1', 'Weighing the two options before editing.')
    ]);

    const thinking = parsed?.conversation.messages.filter(
      message => message.channel === 'thinking'
    );
    expect(thinking).toHaveLength(1);
    expect(thinking?.[0].text).toBe('Weighing the two options before editing.');
    expect(thinking?.[0].thinkingTextStored).toBe(true);
  });

  test('keeps the empty block when no summary supersedes it', () => {
    const parsed = parseClaudeSession([line('a1', 0, 'req_1', '')]);

    // 86,000 blocks in the reference corpus are this case. The row is the only
    // record that the turn reasoned at all, so it stays.
    expect(
      parsed?.conversation.messages.filter(m => m.channel === 'thinking')
    ).toHaveLength(1);
  });

  test('does not let one request suppress another request empty block', () => {
    const parsed = parseClaudeSession([
      line('a1', 0, 'req_1', ''),
      line('a2', 1, 'req_1', 'a summary'),
      line('a3', 0, 'req_2', '')
    ]);

    const thinking = parsed?.conversation.messages.filter(
      message => message.channel === 'thinking'
    );
    expect(thinking?.map(m => m.requestId)).toEqual(['req_1', 'req_2']);
    expect(thinking?.map(m => m.thinkingTextStored)).toEqual([true, false]);
  });

  test('keeps an empty block that has no requestId to match on', () => {
    const parsed = parseClaudeSession([
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: null,
        sessionId: 's1',
        timestamp: '2026-09-09T10:00:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: '', signature: 'sig' }]
        }
      }
    ]);

    expect(
      parsed?.conversation.messages.filter(m => m.channel === 'thinking')
    ).toHaveLength(1);
  });

  test('still labels a redacted_thinking block as redacted', () => {
    const parsed = parseClaudeSession([
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: null,
        sessionId: 's1',
        timestamp: '2026-09-09T10:00:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'redacted_thinking', data: 'encrypted' }]
        }
      }
    ]);

    expect(parsed?.conversation.messages[0].text).toBe('[thinking redacted]');
  });
});
