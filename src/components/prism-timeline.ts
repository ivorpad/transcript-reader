import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';

import type {
  NormalizedConversation,
  NormalizedMessage,
  PrismConversationAction
} from '../types/prism';
import { renderIcon } from '../utils/icons';
import './prism-message-card';
import './prism-message-hidden';

@customElement('prism-timeline')
export class PrismTimeline extends LitElement {
  @property({ attribute: false })
  conversation: NormalizedConversation | null = null;

  @property({ type: String })
  fileName = '';

  @property({ type: Number })
  conversationIndex = 0;

  @property({ attribute: false })
  messages: NormalizedMessage[] = [];

  @property({ type: String })
  selectedMessageId: string | null = null;

  @property({ type: Boolean })
  renderMarkdown = false;

  @property({ type: Boolean })
  showAbsoluteTimestamp = false;

  @property({ type: String })
  maxMessageHeight = '100vh';

  @property({ type: String })
  actionStatus: string | null = null;

  @property({ type: Boolean })
  showShareMenu = false;

  @property({ attribute: false })
  hiddenMessageIds: string[] = [];

  render() {
    if (!this.conversation) {
      return html`<div class="empty">No timeline loaded.</div>`;
    }

    return html`
      <article class="timeline">
        <header class="timeline-header">
          <div class="title-block">
            <div class="meta-line">
              <span class="meta-index">#${this.conversationIndex}</span>
              <span class="meta-sep">·</span>
              <span class="meta-file">${this.fileName}</span>
            </div>
            <div class="title">${this.conversation.title}</div>
          </div>
          <div class="actions" aria-label="conversation actions">
            ${this.#renderActionButton(
              'toggleMarkdown',
              renderIcon('Type', { slashed: !this.renderMarkdown, size: 14 }),
              this.renderMarkdown
                ? 'Disable markdown rendering'
                : 'Enable markdown rendering'
            )}
            ${this.#renderActionButton(
              'translateConversation',
              renderIcon('Languages', { size: 14 }),
              'Translate conversation'
            )}
            ${this.#renderActionButton(
              'toggleMetadata',
              renderIcon('Braces', { size: 14 }),
              'Toggle metadata panel'
            )}
            <div class="share-anchor">
              ${this.#renderShareToggle()}
              ${this.showShareMenu
                ? html`
                    <div
                      class="share-menu"
                      @click=${(event: Event) => event.stopPropagation()}
                    >
                      ${this.#renderShareItem(
                        'copyShareableUrl',
                        'Copy shareable URL'
                      )}
                      ${this.#renderShareItem(
                        'copyConversationJson',
                        'Copy conversation JSON'
                      )}
                      ${this.#renderShareItem('downloadConversation', 'Download')}
                      ${this.#renderShareItem(
                        'openRenderView',
                        'Claude render view'
                      )}
                    </div>
                  `
                : null}
            </div>
          </div>
        </header>

        ${this.actionStatus
          ? html`<div class="action-status">${this.actionStatus}</div>`
          : null}

        <div class="stack">
          ${this.messages.length === 0
            ? html`<div class="empty-stack">
                No messages match the current focus filters.
              </div>`
            : this.messages.map(message =>
                this.hiddenMessageIds.includes(message.id)
                  ? html`
                      <prism-message-hidden
                        .message=${message}
                      ></prism-message-hidden>
                    `
                  : html`
                      <prism-message-card
                        .message=${message}
                        ?selected=${message.id === this.selectedMessageId}
                        .renderMarkdown=${this.renderMarkdown}
                        .showAbsoluteTimestamp=${this.showAbsoluteTimestamp}
                        .maxMessageHeight=${this.maxMessageHeight}
                      ></prism-message-card>
                    `
              )}
        </div>
      </article>
    `;
  }

  #renderActionButton(
    action: PrismConversationAction,
    content: string | TemplateResult,
    ariaLabel?: string
  ) {
    return html`
      <button
        class="icon-btn"
        type="button"
        name=${action}
        aria-label=${ifDefined(ariaLabel)}
        title=${ifDefined(ariaLabel)}
        @click=${() => this.#emitAction(action)}
      >
        ${content}
      </button>
    `;
  }

  #renderShareToggle() {
    return html`
      <button
        class="icon-btn ${this.showShareMenu ? 'is-active' : ''}"
        type="button"
        aria-label="Share"
        title="Share"
        @click=${(event: Event) => {
          event.stopPropagation();
          this.#emitAction('toggleShareMenu');
        }}
      >
        ${renderIcon('Share2', { size: 14 })}
      </button>
    `;
  }

  #renderShareItem(action: PrismConversationAction, label: string) {
    return html`
      <button
        class="share-item"
        type="button"
        @click=${() => this.#emitAction(action)}
      >
        ${label}
      </button>
    `;
  }

  #emitAction(action: PrismConversationAction): void {
    this.dispatchEvent(
      new CustomEvent<PrismConversationAction>('prism-conversation-action', {
        detail: action,
        bubbles: true,
        composed: true
      })
    );
  }

  static styles = css`
    :host {
      display: block;
    }

    .timeline {
      background: var(--surface-raised);
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      overflow: hidden;
      box-shadow: var(--shadow-low);
    }

    .timeline-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
    }

    .title-block {
      min-width: 0;
      flex: 1;
    }

    .meta-line {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10.5px;
      color: var(--text-3);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 500;
    }

    .meta-sep {
      color: var(--text-4);
    }

    .meta-file {
      text-transform: none;
      letter-spacing: 0;
      color: var(--text-3);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .title {
      font-size: 14px;
      color: var(--text-1);
      font-weight: 500;
      margin-top: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .actions {
      display: inline-flex;
      gap: 4px;
      flex-shrink: 0;
    }

    .share-anchor {
      position: relative;
    }

    .icon-btn {
      all: unset;
      box-sizing: border-box;
      width: 26px;
      height: 26px;
      display: inline-grid;
      place-items: center;
      border-radius: 6px;
      color: var(--text-2);
      cursor: pointer;
      border: 1px solid transparent;
      transition: background 120ms ease, color 120ms ease;
    }

    .icon-btn:hover,
    .icon-btn.is-active {
      background: var(--surface-sunken);
      color: var(--text-1);
    }

    .icon-btn:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }

    .share-menu {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      z-index: 10;
      width: 200px;
      padding: 4px;
      background: var(--surface-overlay);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      box-shadow: var(--shadow-menu);
    }

    .share-item {
      all: unset;
      box-sizing: border-box;
      display: block;
      width: 100%;
      padding: 7px 10px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 12.5px;
      color: var(--text-2);
    }

    .share-item:hover {
      background: var(--surface-sunken);
    }

    .action-status {
      padding: 6px 14px;
      font-size: 11.5px;
      color: var(--text-2);
      background: var(--surface-raised);
      border-bottom: 1px solid var(--border-subtle);
    }

    .stack {
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .empty,
    .empty-stack {
      padding: 12px;
      color: var(--text-3);
      font-size: 12px;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'prism-timeline': PrismTimeline;
  }
}
