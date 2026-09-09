#!/usr/bin/env bun
/**
 * Writes a fictional Claude Code session for screenshots and demos. Every
 * path, name, id and number is invented; nothing here comes from a real
 * transcript. The shape follows what Claude Code 2.1.263 writes: one line per
 * content block, hooks and reminders as attachments, latched state re-written
 * on every turn, a subagent folder with meta files.
 *
 *   bun tools/build-sample.ts [--out docs/sample]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const out = outFlag === -1 ? 'docs/sample' : args[outFlag + 1];

const SESSION = '0f3c9a1e-7d2b-4c1e-9a55-2c8e4f61d84b';
const CWD = '/Users/j/work/relay';
const START = Date.parse('2026-09-08T14:02:11.402Z');

type Line = Record<string, unknown>;

let counter = 0;
const uuid = (): string => {
  counter++;
  const hex = counter.toString(16).padStart(12, '0');
  return `a71c4d02-${hex.slice(0, 4)}-4${hex.slice(4, 7)}-9${hex.slice(7, 10)}-${hex.slice(0, 12)}`;
};
const toolId = (): string => `toolu_01${(counter++).toString(36).padStart(22, 'Q').toUpperCase()}`;

const stamp = (seconds: number): string => new Date(START + seconds * 1000).toISOString();

const base = (seconds: number, extra: Line = {}): Line => ({
  uuid: uuid(),
  parentUuid: null,
  isSidechain: false,
  sessionId: SESSION,
  timestamp: stamp(seconds),
  cwd: CWD,
  gitBranch: 'fix/queue-flake',
  version: '2.1.263',
  userType: 'external',
  entrypoint: 'cli',
  ...extra
});

const lines: Line[] = [];
let lastUuid: string | null = null;
const push = (line: Line): Line => {
  if (line.parentUuid === null && typeof line.uuid === 'string') line.parentUuid = lastUuid;
  lines.push(line);
  if (typeof line.uuid === 'string') lastUuid = line.uuid;
  return line;
};

const latched = (prompt: string, mode = 'default') => {
  push({ type: 'mode', mode, sessionId: SESSION });
  push({ type: 'permission-mode', permissionMode: 'acceptEdits', sessionId: SESSION });
  push({ type: 'last-prompt', lastPrompt: prompt, sessionId: SESSION });
  push({ type: 'atis-latch', atis: '905262160b2cf328', sessionId: SESSION });
};

const user = (seconds: number, text: string, extra: Line = {}) => {
  latched(text);
  return push(base(seconds, { type: 'user', permissionMode: 'acceptEdits', message: { role: 'user', content: text }, ...extra }));
};

const thinking = (seconds: number, text: string, requestId: string, model = 'claude-opus-5') => {
  push(base(seconds, {
    type: 'assistant',
    requestId,
    apiBlockIndex: 0,
    message: { role: 'assistant', model, content: [{ type: 'thinking', thinking: '', signature: 'Eu8BCkYIBx' }] }
  }));
  push(base(seconds + 1, {
    type: 'assistant',
    requestId,
    apiBlockIndex: 1,
    message: { role: 'assistant', model, content: [{ type: 'thinking', thinking: text, signature: 'Eu8BCkYIBx' }] }
  }));
};

const say = (seconds: number, text: string, requestId: string, model = 'claude-opus-5', out = 420) =>
  push(base(seconds, {
    type: 'assistant',
    requestId,
    effort: 'high',
    message: {
      role: 'assistant',
      model,
      stop_reason: 'end_turn',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 31402, cache_read_input_tokens: 28160, cache_creation_input_tokens: 2891, output_tokens: out, service_tier: 'standard' }
    }
  }));

const call = (seconds: number, name: string, input: Line, requestId: string, model = 'claude-opus-5'): string => {
  const id = toolId();
  push(base(seconds, {
    type: 'assistant',
    requestId,
    effort: 'high',
    message: {
      role: 'assistant',
      model,
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id, name, input, caller: { type: 'direct' } }],
      usage: { input_tokens: 2, cache_read_input_tokens: 30110, cache_creation_input_tokens: 512, output_tokens: 180 }
    }
  }));
  return id;
};

const result = (seconds: number, id: string, content: string, toolUseResult: unknown, isError = false) =>
  push(base(seconds, {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
    toolUseResult
  }));

const hook = (seconds: number, id: string, event: string, name: string, ms: number) =>
  push(base(seconds, {
    type: 'attachment',
    attachment: { type: 'hook_success', hookName: name, hookEvent: event, toolUseID: id, command: `.claude/hooks/${name}.sh`, stdout: '', stderr: '', exitCode: 0, durationMs: ms }
  }));

const tokens = (seconds: number, left: number) =>
  push(base(seconds, { type: 'attachment', attachment: { type: 'total_tokens_reminder', text: `<total_tokens>${left} tokens left</total_tokens>` } }));

const bash = (seconds: number, command: string, description: string, stdout: string, requestId: string, options: { exit?: number; ms?: number; model?: string } = {}) => {
  const id = call(seconds, 'Bash', { command, description }, requestId, options.model);
  hook(seconds, id, 'PreToolUse', 'guard-no-timeout-edits', 41);
  const failed = (options.exit ?? 0) !== 0;
  result(seconds + (options.ms ?? 1), id, stdout, { stdout, stderr: '', interrupted: false, isImage: false, noOutputExpected: false, ...(failed ? { returnCodeInterpretation: 'error' } : {}) }, failed);
  hook(seconds + (options.ms ?? 1), id, 'PostToolUse', 'fmt-check', 88);
  return id;
};

// ---------------------------------------------------------------------------
// The story
// ---------------------------------------------------------------------------

push({ type: 'ai-title', aiTitle: 'Flaky queue spec: drains under load', sessionId: SESSION });
push(base(0, { type: 'attachment', attachment: { type: 'skill_listing', isInitial: true, skillCount: 3, names: ['rspec-debug', 'changelog', 'pr'], content: '- rspec-debug\n- changelog\n- pr' } }));

user(0, 'Fix the flaky test in tests/queue_spec.rb. It fails maybe 1 in 5 runs on CI, always on "drains under load". I don\'t want the test deleted or the timeout raised.');
thinking(3, 'Two candidates: the spec depends on wall-clock sleep for the drain window, or the queue\'s flush is genuinely racing the consumer. Reproduce first at a high repetition count before changing anything, and record which of the two it is.', 'req_0h4021');
say(9, 'I\'ll reproduce it at 200 runs before touching anything, then read the spec and the queue\'s drain path.', 'req_0h4021');
tokens(9, 168_598);

bash(11, 'for i in $(seq 1 200); do bundle exec rspec tests/queue_spec.rb -e "drains under load" >>/tmp/flake.log 2>&1; done; grep -c \'examples, 1 failure\' /tmp/flake.log', 'Reproduce the flake at 200 runs', '37\n', 'req_0h4022', { ms: 48 });
tokens(60, 165_092);

{
  const id = call(60, 'Read', { file_path: `${CWD}/tests/queue_spec.rb`, offset: 88, limit: 60 }, 'req_0h4023');
  const content = [
    '  88  it "drains under load" do',
    '  89    queue = Queue.new(capacity: 512)',
    '  90    producers = 8.times.map { Thread.new { 500.times { queue.push(rand) } } }',
    '  91    sleep 0.25',
    '  92    expect(queue.drained?).to be true',
    '  93  end'
  ].join('\n');
  result(61, id, content, { type: 'text', file: { filePath: `${CWD}/tests/queue_spec.rb`, content, numLines: 60, startLine: 88, totalLines: 214 } });
  push(base(61, { type: 'attachment', attachment: { type: 'read_truncation_notice', toolUseID: id, banner: '154 of 214 lines withheld' } }));
  tokens(61, 161_890);
}

bash(78, 'bundle exec rspec tests/queue_spec.rb -e "drains under load" --seed 41213 --format documentation', 'Run one failing seed', 'Failures:\n\n  1) Queue drains under load\n     Failure/Error: expect(queue.drained?).to be true\n       expected true, got false\n     # ./tests/queue_spec.rb:92:in `block (2 levels)\'\n\n1 example, 1 failure\nFailed examples:\nrspec ./tests/queue_spec.rb:88 # Queue drains under load', 'req_0h4024', { exit: 1, ms: 3 });

{
  const id = toolId();
  push(base(82, { type: 'attachment', attachment: { type: 'hook_blocking_error', hookName: 'guard-no-timeout-edits', hookEvent: 'PreToolUse', toolUseID: id, blockingError: 'do not raise sleep durations in specs' } }));
}

// Agents
const flakeHunter = call(111, 'Agent', { description: 'Hunt the flake under load', subagent_type: 'flake-hunter', name: 'flake-hunter', prompt: 'Run the spec 200 times under load with GC stress on, and report whether the failure correlates with producer thread count or with the sleep window.' }, 'req_0h4025');
result(113, flakeHunter, 'Agent launched in the background', { isAsync: true, status: 'async_launched', agentId: 'ag7b21e0f4a9', description: 'Hunt the flake under load', resolvedModel: 'claude-sonnet-5', prompt: 'Run the spec 200 times under load with GC stress on…' });
tokens(113, 147_004);

const specWriter = call(120, 'Agent', { description: 'Write a regression spec', subagent_type: 'spec-writer', prompt: 'Write a regression spec that fails deterministically against the old drained? implementation.' }, 'req_0h4026');
result(344, specWriter, 'Wrote tests/queue_regression_spec.rb with 3 examples that fail on the old drained? and pass on the mutex-guarded one.', { agentId: 'agc0031477b2', agentType: 'spec-writer', status: 'completed', totalDurationMs: 224_000, totalTokens: 41_210, totalToolUseCount: 9, resolvedModel: 'claude-sonnet-5', content: [{ type: 'text', text: 'Wrote tests/queue_regression_spec.rb with 3 examples.' }], usage: { input_tokens: 120, output_tokens: 3_140 } });

const ciReader = call(346, 'Agent', { description: 'Read the CI config', subagent_type: 'Explore', prompt: 'Read .github/workflows to confirm how CI invokes rspec.' }, 'req_0h4027');
result(364, ciReader, 'API Error: 529 overloaded_error', { agentId: 'ag2e70af1c93', agentType: 'Explore', status: 'failed', resolvedModel: 'claude-haiku-4-5-20251001' }, true);

// An API error the turn recovered from
push(base(520, {
  type: 'assistant',
  requestId: 'req_0h9004',
  isApiErrorMessage: true,
  apiErrorStatus: 529,
  error: 'overloaded_error',
  errorDetails: { type: 'error', retryAfterMs: 21000 },
  isAbortedMidStream: false,
  message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'API Error: 529 overloaded_error' }] }
}));

// The fix
{
  const id = call(549, 'Edit', { file_path: `${CWD}/lib/queue.rb`, old_string: '  @size.zero?', new_string: '  @mutex.synchronize { @size.zero? && @pending.empty? }' }, 'req_0h9005');
  hook(549, id, 'PreToolUse', 'guard-no-timeout-edits', 39);
  result(550, id, 'The file lib/queue.rb has been updated.', {
    filePath: `${CWD}/lib/queue.rb`,
    oldString: '  @size.zero?',
    newString: '  @mutex.synchronize { @size.zero? && @pending.empty? }',
    replaceAll: false,
    userModified: false,
    structuredPatch: [{ oldStart: 141, oldLines: 3, newStart: 141, newLines: 3, lines: [' def drained?', '-  @size.zero?', '+  @mutex.synchronize { @size.zero? && @pending.empty? }', ' end'] }]
  });
  hook(550, id, 'PostToolUse', 'rubocop-a', 310);
  push(base(550, { type: 'file-history-delta', messageId: uuid(), snapshotMessageId: uuid(), trackingPath: `${CWD}/lib/queue.rb`, backup: { backupFileName: null, version: 1, backupTime: stamp(550) } }));
  tokens(551, 101_240);
}

push(base(629, { type: 'system', subtype: 'model_refusal_fallback', originalModel: 'claude-opus-5', fallbackModel: 'claude-sonnet-5', apiRefusalCategory: 'none_given', trigger: 'api_refusal', direction: 'downgrade', level: 'warning' }));
for (let index = 0; index < 3; index++) {
  push(base(651 + index, { type: 'signal-relay', relayId: `rl_44c${index}`, channel: 'ide', payloadBytes: 1180 + index, ts: START + (651 + index) * 1000 }));
}

// Queued while the model was still working, then the interrupt.
push(base(693, { type: 'attachment', attachment: { type: 'queued_command', prompt: 'stop, run it 200 times with GC.stress = true instead, that\'s how CI runs it', commandMode: 'prompt', origin: { kind: 'human' }, timestamp: stamp(693) } }));
push(base(694, { type: 'user', message: { role: 'user', content: '[Request interrupted by user]' } }));
user(695, 'stop, run it 200 times with GC.stress = true instead, that\'s how CI runs it', { interruptedMessageId: 'msg_0h97', toolEndsTurn: true, origin: 'interrupt' });

{
  const id = call(700, 'Bash', { command: 'GC_STRESS=1 for i in $(seq 1 200); do bundle exec rspec tests/queue_spec.rb -e "drains under load"; done', description: 'Re-run under GC stress', run_in_background: true }, 'req_0h9006');
  hook(700, id, 'PreToolUse', 'guard-no-timeout-edits', 40);
  result(952, id, `[1/200] 1 example, 0 failures\n[2/200] 1 example, 0 failures\n\nOutput too large. Full output saved to: /Users/j/.claude/projects/-Users-j-work-relay/${SESSION}/tool-results/9c1e.txt`, { stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false, backgroundTaskId: 'bg_19a4', persistedOutputPath: `/Users/j/.claude/projects/-Users-j-work-relay/${SESSION}/tool-results/9c1e.txt`, persistedOutputSize: 681_360 });
  push(base(952, { type: 'attachment', attachment: { type: 'bash_output_audience_note', toolUseID: id } }));
  tokens(953, 96_310);
}

// A seed sweep: what makes the session long.
user(1000, 'sweep seeds 1 to 400 one at a time so we know how often it fails with the fix in');
say(1004, 'Running each seed on its own so a failure names the seed that produced it.', 'req_0h9007', 'claude-sonnet-5', 60);
let failures = 0;
for (let seed = 1; seed <= 400; seed++) {
  const at = 1006 + seed * 3;
  const fails = seed % 97 === 0;
  if (fails) failures++;
  bash(at, `bundle exec rspec tests/queue_spec.rb -e "drains under load" --seed ${seed}`, `Seed ${seed}`, fails ? `Failures:\n\n  1) Queue drains under load\n     expected true, got false\n\n1 example, 1 failure` : '1 example, 0 failures', `req_0h9${String(100 + seed)}`, { exit: fails ? 1 : 0, ms: 2, model: 'claude-sonnet-5' });
  if (seed % 40 === 0) tokens(at + 2, 96_310 - seed * 120);
}
const sweepEnd = 1006 + 400 * 3 + 5;
say(sweepEnd, `${failures} of 400 seeds still fail, all with the producer count at 8. The mutex guard fixed the drain race but not the case where the last producer is mid-push when the consumer checks. Let me look at that before the regression spec.`, 'req_0h9600', 'claude-sonnet-5', 96);
push(base(sweepEnd + 1, { type: 'system', subtype: 'turn_duration', durationMs: 1_200_000, messageCount: 812 }));

// A gap of 18h 40m, then the morning after.
const morning = sweepEnd + 18 * 3600 + 40 * 60;
user(morning, 'morning. did the GC stress run finish? write the regression spec and open the PR');
say(morning + 4, '0 failures in 200 runs under GC stress. The mutex-guarded drained? holds. Writing a regression spec that fails against the old implementation, then the PR.', 'req_0k2088', 'claude-sonnet-5', 140);
push(base(morning + 6, { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', level: 'info', compactMetadata: { trigger: 'auto', preTokens: 148_204, postTokens: 13_049 } }));
{
  const content = "require 'spec_helper'\n\nRSpec.describe Queue, 'under GC stress' do\n  it 'drains with eight producers' do\n    GC.stress = true\n    queue = Queue.new(capacity: 512)\n    8.times.map { Thread.new { 500.times { queue.push(rand) } } }.each(&:join)\n    expect(queue.drained?).to be true\n  ensure\n    GC.stress = false\n  end\nend\n";
  const id = call(morning + 20, 'Write', { file_path: `${CWD}/tests/support/gc_stress_spec.rb`, content }, 'req_0k2089', 'claude-sonnet-5');
  result(morning + 21, id, 'File created successfully.', { type: 'create', filePath: `${CWD}/tests/support/gc_stress_spec.rb`, content, structuredPatch: [] });
  push(base(morning + 21, { type: 'file-history-delta', messageId: uuid(), snapshotMessageId: uuid(), trackingPath: `${CWD}/tests/support/gc_stress_spec.rb`, backup: { backupFileName: null, version: 1, backupTime: stamp(morning + 21) } }));
}
bash(morning + 40, 'bundle exec rspec tests/support/gc_stress_spec.rb tests/queue_regression_spec.rb', 'Run the new specs', '4 examples, 0 failures', 'req_0k2090', { ms: 6, model: 'claude-sonnet-5' });
bash(morning + 70, 'git add -A && git commit -q -m "Guard drained? with the queue mutex" && gh pr create --fill', 'Commit and open the PR', 'https://github.com/example/relay/pull/2841', 'req_0k2091', { ms: 9, model: 'claude-sonnet-5' });
push(base(morning + 80, { type: 'pr-link', prNumber: 2841, prRepository: 'example/relay', prUrl: 'https://github.com/example/relay/pull/2841' }));
say(morning + 84, 'Opened PR #2841: the mutex guard on drained?, a regression spec under GC stress, and the seed sweep results in the description. The 4 seeds that still failed at producer count 8 are listed there as a follow-up; they are a second race in push, not this one.', 'req_0k2092', 'claude-sonnet-5', 210);

push({
  type: 'cost-state',
  sessionId: SESSION,
  totalCostUSD: 2.14,
  totalAPIDuration: 412_000,
  totalToolDuration: 1_880_000,
  totalLinesAdded: 71,
  totalLinesRemoved: 3,
  totalDuration: (morning + 84) * 1000,
  startTime: START,
  modelUsage: {
    'claude-opus-5': { inputTokens: 1_240, outputTokens: 18_600, cacheReadInputTokens: 2_104_000, cacheCreationInputTokens: 61_000, webSearchRequests: 0, costUSD: 1.91 },
    'claude-sonnet-5': { inputTokens: 860, outputTokens: 42_100, cacheReadInputTokens: 4_811_000, cacheCreationInputTokens: 22_000, webSearchRequests: 0, costUSD: 0.23 }
  },
  hasUnknownModelCost: false
});

// ---------------------------------------------------------------------------
// Subagents
// ---------------------------------------------------------------------------

const agentLines = (agentId: string, seconds: number, prompt: string, steps: Array<[string, string]>, closing: string | null, extra: Line = {}): Line[] => {
  const out: Line[] = [];
  let parent: string | null = null;
  const add = (line: Line) => {
    line.parentUuid = parent;
    out.push(line);
    parent = line.uuid as string;
  };
  add(base(seconds, { type: 'user', agentId, isSidechain: true, message: { role: 'user', content: prompt }, ...extra }));
  let at = seconds + 2;
  for (const [command, stdout] of steps) {
    const id = toolId();
    add(base(at, { type: 'assistant', agentId, isSidechain: true, requestId: `req_${agentId.slice(2, 8)}`, message: { role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'tool_use', id, name: 'Bash', input: { command, description: command.split(' ').slice(0, 3).join(' ') } }] } }));
    add(base(at + 4, { type: 'user', agentId, isSidechain: true, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: stdout }] }, toolUseResult: { stdout, stderr: '', interrupted: false } }));
    at += 40;
  }
  if (closing) {
    add(base(at, { type: 'assistant', agentId, isSidechain: true, message: { role: 'assistant', model: 'claude-sonnet-5', stop_reason: 'end_turn', content: [{ type: 'text', text: closing }], usage: { input_tokens: 40, output_tokens: 310 } } }));
  }
  return out;
};

const subagents: Array<{ id: string; meta: Line; lines: Line[] }> = [];

const logReducerCall = toolId();
subagents.push({
  id: 'ag7b21e0f4a9',
  meta: { agentType: 'flake-hunter', description: 'Hunt the flake under load', toolUseId: flakeHunter, spawnDepth: 1, model: 'claude-sonnet-5', spawnedWithWorktree: true, worktreeBranch: 'flake-sweep' },
  lines: (() => {
    const out = agentLines('ag7b21e0f4a9', 112, 'Run the spec 200 times under load with GC stress on, and report whether the failure correlates with producer thread count or with the sleep window.', [
      ['GC_STRESS=1 for i in $(seq 1 200); do bundle exec rspec tests/queue_spec.rb -e "drains under load" >>/tmp/hunt.log 2>&1; done; grep -c "1 failure" /tmp/hunt.log', '37'],
      ['grep -B2 "1 failure" /tmp/hunt.log | grep -o "producers=[0-9]*" | sort | uniq -c', '  37 producers=8']
    ], null);
    const parent = out[out.length - 1].uuid as string;
    out.push(base(200, { type: 'assistant', agentId: 'ag7b21e0f4a9', isSidechain: true, parentUuid: parent, message: { role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'tool_use', id: logReducerCall, name: 'Agent', input: { description: 'Reduce the failing logs', subagent_type: 'log-reducer', prompt: 'Reduce 200 run logs to the minimal failing interleaving.' } }] } }));
    out.push(base(272, { type: 'user', agentId: 'ag7b21e0f4a9', isSidechain: true, parentUuid: out[out.length - 1].uuid as string, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: logReducerCall, content: 'Stopped by user before a result.' }] }, toolUseResult: { agentId: 'ag91fd3a08c2', agentType: 'log-reducer', status: 'stopped' } }));
    out.push(base(513, { type: 'assistant', agentId: 'ag7b21e0f4a9', isSidechain: true, parentUuid: out[out.length - 1].uuid as string, message: { role: 'assistant', model: 'claude-sonnet-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'All 37 failures had the producer count at 8; none correlated with the sleep window. The drain check races the last push.' }], usage: { input_tokens: 40, output_tokens: 310 } } }));
    return out;
  })()
});

subagents.push({
  id: 'ag91fd3a08c2',
  meta: { agentType: 'log-reducer', description: 'Reduce the failing logs', toolUseId: logReducerCall, spawnDepth: 2, parentAgentId: 'ag7b21e0f4a9', model: 'claude-sonnet-5', stoppedByUser: true },
  lines: agentLines('ag91fd3a08c2', 201, 'Reduce 200 run logs to the minimal failing interleaving.', [
    ['wc -l /tmp/hunt.log', '41200 /tmp/hunt.log'],
    ['awk \'/1 failure/{print NR}\' /tmp/hunt.log | head', '206\n412\n824']
  ], null)
});

subagents.push({
  id: 'agc0031477b2',
  meta: { agentType: 'spec-writer', description: 'Write a regression spec', toolUseId: specWriter, spawnDepth: 1, model: 'claude-sonnet-5' },
  lines: agentLines('agc0031477b2', 121, 'Write a regression spec that fails deterministically against the old drained? implementation.', [
    ['cat lib/queue.rb | sed -n 130,150p', 'def drained?\n  @size.zero?\nend'],
    ['bundle exec rspec tests/queue_regression_spec.rb', '3 examples, 3 failures']
  ], 'Wrote tests/queue_regression_spec.rb with 3 examples that fail on the old drained? and pass on the mutex-guarded one.')
});

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const dir = join(out, SESSION);
mkdirSync(join(dir, 'subagents'), { recursive: true });
mkdirSync(join(dir, 'tool-results'), { recursive: true });
writeFileSync(join(out, `${SESSION}.jsonl`), `${lines.map(line => JSON.stringify(line)).join('\n')}\n`);
for (const agent of subagents) {
  writeFileSync(join(dir, 'subagents', `agent-${agent.id}.jsonl`), `${agent.lines.map(line => JSON.stringify(line)).join('\n')}\n`);
  writeFileSync(join(dir, 'subagents', `agent-${agent.id}.meta.json`), JSON.stringify(agent.meta));
}
writeFileSync(
  join(dir, 'tool-results', '9c1e.txt'),
  Array.from({ length: 200 }, (_, index) => `[${index + 1}/200] 1 example, 0 failures`).join('\n')
);
console.log(`wrote ${lines.length} lines to ${out}/${SESSION}.jsonl and ${subagents.length} subagents`);
