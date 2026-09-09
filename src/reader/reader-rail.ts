import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';

import type { SessionView } from '../types/prism';
import { formatDuration } from '../adapters/claude/session';
import { sharedStyles, type Edge } from './styles';

const turnEdge = (turn: SessionView['turns'][number]): Edge => {
  if (turn.troubleCount > 0) return 'red';
  if (turn.agentCount > 0) return 'violet';
  if (turn.interrupted) return 'amber';
  return 'ink';
};

@customElement('reader-rail')
export class ReaderRail extends LitElement {
  @property({ attribute: false })
  view!: SessionView;

  @property({ type: Number })
  currentTurn = 0;

  #go(turnIndex: number): void {
    this.dispatchEvent(
      new CustomEvent('reader-turn', { detail: { turnIndex }, bubbles: true, composed: true })
    );
  }

  render() {
    const view = this.view;
    if (!view) return nothing;
    const { turns, panels } = view;
    const context = panels.context;
    const last = context.length ? context[context.length - 1] : null;
    const first = context.length ? context[0] : null;

    return html`
      <div class="eyebrow section">Turns · ${turns.length}</div>
      ${turns.map(
        turn => html`
          ${turn.gapBeforeMs !== null
            ? html`<div class="turn gap edge-grey">
                <span class="n mono"></span>
                <span class="label quiet">${formatDuration(turn.gapBeforeMs)} gap</span>
                <span class="dur mono">—</span>
              </div>`
            : nothing}
          <div
            class=${classMap({ turn: true, current: this.currentTurn === turn.index, [`edge-${turnEdge(turn)}`]: true })}
            @click=${() => this.#go(turn.index)}
          >
            <span class="n mono">${turn.index}</span>
            <span class="label">${turn.label}</span>
            <span class="dur mono">${turn.durationMs !== null && turn.durationMs > 0 ? formatDuration(turn.durationMs) : '—'}</span>
          </div>
        `
      )}

      <div class="eyebrow section top">Files changed · ${panels.files.length}</div>
      ${panels.files.length === 0
        ? html`<div class="note">No Edit or Write call and no file-history line in this session.</div>`
        : panels.files.slice(0, 40).map(
            file => html`
              <div class="file">
                <span class="path mono" title=${file.path}>${file.path}</span>
                ${file.added || file.removed
                  ? html`<span class="add mono">+${file.added}</span><span class="del mono">−${file.removed}</span>`
                  : html`<span class="muted mono">×${file.edits}</span>`}
              </div>
            `
          )}
      ${panels.files.length > 40
        ? html`<div class="note">${panels.files.length - 40} more files</div>`
        : nothing}

      <div class="eyebrow section top">Session state</div>
      ${panels.state.length === 0
        ? html`<div class="note">No latched state lines in this session.</div>`
        : panels.state.map(
            entry => html`
              <div class="state">
                <span class="key mono">${entry.key}</span>
                <span class="value mono" title=${entry.value}>${entry.value}</span>
                <span class="writes mono" title=${`${entry.writes} writes, ${entry.changes} changes`}>×${entry.writes}</span>
              </div>
            `
          )}
      ${first && last
        ? html`<div class="state">
            <span class="key mono">context</span>
            <span class="value mono">${last.tokens.toLocaleString()} left</span>
            <span class="writes mono">×${context.length}</span>
          </div>`
        : nothing}
      <div class="note">
        Latched values are written on most turns. Only the final value and its rewrite count appear here; none of them get a row.
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        background: var(--paper-rail);
        overflow-y: auto;
        height: 100%;
      }

      .section {
        padding: 10px 12px 8px;
      }

      .section.top {
        margin-top: 14px;
        border-top: 1px solid var(--line);
      }

      .turn {
        display: flex;
        gap: 8px;
        padding: 6px 12px;
        cursor: pointer;
        border-left: 2px solid var(--edge);
      }

      .turn.gap {
        cursor: default;
      }

      .turn:hover {
        background: var(--line-soft);
      }

      .turn.current {
        background: var(--paper-selected);
      }

      .n {
        font-size: 10px;
        color: var(--ink-4);
        padding-top: 2px;
        width: 16px;
        flex: 0 0 auto;
      }

      .label {
        flex: 1 1 auto;
        min-width: 0;
        font-size: 12px;
        line-height: 1.35;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .dur {
        font-size: 10px;
        color: var(--ink-4);
        flex: 0 0 auto;
        padding-top: 2px;
      }

      .file,
      .state {
        display: flex;
        gap: 8px;
        padding: 4px 12px;
        align-items: baseline;
      }

      .path {
        flex: 1 1 auto;
        min-width: 0;
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        direction: rtl;
        text-align: left;
        white-space: nowrap;
      }

      .add {
        font-size: 10px;
        color: var(--green);
      }

      .del {
        font-size: 10px;
        color: var(--red);
      }

      .key {
        font-size: 11px;
        color: var(--ink-3);
        flex: 0 0 auto;
      }

      .value {
        font-size: 11px;
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: right;
      }

      .writes {
        font-size: 10px;
        color: var(--ink-5);
        width: 34px;
        text-align: right;
        flex: 0 0 auto;
      }

      .note {
        padding: 8px 12px 18px;
        font-size: 11px;
        line-height: 1.4;
        color: var(--ink-4);
      }
    `
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'reader-rail': ReaderRail;
  }
}
