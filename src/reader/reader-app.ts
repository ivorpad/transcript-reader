import { LitElement, css, html, nothing, svg } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';

import {
  LONG_SESSION_ROWS,
  SMALL_SESSION_LINES,
  formatDayClock,
  formatDuration
} from '../adapters/claude/session';
import { fleetSummary } from '../adapters/claude/fleet';
import type {
  FleetView,
  NormalizedMessage,
  ReaderEntry,
  SessionBand,
  SessionView
} from '../types/prism';
import { applyTheme, initTheme } from '../utils/theme';
import { clip, humanBytes, plural, shortId, shortModel, usd } from './format';
import {
  buildRecords,
  fleetFor,
  readLoadedFile,
  rootRecords,
  spawnLine,
  type LoadedRecord,
  type LoadedTextFile
} from './ingest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type ReaderSettings } from './settings';
import { edgeOf } from './reader-row';
import { sharedStyles } from './styles';
import './reader-row';
import './reader-rail';
import './reader-inspector';
import './reader-fleet';
import './reader-folded';
import './reader-catalog';

export type ReaderTab = 'session' | 'fleet' | 'folded' | 'catalog';

interface Filter {
  kind: 'all' | 'tools' | 'trouble' | 'agents' | 'bash' | 'siblings';
  requestId?: string;
}

const EDGE_COLOR: Record<string, string> = {
  blue: 'oklch(0.52 0.12 250)',
  violet: 'oklch(0.5 0.12 300)',
  green: 'oklch(0.5 0.12 150)',
  red: 'oklch(0.52 0.16 25)',
  amber: 'oklch(0.5 0.1 75)',
  grey: '#c2beb5',
  ink: '#6b6862'
};

/** Walks a dropped directory through the entries API, which `dataTransfer.files` cannot do. */
const readDroppedEntries = async (transfer: DataTransfer): Promise<LoadedTextFile[]> => {
  const items = Array.from(transfer.items ?? []);
  const entries = items
    .map(item => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => entry !== null);

  if (entries.length === 0) {
    return Promise.all(Array.from(transfer.files).map(file => readLoadedFile(file)));
  }

  const files: LoadedTextFile[] = [];
  const readEntry = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject)
      );
      if (!/\.(jsonl|json|txt|md)$/u.test(file.name)) return;
      files.push({ name: `${prefix}${file.name}`, text: await file.text() });
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const all: FileSystemEntry[] = [];
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject)
        );
        if (batch.length === 0) break;
        all.push(...batch);
      }
      for (const child of all) await readEntry(child, `${prefix}${entry.name}/`);
    }
  };
  for (const entry of entries) await readEntry(entry, '');
  return files;
};

/** Pure, so the filter bar can count each chip without touching state during render. */
const matchesFilter = (entry: ReaderEntry, filter: Filter): boolean => {
  switch (filter.kind) {
    case 'all':
      return true;
    case 'tools':
      return entry.kind === 'tool' || entry.kind === 'diff' || entry.kind === 'agent';
    case 'trouble':
      return entry.severity === 'error' || entry.severity === 'warning';
    case 'agents':
      return entry.kind === 'agent';
    case 'bash':
      return entry.tag === 'bash';
    case 'siblings':
      return (
        entry.message?.requestId === filter.requestId || entry.result?.requestId === filter.requestId
      );
  }
};

@customElement('transcript-reader')
export class TranscriptReader extends LitElement {
  @state()
  records: LoadedRecord[] = [];

  @state()
  activeKey: string | null = null;

  @state()
  tab: ReaderTab = 'session';

  @state()
  selectedEntryId: string | null = null;

  @state()
  private selectedLine: NormalizedMessage | null = null;

  @state()
  private inspectorOpen = false;

  @state()
  settings: ReaderSettings = { ...DEFAULT_SETTINGS };

  @state()
  private settingsOpen = false;

  @state()
  private filter: Filter = { kind: 'all' };

  @state()
  private readFull = new Set<string>();

  @state()
  private openBands = new Set<number>();

  @state()
  private foldKey: string | null = null;

  @state()
  private width = typeof window === 'undefined' ? 1400 : window.innerWidth;

  @state()
  private dragging = false;

  @state()
  private loadNote: string | null = null;

  #fleetCache: { key: string; fleet: FleetView } | null = null;

  get record(): LoadedRecord | null {
    return this.records.find(record => record.key === this.activeKey) ?? null;
  }

  get view(): SessionView | null {
    return this.record?.view ?? null;
  }

  get fleet(): FleetView | null {
    const record = this.record;
    if (!record) return null;
    if (this.#fleetCache?.key === record.key) return this.#fleetCache.fleet;
    const fleet = fleetFor(this.records, record);
    this.#fleetCache = { key: record.key, fleet };
    return fleet;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.settings = loadSettings();
    initTheme(this.settings.theme);
    window.addEventListener('resize', this.#onResize);
    document.addEventListener('keydown', this.#onKeydown);
  }

  disconnectedCallback(): void {
    window.removeEventListener('resize', this.#onResize);
    document.removeEventListener('keydown', this.#onKeydown);
    super.disconnectedCallback();
  }

  #onResize = (): void => {
    this.width = window.innerWidth;
  };

  #onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.settingsOpen = false;
      this.inspectorOpen = false;
    }
  };

  /** Parses every dropped file and shows the first root session. */
  async ingestFiles(files: LoadedTextFile[]): Promise<void> {
    const records = buildRecords(files);
    this.records = records;
    this.#fleetCache = null;
    const roots = rootRecords(records);
    this.activeKey = roots[0]?.key ?? records[0]?.key ?? null;
    this.tab = 'session';
    this.selectedEntryId = null;
    this.selectedLine = null;
    this.inspectorOpen = false;
    this.filter = { kind: 'all' };
    this.readFull = new Set();
    this.openBands = new Set();
    this.foldKey = null;
    const subagents = records.filter(record => record.parentKey).length;
    const journals = records.filter(record => record.isJournal).length;
    this.loadNote =
      records.length === 0
        ? `${plural(files.length, 'file')} · none is a Claude Code transcript`
        : [
            plural(files.length, 'file'),
            plural(roots.length, 'session'),
            subagents ? plural(subagents, 'subagent') : null,
            journals ? plural(journals, 'journal') : null
          ]
            .filter(Boolean)
            .join(' · ');
  }

  #setSettings(patch: Partial<ReaderSettings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    if (patch.theme) applyTheme(patch.theme);
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  get isSmall(): boolean {
    return (this.record?.lineCount ?? 0) < SMALL_SESSION_LINES;
  }

  get isLong(): boolean {
    const record = this.record;
    return Boolean(record && record.view.ledger.rowCount > LONG_SESSION_ROWS);
  }

  get bandsMode(): boolean {
    return this.isLong && !this.readFull.has(this.record?.key ?? '');
  }

  get railShown(): boolean {
    return this.width >= 940 && !this.isSmall;
  }

  get inspectorDocked(): boolean {
    return this.width >= 1200 && !this.isSmall;
  }

  get visibleEntries(): ReaderEntry[] {
    const view = this.view;
    if (!view) return [];
    const hideMarks = this.settings.bookkeeping === 'hidden';
    return view.entries.filter(entry => {
      if (entry.kind === 'gap') return this.filter.kind === 'all';
      if (!this.settings.showThinking && entry.kind === 'thinking') return false;
      if (hideMarks && (entry.lineClass === 'mark' || entry.kind === 'unknown')) return false;
      return matchesFilter(entry, this.filter);
    });
  }

  get selectedEntry(): ReaderEntry | null {
    return this.view?.entries.find(entry => entry.id === this.selectedEntryId) ?? null;
  }

  get currentTurn(): number {
    return this.selectedEntry?.turnIndex ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  async #scrollToEntry(id: string): Promise<void> {
    await this.updateComplete;
    const host = [...this.renderRoot.querySelectorAll('[data-entry-id]')].find(
      candidate => candidate.getAttribute('data-entry-id') === id
    );
    if (host && typeof host.scrollIntoView === 'function') host.scrollIntoView({ block: 'center' });
  }

  async #goToEntry(id: string): Promise<void> {
    const record = this.record;
    if (!record) return;
    const entry = record.view.entries.find(candidate => candidate.id === id);
    if (!entry) return;
    this.tab = 'session';
    if (this.bandsMode) this.readFull = new Set([...this.readFull, record.key]);
    if (!matchesFilter(entry, this.filter)) this.filter = { kind: 'all' };
    this.selectedEntryId = entry.id;
    this.selectedLine = entry.message;
    await this.#scrollToEntry(entry.id);
  }

  async #goToTurn(turnIndex: number): Promise<void> {
    const view = this.view;
    if (!view) return;
    if (this.bandsMode) {
      const indexes = view.bands
        .map((band, index) => (band.turnIndex === turnIndex ? index : -1))
        .filter(index => index >= 0);
      this.openBands = new Set([...this.openBands, ...indexes]);
      await this.updateComplete;
      const band = this.renderRoot.querySelector(`[data-band="${indexes[0]}"]`);
      if (band && typeof band.scrollIntoView === 'function') band.scrollIntoView({ block: 'start' });
      return;
    }
    const first = view.entries.find(entry => entry.turnIndex === turnIndex && entry.kind !== 'gap');
    if (first) await this.#goToEntry(first.id);
  }

  #onSelect = (event: CustomEvent<{ entryId: string; line: NormalizedMessage | null }>): void => {
    this.selectedEntryId = event.detail.entryId;
    this.selectedLine = event.detail.line;
    this.inspectorOpen = true;
  };

  #onGo = (event: CustomEvent<{ tab: ReaderTab; entryId?: string }>): void => {
    const { tab, entryId } = event.detail;
    if (tab === 'session' && entryId) {
      void this.#goToEntry(entryId);
      return;
    }
    this.tab = tab;
  };

  #onOpenAgent = (event: CustomEvent<{ recordKey: string | null; entryId: string | null }>): void => {
    const { recordKey, entryId } = event.detail;
    if (recordKey && this.records.some(record => record.key === recordKey)) {
      this.#activate(recordKey);
      return;
    }
    if (entryId) void this.#goToEntry(entryId);
  };

  #activate(key: string): void {
    this.activeKey = key;
    this.tab = 'session';
    this.selectedEntryId = null;
    this.selectedLine = null;
    this.inspectorOpen = false;
    this.filter = { kind: 'all' };
    this.openBands = new Set();
    this.foldKey = null;
  }

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------

  async #onInput(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;
    await this.ingestFiles(await Promise.all(files.map(file => readLoadedFile(file))));
  }

  async #onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragging = false;
    if (!event.dataTransfer) return;
    const files = await readDroppedEntries(event.dataTransfer);
    if (files.length) await this.ingestFiles(files);
  }

  #onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging = true;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  render() {
    const record = this.record;
    return html`
      <div
        class=${classMap({ app: true, dragging: this.dragging })}
        @dragover=${this.#onDragOver}
        @dragleave=${() => {
          this.dragging = false;
        }}
        @drop=${this.#onDrop}
        @reader-select=${this.#onSelect}
        @reader-go=${this.#onGo}
        @reader-open-agent=${this.#onOpenAgent}
        @reader-turn=${(event: CustomEvent<{ turnIndex: number }>) => void this.#goToTurn(event.detail.turnIndex)}
        @reader-siblings=${(event: CustomEvent<{ requestId: string }>) => {
          this.filter = { kind: 'siblings', requestId: event.detail.requestId };
          this.tab = 'session';
          if (record) this.readFull = new Set([...this.readFull, record.key]);
        }}
        @reader-close=${() => {
          this.inspectorOpen = false;
        }}
        @reader-fold-pick=${(event: CustomEvent<{ key: string }>) => {
          this.foldKey = event.detail.key;
        }}
      >
        ${this.#renderTop()}
        ${record ? this.#renderLoaded(record) : this.#renderEmpty()}
        ${record ? this.#renderFooter(record) : nothing}
        ${this.settingsOpen ? this.#renderSettings() : nothing}
        <input class="hidden-input" id="file-input" type="file" multiple accept=".jsonl,.json,.txt,.md" @change=${this.#onInput} />
        <input class="hidden-input" id="folder-input" type="file" multiple webkitdirectory @change=${this.#onInput} />
      </div>
    `;
  }

  #pick(id: string): void {
    (this.renderRoot.querySelector(`#${id}`) as HTMLInputElement | null)?.click();
  }

  #renderTop() {
    const record = this.record;
    const view = this.view;
    const roots = rootRecords(this.records);
    const fleet = this.fleet;
    const tabs: Array<[ReaderTab, string]> = [
      ['session', 'Session'],
      ['fleet', fleet && fleet.agents.length ? `Fleet · ${fleet.agents.length}` : 'Fleet'],
      ['folded', view ? `Folded · ${view.ledger.foldedLines.toLocaleString()}` : 'Folded'],
      ['catalog', 'Catalog']
    ];
    const dot = !view
      ? 'grey'
      : view.ledger.unaccountedLines !== 0 || view.ledger.malformedLines > 0
        ? 'red'
        : view.ledger.unrecognisedTypes.length
          ? 'amber'
          : 'green';
    const showPicker = roots.length > 1 || (record && record.parentKey);

    return html`
      <div class="top">
        <span class="brand">Transcript Reader</span>
        ${record
          ? html`<div class="tabs">
              ${tabs.map(
                ([key, label]) => html`<button
                  type="button"
                  class=${classMap({ tab: true, active: this.tab === key })}
                  data-tab=${key}
                  @click=${() => {
                    this.tab = key;
                  }}
                >
                  ${label}
                </button>`
              )}
            </div>`
          : nothing}
        ${showPicker
          ? html`<select
              class="picker mono"
              aria-label="Session"
              .value=${this.activeKey ?? ''}
              @change=${(event: Event) => this.#activate((event.target as HTMLSelectElement).value)}
            >
              ${this.records
                .filter(candidate => !candidate.parentKey || candidate.key === this.activeKey || candidate.parentKey === record?.key)
                .map(
                  candidate => html`<option value=${candidate.key} ?selected=${candidate.key === this.activeKey}>
                    ${candidate.parentKey ? '└ ' : ''}${clip(candidate.conversation.title, 48)} · ${candidate.fileName.split('/').pop()}
                  </option>`
                )}
            </select>`
          : nothing}
        <span class="spacer"></span>
        ${record
          ? html`<div class="chip mono" title=${record.fileName}>
              <span class="dot ${dot}"></span>
              <span class="chip-name">${record.fileName.split('/').pop()}</span>
              <span class="sep">|</span>
              <span>${humanBytes(record.fileText.length)} · ${plural(record.lineCount, 'line')}</span>
            </div>`
          : nothing}
        <button type="button" class="btn" @click=${() => this.#pick('file-input')}>Open files</button>
        <button type="button" class="btn" @click=${() => this.#pick('folder-input')}>Open a folder</button>
        <button
          type="button"
          class=${classMap({ btn: true, active: this.settingsOpen })}
          aria-label="Reading settings"
          @click=${(event: Event) => {
            event.stopPropagation();
            this.settingsOpen = !this.settingsOpen;
          }}
        >
          Reading
        </button>
      </div>
    `;
  }

  #renderEmpty() {
    return html`
      <div class="empty">
        <div class="empty-card">
          <div class="empty-title">Read a Claude Code session back</div>
          <p>
            Drop a transcript here: one <span class="mono">.jsonl</span> from
            <span class="mono">~/.claude/projects</span>, or the session's whole folder so its subagents, meta files
            and spilled tool output load with it. Everything is parsed in this tab and nothing is uploaded.
          </p>
          <div class="empty-actions">
            <button type="button" class="btn" @click=${() => this.#pick('file-input')}>Choose files</button>
            <button type="button" class="btn" @click=${() => this.#pick('folder-input')}>Choose a folder</button>
          </div>
          ${this.loadNote ? html`<div class="empty-note mono">${this.loadNote}</div>` : nothing}
        </div>
      </div>
    `;
  }

  #renderLoaded(record: LoadedRecord) {
    switch (this.tab) {
      case 'fleet':
        return html`<div class="main">
          <reader-fleet
            .view=${record.view}
            .fleet=${this.fleet}
            .title=${record.conversation.title}
            .sessionLabel=${plural(record.lineCount, 'line')}
          ></reader-fleet>
        </div>`;
      case 'folded':
        return html`<div class="main">
          <reader-folded .view=${record.view} .selectedKey=${this.foldKey}></reader-folded>
        </div>`;
      case 'catalog':
        return html`<div class="main">
          <reader-catalog .conversation=${record.conversation}></reader-catalog>
        </div>`;
      default:
        return html`${this.#renderHeader(record)}${this.#renderSession(record)}`;
    }
  }

  #titleSource(record: LoadedRecord): string {
    const title = record.conversation.title;
    const has = (type: string) =>
      record.conversation.folded.some(line => line.lineType === type && line.text.startsWith(title.slice(0, 40)));
    if (has('custom-title')) return 'custom-title';
    if (has('ai-title')) return 'ai-title';
    return record.isJournal ? 'journal' : 'first prompt';
  }

  #renderHeader(record: LoadedRecord) {
    const view = record.view;
    const { crumbs } = view.panels;
    const cost = record.conversation.cost;
    const fleet = this.fleet;
    const summary = fleet ? fleetSummary(fleet) : null;
    const tools = view.entries.filter(entry => entry.kind === 'tool' || entry.kind === 'diff' || entry.kind === 'agent');
    const topTool = (() => {
      const counts = new Map<string, number>();
      for (const tool of tools) counts.set(tool.tag, (counts.get(tool.tag) ?? 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      return top ? `${top[1]} ${top[0]}` : '';
    })();
    const trouble = view.trouble;
    const troubleParts = [
      trouble.apiErrors ? `${trouble.apiErrors} api` : null,
      trouble.refusals ? `${trouble.refusals} refusal` : null,
      trouble.hooksBlocked ? `${trouble.hooksBlocked} hook` : null,
      trouble.toolFailures ? `${trouble.toolFailures} tool` : null
    ].filter(Boolean);
    const outcome = view.outcome;
    const models = cost?.modelUsage.map(usage => shortModel(usage.model)).slice(0, 2).join(' · ') ?? '';
    const spawn = spawnLine(this.records, record);
    const parent = record.parentKey ? this.records.find(candidate => candidate.key === record.parentKey) : null;

    const stats: Array<{ k: string; v: string; sub: string; tone?: string }> = [
      {
        k: 'Ran for',
        v: view.timing.wallMs !== null ? formatDuration(view.timing.wallMs) : '—',
        sub:
          view.timing.activeMs !== null && view.timing.idleMs > 0
            ? `${formatDuration(view.timing.activeMs)} active`
            : 'one sitting'
      },
      { k: 'Cost', v: usd(cost?.totalCostUSD) ?? '—', sub: models || (cost ? '' : 'no cost-state line') },
      {
        k: 'Outcome',
        v: outcome.state.charAt(0).toUpperCase() + outcome.state.slice(1),
        sub: outcome.state === 'interrupted' ? `turn ${outcome.atTurn} of ${outcome.turnCount}` : plural(outcome.turnCount, 'turn'),
        tone: outcome.state === 'interrupted' ? 'red' : outcome.state === 'incomplete' ? 'amber' : ''
      },
      { k: 'Tools', v: String(tools.length), sub: topTool }
    ];
    if (summary && summary.total) {
      stats.push({
        k: 'Agents',
        v: String(summary.total),
        sub: [summary.stopped ? `${summary.stopped} stopped` : null, summary.failed ? `${summary.failed} failed` : null, summary.running ? `${summary.running} running` : null]
          .filter(Boolean)
          .join(' · ') || 'all finished',
        tone: 'violet'
      });
    }
    if (trouble.total) {
      stats.push({ k: 'Trouble', v: String(trouble.total), sub: troubleParts.join(' · '), tone: 'amber' });
    }

    return html`
      <div class="head">
        <div class="head-title">
          <div class="title-line">
            <span class="title">${record.conversation.title}</span>
            <span class="source mono">${this.#titleSource(record)}</span>
          </div>
          <div class="crumbs mono">
            ${parent
              ? html`<a href="#" @click=${(event: Event) => { event.preventDefault(); this.#activate(parent.key); }}>↑ ${clip(parent.conversation.title, 40)}</a>`
              : nothing}
            ${spawn ? html`<span>${spawn}</span>` : nothing}
            ${crumbs.sessionId ? html`<span>${shortId(crumbs.sessionId, 8, 4)}</span>` : nothing}
            ${crumbs.cwd ? html`<span>${crumbs.cwd.replace(/^\/Users\/[^/]+/u, '~')}</span>` : nothing}
            ${crumbs.branch ? html`<span>${crumbs.branch}</span>` : nothing}
            ${crumbs.version ? html`<span>cc ${crumbs.version}</span>` : nothing}
            ${crumbs.startedAt !== null ? html`<span>${formatDayClock(crumbs.startedAt)}</span>` : nothing}
          </div>
        </div>
        <div class="stats">
          ${stats.map(
            stat => html`<div class="stat">
              <div class="eyebrow">${stat.k}</div>
              <div class="stat-v mono ${stat.tone ?? ''}">${stat.v}</div>
              <div class="stat-sub mono">${stat.sub}</div>
            </div>`
          )}
        </div>
      </div>
    `;
  }

  #renderSession(record: LoadedRecord) {
    const view = record.view;
    const small = this.isSmall;
    const floating = !this.inspectorDocked && this.inspectorOpen;
    return html`
      <div class="body">
        ${this.railShown
          ? html`<div class="rail"><reader-rail .view=${view} .currentTurn=${this.currentTurn}></reader-rail></div>`
          : nothing}
        <div class="centre">
          ${!small ? this.#renderFilters(view) : nothing}
          <div class="stream ${classMap({ narrow: small })}">
            ${this.bandsMode ? this.#renderBands(record) : this.#renderStream(record)}
          </div>
        </div>
        ${this.isLong ? this.#renderMinimap(view) : nothing}
        ${this.inspectorDocked || floating
          ? html`<div class=${classMap({ inspector: true, floating })}>
              <reader-inspector
                .entry=${this.selectedEntry}
                .line=${this.selectedLine}
                ?floating=${floating}
              ></reader-inspector>
            </div>`
          : nothing}
      </div>
    `;
  }

  #renderFilters(view: SessionView) {
    const entries = view.entries.filter(entry => entry.kind !== 'gap');
    const count = (kind: Filter['kind']) =>
      entries.filter(entry => matchesFilter(entry, { kind, requestId: this.filter.requestId })).length;
    const chips: Array<{ kind: Filter['kind']; label: string; tone: string }> = [
      { kind: 'all', label: `all rows ${entries.length.toLocaleString()}`, tone: 'ink' },
      { kind: 'tools', label: `tool rows ${count('tools')}`, tone: '' },
      { kind: 'trouble', label: `trouble ${count('trouble')}`, tone: 'red' },
      { kind: 'agents', label: `agent rows ${count('agents')}`, tone: 'violet' },
      { kind: 'bash', label: `bash only ${count('bash')}`, tone: '' }
    ];
    if (this.filter.kind === 'siblings') {
      chips.push({ kind: 'siblings', label: `siblings of ${shortId(this.filter.requestId, 8, 2)} ${count('siblings')}`, tone: 'blue' });
    }
    const visible = this.visibleEntries.filter(entry => entry.kind !== 'gap').length;
    return html`
      <div class="filters">
        ${chips.map(
          chip => html`<button
            type="button"
            class=${classMap({ chipbtn: true, mono: true, on: this.filter.kind === chip.kind, [chip.tone]: Boolean(chip.tone) })}
            @click=${() => {
              this.filter = chip.kind === 'siblings' ? this.filter : { kind: chip.kind };
            }}
          >
            ${chip.label}
          </button>`
        )}
        <span class="spacer"></span>
        <span class="scope mono">
          showing all ${plural(view.turns.length, 'turn')} · ${visible.toLocaleString()} of ${entries.length.toLocaleString()} rows in view
          ${this.isLong
            ? html` · <a href="#" @click=${(event: Event) => { event.preventDefault(); this.#toggleFull(); }}>${this.bandsMode ? 'read in full' : 'collapse to turns'}</a>`
            : nothing}
        </span>
      </div>
    `;
  }

  #toggleFull(): void {
    const key = this.record?.key;
    if (!key) return;
    const next = new Set(this.readFull);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.readFull = next;
  }

  #renderStream(record: LoadedRecord) {
    const entries = this.visibleEntries;
    if (entries.length === 0) {
      return html`<div class="none">No rows match this filter.</div>`;
    }
    return html`
      ${this.isLong
        ? html`<div class="stream-note">
            Reading ${plural(record.view.ledger.rowCount, 'row')} in full.
            <a href="#" @click=${(event: Event) => { event.preventDefault(); this.#toggleFull(); }}>Collapse to one band per turn</a>
          </div>`
        : nothing}
      ${repeat(
        entries,
        entry => entry.id,
        entry => html`<reader-row
          data-entry-id=${entry.id}
          .entry=${entry}
          .settings=${this.settings}
          ?selected=${entry.id === this.selectedEntryId}
        ></reader-row>`
      )}
    `;
  }

  #bandChild(entry: ReaderEntry): string {
    switch (entry.kind) {
      case 'text':
      case 'image':
        return clip(entry.message?.text ?? '', 120);
      case 'thinking':
        return entry.sub;
      case 'tool':
      case 'diff':
        return clip(`${entry.message?.text.split('\n')[0] ?? ''}${entry.sub && entry.tag !== 'bash' ? ` · ${entry.sub}` : entry.sub ? ` · ${entry.sub}` : ''}`, 110);
      case 'agent':
        return clip(`${entry.agentType} · ${entry.agentAsk ?? ''}`, 110);
      case 'gap':
        return `${formatDuration(entry.gap?.ms ?? 0)} gap`;
      default:
        return clip(entry.message?.text ?? '', 110);
    }
  }

  #renderBands(record: LoadedRecord) {
    const view = record.view;
    const bandTone = (band: SessionBand): string => {
      if (band.tag === 'you') return 'blue';
      if (band.tag === 'gap') return 'grey';
      if (band.tag === 'system') return 'amber';
      if (band.severity === 'error' || band.severity === 'warning') return 'red';
      if (band.hasAgents) return 'violet';
      return 'ink';
    };
    return html`
      <div class="stream-note">
        Over ${LONG_SESSION_ROWS} rows the reader opens collapsed: one band per turn, showing what the turn did rather
        than every row it drew. Bands open in place.
        <a href="#" @click=${(event: Event) => { event.preventDefault(); this.#toggleFull(); }}>Read all ${plural(view.ledger.rowCount, 'row')} in full</a>
      </div>
      ${view.bands.map((band, index) => {
        const open = this.openBands.has(index);
        const tone = bandTone(band);
        return html`
          <div class="band edge-${tone}" data-band=${index}>
            <div
              class="band-head"
              @click=${() => {
                const next = new Set(this.openBands);
                if (next.has(index)) next.delete(index);
                else next.add(index);
                this.openBands = next;
              }}
            >
              <span class="band-time mono">${band.timeLabel}</span>
              <span class="band-caret mono">${band.entries.length ? (open ? '▾' : '▸') : ''}</span>
              <span class="band-tag mono ${tone}">${band.tag}</span>
              <span class="band-label">${band.label}</span>
              ${band.marks.map(mark => html`<span class="mark mono ${mark.tone}">${mark.text}</span>`)}
              <span class="band-dur mono">${band.durationMs !== null && band.durationMs > 0 ? formatDuration(band.durationMs) : ''}</span>
            </div>
            ${open
              ? html`<div class="band-body">
                  ${band.entries.slice(0, 60).map(
                    entry => html`<div
                      class="band-child"
                      @click=${() => void this.#goToEntry(entry.id)}
                    >
                      <span class="child-tag mono">${entry.tag}</span>
                      <span class="child-text mono">${this.#bandChild(entry)}</span>
                      <span class="child-dur mono">${entry.durationMs !== null && entry.kind !== 'text' ? formatDuration(entry.durationMs) : ''}</span>
                    </div>`
                  )}
                  ${band.entries.length > 60
                    ? html`<div class="band-more mono">${band.entries.length - 60} more rows in this turn</div>`
                    : nothing}
                  ${band.entries[0]
                    ? html`<div class="band-link"><a href="#" @click=${(event: Event) => { event.preventDefault(); void this.#goToEntry(band.entries[0].id); }}>read this turn in full</a></div>`
                    : nothing}
                </div>`
              : nothing}
          </div>
        `;
      })}
    `;
  }

  #renderMinimap(view: SessionView) {
    const rows = view.entries;
    const total = rows.length || 1;
    return html`
      <div
        class="minimap"
        title="the whole session, one line per row"
        @click=${(event: MouseEvent) => {
          const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
          const fraction = (event.clientY - box.top) / box.height;
          const index = Math.min(rows.length - 1, Math.max(0, Math.floor(fraction * rows.length)));
          const target = rows[index];
          if (target) void this.#goToEntry(target.id);
        }}
      >
        <svg viewBox=${`0 0 12 ${total}`} preserveAspectRatio="none" aria-hidden="true">
          ${rows.map(
            (entry, index) =>
              svg`<rect x="0" y=${index} width="12" height="1" fill=${EDGE_COLOR[edgeOf(entry)] ?? EDGE_COLOR.grey}></rect>`
          )}
        </svg>
      </div>
    `;
  }

  #renderFooter(record: LoadedRecord) {
    const ledger = record.view.ledger;
    const unknown = ledger.unrecognisedTypes;
    return html`
      <div class="foot mono">
        <span>${ledger.parsedLines.toLocaleString()} lines parsed</span>
        <span>${ledger.rowCount.toLocaleString()} rows drawn</span>
        <span class="link" @click=${() => { this.tab = 'folded'; }}>${ledger.foldedLines.toLocaleString()} folded</span>
        <span class=${ledger.malformedLines ? 'red' : ''}>${ledger.malformedLines} malformed ${ledger.malformedLines === 1 ? 'line' : 'lines'} skipped</span>
        <span class=${unknown.length ? 'amber' : ''}>
          ${unknown.length
            ? `${plural(unknown.length, 'unrecognised type')}: ${unknown.map(type => type.type).slice(0, 4).join(', ')}`
            : '0 unrecognised types'}
        </span>
        ${ledger.unaccountedLines !== 0
          ? html`<span class="red">${ledger.unaccountedLines} lines unaccounted for</span>`
          : nothing}
        <span class="spacer"></span>
        <span>write order · ${ledger.outOfOrderLines ? `${plural(ledger.outOfOrderLines, 'line')} out of timestamp order` : 'in timestamp order'}</span>
      </div>
    `;
  }

  #renderSettings() {
    const settings = this.settings;
    const radio = <K extends keyof ReaderSettings>(key: K, options: Array<[ReaderSettings[K] & string, string]>) => html`
      <div class="setting">
        <div class="eyebrow">${String(key).replace(/([A-Z])/gu, ' $1').toLowerCase()}</div>
        <div class="options">
          ${options.map(
            ([value, label]) => html`<button
              type="button"
              class=${classMap({ opt: true, mono: true, on: settings[key] === value })}
              @click=${() => this.#setSettings({ [key]: value } as Partial<ReaderSettings>)}
            >
              ${label}
            </button>`
          )}
        </div>
      </div>
    `;
    return html`
      <div class="settings" @click=${(event: Event) => event.stopPropagation()}>
        ${radio('density', [['comfortable', 'comfortable'], ['compact', 'compact']])}
        ${radio('bookkeeping', [['marked', 'marks shown'], ['hidden', 'marks hidden']])}
        ${radio('timeDisplay', [['elapsed', 'elapsed'], ['absolute', 'absolute']])}
        ${radio('theme', [['light', 'light'], ['dark', 'dark'], ['system', 'system']])}
        <label class="check"><input type="checkbox" .checked=${settings.showThinking} @change=${(event: Event) => this.#setSettings({ showThinking: (event.target as HTMLInputElement).checked })} /> show thinking</label>
        <label class="check"><input type="checkbox" .checked=${settings.markdown} @change=${(event: Event) => this.#setSettings({ markdown: (event.target as HTMLInputElement).checked })} /> render markdown</label>
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        height: 100%;
      }

      .app {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 480px;
        background: var(--paper);
        overflow: hidden;
        position: relative;
      }

      .app.dragging::after {
        content: 'drop to read';
        position: absolute;
        inset: 8px;
        border: 2px dashed var(--blue);
        border-radius: 8px;
        background: color-mix(in srgb, var(--blue-soft) 70%, transparent);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--font-mono);
        font-size: 13px;
        color: var(--blue);
        pointer-events: none;
        z-index: 20;
      }

      .hidden-input {
        display: none;
      }

      .spacer {
        flex: 1 1 auto;
      }

      .red { color: var(--red); }
      .amber { color: var(--amber); }
      .violet { color: var(--violet); }
      .blue { color: var(--blue); }

      /* Top bar */
      .top {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 0 14px;
        height: 44px;
        flex: 0 0 auto;
        border-bottom: 1px solid var(--line);
        background: var(--paper-raised);
      }

      .brand {
        font-weight: 600;
        font-size: 13px;
        flex: 0 0 auto;
      }

      .tabs {
        display: flex;
        gap: 2px;
        padding: 2px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: var(--paper);
        flex-wrap: wrap;
      }

      .tab {
        font-family: var(--font-mono);
        font-size: 11px;
        padding: 3px 9px;
        border: 0;
        border-radius: 4px;
        cursor: pointer;
        background: transparent;
        color: var(--ink-3);
      }

      .tab.active {
        background: var(--ink);
        color: var(--paper);
      }

      .picker {
        font-size: 11px;
        max-width: 320px;
        border: 1px solid var(--line);
        border-radius: 5px;
        background: var(--paper);
        color: var(--ink-2);
        padding: 3px 6px;
      }

      .chip {
        display: flex;
        align-items: center;
        gap: 7px;
        font-size: 11px;
        color: var(--ink-3);
        border: 1px solid var(--line);
        border-radius: 5px;
        padding: 4px 8px;
        background: var(--paper);
        flex: 0 1 auto;
        min-width: 0;
      }

      .chip-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 220px;
      }

      .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--grey);
        flex: 0 0 auto;
      }

      .dot.green { background: var(--green); }
      .dot.amber { background: var(--amber); }
      .dot.red { background: var(--red); }

      .sep {
        color: var(--ink-5);
      }

      .btn.active {
        background: var(--line-faint);
      }

      /* Header */
      .head {
        display: flex;
        align-items: stretch;
        flex: 0 0 auto;
        border-bottom: 1px solid var(--line);
        background: var(--paper-raised);
        flex-wrap: wrap;
      }

      .head-title {
        flex: 1 1 320px;
        min-width: 0;
        padding: 14px 16px 12px;
      }

      .title-line {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
        flex-wrap: wrap;
      }

      .title {
        font-size: 17px;
        font-weight: 600;
        letter-spacing: -0.01em;
      }

      .source {
        font-size: 10px;
        color: var(--ink-4);
        border: 1px solid var(--line);
        border-radius: 4px;
        padding: 2px 5px;
      }

      .crumbs {
        display: flex;
        flex-wrap: wrap;
        gap: 0 14px;
        font-size: 11px;
        color: var(--ink-3);
      }

      .stats {
        display: flex;
        align-items: stretch;
        border-left: 1px solid var(--line);
        flex-wrap: wrap;
      }

      .stat {
        padding: 14px 18px 12px;
        border-right: 1px solid var(--line-faint);
        min-width: 92px;
      }

      .stat .eyebrow {
        margin-bottom: 5px;
      }

      .stat-v {
        font-size: 15px;
        font-weight: 500;
      }

      .stat-sub {
        font-size: 10px;
        color: var(--ink-4);
        margin-top: 3px;
      }

      /* Body */
      .body {
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
        position: relative;
      }

      .main {
        flex: 1 1 auto;
        min-height: 0;
        min-width: 0;
        display: flex;
      }

      .main > * {
        flex: 1 1 auto;
        min-width: 0;
      }

      .rail {
        flex: 0 0 236px;
        min-width: 0;
        border-right: 1px solid var(--line);
        overflow: hidden;
      }

      .centre {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }

      .filters {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 7px 14px;
        border-bottom: 1px solid var(--line);
        background: var(--paper-raised);
        flex: 0 0 auto;
        flex-wrap: wrap;
      }

      .chipbtn {
        font-size: 11px;
        padding: 3px 8px;
        border-radius: 11px;
        cursor: pointer;
        border: 1px solid var(--line);
        background: var(--paper-raised);
        color: var(--ink-3);
      }

      .chipbtn.red { border-color: var(--red-line); background: var(--red-soft); color: var(--red); }
      .chipbtn.violet { border-color: var(--violet-line); background: var(--violet-paper); color: var(--violet); }
      .chipbtn.blue { border-color: var(--blue-soft); background: var(--blue-soft); color: var(--blue); }

      .chipbtn.on {
        background: var(--ink);
        border-color: var(--ink);
        color: var(--paper);
      }

      .scope {
        font-size: 11px;
        color: var(--ink-3);
      }

      .stream {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        padding: 0 0 60px;
      }

      .stream.narrow {
        max-width: 760px;
        margin: 0 auto;
        width: 100%;
      }

      .stream-note,
      .none {
        padding: 12px 14px;
        border-bottom: 1px solid var(--line);
        background: var(--paper-rail);
        font-size: 12.5px;
        line-height: 1.5;
        color: var(--ink-2);
        max-width: 86ch;
      }

      .none {
        color: var(--ink-4);
      }

      /* Bands */
      .band {
        border-bottom: 1px solid var(--line-soft);
        border-left: 3px solid var(--edge);
      }

      .band-head {
        display: flex;
        gap: 10px;
        align-items: baseline;
        padding: 9px 14px 9px 11px;
        cursor: pointer;
        flex-wrap: wrap;
      }

      .band-head:hover {
        background: var(--paper-hover);
      }

      .band-time {
        font-size: 10px;
        color: var(--ink-4);
        width: 62px;
        flex: 0 0 auto;
      }

      .band-caret {
        width: 12px;
        flex: 0 0 auto;
        font-size: 11px;
        color: var(--ink-4);
      }

      .band-tag {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        width: 52px;
        flex: 0 0 auto;
        color: var(--edge);
      }

      .band-tag.ink {
        color: var(--ink);
      }

      .band-label {
        flex: 1 1 220px;
        min-width: 0;
        font-size: 13px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .mark {
        font-size: 10px;
        padding: 1px 5px;
        border-radius: 3px;
        border: 1px solid var(--line);
        background: var(--paper-raised);
        flex: 0 0 auto;
        color: var(--ink-3);
      }

      .mark.trouble { color: var(--red); }
      .mark.agent { color: var(--violet); }
      .mark.tool,
      .mark.edit { color: var(--green); }
      .mark.mark { color: var(--amber); }
      .mark.link { color: var(--blue); }

      .band-dur {
        font-size: 10px;
        color: var(--ink-4);
        width: 58px;
        text-align: right;
        flex: 0 0 auto;
      }

      .band-body {
        padding: 0 14px 10px 82px;
      }

      .band-child {
        display: flex;
        gap: 10px;
        padding: 4px 0;
        border-top: 1px solid var(--line-soft);
        cursor: pointer;
      }

      .band-child:hover {
        background: var(--paper-hover);
      }

      .child-tag {
        font-size: 10px;
        color: var(--ink-3);
        width: 64px;
        flex: 0 0 auto;
        text-transform: uppercase;
      }

      .child-text {
        flex: 1 1 auto;
        min-width: 0;
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--ink-2);
      }

      .child-dur {
        font-size: 10px;
        color: var(--ink-4);
        flex: 0 0 auto;
      }

      .band-more {
        padding: 4px 0;
        font-size: 11px;
        color: var(--ink-4);
      }

      .band-link {
        padding-top: 6px;
        font-size: 12px;
      }

      /* Minimap */
      .minimap {
        flex: 0 0 24px;
        border-left: 1px solid var(--line);
        background: var(--paper-rail);
        padding: 4px 6px;
        cursor: pointer;
      }

      .minimap svg {
        width: 12px;
        height: 100%;
        display: block;
      }

      /* Inspector */
      .inspector {
        flex: 0 0 336px;
        min-width: 0;
        border-left: 1px solid var(--line);
        background: var(--paper-raised);
        overflow: hidden;
      }

      .inspector.floating {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: min(420px, 90%);
        box-shadow: -8px 0 24px rgba(0, 0, 0, 0.08);
        z-index: 10;
      }

      /* Footer */
      .foot {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 0 14px;
        height: 26px;
        flex: 0 0 auto;
        border-top: 1px solid var(--line);
        background: var(--paper-rail);
        font-size: 11px;
        color: var(--ink-3);
        overflow: hidden;
        white-space: nowrap;
      }

      .foot .link {
        cursor: pointer;
        text-decoration: underline;
        text-decoration-color: var(--ink-5);
      }

      .foot .link:hover {
        color: var(--ink);
      }

      /* Empty */
      .empty {
        flex: 1 1 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }

      .empty-card {
        max-width: 520px;
        border: 1px dashed var(--ink-5);
        border-radius: 8px;
        background: var(--paper-raised);
        padding: 22px 24px;
      }

      .empty-title {
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 8px;
      }

      .empty p {
        margin: 0 0 14px;
        font-size: 13px;
        line-height: 1.55;
        color: var(--ink-2);
      }

      .empty-actions {
        display: flex;
        gap: 8px;
      }

      .empty-note {
        margin-top: 12px;
        font-size: 11px;
        color: var(--amber);
      }

      /* Settings */
      .settings {
        position: absolute;
        top: 48px;
        right: 12px;
        z-index: 30;
        width: 280px;
        padding: 12px 14px;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: var(--paper-raised);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
      }

      .setting {
        margin-bottom: 10px;
      }

      .options {
        display: flex;
        gap: 4px;
        margin-top: 4px;
        flex-wrap: wrap;
      }

      .opt {
        font-size: 11px;
        padding: 2px 8px;
        border: 1px solid var(--line);
        border-radius: 4px;
        background: var(--paper);
        cursor: pointer;
        color: var(--ink-3);
      }

      .opt.on {
        background: var(--ink);
        border-color: var(--ink);
        color: var(--paper);
      }

      .check {
        display: flex;
        gap: 8px;
        align-items: center;
        font-size: 12px;
        margin-top: 6px;
      }
    `
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'transcript-reader': TranscriptReader;
  }
}
