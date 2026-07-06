import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { NormalizedMessage } from '../types/prism';
import { renderIcon, type IconName } from '../utils/icons';
import './prism-message-text';

@customElement('prism-message-card')
export class PrismMessageCard extends LitElement {
  @property({ attribute: false })
  message!: NormalizedMessage;

  @property({ type: Boolean })
  selected = false;

  @property({ type: Boolean })
  renderMarkdown = false;

  @property({ type: Boolean })
  showAbsoluteTimestamp = false;

  @property({ type: String })
  maxMessageHeight = '100vh';

  connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('click', this.#handleClick);
  }

  disconnectedCallback(): void {
    this.removeEventListener('click', this.#handleClick);
    super.disconnectedCallback();
  }

  updated(): void {
    if (!this.message) {
      return;
    }

    this.dataset.channel = this.message.channel;
    this.dataset.sidechain = String(this.message.isSidechain);
    this.dataset.role = this.message.role;
    if (this.message.recipient) {
      this.dataset.recipient = this.message.recipient;
    } else {
      delete this.dataset.recipient;
    }
  }

  render() {
    if (!this.message) {
      return html``;
    }

    const isCodeLike =
      this.message.channel === 'tool_call' ||
      this.message.channel === 'tool_result' ||
      this.message.channel === 'event';

    return html`
      <article
        class="card ${this.selected ? 'selected' : ''}"
        style=${`--prism-message-max-height: ${this.maxMessageHeight};`}
      >
        <div class="rail rail-${this.message.role}" aria-hidden="true">
          <span class="glyph">${this.#getRoleGlyph()}</span>
          <span class="rail-line"></span>
        </div>

        <div class="body">
          <header>
            <div class="chips">
              <span class="chip role role-${this.message.role}"
                >${this.message.role}</span
              >
              <span class="chip channel">${this.message.channel}</span>
              ${this.message.name
                ? html`<span class="chip name">${this.message.name}</span>`
                : null}
              ${this.message.isSidechain
                ? html`<span class="chip sidechain">sidechain</span>`
                : null}
            </div>
            <div class="meta">
              ${this.message.timestamp
                ? html`<time
                    >${this.#formatTimestamp(this.message.timestamp)}</time
                  >`
                : null}
              <button
                class="fold-button"
                type="button"
                aria-label="Fold message"
                title="Collapse message"
                @click=${this.#handleFold}
              >
                ${renderIcon('ChevronUp', { size: 13 })}
              </button>
            </div>
          </header>

          ${isCodeLike
            ? html`<pre>${this.message.text}</pre>`
            : html`
                <prism-message-text
                  .text=${this.message.text}
                  .shouldRenderMarkdown=${this.renderMarkdown}
                  .maxHeight=${this.maxMessageHeight}
                ></prism-message-text>
              `}
        </div>
      </article>
    `;
  }

  #formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return timestamp;
    }

    if (this.showAbsoluteTimestamp) {
      return date.toLocaleString();
    }

    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  #getRoleGlyph(): TemplateResult {
    const iconName: IconName = (() => {
      switch (this.message.role) {
        case 'assistant':
          return 'Bot';
        case 'tool':
          return 'Wrench';
        case 'system':
        case 'meta':
          return 'MoreHorizontal';
        case 'user':
        default:
          return 'User';
      }
    })();
    return renderIcon(iconName, { size: 14 });
  }

  #handleClick = (event: Event) => {
    if (!this.message) {
      return;
    }
    const path = event.composedPath();
    if (
      path.some(
        node =>
          node instanceof HTMLElement && node.classList?.contains('fold-button')
      )
    ) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent('prism-select-message', {
        detail: { messageId: this.message.id },
        bubbles: true,
        composed: true
      })
    );
  };

  #handleFold = (event: Event) => {
    event.stopPropagation();
    if (!this.message) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent('prism-fold-message', {
        detail: { messageId: this.message.id },
        bubbles: true,
        composed: true
      })
    );
  };

  static styles = css`
    :host {
      display: block;
    }

    .card {
      display: grid;
      grid-template-columns: 16px minmax(0, 1fr);
      column-gap: 10px;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
      background: var(--surface-base);
      cursor: pointer;
      min-width: 0;
      transition: background 120ms ease, border-color 120ms ease;
    }

    .card:hover {
      border-color: var(--border-strong);
    }

    .card.selected {
      background: color-mix(in srgb, var(--accent-soft) 50%, var(--surface-base));
      border-color: color-mix(in srgb, var(--accent) 40%, var(--surface-base));
    }

    /* ---- Role rail (left): icon + accent line ---- */
    .rail {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      color: var(--text-3);
    }

    .rail-user {
      color: var(--role-user);
    }

    .rail-assistant,
    .rail-tool {
      color: var(--role-asst);
    }

    .rail-system,
    .rail-meta {
      color: var(--text-3);
    }

    :host([data-channel='tool_result']) .rail-tool {
      color: var(--role-tool-res);
    }

    /* tool_call arrives as role 'assistant' (demo session) or 'tool' (parser) */
    :host([data-channel='tool_call']) .rail-assistant,
    :host([data-channel='tool_call']) .rail-tool {
      color: var(--role-tool-call);
    }

    .glyph {
      display: inline-flex;
      line-height: 0;
    }

    .rail-line {
      width: 2px;
      flex: 1;
      min-height: 8px;
      background: currentColor;
      opacity: 0.4;
      border-radius: 2px;
    }

    /* ---- Body (right column) ---- */
    .body {
      min-width: 0;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 5px;
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      align-items: center;
      min-width: 0;
    }

    .meta {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    time {
      color: var(--text-3);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    /* ---- Chips: 1px 6px padding, 4px radius, 10.5px font ---- */
    .chip {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10.5px;
      line-height: 1.5;
      font-weight: 400;
      white-space: nowrap;
      color: var(--text-2);
      background: var(--surface-sunken);
      font-variant-numeric: tabular-nums;
    }

    .chip.role {
      font-weight: 500;
    }

    .chip.role-user {
      color: var(--role-user);
      background: var(--role-user-bg);
    }

    .chip.role-assistant,
    .chip.role-tool {
      color: var(--role-asst);
      background: var(--role-asst-bg);
    }

    :host([data-channel='tool_result']) .chip.role-tool {
      color: var(--role-tool-res);
      background: var(--role-tool-res-bg);
    }

    :host([data-channel='tool_call']) .chip.channel {
      color: var(--role-tool-call);
      background: var(--role-tool-call-bg);
    }

    :host([data-channel='tool_result']) .chip.channel {
      color: var(--role-tool-res);
      background: var(--role-tool-res-bg);
    }

    .chip.role-system,
    .chip.role-meta {
      color: var(--text-2);
      background: var(--surface-sunken);
    }

    .chip.channel,
    .chip.name {
      color: var(--text-2);
      background: var(--surface-sunken);
    }

    .chip.sidechain {
      color: var(--accent);
      background: var(--accent-soft);
    }

    /* ---- Fold button (hover-revealed) ---- */
    .fold-button {
      all: unset;
      box-sizing: border-box;
      width: 20px;
      height: 20px;
      display: inline-grid;
      place-items: center;
      border-radius: 4px;
      color: var(--text-3);
      cursor: pointer;
      opacity: 0;
      transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
    }

    .card:hover .fold-button,
    .fold-button:focus-visible {
      opacity: 1;
    }

    .fold-button:hover {
      background: var(--surface-sunken);
      color: var(--text-1);
    }

    .fold-button:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }

    /* ---- Message body ---- */
    pre {
      margin: 0;
      padding: 8px 10px;
      max-height: var(--prism-message-max-height, 100vh);
      overflow: auto;
      background: var(--surface-sunken);
      border: 1px solid var(--border-subtle);
      border-radius: 5px;
      font-family: 'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace;
      font-size: 11.5px;
      line-height: 1.5;
      color: var(--text-2);
      white-space: pre-wrap;
      word-break: break-word;
    }

    prism-message-text {
      display: block;
      font-size: 13px;
      line-height: 1.55;
      color: var(--text-2);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'prism-message-card': PrismMessageCard;
  }
}
