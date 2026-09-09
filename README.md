# Transcript Reader

A local-first reader for Claude Code session transcripts. Drop one `.jsonl`
from `~/.claude/projects`, or the session's whole folder, and read the run back:
what was asked, what ran, what came back, and where the time and money went.
Everything is parsed in the browser tab. Nothing is uploaded.

Live build: [ivorpad.github.io/transcript-reader](https://ivorpad.github.io/transcript-reader/)

Forked from [dawushi97/Prism](https://github.com/dawushi97/Prism). The parser
was rebuilt against real transcripts and the interface replaced.

## How it reads a transcript

Every line type has one of five classes, and the class decides where the line
goes. The class is a lookup (`src/adapters/claude/catalog.ts`), so a type the
reader has never seen falls to the last class instead of breaking the page.

| class | what it means | examples |
| --- | --- | --- |
| read | gets a row: what was asked, said, run, and what came back | `user`, `assistant`, `tool_use`, `tool_result`, `system:compact_boundary` |
| fold | never a row; attaches to the tool call it names, shows as a count on that row | `hook_success`, `read_truncation_notice`, `structured_output` |
| mark | one low-contrast line in sequence; it changed the run's conditions | `hook_blocking_error`, `queued_command`, `system:model_refusal_fallback`, a thinking block with no stored text, a `user` line nobody typed |
| panel | answers a question about the session, not about a moment in it | `mode`, `cost-state`, `file-history-delta`, `total_tokens_reminder`, `skill_listing` |
| unknown | anything not in the tables; drawn once with its key list, repeats collapsed, counted in the footer | a type Claude Code adds tomorrow |

The tables place the 27 top-level types, 11 system subtypes, 49 attachment
types and 8 content blocks observed across 3,287 files and one million lines of
`~/.claude/projects`, Claude Code 2.1.193 through 2.1.263. Two dispositions
are set by hand rather than derived from the class: a blocking hook takes a row
of its own because it changed what happened, and a token reminder folds onto
the nearest row even though its numbers feed the rail.

Rows are drawn in write order. A tool call and its result are one row. A quiet
stretch of ten minutes or more is a row of its own, and every row after it
carries a weekday and clock time instead of an offset. Interrupt markers, task
notifications, echoed slash-command output and injected context are written as
`user` lines; they draw as marks and open no turn.

## What the reader shows

- **Session.** The rows. Above 400 rows it opens collapsed, one band per turn
  saying what the turn did; bands open in place. Under 40 lines the turn rail,
  the filter bar and the docked inspector are withheld and the column widens.
- **Fleet.** Every agent the session spawned, as lanes against active time and
  as a tree. The fleet is a view inside the session, because every agent exists
  because of an Agent call in this transcript. Drop the session's folder and the
  subagent transcripts and meta files fill in status, rows and cost.
- **Folded.** Every line that drew no row, by type, with the row it attached to.
- **Catalog.** The five classes, with the count of each type in the loaded
  session.

The footer is a ledger: lines parsed, rows drawn, lines folded, malformed lines
skipped, unrecognised types, and how many lines are out of timestamp order.
`drawn + folded + malformed` equals `parsed` for every file in the corpus; the
audit checks it.

## Loading a session

1. Open the page and drop a `.jsonl` file, or use *Open files*.
2. Better: drop the session's folder from `~/.claude/projects/<project>/`. The
   reader pairs `subagents/*.jsonl` with their `.meta.json`, reads
   `custom-title.json`, and inlines `tool-results/*` where a row says its output
   was saved to disk.

Reading settings (density, marks shown or hidden, elapsed or absolute time,
thinking, markdown, theme) persist in the browser.

## Development

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 510 tests in 6 files, including 46 per-version fixtures
npm run typecheck    # app and tools
npm run audit        # 16 checks over ~/.claude/projects, exits 1 on failure
npm run fixtures     # rebuild the redacted per-version fixtures
npm run build        # production bundle in dist/
```

`npm run audit` runs the adapter over every transcript on the machine and
prints one measurement per check: lines dropped, rows rendered as JSON, image
payloads inlined, lines the catalog cannot place, ledgers that do not balance.
Each of the catalog checks was run against deliberately broken code before it
was trusted. CI cannot run the audit because it has no `~/.claude/projects`;
`tests/format-regression.test.ts` carries the same checks against 46 redacted
fixtures spanning Claude Code 2.1.193 to 2.1.263, and `npm run fixtures`
rebuilds them from a local corpus.

Pushes to `main` build and deploy `dist/` to GitHub Pages.

## Architecture

```text
src/
├── reader/
│   ├── reader-app.ts          # shell: tabs, header, rail, stream, bands, inspector, footer
│   ├── reader-row.ts          # one row: text, thinking, tool, agent, diff, image, event, unknown, gap
│   ├── reader-rail.ts         # turns, files changed, session state
│   ├── reader-inspector.ts    # fields and the raw line
│   ├── reader-fleet.ts        # lanes and tree
│   ├── reader-folded.ts       # every line that drew no row
│   ├── reader-catalog.ts      # the five classes
│   ├── ingest.ts              # files to linked records with views built
│   ├── inspect.ts             # which fields a line shows
│   └── settings.ts
├── adapters/claude/
│   ├── parser.ts              # JSONL to NormalizedMessage[], write order, ledger inputs
│   ├── catalog.ts             # class and disposition lookups
│   ├── collapse.ts            # the fold pass: draw, attach, or route to a panel
│   ├── session.ts             # turns, entries, bands, panels, folds, ledger, timing
│   ├── fleet.ts               # agents from Agent calls, enriched from what else loaded
│   ├── events.ts              # one line of text per event kind
│   ├── content.ts             # content blocks, images, tool input and results
│   └── prompts.ts             # envelopes and the user lines nobody typed
├── types/prism.ts             # shared types
└── utils/                     # markdown, theme, icons
tools/
├── audit-corpus.ts            # the 16 checks
└── build-fixtures.ts
```

Lit, TypeScript, Vite and Vitest; marked and DOMPurify for markdown.

## Privacy

Files are parsed in the browser. Nothing leaves the tab.

## License

MIT
