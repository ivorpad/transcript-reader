import { describe, expect, test } from 'vitest';

import { buildFleet, fleetSummary, journalFromLines } from '../src/adapters/claude/fleet';
import { parseClaudeSession } from '../src/adapters/claude/parser';
import { buildSessionView } from '../src/adapters/claude/session';
import type { ClaudeSessionParseResult } from '../src/types/prism';

const t = (seconds: number) =>
  new Date(Date.parse('2026-09-09T10:00:00.000Z') + seconds * 1000).toISOString();

const parent = (extra: Array<Record<string, unknown>> = []) => {
  const lines = [
    {
      type: 'user',
      uuid: 'u1',
      parentUuid: null,
      sessionId: 'p',
      timestamp: t(0),
      message: { role: 'user', content: 'go' }
    },
    {
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'u1',
      sessionId: 'p',
      timestamp: t(1),
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'Agent',
            input: { description: 'Hunt the flake', subagent_type: 'flake-hunter', prompt: 'x' }
          },
          {
            type: 'tool_use',
            id: 'toolu_2',
            name: 'Agent',
            input: { description: 'Read CI config', subagent_type: 'Explore', prompt: 'y' }
          }
        ]
      }
    },
    {
      type: 'user',
      uuid: 'u2',
      parentUuid: 'a1',
      sessionId: 'p',
      timestamp: t(2),
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'launched' }]
      },
      toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'ag_1' }
    },
    {
      type: 'user',
      uuid: 'u3',
      parentUuid: 'u2',
      sessionId: 'p',
      timestamp: t(20),
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'API error', is_error: true }]
      }
    },
    ...extra
  ];
  const parsed = parseClaudeSession(lines) as ClaudeSessionParseResult;
  return buildSessionView(parsed, lines.length);
};

const child = (lines: Array<Record<string, unknown>>) => {
  const parsed = parseClaudeSession(lines) as ClaudeSessionParseResult;
  return buildSessionView(parsed, lines.length);
};

describe('fleet', () => {
  test('builds one agent per Agent call, from the parent alone', () => {
    const fleet = buildFleet(parent());

    expect(fleet.agents.map(agent => [agent.type, agent.status, agent.agentId])).toEqual([
      ['flake-hunter', 'launched', 'ag_1'],
      ['Explore', 'failed', null]
    ]);
    expect(fleet.agents[0].description).toBe('Hunt the flake');
    expect(fleet.agents[0].depth).toBe(1);
    expect(fleetSummary(fleet)).toMatchObject({ total: 2, failed: 1, running: 1 });
  });

  test('enriches an agent from its loaded transcript and meta file', () => {
    const childView = child([
      {
        type: 'user',
        uuid: 'c1',
        parentUuid: null,
        sessionId: 'c',
        agentId: 'ag_1',
        isSidechain: true,
        timestamp: t(3),
        message: { role: 'user', content: 'x' }
      },
      {
        type: 'assistant',
        uuid: 'c2',
        parentUuid: 'c1',
        sessionId: 'c',
        agentId: 'ag_1',
        isSidechain: true,
        timestamp: t(63),
        message: { role: 'assistant', content: [{ type: 'text', text: 'found it' }] }
      }
    ]);

    const fleet = buildFleet(parent(), [
      {
        recordKey: 'proj/p/subagents/ag_1.jsonl',
        toolUseId: 'toolu_1',
        agentId: 'ag_1',
        meta: {
          agentId: 'ag_1',
          agentType: 'flake-hunter',
          description: 'Hunt the flake',
          toolUseId: 'toolu_1',
          name: null,
          model: 'claude-sonnet-5',
          parentAgentId: null,
          spawnDepth: 1,
          isFork: false,
          spawnedWithWorktree: true,
          stoppedByUser: false,
          worktreePath: null,
          worktreeBranch: 'flake-sweep',
          inheritedWorktreePath: null,
          raw: {}
        },
        view: childView,
        costUSD: 0.41,
        rowCount: 2
      }
    ]);

    const agent = fleet.agents[0];
    expect(agent.status).toBe('finished');
    expect(agent.startedAt).toBe(Date.parse(t(1)));
    expect(agent.endedAt).toBe(Date.parse(t(63)));
    expect(agent.costUSD).toBe(0.41);
    expect(agent.rowCount).toBe(2);
    expect(agent.model).toBe('claude-sonnet-5');
    expect(agent.worktree).toBe('flake-sweep');
    expect(agent.recordKey).toBe('proj/p/subagents/ag_1.jsonl');
  });

  test('reads stopped-by-user from the meta file and finished from a journal', () => {
    const stopped = buildFleet(parent(), [
      {
        recordKey: 'k',
        toolUseId: 'toolu_1',
        agentId: 'ag_1',
        meta: {
          agentId: 'ag_1',
          agentType: 'flake-hunter',
          description: null,
          toolUseId: 'toolu_1',
          name: null,
          model: null,
          parentAgentId: null,
          spawnDepth: 2,
          isFork: false,
          spawnedWithWorktree: false,
          stoppedByUser: true,
          worktreePath: null,
          worktreeBranch: null,
          inheritedWorktreePath: null,
          raw: {}
        },
        view: child([
          {
            type: 'user',
            uuid: 'c1',
            parentUuid: null,
            sessionId: 'c',
            timestamp: t(3),
            message: { role: 'user', content: 'x' }
          }
        ]),
        costUSD: null,
        rowCount: 1
      }
    ]);
    expect(stopped.agents[0].status).toBe('stopped');
    expect(stopped.agents[0].depth).toBe(2);

    const journal = journalFromLines([
      { type: 'started', key: 'k', agentId: 'ag_1' },
      { type: 'result', key: 'k', agentId: 'ag_1', result: {} }
    ]);
    const finished = buildFleet(parent(), [], journal);
    expect(finished.agents[0].status).toBe('finished');
    expect(finished.agents[0].note).toContain('journal');
  });
});
