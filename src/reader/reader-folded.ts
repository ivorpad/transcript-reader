import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';

import type { FoldedType, NormalizedMessage, SessionView } from '../types/reader';
import { foldNote } from '../adapters/claude/session';
import { humanBytes, plural, safeRawJson } from './format';
import { sharedStyles } from './styles';

const PAGE = 120;

const toneOf = (fold: FoldedType): string => {
  if (fold.key === 'hook_blocking_error') return 'red';
  switch (fold.lineClass) {
    case 'fold':
      return 'green';
    case 'panel':
      return 'blue';
    case 'mark':
      return 'amber';
    default:
      return '';
  }
};

@customElement('reader-folded')
export class ReaderFolded extends LitElement {
  @property({ attribute: false })
  view!: SessionView;

  @property({ type: String })
  selectedKey: string | null = null;

  @state()
  private shown = PAGE;

  @state()
  private rawLine: NormalizedMessage | null = null;

  #pick(key: string): void {
    this.shown = PAGE;
    this.rawLine = null;
    this.dispatchEvent(new CustomEvent('reader-fold-pick', { detail: { key }, bubbles: true, composed: true }));
  }

  #host(hostId: string | null): void {
    if (!hostId) return;
    this.dispatchEvent(
      new CustomEvent('reader-go', { detail: { tab: 'session', entryId: hostId }, bubbles: true, composed: true })
    );
  }

  render() {
    const view = this.view;
    if (!view) return nothing;
    const folds = view.folds;
    const total = view.ledger.foldedLines;
    const current = folds.find(fold => fold.key === this.selectedKey) ?? folds[0] ?? null;
    const attachmentShare =
      view.ledger.parsedLines > 0
        ? Math.round((folds.filter(f => f.lineClass !== 'panel' || f.disposition === 'row').reduce((n, f) => n + f.count, 0) / view.ledger.parsedLines) * 100)
        : 0;

    return html`
      <div class="list">
        <div class="list-head">
          <div class="count">${total.toLocaleString()} folded</div>
          <div class="lede">
            ${folds.length
              ? html`Lines that drew no row, across ${plural(folds.length, 'type')}. Attachments folded onto rows are
                  ${attachmentShare}% of all lines. Every one is reachable here, and from the count on the row it
                  attaches to.`
              : html`Every line in this session drew a row.`}
          </div>
        </div>
        ${folds.map(
          fold => html`
            <div
              class=${classMap({ type: true, current: fold === current, [`edge-${toneOf(fold) || 'grey'}`]: true })}
              @click=${() => this.#pick(fold.key)}
            >
              <span class="name mono">${fold.key}</span>
              <span class="where mono">${fold.disposition === 'own-row' ? 'row of its own' : fold.disposition}</span>
              <span class="n mono">${fold.count.toLocaleString()}</span>
            </div>
          `
        )}
        <div class="note">Counts are for this session. Corpus-wide, hook_success alone is 268,430 lines and total_tokens_reminder 46,833.</div>
      </div>
      <div class="detail">
        ${current ? this.#renderDetail(current) : nothing}
      </div>
    `;
  }

  #renderDetail(fold: FoldedType) {
    const items = fold.items.slice(0, this.shown);
    const raw = this.rawLine ?? fold.items[0]?.message ?? null;
    return html`
      <div class="detail-wrap">
        <div class="detail-head">
          <span class="detail-name mono">${fold.key}</span>
          <span class="mono muted">${fold.count.toLocaleString()} in this session · class ${fold.lineClass} · ${fold.disposition === 'own-row' ? 'row of its own' : fold.disposition}</span>
        </div>
        <div class="rule">${foldNote(fold)}</div>
        <div class="table">
          <div class="thead mono eyebrow">
            <span class="c-at">at</span><span class="c-host">attaches to</span><span class="c-payload">payload</span><span class="c-size">size</span>
          </div>
          ${items.map(
            item => html`
              <div class="tr ${classMap({ current: item.message === raw })}" @click=${() => { this.rawLine = item.message; }}>
                <span class="c-at mono">${item.at}</span>
                <span class="c-host mono">
                  ${item.hostId
                    ? html`<a href="#" @click=${(event: Event) => { event.preventDefault(); event.stopPropagation(); this.#host(item.hostId); }}>${item.hostLabel}</a>`
                    : html`<span class="muted">${fold.disposition === 'panel' ? 'panel' : item.hostLabel}</span>`}
                </span>
                <span class="c-payload mono">${item.payload}</span>
                <span class="c-size mono">${humanBytes(item.bytes)}</span>
              </div>
            `
          )}
          ${fold.items.length > this.shown
            ? html`<div class="more mono">
                ${(fold.items.length - this.shown).toLocaleString()} more ·
                <a href="#" @click=${(event: Event) => { event.preventDefault(); this.shown += PAGE * 4; }}>show more</a>
              </div>`
            : nothing}
        </div>
        ${raw
          ? html`<div class="mono muted raw-label">raw line${this.rawLine ? '' : ' · first of this type'}</div>
              <pre class="raw">${safeRawJson(raw.raw)}</pre>`
          : nothing}
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        height: 100%;
        overflow: hidden;
      }

      .list {
        flex: 0 0 340px;
        min-width: 0;
        border-right: 1px solid var(--line);
        background: var(--paper-rail);
        overflow-y: auto;
      }

      .list-head {
        padding: 12px 14px;
        border-bottom: 1px solid var(--line);
      }

      .count {
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 4px;
      }

      .lede {
        font-size: 12px;
        line-height: 1.5;
        color: var(--ink-3);
      }

      .type {
        display: flex;
        gap: 9px;
        align-items: baseline;
        padding: 6px 14px;
        border-bottom: 1px solid var(--line-soft);
        cursor: pointer;
        border-left: 2px solid transparent;
      }

      .type:hover {
        background: var(--line-soft);
      }

      .type.current {
        background: var(--line-soft);
        border-left-color: var(--edge);
      }

      .name {
        flex: 1 1 auto;
        min-width: 0;
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--ink-2);
      }

      .where {
        font-size: 10px;
        color: var(--ink-4);
        flex: 0 0 auto;
      }

      .n {
        font-size: 11px;
        color: var(--ink-3);
        flex: 0 0 52px;
        text-align: right;
      }

      .note {
        padding: 10px 14px 24px;
        font-size: 11px;
        line-height: 1.45;
        color: var(--ink-4);
      }

      .detail {
        flex: 1 1 auto;
        min-width: 0;
        overflow-y: auto;
        padding: 16px 20px 60px;
      }

      .detail-wrap {
        max-width: 860px;
      }

      .detail-head {
        display: flex;
        align-items: baseline;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 4px;
        font-size: 11px;
      }

      .detail-name {
        font-size: 14px;
        font-weight: 600;
      }

      .rule {
        font-size: 13px;
        line-height: 1.55;
        color: var(--ink-2);
        max-width: 84ch;
      }

      .table {
        margin-top: 14px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: var(--paper-raised);
        overflow: hidden;
      }

      .thead,
      .tr {
        display: flex;
        gap: 10px;
        padding: 6px 12px;
        align-items: baseline;
      }

      .thead {
        padding: 7px 12px;
        background: var(--paper-rail);
        border-bottom: 1px solid var(--line);
        letter-spacing: 0.06em;
      }

      .tr {
        border-bottom: 1px solid var(--line-soft);
        cursor: pointer;
        font-size: 11px;
      }

      .tr:hover,
      .tr.current {
        background: var(--paper-rail);
      }

      .c-at {
        flex: 0 0 62px;
        color: var(--ink-4);
      }

      .c-host {
        flex: 0 0 180px;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .c-payload {
        flex: 1 1 auto;
        min-width: 0;
        color: var(--ink-2);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .c-size {
        flex: 0 0 58px;
        text-align: right;
        color: var(--ink-4);
        font-size: 10px;
      }

      .more {
        padding: 8px 12px;
        font-size: 11px;
        color: var(--ink-4);
      }

      .raw-label {
        margin: 14px 0 6px;
        font-size: 11px;
      }

      .raw {
        max-height: 360px;
        overflow: auto;
      }
    `
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'reader-folded': ReaderFolded;
  }
}
