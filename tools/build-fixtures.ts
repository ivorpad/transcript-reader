#!/usr/bin/env bun
/**
 * Samples real sessions across a range of Claude Code versions and writes
 * redacted fixtures. Prompt text, file paths, hostnames and ids are replaced;
 * only the *shape* of each line survives, which is what the parser is tested on.
 *
 *   bun tools/build-fixtures.ts [--root <dir>] [--out tests/fixtures/versions]
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

const root = flag('--root') ?? `${process.env.HOME}/.claude/projects`;
const out = flag('--out') ?? 'tests/fixtures/versions';
const perVersion = Number(flag('--lines') ?? 150);

/** Long strings are capped: the snapshot tests shape, not payload size. */
const MAX_STRING = 120;
const TIME_BASE = Date.parse('2026-01-01T00:00:00.000Z');

const walk = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.name.endsWith('.jsonl')) found.push(path);
  }
  return found;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

let counter = 0;
const idMap = new Map<string, string>();
const stableId = (value: string, prefix: string): string => {
  const existing = idMap.get(value);
  if (existing) return existing;
  const replacement = `${prefix}${(counter++).toString(36)}`;
  idMap.set(value, replacement);
  return replacement;
};

/** Replaces content while keeping length class, type and structure intact. */
const redact = (value: unknown, key?: string): unknown => {
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [field, inner] of Object.entries(value)) {
      out[field] = redact(inner, field);
    }
    return out;
  }
  if (typeof value !== 'string') return value;

  if (key === 'type' || key === 'subtype' || key === 'role' || key === 'level') {
    return value;
  }
  // Keep timestamps ordered and parseable without revealing when work happened.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u.test(value)) {
    return new Date(TIME_BASE + counter++ * 1000).toISOString();
  }
  if (key === 'name' || key === 'tool_name' || key === 'model' || key === 'version') {
    return value;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) {
    return stableId(value, 'uuid-');
  }
  if (/^toolu_/u.test(value)) return stableId(value, 'toolu_');
  if (value.startsWith('/') || value.includes('/Users/')) {
    return `/redacted/path-${stableId(value, 'p').slice(1)}`;
  }
  // Keep a length class so grouping behaves the same, without keeping the bulk.
  if (value.length > 200) return `redacted long ${'x'.repeat(MAX_STRING)}`;
  if (value.length > 60) return `redacted medium ${'x'.repeat(40)}`;
  return 'redacted';
};

const byVersion = new Map<string, unknown[]>();

for (const file of walk(root)) {
  const text = await Bun.file(file).text();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const version = typeof parsed.version === 'string' ? parsed.version : null;
    if (!version) continue;
    const bucket = byVersion.get(version) ?? [];
    if (bucket.length >= perVersion) continue;
    bucket.push(redact(parsed));
    byVersion.set(version, bucket);
  }
}

mkdirSync(out, { recursive: true });
const versions = [...byVersion.keys()].sort();
for (const version of versions) {
  const lines = byVersion.get(version) ?? [];
  writeFileSync(
    join(out, `${version}.jsonl`),
    `${lines.map(line => JSON.stringify(line)).join('\n')}\n`
  );
}
writeFileSync(
  join(out, 'index.json'),
  `${JSON.stringify({ versions, perVersion, generated: new Date().toISOString() }, null, 2)}\n`
);
console.log(`wrote ${versions.length} version fixtures to ${out}`);
console.log(`${versions[0]} … ${versions[versions.length - 1]}`);
