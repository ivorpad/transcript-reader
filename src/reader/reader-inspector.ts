import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { NormalizedMessage, ReaderEntry } from '../types/prism';
import { safeRawJson, shortId } from './format';
import { gapFields, inspectorFields } from './inspect';
import { sharedStyles } from './styles';

@customElement('reader-inspector')
export class ReaderInspector extends LitElement {
  @property({ attribute: false })
  entry: ReaderEntry | null = null;

  @property({ attribute: false })
  line: NormalizedMessage | null = null;

  @property({ type: Boolean })
  floating = false;

  @state()
  private copied = false;

  #emit(name: string, detail: Record<string, unknown> = {}): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  async #copy(): Promise<void> {
    const line = this.line;
    if (!line) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(line.raw));
      this.copied = true;
      setTimeout(() => {
        this.copied = false;
      }, 1500);
    } catch {
      this.copied = false;
    }
  }

  render() {
    const entry = this.entry;
    const line = this.line;
    const isGap = entry?.kind === 'gap' && !line;
    const title = isGap
      ? 'gap'
      : line
        ? `${entry?.tag ?? line.channel} · ${shortId(line.uuid ?? line.id, 8, 4)}`
        : 'nothing selected';
    const fields = isGap && entry ? gapFields(entry) : line ? inspectorFields(line, entry) : [];
    const unrecognised = line?.lineClass === 'unknown';

    return html`
      <div class="head">
        <span class="eyebrow">Line</span>
        <span class="title mono">${title}</span>
        ${this.floating
          ? html`<button class="btn small" type="button" @click=${() => this.#emit('reader-close')}>close</button>`
          : nothing}
      </div>
      ${!line && !isGap
        ? html`<div class="empty">Click a row to read its fields and the raw line it came from.</div>`
        : html`
            <div class="fields">
              ${fields.map(
                ([key, value]) => html`
                  <div class="field">
                    <span class="k mono">${key}</span>
                    <span class="v mono">${value}</span>
                  </div>
                `
              )}
            </div>
            <div class="eyebrow raw-label">${isGap ? 'no line' : unrecognised ? 'raw line · unrecognised' : 'raw line'}</div>
            <pre class="raw">${isGap
              ? '// No line represents the gap. It is computed from the\n// timestamp difference between two adjacent lines.'
              : safeRawJson(line?.raw)}</pre>
            ${line
              ? html`<div class="actions">
                  <button class="btn" type="button" @click=${() => this.#copy()}>
                    ${this.copied ? 'copied' : 'Copy line'}
                  </button>
                  ${line.requestId
                    ? html`<button
                        class="btn"
                        type="button"
                        @click=${() => this.#emit('reader-siblings', { requestId: line.requestId })}
                      >
                        Siblings by requestId
                      </button>`
                    : nothing}
                </div>`
              : nothing}
          `}
    `;
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        background: var(--paper-raised);
        overflow-y: auto;
        height: 100%;
      }

      .head {
        padding: 10px 14px;
        border-bottom: 1px solid var(--line);
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .title {
        font-size: 11px;
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .btn.small {
        padding: 2px 7px;
      }

      .empty {
        padding: 14px;
        font-size: 12px;
        color: var(--ink-4);
        line-height: 1.5;
      }

      .fields {
        padding: 10px 14px;
      }

      .field {
        display: flex;
        gap: 10px;
        padding: 3px 0;
        align-items: baseline;
      }

      .k {
        flex: 0 0 110px;
        font-size: 11px;
        color: var(--ink-4);
      }

      .v {
        flex: 1 1 auto;
        min-width: 0;
        font-size: 11px;
        word-break: break-word;
        color: var(--ink-2);
      }

      .raw-label {
        padding: 0 14px 4px;
      }

      .raw {
        margin: 0 14px 12px;
        max-height: 320px;
        overflow: auto;
      }

      .actions {
        padding: 0 14px 18px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
    `
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'reader-inspector': ReaderInspector;
  }
}
