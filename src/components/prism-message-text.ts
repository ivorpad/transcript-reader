import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import { renderMarkdown } from '../utils/markdown';

@customElement('prism-message-text')
export class PrismMessageText extends LitElement {
  @property({ type: String })
  text = '';

  @property({ type: Boolean })
  shouldRenderMarkdown = false;

  @property({ type: String })
  maxHeight = '100vh';

  render() {
    const cssVar = `--prism-message-max-height: ${this.maxHeight};`;

    if (this.shouldRenderMarkdown) {
      return html`<div
        class="message-text rendered"
        data-mode="markdown"
        style=${cssVar}
      >${unsafeHTML(renderMarkdown(this.text))}</div>`;
    }

    return html`<div
      class="message-text plain"
      data-mode="plain"
      style=${cssVar}
    >${this.text.replace(/^[\r\n]+|[\r\n]+$/g, '')}</div>`;
  }

  static styles = css`
    :host {
      display: block;
      min-width: 0;
    }

    .message-text {
      color: inherit;
      line-height: 1.5;
      word-break: break-word;
      max-height: var(--prism-message-max-height, 100vh);
      overflow: auto;
    }

    .plain {
      white-space: pre-wrap;
    }

    .rendered {
      line-height: 1.45;
      /* explicit so an inherited pre-wrap from the host can't turn the
         inter-element newlines in marked's output into visible blank lines */
      white-space: normal;
    }

    .rendered > :first-child {
      margin-top: 0;
    }

    .rendered > :last-child {
      margin-bottom: 0;
    }

    .rendered p,
    .rendered ul,
    .rendered ol,
    .rendered blockquote,
    .rendered pre {
      margin: 0 0 0.45em;
    }

    .rendered h1,
    .rendered h2,
    .rendered h3,
    .rendered h4,
    .rendered h5,
    .rendered h6 {
      margin: 0.6em 0 0.3em;
      line-height: 1.3;
      font-weight: 600;
    }

    .rendered h1 {
      font-size: 1.35em;
    }

    .rendered h2 {
      font-size: 1.2em;
    }

    .rendered h3 {
      font-size: 1.1em;
    }

    .rendered h4,
    .rendered h5,
    .rendered h6 {
      font-size: 1em;
    }

    .rendered ul,
    .rendered ol {
      padding-left: 1.2rem;
    }

    .rendered li {
      margin: 0.1em 0;
    }

    .rendered li > p {
      margin: 0;
    }

    .rendered li + li {
      margin-top: 0.15em;
    }

    .rendered blockquote {
      padding-left: 0.9rem;
      border-left: 3px solid var(--border-strong);
      color: var(--text-2);
    }

    .rendered code {
      padding: 0.08rem 0.3rem;
      border-radius: 4px;
      background: var(--surface-sunken);
      font-family:
        ui-monospace,
        'SFMono-Regular',
        monospace;
      font-size: 0.92em;
    }

    .rendered pre {
      overflow: auto;
      padding: 10px 12px;
      border-radius: 6px;
      background: var(--surface-sunken);
    }

    .rendered pre code {
      padding: 0;
      background: transparent;
      display: block;
      white-space: pre;
    }

    .rendered a {
      color: var(--accent);
      text-decoration: none;
    }

    .rendered a:hover {
      text-decoration: underline;
    }

    .rendered table {
      border-collapse: collapse;
      width: auto;
      max-width: 100%;
      margin: 0 0 0.8em;
      font-size: 0.95em;
      font-variant-numeric: tabular-nums;
    }

    .rendered table :is(th, td) {
      padding: 5px 10px;
      border: 1px solid var(--border-subtle);
      text-align: left;
      vertical-align: top;
      line-height: 1.45;
    }

    .rendered table th {
      background: var(--surface-raised);
      color: var(--text-1);
      font-weight: 600;
    }

    .rendered table tbody tr:nth-child(even) td {
      background: var(--surface-raised);
    }

    .rendered table :is(th, td)[align='right'] {
      text-align: right;
    }

    .rendered table :is(th, td)[align='center'] {
      text-align: center;
    }

    .rendered img {
      max-width: 100%;
      border-radius: 4px;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'prism-message-text': PrismMessageText;
  }
}
