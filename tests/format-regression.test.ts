import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { classifyLine } from '../src/adapters/claude/catalog';
import {
  isClaudeSessionJSONL,
  parseClaudeSession
} from '../src/adapters/claude/parser';
import { buildSessionView } from '../src/adapters/claude/session';
import type { NormalizedMessage } from '../src/types/reader';

const FIXTURE_DIR = join(__dirname, 'fixtures', 'versions');

const index = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'index.json'), 'utf8')
) as { versions: string[] };

const versionFiles = readdirSync(FIXTURE_DIR)
  .filter(name => name.endsWith('.jsonl'))
  .sort();

/** Every line the parser kept, wherever it went. */
const everyLine = (parsed: ReturnType<typeof parseClaudeSession>): NormalizedMessage[] => {
  const lines: NormalizedMessage[] = [];
  const visit = (message: NormalizedMessage) => {
    lines.push(message);
    for (const member of message.groupedMessages ?? []) visit(member);
    for (const folded of message.folded ?? []) visit(folded);
  };
  for (const message of parsed?.conversation.messages ?? []) visit(message);
  for (const message of parsed?.conversation.folded ?? []) visit(message);
  return lines;
};

const readLines = (name: string): unknown[] =>
  readFileSync(join(FIXTURE_DIR, name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return line;
      }
    });

/**
 * Redacted samples from every Claude Code version the reference corpus spans.
 * A new line type, attachment type or system subtype fails here instead of
 * appearing silently in the viewer — which is how the parser drifted 28,196
 * lines behind the format in the first place.
 */
describe('format regression across Claude Code versions', () => {
  test('covers the version range the corpus spans', () => {
    expect(versionFiles.length).toBeGreaterThanOrEqual(40);
    expect(index.versions[0]).toBe('2.1.193');
    expect(index.versions[index.versions.length - 1]).toBe('2.1.263');
  });

  test.each(versionFiles)('%s parses with no dropped lines', name => {
    const lines = readLines(name);
    expect(isClaudeSessionJSONL(lines)).toBe(true);

    const parsed = parseClaudeSession(lines);
    expect(parsed).not.toBeNull();
    expect(parsed?.warnings).toEqual([]);
  });

  test.each(versionFiles)('%s renders no row as raw JSON', name => {
    const parsed = parseClaudeSession(readLines(name));
    const offenders = everyLine(parsed)
      .filter(message => message.channel === 'event')
      .filter(message => {
        const head = message.text.trimStart();
        if (!head.startsWith('{') && !head.startsWith('[')) return false;
        try {
          return typeof JSON.parse(head) === 'object';
        } catch {
          return false;
        }
      })
      .map(message => message.eventKind);

    expect(offenders).toEqual([]);
  });

  test.each(versionFiles)('%s renders no tool call as raw JSON', name => {
    const parsed = parseClaudeSession(readLines(name));
    const offenders = (parsed?.conversation.messages ?? [])
      .filter(message => message.channel === 'tool_call' && message.toolUseId)
      .filter(message => {
        try {
          const decoded = JSON.parse(message.text.trimStart()) as { id?: unknown };
          return decoded?.id === message.toolUseId;
        } catch {
          return false;
        }
      })
      .map(message => message.name);

    expect(offenders).toEqual([]);
  });

  test.each(versionFiles)('%s inlines no image payload', name => {
    const parsed = parseClaudeSession(readLines(name));
    const offenders = (parsed?.conversation.messages ?? []).filter(message =>
      (message.images ?? []).some(image => message.text.includes(image.url))
    );

    expect(offenders).toEqual([]);
  });

  test.each(versionFiles)('%s caps every row at the render limit', name => {
    const parsed = parseClaudeSession(readLines(name));
    const longest = Math.max(
      0,
      ...(parsed?.conversation.messages ?? []).map(message => message.text.length)
    );

    expect(longest).toBeLessThanOrEqual(50_000);
  });

  test.each(versionFiles)('%s places every line in a class other than unknown', name => {
    const lines = readLines(name);
    const unknown = lines
      .filter(line => classifyLine(line) === 'unknown')
      .map(line => JSON.stringify(line).slice(0, 80));

    expect(unknown).toEqual([]);
  });

  test.each(versionFiles)('%s draws no fold or panel line as a row', name => {
    const parsed = parseClaudeSession(readLines(name));
    const offenders = (parsed?.conversation.messages ?? [])
      .filter(message => message.lineClass === 'fold' || message.lineClass === 'panel')
      .map(message => message.eventKind ?? message.lineType);

    expect(offenders).toEqual([]);
  });

  test.each(versionFiles)('%s accounts for every line in the ledger', name => {
    const lines = readLines(name);
    const parsed = parseClaudeSession(lines);
    const view = buildSessionView(parsed as NonNullable<typeof parsed>, lines.length);

    expect(view.ledger.unaccountedLines).toBe(0);
    expect(view.ledger.drawnLines + view.ledger.foldedLines + view.ledger.malformedLines).toBe(
      lines.length
    );
  });

  test('the shape of the corpus has not changed', () => {
    const lineTypes = new Set<string>();
    const eventKinds = new Set<string>();

    for (const name of versionFiles) {
      const parsed = parseClaudeSession(readLines(name));
      for (const row of everyLine(parsed)) {
        if (row.lineType) lineTypes.add(row.lineType);
        if (row.eventKind) eventKinds.add(row.eventKind);
      }
    }

    // A type the parser has no summariser for shows up as `unknown:` or
    // `attachment:` with no entry, which is the signal to update the adapter.
    const unknown = [...eventKinds].filter(kind => kind.startsWith('unknown:'));
    expect(unknown).toEqual([]);

    expect([...lineTypes].sort()).toMatchSnapshot('line types');
    expect([...eventKinds].sort()).toMatchSnapshot('event kinds');
  });
});
