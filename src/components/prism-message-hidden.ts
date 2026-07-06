import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { NormalizedMessage } from '../types/prism';
import { renderIcon, type IconName } from '../utils/icons';

@customElement('prism-message-hidden')
export class PrismMessageHidden extends LitElement {
  @property({ attribute: false })
  message: NormalizedMessage | null = null;

  updated(): void {
    if (!this.message) {
      return;
    }

    this.dataset.channel = this.message.channel;
  }

  render() {
    const role = this.message?.role ?? 'user';
    const channel = this.message?.channel ?? 'message';

    return html`
      <button
        type="button"
        class="hidden-stub"
        aria-label="Show message"
        @click=${this.#handleClick}
      >
        <span class="rail rail-${role}" aria-hidden="true">
          ${this.#getRoleGlyph()}
        </span>

        <span class="chips">
          <span class="chip role role-${role}">${role}</span>
          <span class="chip channel">${channel}</span>
          ${this.message?.name
            ? html`<span class="chip name">${this.message.name}</span>`
            : null}
        </span>

        <span class="reveal">
          ${renderIcon('EyeOff', { size: 12 })}
          <span>show</span>
        </span>
      </button>
    `;
  }

  #getRoleGlyph(): TemplateResult {
    const iconName: IconName = (() => {
      switch (this.message?.role) {
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

  #handleClick = () => {
    if (!this.message) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent('prism-reveal-message', {
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

    .hidden-stub {
      all: unset;
      box-sizing: border-box;
      display: grid;
      grid-template-columns: 16px 1fr auto;
      align-items: center;
      column-gap: 10px;
      width: 100%;
      padding: 5px 10px 5px 8px;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      background: var(--surface-sunken);
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease;
    }

    .hidden-stub:hover {
      background: var(--surface-base);
      border-color: var(--border-strong);
    }

    .hidden-stub:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }

    .rail {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--text-3);
      opacity: 0.7;
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

    .chips {
      display: flex;
      gap: 5px;
      align-items: center;
      flex-wrap: wrap;
      min-width: 0;
    }

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

    .reveal {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--text-3);
      font-size: 11px;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'prism-message-hidden': PrismMessageHidden;
  }
}
