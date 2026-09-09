import { css } from 'lit';

/** Type and control styles shared by every reader element. */
export const sharedStyles = css`
  :host {
    font-family: var(--font-sans);
    font-size: 14px;
    color: var(--ink);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .eyebrow {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-4);
  }

  .muted {
    color: var(--ink-4);
  }

  .quiet {
    color: var(--ink-3);
  }

  button {
    font: inherit;
    color: inherit;
  }

  .btn {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 4px 9px;
    border: 1px solid var(--line);
    border-radius: 5px;
    background: var(--paper);
    cursor: pointer;
    color: var(--ink-2);
  }

  .btn:hover {
    background: var(--line-faint);
  }

  .pill {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--paper-sunken);
    color: var(--ink-3);
    white-space: nowrap;
  }

  .pill.blue {
    background: var(--blue-soft);
    color: var(--blue);
  }

  .pill.red {
    background: var(--red-soft);
    color: var(--red);
  }

  .pill.violet {
    background: var(--violet-soft);
    color: var(--violet);
  }

  .pill.green {
    background: var(--green-soft);
    color: var(--green);
  }

  .pill.amber {
    background: var(--amber-soft);
    color: var(--amber);
  }

  .raw {
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--paper-sunken);
    border: 1px solid var(--line);
    border-radius: 5px;
    padding: 9px 10px;
    color: var(--ink-2);
    margin: 0;
  }

  .edge-blue { --edge: var(--blue); }
  .edge-violet { --edge: var(--violet); }
  .edge-green { --edge: var(--green); }
  .edge-red { --edge: var(--red); }
  .edge-amber { --edge: var(--amber); }
  .edge-grey { --edge: var(--grey); }
  .edge-ink { --edge: var(--ink); }
`;

export type Edge = 'blue' | 'violet' | 'green' | 'red' | 'amber' | 'grey' | 'ink';
