import { describe, expect, test } from 'vitest';

import { parseClaudeSession } from '../src/adapters/claude/parser';
import { buildSessionView } from '../src/adapters/claude/session';

let clock = 0;
const t = (seconds: number) =>
  new Date(Date.parse('2026-09-09T10:00:00.000Z') + seconds * 1000).toISOString();

const prompt = (uuid: string, text: string, seconds: number, extra = {}) => ({
  type: 'user' as const,
  uuid,
  parentUuid: null,
  sessionId: 's1',
  timestamp: t(seconds),
  message: { role: 'user', content: text },
  ...extra
});

const say = (uuid: string, text: string, seconds: number, extra = {}) => ({
  type: 'assistant' as const,
  uuid,
  parentUuid: null,
  sessionId: 's1',
  timestamp: t(seconds),
  message: { role: 'assistant', content: [{ type: 'text', text }] },
  ...extra
});

const call = (uuid: string, id: string, name: string, seconds: number) => ({
  type: 'assistant' as const,
  uuid,
  parentUuid: null,
  sessionId: 's1',
  timestamp: t(seconds),
  message: {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name, input: { command: 'ls' } }]
  }
});

const result = (uuid: string, id: string, seconds: number, extra = {}) => ({
  type: 'user' as const,
  uuid,
  parentUuid: null,
  sessionId: 's1',
  timestamp: t(seconds),
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }]
  },
  ...extra
});

const view = (lines: Array<Record<string, unknown>>) => {
  const parsed = parseClaudeSession(lines);
  if (!parsed) throw new Error('did not parse');
  return buildSessionView(parsed, lines.length);
};

describe('turns', () => {
  test('opens a turn at a prompt and not at a tool result', () => {
    const v = view([
      prompt('u1', 'first ask', 0),
      call('a1', 'toolu_1', 'Bash', 1),
      result('u2', 'toolu_1', 2),
      say('a2', 'done', 3),
      prompt('u3', 'second ask', 4)
    ]);

    expect(v.turns).toHaveLength(2);
    expect(v.turns.map(turn => turn.label)).toEqual(['first ask', 'second ask']);
    expect(v.turns[0].toolCount).toBe(1);
  });

  test('does not open a turn on an injected meta message', () => {
    const v = view([
      prompt('u1', 'real ask', 0),
      prompt('u2', 'injected', 1, { isMeta: true }),
      say('a1', 'answer', 2)
    ]);

    expect(v.turns).toHaveLength(1);
    expect(v.turns[0].label).toBe('real ask');
  });

  test('puts anything before the first prompt in its own opening turn', () => {
    const v = view([say('a0', 'resumed', 0), prompt('u1', 'ask', 1)]);

    expect(v.turns).toHaveLength(2);
    expect(v.turns[0].label).toBe('Session start');
  });

  test('records a quiet stretch between turns and not a short one', () => {
    const v = view([
      prompt('u1', 'first', 0),
      say('a1', 'ok', 10),
      prompt('u2', 'after a minute', 70),
      say('a2', 'ok', 75),
      prompt('u3', 'after four hours', 75 + 4 * 3600),
      say('a3', 'ok', 80 + 4 * 3600)
    ]);

    expect(v.turns[1].gapBeforeMs).toBeNull();
    expect(v.turns[2].gapBeforeMs).toBe(4 * 3600 * 1000);
  });

  test('counts agents spawned in a turn', () => {
    const v = view([
      prompt('u1', 'go', 0),
      call('a1', 'toolu_1', 'Agent', 1),
      call('a2', 'toolu_2', 'Agent', 2),
      call('a3', 'toolu_3', 'Bash', 3)
    ]);

    expect(v.turns[0].agentCount).toBe(2);
    expect(v.turns[0].toolCount).toBe(3);
  });
});

describe('ledger', () => {
  test('balances: drawn plus folded plus malformed equals parsed', () => {
    const lines = [
      prompt('u1', 'go', 0),
      call('a1', 'toolu_1', 'Bash', 1),
      result('u2', 'toolu_1', 2, {
        toolUseResult: { stdout: 'ok', stderr: '', interrupted: false }
      }),
      {
        type: 'attachment',
        uuid: 'h1',
        sessionId: 's1',
        timestamp: t(3),
        attachment: {
          type: 'hook_success',
          hookName: 'fmt',
          hookEvent: 'PostToolUse',
          exitCode: 0,
          durationMs: 4,
          toolUseID: 'toolu_1'
        }
      },
      { type: 'mode', mode: 'plan', sessionId: 's1' },
      { type: 'mode', mode: 'plan', sessionId: 's1' }
    ];

    const v = view(lines);
    const { parsedLines, drawnLines, foldedLines, malformedLines } = v.ledger;

    expect(parsedLines).toBe(6);
    expect(drawnLines + foldedLines + malformedLines).toBe(parsedLines);
    expect(v.ledger.unaccountedLines).toBe(0);
  });

  test('reports rows and lines as separate units', () => {
    // One assistant line carrying text and two tool calls draws three rows.
    const v = view([
      prompt('u1', 'go', 0),
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: null,
        sessionId: 's1',
        timestamp: t(1),
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'running two things' },
            { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} },
            { type: 'tool_use', id: 'toolu_2', name: 'Bash', input: {} }
          ]
        }
      }
    ]);

    expect(v.ledger.parsedLines).toBe(2);
    expect(v.ledger.drawnLines).toBe(2);
    expect(v.ledger.rowCount).toBe(4);
    expect(v.ledger.unaccountedLines).toBe(0);
  });

  test('counts a malformed line once, not as drawn and malformed both', () => {
    const v = view([prompt('u1', 'go', 0), 'not json at all' as never]);

    expect(v.ledger.parsedLines).toBe(2);
    expect(v.ledger.drawnLines).toBe(1);
    expect(v.ledger.malformedLines).toBe(1);
    expect(v.ledger.unaccountedLines).toBe(0);
  });

  test('names an unrecognised type rather than only counting it', () => {
    const v = view([
      prompt('u1', 'go', 0),
      { type: 'signal-relay', sessionId: 's1', relayId: 'r1', timestamp: t(1) }
    ]);

    expect(v.ledger.unrecognisedTypes).toEqual([{ type: 'signal-relay', count: 1 }]);
  });
});

describe('outcome and trouble', () => {
  test('reports an interrupt and the turn it happened in', () => {
    const v = view([
      prompt('u1', 'first', 0),
      say('a1', 'ok', 1),
      prompt('u2', 'stop that', 2, { interruptedMessageId: 'a1' }),
      say('a2', 'stopped', 3)
    ]);

    expect(v.outcome).toEqual({ state: 'interrupted', atTurn: 2, turnCount: 2 });
  });

  test('reports finished when the last conversational row is the model speaking', () => {
    const v = view([prompt('u1', 'go', 0), say('a1', 'here you go', 1)]);
    expect(v.outcome.state).toBe('finished');
  });

  test('reports incomplete when the session ends mid tool call', () => {
    const v = view([prompt('u1', 'go', 0), call('a1', 'toolu_1', 'Bash', 1)]);
    expect(v.outcome.state).toBe('incomplete');
  });

  test('separates refusals, api errors and blocked hooks', () => {
    const v = view([
      prompt('u1', 'go', 0),
      say('a1', 'refused', 1, { message: { role: 'assistant', stop_reason: 'refusal', content: [{ type: 'text', text: 'no' }] } }),
      say('a2', 'errored', 2, { isApiErrorMessage: true, apiErrorStatus: '529' }),
      {
        type: 'attachment',
        uuid: 'h1',
        sessionId: 's1',
        timestamp: t(3),
        attachment: {
          type: 'hook_blocking_error',
          hookName: 'guard',
          blockingError: 'nope'
        }
      }
    ]);

    expect(v.trouble.refusals).toBe(1);
    expect(v.trouble.apiErrors).toBe(1);
    expect(v.trouble.hooksBlocked).toBe(1);
    expect(v.trouble.total).toBe(3);
  });
});

describe('timing', () => {
  test('separates wall clock from active time using the gaps', () => {
    const v = view([
      prompt('u1', 'first', 0),
      say('a1', 'ok', 60),
      prompt('u2', 'much later', 60 + 6 * 3600),
      say('a2', 'ok', 120 + 6 * 3600)
    ]);

    expect(v.timing.wallMs).toBe((120 + 6 * 3600) * 1000);
    expect(v.timing.idleMs).toBe(6 * 3600 * 1000);
    expect(v.timing.activeMs).toBe(120 * 1000);
  });
});

const attachment = (
  uuid: string,
  type: string,
  seconds: number,
  fields: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
) => ({
  type: 'attachment',
  uuid,
  sessionId: 's1',
  timestamp: t(seconds),
  attachment: { type, ...fields },
  ...extra
});

describe('entries', () => {
  test('pairs a tool call with its result and folds both sides onto one row', () => {
    const v = view([
      prompt('u1', 'go', 0),
      call('a1', 'toolu_1', 'Bash', 1),
      attachment('h1', 'hook_success', 1, { hookName: 'pre', toolUseID: 'toolu_1', exitCode: 0 }),
      result('u2', 'toolu_1', 3, {
        toolUseResult: { stdout: 'ok', stderr: '', interrupted: false }
      }),
      attachment('r1', 'total_tokens_reminder', 4, {
        text: '<total_tokens>1000 tokens left</total_tokens>'
      }, { parentUuid: 'u2' }),
      say('a2', 'done', 5)
    ]);

    const kinds = v.entries.map(entry => entry.kind);
    expect(kinds).toEqual(['text', 'tool', 'text']);
    const tool = v.entries[1];
    expect(tool.tag).toBe('bash');
    expect(tool.result?.text).toBe('ok');
    expect(tool.durationMs).toBe(2000);
    expect(tool.folded.map(line => line.uuid)).toEqual(['h1', 'r1']);
    expect(v.ledger.rowCount).toBe(3);
    expect(v.ledger.unaccountedLines).toBe(0);
  });

  test('labels time as an offset inside a stretch and as a weekday clock after a gap', () => {
    const v = view([
      prompt('u1', 'first', 0),
      say('a1', 'ok', 71),
      prompt('u2', 'after a long gap', 71 + 20 * 3600),
      say('a2', 'ok', 75 + 20 * 3600)
    ]);

    expect(v.entries.map(entry => entry.kind)).toEqual(['text', 'text', 'gap', 'text', 'text']);
    expect(v.entries[0].timeLabel).toBe('+0s');
    expect(v.entries[1].timeLabel).toBe('+1m11s');
    const gap = v.entries[2];
    expect(gap.gap?.ms).toBe(20 * 3600 * 1000);
    expect(gap.durationMs).toBe(20 * 3600 * 1000);
    expect(v.entries[3].timeLabel).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d$/u);
    expect(v.entries[3].timeLabel).toBe(v.entries[3].clockLabel);
    expect(v.timing.idleMs).toBe(20 * 3600 * 1000);
    expect(v.timing.stretches).toHaveLength(2);
  });

  test('classifies an Agent call as an agent row and an Edit with a patch as a diff row', () => {
    const v = view([
      prompt('u1', 'go', 0),
      {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        sessionId: 's1',
        timestamp: t(1),
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_agent',
              name: 'Agent',
              input: { description: 'Sweep it', subagent_type: 'Explore', prompt: 'look around' }
            },
            {
              type: 'tool_use',
              id: 'toolu_edit',
              name: 'Edit',
              input: { file_path: '/repo/lib/queue.rb', old_string: 'a', new_string: 'b' }
            }
          ]
        }
      },
      result('u2', 'toolu_agent', 2, {
        toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'ag_1' }
      }),
      result('u3', 'toolu_edit', 3, {
        toolUseResult: {
          filePath: '/repo/lib/queue.rb',
          structuredPatch: [
            { oldStart: 141, oldLines: 3, newStart: 141, newLines: 3, lines: [' def drained?', '-  @size.zero?', '+  @mutex.synchronize { @size.zero? }', ' end'] }
          ]
        }
      })
    ]);

    const agent = v.entries.find(entry => entry.kind === 'agent');
    expect(agent?.agentType).toBe('Explore');
    expect(agent?.agentAsk).toBe('Sweep it');
    expect(agent?.agentId).toBe('ag_1');

    const diff = v.entries.find(entry => entry.kind === 'diff');
    expect(diff?.sub).toBe('/repo/lib/queue.rb');
    expect(diff?.diff?.map(line => line.sign).join('')).toBe(' -+ ');
    expect(diff?.diff?.[1].number).toBe(142);
    expect(v.panels.files).toEqual([
      { path: '/repo/lib/queue.rb', added: 1, removed: 1, edits: 1 }
    ]);
  });

  test('marks a failed tool result and a spilled one', () => {
    const v = view([
      prompt('u1', 'go', 0),
      call('a1', 'toolu_1', 'Bash', 1),
      {
        ...result('u2', 'toolu_1', 2),
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'boom', is_error: true }]
        }
      },
      call('a2', 'toolu_2', 'Bash', 3),
      {
        ...result('u3', 'toolu_2', 4),
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_2',
              content: 'Output too large. Full output saved to: /x/tool-results/abc.txt'
            }
          ]
        }
      }
    ]);

    const tools = v.entries.filter(entry => entry.kind === 'tool');
    expect(tools[0].badge).toBe('is_error');
    expect(tools[0].severity).toBe('warning');
    expect(tools[1].badge).toBe('spilled');
    expect(v.trouble.toolFailures).toBe(1);
  });
});

describe('panels and folds', () => {
  test('lists every line that drew no row, grouped by type with its host', () => {
    const lines = [
      prompt('u1', 'go', 0),
      call('a1', 'toolu_1', 'Bash', 1),
      attachment('h1', 'hook_success', 1, { hookName: 'pre', toolUseID: 'toolu_1', exitCode: 0 }),
      attachment('h2', 'hook_success', 2, { hookName: 'post', toolUseID: 'toolu_1', exitCode: 0 }),
      result('u2', 'toolu_1', 3),
      { type: 'mode', mode: 'plan', sessionId: 's1', uuid: 'm1' },
      { type: 'mode', mode: 'plan', sessionId: 's1', uuid: 'm2' },
      { type: 'file-history-delta', uuid: 'f1', sessionId: 's1', trackingPath: '/repo/a.rb' },
      attachment('r1', 'total_tokens_reminder', 4, {
        text: '<total_tokens>120000 tokens left</total_tokens>'
      })
    ];
    const v = view(lines);

    expect(v.folds.map(fold => [fold.key, fold.count, fold.disposition])).toEqual([
      ['hook_success', 2, 'row'],
      ['mode', 2, 'panel'],
      ['file-history-delta', 1, 'panel'],
      ['total_tokens_reminder', 1, 'row']
    ]);
    const hooks = v.folds[0];
    expect(hooks.items[0].hostLabel).toMatch(/^bash/u);
    expect(hooks.items[0].hostId).toBe(v.entries[1].id);
    expect(v.panels.state).toEqual([{ key: 'mode', value: 'plan', writes: 2, changes: 0 }]);
    expect(v.panels.files).toEqual([{ path: '/repo/a.rb', added: 0, removed: 0, edits: 1 }]);
    expect(v.panels.context).toEqual([{ at: Date.parse(t(4)), tokens: 120000, hostId: v.entries[1].result?.id }]);

    const { parsedLines, drawnLines, foldedLines, malformedLines } = v.ledger;
    expect(parsedLines).toBe(lines.length);
    expect(drawnLines).toBe(3);
    expect(foldedLines).toBe(6);
    expect(drawnLines + foldedLines + malformedLines).toBe(parsedLines);
  });
});

describe('bands', () => {
  test('makes one band for the prompt and one for what the turn did', () => {
    const v = view([
      prompt('u1', 'Fix the flaky test', 0),
      call('a1', 'toolu_1', 'Bash', 1),
      result('u2', 'toolu_1', 2),
      say('a2', 'I reproduced it at 200 runs.\nThen more.', 3),
      prompt('u3', 'stop', 4 + 20 * 3600, { interruptedMessageId: 'msg_1' })
    ]);

    expect(v.bands.map(band => band.tag)).toEqual(['you', 'turn', 'gap', 'you']);
    expect(v.bands[0].label).toBe('Fix the flaky test');
    expect(v.bands[1].label).toBe('I reproduced it at 200 runs.');
    expect(v.bands[1].marks.map(mark => mark.text)).toEqual(['1 tool']);
    expect(v.bands[1].entries).toHaveLength(2);
    expect(v.bands[3].marks.map(mark => mark.text)).toEqual(['interrupt']);
    expect(v.outcome.state).toBe('interrupted');
  });
});
