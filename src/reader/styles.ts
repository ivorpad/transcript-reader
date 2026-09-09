import { css } from 'lit';

/** Type and control styles shared by every reader element. */
export const sharedStyles = css`
  :host {
    font-family: var(--font-sans);
    font-size: var(--body-size);
    color: var(--ink);
  }

  .mono {
    font-family: var(--font-mono);
  }

  /* 16/20 Medium: the name of the thing on the page. */
  .title-text {
    font-size: var(--title-size);
    line-height: var(--title-line);
    font-weight: 500;
  }

  /* 13/16 Medium: captions, section heads, control text. */
  .eyebrow,
  .label {
    font-family: var(--font-sans);
    font-size: var(--label-size);
    line-height: var(--label-line);
    font-weight: 500;
    color: var(--ink-3);
  }

  .body {
    font-size: var(--body-size);
    line-height: 1.5;
    font-weight: 400;
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
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--button-height);
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: var(--button-radius);
    background: var(--paper);
    cursor: pointer;
    color: var(--ink);
    font-family: var(--font-sans);
    font-size: var(--label-size);
    line-height: var(--label-line);
    font-weight: 500;
    white-space: nowrap;
  }

  .btn:hover {
    background: var(--line-faint);
  }

  .pill {
    display: inline-flex;
    align-items: center;
    height: var(--badge-height);
    padding: 0 6px;
    border-radius: var(--badge-radius);
    background: var(--badge-fill);
    color: var(--badge-text);
    font-family: var(--font-sans);
    font-size: 12px;
    line-height: 1;
    font-weight: 500;
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
    background: var(--badge-fill);
    color: var(--badge-text);
  }

  .pill.amber {
    background: var(--amber-soft);
    color: var(--amber);
  }

  .raw {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--paper-sunken);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 9px 10px;
    color: var(--ink);
    margin: 0;
  }

  /* 24x14 track, 10px thumb. */
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: var(--label-size);
    line-height: var(--label-line);
    font-weight: 500;
    color: var(--ink);
  }

  .switch input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }

  .switch .track {
    position: relative;
    width: 24px;
    height: 14px;
    border-radius: 7px;
    background: var(--switch-off);
    transition: background 120ms ease;
    flex: 0 0 auto;
  }

  .switch .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ffffff;
    transition: left 120ms ease;
  }

  .switch input:checked + .track {
    background: var(--switch-track);
  }

  .switch input:checked + .track .thumb {
    left: 12px;
  }

  .switch input:focus-visible + .track {
    outline: 2px solid var(--switch-track);
    outline-offset: 2px;
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
