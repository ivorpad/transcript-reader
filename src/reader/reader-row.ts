import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import type { NormalizedMessage, MessageImage, ReaderEntry } from '../types/reader';
import { formatDuration, outputMeta } from '../adapters/claude/session';
import { renderMarkdown } from '../utils/markdown';
import { foldedDetail, foldedMeta, humanBytes, shortId } from './format';
import type { ReaderSettings } from './settings';
import { sharedStyles, type Edge } from './styles';

export const edgeOf = (entry: ReaderEntry): Edge => {
  switch (entry.kind) {
    case 'gap':
      return 'grey';
    case 'thinking':
      return 'grey';
    case 'agent':
      return 'violet';
    case 'unknown':
      return 'amber';
    case 'tool':
    case 'diff':
      if (entry.severity === 'error' || entry.severity === 'warning') return 'red';
      if (entry.badge === 'spilled' || entry.badge === 'background') return 'blue';
      return 'green';
    case 'event':
      if (entry.tag === 'api error') return 'red';
      if (entry.severity === 'error' || entry.severity === 'warning' || entry.severity === 'notice') return 'amber';
      return entry.lineClass === 'read' ? 'amber' : 'grey';
    case 'image':
    case 'text':
      return entry.message?.role === 'user' ? 'blue' : 'ink';
  }
};

const badgeTone = (badge: string): string => {
  if (badge === 'is_error' || badge === 'retried' || badge.startsWith('denied')) return 'red';
  if (badge === 'spilled' || badge === 'background') return 'blue';
  if (badge === 'interrupt') return 'amber';
  return '';
};

const imageBytes = (image: MessageImage): number => image.bytes ?? Math.floor((image.url.length * 3) / 4);

/** Base64 to a Blob behind an object URL, so the DOM holds a reference and not the payload. */
const decodeImage = (image: MessageImage): string => {
  if (!image.url.startsWith('data:')) return image.url;
  const comma = image.url.indexOf(',');
  const binary = atob(image.url.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: image.mediaType }));
};

@customElement('reader-row')
export class ReaderRow extends LitElement {
  @property({ attribute: false })
  entry!: ReaderEntry;

  @property({ type: Boolean, reflect: true })
  selected = false;

  @property({ attribute: false })
  settings!: ReaderSettings;

  @state()
  private outputOpen = false;

  @state()
  private foldOpen = false;

  @state()
  private expanded = false;

  @state()
  private decoded = new Map<number, string>();

  connectedCallback(): void {
    super.connectedCallback();
    this.outputOpen = this.entry?.severity === 'error' || this.entry?.severity === 'warning';
  }

  disconnectedCallback(): void {
    this.#revokeAll();
    super.disconnectedCallback();
  }

  #revokeAll(): void {
    for (const url of this.decoded.values()) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
    this.decoded = new Map();
  }

  #select(line?: NormalizedMessage): void {
    this.dispatchEvent(
      new CustomEvent('reader-select', {
        detail: { entryId: this.entry.id, line: line ?? this.entry.message },
        bubbles: true,
        composed: true
      })
    );
  }

  #go(tab: 'fleet' | 'folded', event: Event, extra: Record<string, unknown> = {}): void {
    event.preventDefault();
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('reader-go', {
        detail: { tab, entryId: this.entry.id, ...extra },
        bubbles: true,
        composed: true
      })
    );
  }

  render() {
    const entry = this.entry;
    if (!entry) return nothing;
    if (entry.kind === 'gap') return this.#renderGap();

    const edge = edgeOf(entry);
    const time =
      this.settings?.timeDisplay === 'absolute' && entry.clockLabel ? entry.clockLabel : entry.timeLabel;
    const dense = this.settings?.density === 'compact';
    const dur = entry.durationMs !== null && entry.kind !== 'text' ? formatDuration(entry.durationMs) : '';

    return html`
      <div
        class=${classMap({ row: true, [`edge-${edge}`]: true, selected: this.selected, dense, mark: entry.lineClass === 'mark' })}
        data-entry-id=${entry.id}
        @click=${() => this.#select()}
      >
        <div class="time mono">
          <div>${time}</div>
          <div class="dur">${dur}</div>
        </div>
        <div class="body">
          <div class="head">
            <span class="tag mono">${entry.tag}</span>
            ${entry.sub ? html`<span class="sub mono">${entry.sub}</span>` : nothing}
            ${entry.badge
              ? html`<span class="pill ${badgeTone(entry.badge)}">${entry.badge}</span>`
              : nothing}
            ${entry.message?.groupCount && entry.message.groupCount > 1
              ? html`<span class="pill">×${entry.message.groupCount}</span>`
              : nothing}
          </div>
          ${this.#renderBody(entry, edge)}
          ${this.#renderImages(entry)}
        </div>
      </div>
    `;
  }

  #renderBody(entry: ReaderEntry, edge: Edge): TemplateResult | typeof nothing {
    switch (entry.kind) {
      case 'text':
      case 'image':
        return this.#renderText(entry);
      case 'thinking':
        return entry.lineClass === 'mark'
          ? html`<div class="event mono">reasoned here; the text was not stored, only the signature</div>`
          : this.#renderText(entry);
      case 'tool':
      case 'diff':
      case 'agent':
        return this.#renderTool(entry, edge);
      case 'event':
        return html`<div class="event mono ${entry.lineClass === 'read' ? 'read' : ''}">${entry.message ? this.#text(entry.message) : ''}</div>
          ${this.#renderTruncation(entry.message)} ${this.#renderFolded(entry)}`;
      case 'unknown':
        return this.#renderUnknown(entry);
      default:
        return nothing;
    }
  }

  #text(message: NormalizedMessage): string {
    return this.expanded && message.fullText ? message.fullText : message.text;
  }

  #renderText(entry: ReaderEntry) {
    const message = entry.message;
    if (!message) return nothing;
    const text = this.#text(message);
    const markdown = this.settings?.markdown && entry.kind === 'text';
    return html`
      ${markdown
        ? html`<div class="prose rendered">${unsafeHTML(renderMarkdown(text))}</div>`
        : html`<div class="prose">${text.replace(/^[\r\n]+|[\r\n]+$/gu, '')}</div>`}
      ${this.#renderTruncation(message)}
      ${this.#renderFolded(entry)}
    `;
  }

  #renderTruncation(message: NormalizedMessage | null) {
    if (!message?.truncatedFrom) return nothing;
    const kb = Math.round(message.truncatedFrom / 1024);
    return html`<button
      class="btn expand"
      type="button"
      @click=${(event: Event) => {
        event.stopPropagation();
        this.expanded = !this.expanded;
      }}
    >
      ${this.expanded ? 'Collapse' : `Show all ${kb} KB`}
    </button>`;
  }

  #renderTool(entry: ReaderEntry, edge: Edge) {
    const call = entry.message;
    const result = entry.result;
    if (!call) return nothing;
    const foldCount = entry.folded.length;
    const foldWarn = entry.folded.some(line => (line.severity ?? 'info') !== 'info');
    const output = result ? this.#text(result) : '';

    return html`
      ${entry.kind === 'agent' ? this.#renderAgent(entry) : nothing}
      ${entry.kind !== 'agent' && call.channel === 'tool_call'
        ? html`<div class="input mono">${call.text}</div>`
        : nothing}
      ${entry.kind === 'diff' && entry.diff ? this.#renderDiff(entry) : nothing}
      <div class="meta mono">
        ${result && call.channel === 'tool_call'
          ? html`<span
              class="toggle"
              @click=${(event: Event) => {
                event.stopPropagation();
                this.outputOpen = !this.outputOpen;
              }}
              ><span class="caret">${this.outputOpen ? '▾' : '▸'}</span><span>${outputMeta(result)}</span></span
            >`
          : result
            ? html`<span>${outputMeta(result)}</span>`
            : html`<span class="muted">no result in this transcript</span>`}
        ${foldCount
          ? html`<span
              class="fold ${classMap({ open: this.foldOpen, warn: foldWarn })}"
              @click=${(event: Event) => {
                event.stopPropagation();
                this.foldOpen = !this.foldOpen;
              }}
              >${this.foldOpen ? '▾' : '▸'} ${foldCount} folded</span
            >`
          : nothing}
      </div>
      ${(this.outputOpen && result && call.channel === 'tool_call') || (result && call.channel !== 'tool_call')
        ? html`<div class="out mono edge-${edge}">${output}</div>${this.#renderTruncation(result)}`
        : nothing}
      ${this.foldOpen ? this.#renderFoldList(entry) : nothing}
    `;
  }

  #renderFolded(entry: ReaderEntry) {
    const count = entry.folded.length;
    if (!count) return nothing;
    return html`
      <div class="meta mono">
        <span
          class="fold ${classMap({ open: this.foldOpen })}"
          @click=${(event: Event) => {
            event.stopPropagation();
            this.foldOpen = !this.foldOpen;
          }}
          >${this.foldOpen ? '▾' : '▸'} ${count} folded</span
        >
      </div>
      ${this.foldOpen ? this.#renderFoldList(entry) : nothing}
    `;
  }

  #renderFoldList(entry: ReaderEntry) {
    const byToolUse = entry.folded.some(line => {
      const attachment = line.raw.attachment as Record<string, unknown> | undefined;
      return typeof attachment?.toolUseID === 'string';
    });
    return html`
      <div class="folds">
        <div class="folds-head eyebrow mono">
          folded onto this row · ${byToolUse ? 'matched by toolUseID' : 'written under it'}
        </div>
        ${entry.folded.map(
          line => html`
            <div
              class="fold-line"
              @click=${(event: Event) => {
                event.stopPropagation();
                this.#select(line);
              }}
            >
              <span class="fold-type mono ${line.severity && line.severity !== 'info' ? 'amber' : ''}"
                >${line.eventKind?.replace(/^(attachment|system):/u, '') ?? line.lineType}</span
              >
              <span class="fold-detail mono">${foldedDetail(line)}</span>
              <span class="fold-meta mono">${foldedMeta(line)}</span>
            </div>
          `
        )}
        <div class="folds-foot mono">
          <a href="#" @click=${(event: Event) => this.#go('folded', event)}>every folded line</a>
        </div>
      </div>
    `;
  }

  #renderAgent(entry: ReaderEntry) {
    const result = entry.result;
    const toolUseResult = (result?.toolUseResult ?? null) as Record<string, unknown> | null;
    const status =
      typeof toolUseResult?.status === 'string'
        ? toolUseResult.status
        : result
          ? result.severity === 'warning'
            ? 'failed'
            : 'returned'
          : 'no result';
    return html`
      <div class="agent">
        <div class="agent-head">
          <span class="agent-type mono">${entry.agentType}</span>
          ${entry.agentId ? html`<span class="mono muted">${shortId(entry.agentId, 8, 3)}</span>` : nothing}
          <span class="pill violet">${status}</span>
        </div>
        <div class="agent-ask">${entry.agentAsk}</div>
        <div class="agent-foot mono">
          ${entry.durationMs !== null ? html`<span>${formatDuration(entry.durationMs)} to answer</span>` : nothing}
          <a href="#" @click=${(event: Event) => this.#go('fleet', event)}>open in fleet</a>
        </div>
      </div>
    `;
  }

  #renderDiff(entry: ReaderEntry) {
    return html`
      <div class="diff mono">
        ${(entry.diff ?? []).map(
          line => html`
            <div class="diff-line ${line.sign === '+' ? 'add' : line.sign === '-' ? 'del' : ''}">
              <span class="n">${line.number ?? ''}</span>
              <span class="s">${line.sign === '-' ? '−' : line.sign}</span>
              <span class="t">${line.text}</span>
            </div>
          `
        )}
        ${entry.diffOmitted
          ? html`<div class="diff-more">${entry.diffOmitted} more lines not drawn</div>`
          : nothing}
      </div>
    `;
  }

  #renderImages(entry: ReaderEntry) {
    if (!entry.images.length) return nothing;
    return html`${entry.images.map((image, index) => this.#renderImage(image, index))}`;
  }

  #renderImage(image: MessageImage, index: number) {
    const url = this.decoded.get(index);
    const bytes = imageBytes(image);
    return html`
      <div class="image">
        <div class="image-head">
          <div class="thumb"></div>
          <div class="image-meta mono">
            <div>${image.mediaType} · ${humanBytes(bytes)}${image.url.startsWith('data:') ? ' base64' : ''}</div>
            <div class="muted">${url ? 'decoded · one object URL held' : 'held as a string, not in the DOM'}</div>
          </div>
          <button
            class="btn"
            type="button"
            @click=${(event: Event) => {
              event.stopPropagation();
              const next = new Map(this.decoded);
              if (url) {
                if (url.startsWith('blob:')) URL.revokeObjectURL(url);
                next.delete(index);
              } else {
                next.set(index, decodeImage(image));
              }
              this.decoded = next;
            }}
          >
            ${url ? 'hide' : 'decode'}
          </button>
        </div>
        ${url ? html`<img src=${url} alt="${image.mediaType} attachment" />` : nothing}
      </div>
    `;
  }

  #renderUnknown(entry: ReaderEntry) {
    const message = entry.message;
    const keys = Object.keys(message?.raw ?? {}).filter(
      key => !['type', 'uuid', 'parentUuid', 'sessionId', 'timestamp'].includes(key)
    );
    return html`
      <div class="unknown">
        <div class="unknown-note">This line type is not in the reader's table. It is shown, not dropped.</div>
        <div class="unknown-body mono">
          ${entry.tag} · ${keys.length} keys: ${keys.slice(0, 12).join(', ')}
          ${message?.groupCount && message.groupCount > 1
            ? html`<br />seen ${message.groupCount} times · shown once here`
            : nothing}
        </div>
      </div>
    `;
  }

  #renderGap() {
    const gap = this.entry.gap;
    return html`
      <div class="row gap edge-grey" data-entry-id=${this.entry.id} @click=${() => this.#select()}>
        <div class="gap-inner">
          <span class="mono quiet">${gap?.from}</span>
          <span class="dash"></span>
          <span class="mono gap-body">${formatDuration(gap?.ms ?? 0)} — no lines written</span>
          <span class="dash"></span>
          <span class="mono quiet">${gap?.to}</span>
        </div>
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }

      .row {
        border-bottom: 1px solid var(--line-soft);
        border-left: 3px solid var(--edge);
        display: flex;
        gap: 10px;
        padding: 9px 14px 9px 11px;
        cursor: default;
      }

      .row:hover {
        background: var(--paper-hover);
      }

      .row.selected {
        background: var(--paper-selected);
      }

      .row.dense {
        padding-top: 5px;
        padding-bottom: 5px;
      }

      .row.mark .prose,
      .row.mark .event {
        color: var(--ink-3);
      }

      .time {
        flex: 0 0 62px;
        font-size: 10px;
        color: var(--ink-4);
        padding-top: 2px;
        line-height: 1.5;
      }

      .dur {
        color: var(--ink-5);
      }

      .body {
        flex: 1 1 auto;
        min-width: 0;
      }

      .head {
        display: flex;
        align-items: center;
        gap: 7px;
        margin-bottom: 3px;
        flex-wrap: wrap;
        min-width: 0;
      }

      .tag {
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--edge);
      }

      .edge-ink .tag {
        color: var(--ink);
      }

      .sub {
        font-size: 11px;
        color: var(--ink-3);
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .prose {
        font-size: 14px;
        line-height: 1.5;
        white-space: pre-wrap;
        text-wrap: pretty;
        max-width: 78ch;
        word-break: break-word;
      }

      .prose.rendered {
        white-space: normal;
      }

      .prose.rendered > :first-child {
        margin-top: 0;
      }

      .prose.rendered > :last-child {
        margin-bottom: 0;
      }

      .prose.rendered p,
      .prose.rendered ul,
      .prose.rendered ol,
      .prose.rendered pre,
      .prose.rendered blockquote {
        margin: 0 0 0.5em;
      }

      .prose.rendered pre,
      .prose.rendered code {
        font-family: var(--font-mono);
        font-size: 12.5px;
      }

      .prose.rendered pre {
        background: var(--paper-sunken);
        border: 1px solid var(--line);
        border-radius: 5px;
        padding: 7px 9px;
        overflow-x: auto;
      }

      .prose.rendered table {
        border-collapse: collapse;
        font-size: 13px;
      }

      .prose.rendered th,
      .prose.rendered td {
        border: 1px solid var(--line);
        padding: 3px 8px;
      }

      .event {
        font-size: 12px;
        line-height: 1.5;
        color: var(--ink-3);
        white-space: pre-wrap;
        max-width: 80ch;
        word-break: break-word;
      }

      .event.read {
        color: var(--ink-2);
        font-size: 13px;
      }

      .input {
        font-size: 12.5px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
        background: var(--paper-sunken);
        border: 1px solid var(--line);
        border-radius: 5px;
        padding: 7px 9px;
        max-height: 320px;
        overflow: auto;
      }

      .meta {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 5px;
        flex-wrap: wrap;
        font-size: 11px;
        color: var(--ink-3);
      }

      .toggle {
        cursor: pointer;
        display: inline-flex;
        gap: 6px;
      }

      .toggle:hover {
        color: var(--ink);
      }

      .caret {
        width: 10px;
        display: inline-block;
      }

      .fold {
        cursor: pointer;
        padding: 1px 6px;
        border-radius: 9px;
        border: 1px solid var(--line);
        background: var(--paper-raised);
        color: var(--ink-3);
      }

      .fold.open {
        border-color: var(--green-line);
        background: var(--green-soft);
        color: var(--green);
      }

      .fold.warn {
        border-color: var(--amber-line);
        color: var(--amber);
      }

      .fold:hover {
        opacity: 0.8;
      }

      .out {
        margin-top: 6px;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 240px;
        overflow: auto;
        background: var(--paper-raised);
        border: 1px solid var(--line);
        border-left: 3px solid var(--edge);
        border-radius: 4px;
        padding: 8px 10px;
        color: var(--ink-2);
      }

      .expand {
        margin-top: 6px;
      }

      .folds {
        margin-top: 6px;
        border: 1px solid var(--line);
        border-radius: 5px;
        background: var(--paper-rail);
        overflow: hidden;
      }

      .folds-head {
        padding: 6px 10px;
        border-bottom: 1px solid var(--line-faint);
        letter-spacing: 0.06em;
      }

      .fold-line {
        display: flex;
        gap: 10px;
        align-items: baseline;
        padding: 5px 10px;
        border-top: 1px solid var(--line-soft);
        cursor: pointer;
      }

      .fold-line:hover {
        background: var(--paper-sunken);
      }

      .fold-type {
        font-size: 11px;
        color: var(--green);
        flex: 0 0 auto;
      }

      .fold-type.amber {
        color: var(--amber);
      }

      .fold-detail {
        flex: 1 1 auto;
        min-width: 0;
        font-size: 11px;
        color: var(--ink-2);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .fold-meta {
        font-size: 10px;
        color: var(--ink-4);
        flex: 0 0 auto;
      }

      .folds-foot {
        padding: 5px 10px;
        border-top: 1px solid var(--line-soft);
        font-size: 11px;
      }

      .agent {
        border: 1px solid var(--violet-line);
        border-radius: 6px;
        background: var(--violet-paper);
        padding: 9px 11px;
        max-width: 640px;
        min-width: 0;
      }

      .agent-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 8px;
        margin-bottom: 6px;
        min-width: 0;
        font-size: 10px;
      }

      .agent-type {
        font-size: 11px;
        font-weight: 600;
        color: var(--violet);
      }

      .agent-ask {
        font-size: 13px;
        line-height: 1.45;
        color: var(--ink-2);
        max-width: 70ch;
      }

      .agent-foot {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 14px;
        margin-top: 8px;
        font-size: 11px;
        color: var(--ink-3);
      }

      .diff {
        border: 1px solid var(--line);
        border-radius: 5px;
        overflow: hidden;
        max-width: 720px;
        font-size: 12px;
        line-height: 1.55;
      }

      .diff-line {
        display: flex;
        background: var(--paper-raised);
      }

      .diff-line.add {
        background: var(--diff-add);
      }

      .diff-line.del {
        background: var(--diff-del);
      }

      .diff .n {
        flex: 0 0 40px;
        text-align: right;
        padding-right: 8px;
        color: var(--ink-5);
      }

      .diff .s {
        flex: 0 0 14px;
        color: var(--ink-5);
      }

      .diff-line.add .s {
        color: var(--green);
      }

      .diff-line.del .s {
        color: var(--red);
      }

      .diff .t {
        flex: 1 1 auto;
        min-width: 0;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--ink-2);
        padding-right: 8px;
      }

      .diff-more {
        padding: 4px 10px;
        font-size: 11px;
        color: var(--ink-4);
        border-top: 1px solid var(--line-soft);
      }

      .image {
        border: 1px solid var(--line);
        border-radius: 5px;
        background: var(--paper-sunken);
        padding: 9px 11px;
        max-width: 460px;
        margin-top: 6px;
      }

      .image-head {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .thumb {
        width: 46px;
        height: 34px;
        flex: 0 0 auto;
        border: 1px solid var(--line);
        border-radius: 3px;
        background: repeating-linear-gradient(45deg, var(--line-faint) 0 4px, var(--paper-sunken) 4px 8px);
      }

      .image-meta {
        flex: 1 1 auto;
        min-width: 0;
        font-size: 11px;
        line-height: 1.5;
        color: var(--ink-3);
      }

      .image img {
        display: block;
        margin-top: 9px;
        max-width: 100%;
        max-height: 420px;
        border: 1px solid var(--line);
        border-radius: 4px;
      }

      .unknown {
        border: 1px dashed var(--ink-5);
        border-radius: 5px;
        background: var(--paper-hover);
        padding: 8px 10px;
        max-width: 640px;
      }

      .unknown-note {
        font-size: 13px;
        line-height: 1.45;
        color: var(--ink-2);
      }

      .unknown-body {
        font-size: 11px;
        color: var(--ink-3);
        margin-top: 6px;
        white-space: pre-wrap;
      }

      .row.gap {
        padding: 0;
        display: block;
        background: var(--paper-sunken);
      }

      .gap-inner {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        font-size: 11px;
      }

      .dash {
        flex: 1 1 auto;
        height: 1px;
        background: repeating-linear-gradient(90deg, var(--ink-5) 0 4px, transparent 4px 9px);
      }

      .gap-body {
        font-weight: 600;
        color: var(--ink-2);
        flex: 0 0 auto;
      }
    `
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'reader-row': ReaderRow;
  }
}
