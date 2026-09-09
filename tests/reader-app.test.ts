import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, test } from 'vitest';

import '../src/reader/reader-app';
import type { TranscriptReader } from '../src/reader/reader-app';
import { buildRecords, fleetFor, pairingStem, readLoadedFile, rootRecords } from '../src/reader/ingest';
import { shortId } from '../src/reader/format';

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8');

const t = (seconds: number) =>
  new Date(Date.parse('2026-09-09T10:00:00.000Z') + seconds * 1000).toISOString();

const line = (record: Record<string, unknown>) => JSON.stringify(record);

const prompt = (uuid: string, text: string, seconds: number, extra: Record<string, unknown> = {}) =>
  line({
    type: 'user',
    uuid,
    parentUuid: null,
    sessionId: 's1',
    timestamp: t(seconds),
    cwd: '/Users/j/work/relay',
    gitBranch: 'fix/queue-flake',
    version: '2.1.263',
    message: { role: 'user', content: text },
    ...extra
  });

const say = (uuid: string, text: string, seconds: number) =>
  line({
    type: 'assistant',
    uuid,
    parentUuid: null,
    sessionId: 's1',
    timestamp: t(seconds),
    message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text }], usage: { output_tokens: 12 } }
  });

const call = (uuid: string, id: string, name: string, input: Record<string, unknown>, seconds: number) =>
  line({
    type: 'assistant',
    uuid,
    parentUuid: null,
    sessionId: 's1',
    timestamp: t(seconds),
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }
  });

const result = (uuid: string, id: string, content: string, seconds: number, extra: Record<string, unknown> = {}) =>
  line({
    type: 'user',
    uuid,
    parentUuid: null,
    sessionId: 's1',
    timestamp: t(seconds),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
    ...extra
  });

const attachment = (uuid: string, type: string, fields: Record<string, unknown>, seconds: number) =>
  line({ type: 'attachment', uuid, sessionId: 's1', timestamp: t(seconds), attachment: { type, ...fields } });

/** A session that exercises every row kind and every class. 41 lines, 12 rows. */
const richSession = [
  line({ type: 'ai-title', aiTitle: 'Flaky queue spec: drains under load', sessionId: 's1' }),
  ...Array.from({ length: 20 }, (_, index) => line({ type: 'last-prompt', lastPrompt: `prompt ${index}`, sessionId: 's1' })),
  line({ type: 'mode', mode: 'plan', sessionId: 's1' }),
  line({ type: 'mode', mode: 'plan', sessionId: 's1' }),
  prompt('u1', 'Fix the flaky test in tests/queue_spec.rb', 0),
  line({
    type: 'assistant',
    uuid: 'th1',
    parentUuid: 'u1',
    sessionId: 's1',
    requestId: 'req_1',
    timestamp: t(3),
    message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Two candidates.', signature: 'sig' }] }
  }),
  say('a1', 'I will reproduce it at 200 runs first.', 9),
  call('a2', 'toolu_1', 'Bash', { command: 'rspec tests/queue_spec.rb --seed 41213' }, 11),
  attachment('h1', 'hook_success', { hookName: 'guard', hookEvent: 'PreToolUse', exitCode: 0, durationMs: 41, toolUseID: 'toolu_1' }, 11),
  result('u2', 'toolu_1', 'Failures:\n  1) Queue drains under load', 14, {
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Failures:\n  1) Queue drains under load', is_error: true }]
    },
    toolUseResult: { stdout: 'Failures:', stderr: '', interrupted: false }
  }),
  attachment('r1', 'total_tokens_reminder', { text: '<total_tokens>168000 tokens left</total_tokens>' }, 14),
  attachment('e1', 'hook_blocking_error', { hookName: 'guard-no-timeout-edits', hookEvent: 'PreToolUse', blockingError: 'do not raise sleep durations', toolUseID: 'toolu_x' }, 20),
  call('a3', 'toolu_agent', 'Agent', { description: 'Hunt the flake', subagent_type: 'flake-hunter', prompt: 'look' }, 30),
  result('u3', 'toolu_agent', 'launched', 31, { toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'ag_1' } }),
  call('a4', 'toolu_edit', 'Edit', { file_path: '/Users/j/work/relay/lib/queue.rb', old_string: 'a', new_string: 'b' }, 40),
  result('u4', 'toolu_edit', 'ok', 41, {
    toolUseResult: {
      filePath: '/Users/j/work/relay/lib/queue.rb',
      structuredPatch: [{ oldStart: 141, oldLines: 2, newStart: 141, newLines: 2, lines: ['-  @size.zero?', '+  @mutex.synchronize { @size.zero? }'] }]
    }
  }),
  line({ type: 'signal-relay', uuid: 'x1', sessionId: 's1', timestamp: t(50), relayId: 'rl_1', channel: 'ide' }),
  line({ type: 'system', subtype: 'compact_boundary', uuid: 'c1', sessionId: 's1', timestamp: t(60), content: 'Conversation compacted', level: 'info', compactMetadata: { trigger: 'auto', preTokens: 148204 } }),
  prompt('u5', 'stop, run it under GC stress', 60 + 20 * 3600, { interruptedMessageId: 'msg_1' }),
  say('a5', 'Done: 0 failures in 200 runs.', 70 + 20 * 3600),
  line({ type: 'cost-state', sessionId: 's1', totalCostUSD: 2.14, totalDuration: 72_000_000, modelUsage: { 'claude-opus-5': { costUSD: 2.14 } } }),
  'this line is not json'
].join('\n');

const smallSession = [
  prompt('u1', "What's the difference between the two rate limiters?", 0),
  say('a1', 'One is a fixed window, the other a token bucket.', 22),
  prompt('u2', 'thanks', 96),
  say('a2', 'Happy to help.', 99)
].join('\n');

const mount = async () => {
  document.body.innerHTML = '';
  const app = document.createElement('transcript-reader') as TranscriptReader;
  document.body.append(app);
  await app.updateComplete;
  return app;
};

const text = (root: ParentNode | null | undefined, selector: string) =>
  (root?.querySelector(selector)?.textContent ?? '').replace(/\s+/gu, ' ').trim();

const shadowText = (element: Element | null | undefined) =>
  (element?.shadowRoot?.textContent ?? '').replace(/\s+/gu, ' ').trim();

const rows = (app: TranscriptReader) => [...(app.shadowRoot?.querySelectorAll('reader-row') ?? [])];

const settle = async (app: TranscriptReader) => {
  await app.updateComplete;
  const children = [...(app.shadowRoot?.querySelectorAll('*') ?? [])].filter(
    (element): element is HTMLElement & { updateComplete: Promise<unknown> } =>
      'updateComplete' in element
  );
  await Promise.all(children.map(child => child.updateComplete));
  await app.updateComplete;
};

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1500 });
});

describe('ingestion', () => {
  test('keys on the relative path so same-named files stay apart', () => {
    const records = buildRecords([
      { name: 'project-a/session.jsonl', text: smallSession },
      { name: 'project-b/session.jsonl', text: smallSession }
    ]);
    expect(records).toHaveLength(2);
    expect(new Set(records.map(record => record.key)).size).toBe(2);
    expect(pairingStem('proj/parent/subagents/a9f6.meta.json')).toBe('proj/parent/subagents/a9f6');
  });

  test('nests a subagent under the Agent call that spawned it and builds its fleet', () => {
    const child = [
      line({ type: 'user', uuid: 'c1', parentUuid: null, sessionId: 'child', agentId: 'ag_1', isSidechain: true, timestamp: t(32), message: { role: 'user', content: 'look' } }),
      line({ type: 'assistant', uuid: 'c2', parentUuid: 'c1', sessionId: 'child', agentId: 'ag_1', isSidechain: true, timestamp: t(90), message: { role: 'assistant', content: [{ type: 'text', text: 'found it' }] } })
    ].join('\n');
    const records = buildRecords([
      { name: 'proj/parent.jsonl', text: richSession },
      { name: 'proj/parent/subagents/ag_1.jsonl', text: child },
      { name: 'proj/parent/subagents/ag_1.meta.json', text: JSON.stringify({ agentType: 'flake-hunter', description: 'Hunt the flake', toolUseId: 'toolu_agent', spawnDepth: 1 }) },
      { name: 'proj/parent/custom-title.json', text: JSON.stringify({ customTitle: 'the name I gave it' }) }
    ]);

    const parent = records.find(record => record.fileName === 'proj/parent.jsonl');
    const subagent = records.find(record => record.fileName.includes('subagents'));
    expect(subagent?.parentKey).toBe(parent?.key);
    expect(subagent?.parentToolUseId).toBe('toolu_agent');
    expect(subagent?.meta?.agentId).toBe('ag_1');
    expect(parent?.conversation.title).toBe('the name I gave it');
    expect(rootRecords(records).map(record => record.fileName)).toEqual(['proj/parent.jsonl']);

    const fleet = fleetFor(records, parent as NonNullable<typeof parent>);
    expect(fleet.agents).toHaveLength(1);
    expect(fleet.agents[0]).toMatchObject({ type: 'flake-hunter', status: 'finished', rowCount: 2, recordKey: subagent?.key });
  });

  test('lists an agent spawned by an agent after its parent, at depth two', () => {
    const grandchild = [
      line({ type: 'user', uuid: 'g1', parentUuid: null, sessionId: 'gc', agentId: 'ag_2', isSidechain: true, timestamp: t(40), message: { role: 'user', content: 'reduce' } })
    ].join('\n');
    const child = [
      line({ type: 'user', uuid: 'c1', parentUuid: null, sessionId: 'child', agentId: 'ag_1', isSidechain: true, timestamp: t(32), message: { role: 'user', content: 'look' } }),
      call('c2', 'toolu_inner', 'Agent', { description: 'Reduce it', subagent_type: 'log-reducer', prompt: 'r' }, 35),
      result('c3', 'toolu_inner', 'stopped', 60, { toolUseResult: { agentId: 'ag_2', agentType: 'log-reducer', status: 'stopped' } }),
      line({ type: 'assistant', uuid: 'c4', parentUuid: 'c3', sessionId: 'child', agentId: 'ag_1', isSidechain: true, timestamp: t(90), message: { role: 'assistant', content: [{ type: 'text', text: 'found it' }] } })
    ].join('\n');
    const records = buildRecords([
      { name: 'proj/parent.jsonl', text: richSession },
      { name: 'proj/parent/subagents/ag_1.jsonl', text: child },
      { name: 'proj/parent/subagents/ag_1.meta.json', text: JSON.stringify({ agentType: 'flake-hunter', toolUseId: 'toolu_agent', spawnDepth: 1 }) },
      { name: 'proj/parent/subagents/ag_2.jsonl', text: grandchild },
      { name: 'proj/parent/subagents/ag_2.meta.json', text: JSON.stringify({ agentType: 'log-reducer', toolUseId: 'toolu_inner', spawnDepth: 2, parentAgentId: 'ag_1', stoppedByUser: true }) }
    ]);
    const parent = records.find(record => record.fileName === 'proj/parent.jsonl') as NonNullable<(typeof records)[number]>;
    const fleet = fleetFor(records, parent);
    expect(fleet.agents.map(agent => [agent.type, agent.depth, agent.status])).toEqual([
      ['flake-hunter', 1, 'finished'],
      ['log-reducer', 2, 'stopped']
    ]);
  });

  test('inlines a spilled tool-results file and rebuilds the view', () => {
    const withSpill = [
      call('a1', 'toolu_1', 'Bash', { command: 'ls' }, 0),
      result('u1', 'toolu_1', 'Output too large. Full output saved to: /p/tool-results/b1lvb91uj.txt', 1)
    ].join('\n');
    const records = buildRecords([
      { name: 'p.jsonl', text: withSpill },
      { name: 'p/tool-results/b1lvb91uj.txt', text: 'the real output was here' }
    ]);
    const row = records[0].conversation.messages.find(message => message.channel === 'tool_result');
    expect(row?.text).toContain('the real output was here');
    expect(records[0].view.entries[0].result?.text).toContain('the real output was here');
  });

  test('shortens an id with or without a tail', () => {
    expect(shortId('0f3c9a1e-7d2b-4c1e-9a55-2c8e4f61d84b', 8, 4)).toBe('0f3c9a1e…d84b');
    expect(shortId('0f3c9a1e-7d2b-4c1e-9a55-2c8e4f61d84b', 8, 0)).toBe('0f3c9a1e…');
    expect(shortId('short', 8, 4)).toBe('short');
  });

  test('reads a File with its relative path', async () => {
    const file = new File(['{}'], 'x.jsonl') as File & { webkitRelativePath?: string };
    Object.defineProperty(file, 'webkitRelativePath', { value: 'dir/x.jsonl' });
    expect(await readLoadedFile(file)).toEqual({ name: 'dir/x.jsonl', text: '{}' });
  });

  test('parses the checked-in fixtures', () => {
    const records = buildRecords([
      { name: 'main-session.jsonl', text: fixture('main-session.jsonl') },
      { name: 'subagent-session.jsonl', text: fixture('subagent-session.jsonl') },
      { name: 'subagent-session.meta.json', text: fixture('subagent-session.meta.json') }
    ]);
    expect(records.length).toBeGreaterThanOrEqual(2);
    for (const record of records) expect(record.view.ledger.unaccountedLines).toBe(0);
  });
});

describe('transcript reader', () => {
  test('opens on an empty state that explains what to drop', async () => {
    const app = await mount();
    const empty = app.shadowRoot?.querySelector('.empty-card');
    expect(empty?.textContent).toContain('Drop a transcript here');
    expect(app.shadowRoot?.querySelector('.foot')).toBeNull();
    app.remove();
  });

  test('draws the session: header, rows of every kind, rail, inspector and a reconciled footer', async () => {
    const app = await mount();
    await app.ingestFiles([{ name: 'proj/queue_spec-flake.jsonl', text: richSession }]);
    await settle(app);
    const root = app.shadowRoot;

    expect(text(root, '.title')).toBe('Flaky queue spec: drains under load');
    expect(text(root, '.source')).toBe('ai-title');
    expect(text(root, '.crumbs')).toContain('~/work/relay');
    expect(text(root, '.crumbs')).toContain('fix/queue-flake');
    expect(text(root, '.crumbs')).toContain('cc 2.1.263');

    const stats = [...(root?.querySelectorAll('.stat') ?? [])].map(stat => text(stat, '.eyebrow'));
    expect(stats).toEqual(['Ran for', 'Cost', 'Outcome', 'Tools', 'Agents', 'Trouble']);
    expect(text(root, '.stat:nth-child(2) .stat-v')).toBe('$2.14');
    expect(text(root, '.stat:nth-child(3) .stat-v')).toBe('Interrupted');

    const kinds = app.view?.entries.map(entry => entry.kind);
    expect(kinds).toEqual(['text', 'thinking', 'text', 'tool', 'event', 'agent', 'diff', 'unknown', 'event', 'gap', 'text', 'text']);
    expect(rows(app)).toHaveLength(12);

    const bash = rows(app)[3];
    expect(shadowText(bash)).toContain('bash');
    expect(shadowText(bash)).toContain('is_error');
    expect(shadowText(bash)).toContain('2 folded');
    expect(shadowText(bash)).toContain('Failures:');

    const unknown = rows(app)[7];
    expect(shadowText(unknown)).toContain('It is shown, not dropped');
    expect(shadowText(unknown)).toContain('signal-relay');

    const gap = rows(app)[9];
    expect(shadowText(gap)).toContain('no lines written');

    const rail = root?.querySelector('reader-rail');
    expect(shadowText(rail)).toContain('Turns · 2');
    expect(shadowText(rail)).toContain('lib/queue.rb');
    expect(shadowText(rail)).toContain('mode');
    expect(shadowText(rail)).toContain('×2');

    expect(root?.querySelector('.inspector')).not.toBeNull();

    const foot = text(root, '.foot');
    expect(foot).toContain('41 lines parsed');
    expect(foot).toContain('11 rows drawn');
    expect(foot).toContain('26 folded');
    expect(foot).toContain('1 malformed line skipped');
    expect(foot).toContain('1 unrecognised type: signal-relay');
    expect(foot).not.toContain('unaccounted');
    const ledger = app.view?.ledger;
    expect(ledger && ledger.drawnLines + ledger.foldedLines + ledger.malformedLines).toBe(41);
    app.remove();
  });

  test('selecting a row fills the inspector with its fields and raw line', async () => {
    const app = await mount();
    await app.ingestFiles([{ name: 'proj/s.jsonl', text: richSession }]);
    await settle(app);
    const bash = rows(app)[3];
    (bash.shadowRoot?.querySelector('.row') as HTMLElement).click();
    await app.updateComplete;
    const inspector = app.shadowRoot?.querySelector('reader-inspector');
    await (inspector as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    const body = shadowText(inspector);
    expect(body).toContain('tool_use.id');
    expect(body).toContain('raw line');
    expect(body).toContain('"tool_use"');
    expect(app.selectedEntryId).toBe(app.view?.entries[3].id);
    app.remove();
  });

  test('a small session withholds the rail, the filters and the docked inspector', async () => {
    const app = await mount();
    await app.ingestFiles([{ name: 'proj/b81d2c40.jsonl', text: smallSession }]);
    await settle(app);
    const root = app.shadowRoot;
    expect(root?.querySelector('reader-rail')).toBeNull();
    expect(root?.querySelector('.filters')).toBeNull();
    expect(root?.querySelector('.inspector')).toBeNull();
    expect(root?.querySelector('.stream.narrow')).not.toBeNull();

    (rows(app)[0].shadowRoot?.querySelector('.row') as HTMLElement).click();
    await app.updateComplete;
    expect(root?.querySelector('.inspector.floating')).not.toBeNull();
    app.remove();
  });

  test('a long session opens as bands, and a band opens in place', async () => {
    const many: string[] = [];
    for (let turn = 0; turn < 80; turn++) {
      const base = turn * 100;
      many.push(prompt(`u${turn}`, `ask ${turn}`, base));
      for (let step = 0; step < 4; step++) {
        many.push(call(`c${turn}-${step}`, `toolu_${turn}_${step}`, 'Bash', { command: `echo ${step}` }, base + 1 + step));
        many.push(result(`r${turn}-${step}`, `toolu_${turn}_${step}`, `${step}`, base + 2 + step));
      }
      many.push(say(`a${turn}`, `did ${turn}`, base + 20));
    }
    const app = await mount();
    await app.ingestFiles([{ name: 'proj/long.jsonl', text: many.join('\n') }]);
    await settle(app);
    const root = app.shadowRoot;

    expect(app.view?.ledger.rowCount).toBeGreaterThan(400);
    expect(rows(app)).toHaveLength(0);
    const bands = root?.querySelectorAll('.band') ?? [];
    expect(bands.length).toBe(160);
    expect(text(bands[1], '.band-label')).toBe('did 0');
    expect(text(bands[1], '.mark')).toBe('4 tools');
    expect(root?.querySelector('.minimap')).not.toBeNull();

    (bands[1].querySelector('.band-head') as HTMLElement).click();
    await app.updateComplete;
    expect(root?.querySelectorAll('.band-child').length).toBe(5);

    (root?.querySelector('.band-link a') as HTMLElement).click();
    await settle(app);
    expect(rows(app).length).toBeGreaterThan(400);
    app.remove();
  });

  test('filters narrow the stream and the scope line says so', async () => {
    const app = await mount();
    await app.ingestFiles([{ name: 'proj/s.jsonl', text: richSession }]);
    await settle(app);
    const root = app.shadowRoot;
    const chip = [...(root?.querySelectorAll('.chipbtn') ?? [])].find(button => button.textContent?.includes('trouble')) as HTMLElement;
    chip.click();
    await settle(app);
    expect(rows(app)).toHaveLength(2);
    expect(text(root, '.scope')).toContain('2 of 11 rows in view');
    app.remove();
  });

  test('the folded and catalog tabs account for every line that drew no row', async () => {
    const app = await mount();
    await app.ingestFiles([{ name: 'proj/s.jsonl', text: richSession }]);
    await settle(app);
    const root = app.shadowRoot;

    (root?.querySelector('[data-tab="folded"]') as HTMLElement).click();
    await app.updateComplete;
    const folded = root?.querySelector('reader-folded');
    await (folded as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    const foldedText = shadowText(folded);
    expect(foldedText).toContain('26 folded');
    expect(foldedText).toContain('last-prompt');
    expect(foldedText).toContain('mode');
    expect(foldedText).toContain('hook_success');
    expect(foldedText).toContain('total_tokens_reminder');
    expect(foldedText).toContain('cost-state');

    (root?.querySelector('[data-tab="catalog"]') as HTMLElement).click();
    await app.updateComplete;
    const catalog = root?.querySelector('reader-catalog');
    await (catalog as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    const catalogText = shadowText(catalog);
    for (const name of ['read', 'fold', 'mark', 'panel', 'unknown']) expect(catalogText).toContain(name);
    expect(catalogText).toContain('signal-relay');

    (root?.querySelector('[data-tab="fleet"]') as HTMLElement).click();
    await app.updateComplete;
    const fleet = root?.querySelector('reader-fleet');
    await (fleet as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    expect(shadowText(fleet)).toContain('flake-hunter');
    expect(shadowText(fleet)).toContain('launched');
    app.remove();
  });

  test('reading settings persist and change the rows', async () => {
    const app = await mount();
    await app.ingestFiles([{ name: 'proj/s.jsonl', text: richSession }]);
    await settle(app);
    const root = app.shadowRoot;
    ([...(root?.querySelectorAll('.top .btn') ?? [])].find(button => button.textContent?.includes('Reading')) as HTMLElement).click();
    await app.updateComplete;
    const hidden = [...(root?.querySelectorAll('.opt') ?? [])].find(button => button.textContent?.includes('marks hidden')) as HTMLElement;
    hidden.click();
    await settle(app);
    expect(app.settings.bookkeeping).toBe('hidden');
    expect(JSON.parse(localStorage.getItem('transcript-reader-settings') ?? '{}').bookkeeping).toBe('hidden');
    expect(app.view?.entries.length).toBe(12);
    // The blocking hook is a mark and signal-relay is unknown; both hide.
    expect(rows(app).length).toBe(10);
    app.remove();
  });
});
