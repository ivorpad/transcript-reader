import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';

import { CATALOG, typeNameOf } from '../adapters/claude/catalog';
import type { LineClass, NormalizedConversation, NormalizedMessage } from '../types/reader';
import { sharedStyles } from './styles';

const toneOf = (name: LineClass): string => {
  switch (name) {
    case 'read':
      return 'ink';
    case 'fold':
      return 'green';
    case 'mark':
      return 'amber';
    case 'panel':
      return 'blue';
    default:
      return 'grey';
  }
};

const visit = (message: NormalizedMessage, into: (line: NormalizedMessage) => void) => {
  into(message);
  for (const member of message.groupedMessages ?? []) visit(member, into);
  for (const folded of message.folded ?? []) visit(folded, into);
};

/** Class and type counts over every line the parser kept. */
export const classCounts = (conversation: NormalizedConversation | null) => {
  const byClass = new Map<LineClass, number>();
  const byType = new Map<string, number>();
  let total = 0;
  if (!conversation) return { byClass, byType, total };
  const seen = new Set<object>();
  const count = (line: NormalizedMessage) => {
    if (seen.has(line.raw)) return;
    seen.add(line.raw);
    total++;
    const lineClass = line.lineClass ?? 'unknown';
    byClass.set(lineClass, (byClass.get(lineClass) ?? 0) + 1);
    const key = typeNameOf(line);
    byType.set(key, (byType.get(key) ?? 0) + 1);
  };
  for (const message of conversation.messages) visit(message, count);
  for (const message of conversation.folded) visit(message, count);
  total += conversation.malformed.length;
  if (conversation.malformed.length) {
    byClass.set('unknown', (byClass.get('unknown') ?? 0) + conversation.malformed.length);
  }
  return { byClass, byType, total };
};

@customElement('reader-catalog')
export class ReaderCatalog extends LitElement {
  @property({ attribute: false })
  conversation: NormalizedConversation | null = null;

  render() {
    const counts = classCounts(this.conversation);
    const share = (name: LineClass): string => {
      if (!counts.total) return 'no session loaded';
      const n = counts.byClass.get(name) ?? 0;
      const pct = Math.round((n / counts.total) * 100);
      return `${n.toLocaleString()} lines · ${pct}% of this session`;
    };
    const present = (item: string): number => {
      const key = item.startsWith('system:') ? item : item.replace(/^attachment:/u, '');
      return counts.byType.get(key) ?? (key === 'user' || key === 'assistant' ? counts.byType.get(key) ?? 0 : 0);
    };

    return html`
      <div class="wrap">
        <div class="h1">Every line type has a class, and the class decides where it goes</div>
        <div class="lede">
          Five classes. A type's class is a lookup, so a type the reader has never seen falls to the last class rather
          than breaking the page. 27 top-level types, 11 system subtypes, 49 attachment types and 8 content blocks are
          placed below. Types present in the loaded session carry their line count.
        </div>
        ${CATALOG.map(entry => {
          const tone = toneOf(entry.name);
          return html`
            <div class="card">
              <div class="card-head edge-${tone} ${tone}">
                <span class="name mono">${entry.name}</span>
                <span class="rule">${entry.rule}</span>
                <span class="share mono">${share(entry.name)}</span>
              </div>
              <div class="card-body">
                <div class="mono muted small">specimen</div>
                <pre class="specimen mono edge-${tone}">${entry.specimen}</pre>
                <div class="mono muted small gap">${entry.name === 'unknown' ? 'everything else' : `${entry.items.length} types`}</div>
                <div class="items">
                  ${entry.items.map(item => {
                    const n = entry.name === 'unknown' ? 0 : present(item);
                    return html`<span class=${classMap({ item: true, mono: true, present: n > 0 })}
                      >${item}${n > 0 ? html` <span class="n">${n.toLocaleString()}</span>` : nothing}</span
                    >`;
                  })}
                </div>
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        overflow-y: auto;
        height: 100%;
      }

      .wrap {
        max-width: 1000px;
        padding: 18px 22px 60px;
      }

      .h1 {
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 6px;
      }

      .lede {
        font-size: 13px;
        line-height: 1.55;
        color: var(--ink-2);
        margin-bottom: 4px;
        max-width: 88ch;
      }

      .card {
        border: 1px solid var(--line);
        border-radius: 7px;
        background: var(--paper-raised);
        margin-top: 14px;
        overflow: hidden;
      }

      .card-head {
        display: flex;
        align-items: baseline;
        gap: 10px;
        padding: 11px 14px;
        border-bottom: 1px solid var(--line-soft);
        flex-wrap: wrap;
        background: var(--paper-rail);
      }

      .card-head.green { background: var(--green-soft); }
      .card-head.amber { background: var(--amber-soft); }
      .card-head.blue { background: var(--blue-soft); }
      .card-head.ink { background: var(--paper-sunken); }

      .name {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--edge);
      }

      .rule {
        font-size: 13px;
        line-height: 1.45;
        color: var(--ink-2);
        flex: 1 1 260px;
        min-width: 0;
      }

      .share {
        font-size: 11px;
        color: var(--ink-4);
        flex: 0 0 auto;
      }

      .card-body {
        padding: 11px 14px;
      }

      .small {
        font-size: 11px;
        margin-bottom: 7px;
      }

      .small.gap {
        margin: 12px 0 7px;
      }

      .specimen {
        border: 1px solid var(--line);
        border-left: 3px solid var(--edge);
        border-radius: 4px;
        background: var(--paper-rail);
        padding: 8px 10px;
        font-size: 12px;
        line-height: 1.6;
        white-space: pre-wrap;
        overflow-x: auto;
        color: var(--ink-2);
        margin: 0;
      }

      .items {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }

      .item {
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 3px;
        border: 1px solid var(--line);
        background: var(--paper);
        color: var(--ink-3);
      }

      .item.present {
        color: var(--ink);
        border-color: var(--ink-5);
        background: var(--paper-raised);
      }

      .n {
        color: var(--ink-4);
      }
    `
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    'reader-catalog': ReaderCatalog;
  }
}
