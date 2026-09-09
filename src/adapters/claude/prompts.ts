/**
 * What a `user` line actually is. Claude Code writes four things on that line
 * type besides prompts and tool results: the interrupt marker, background task
 * notifications, the echoed output of a local slash command, and reminder
 * blocks. None of them is something the person typed, so none opens a turn.
 */
export type UserLineKind = 'prompt' | 'interrupt' | 'notification' | 'command-output';

/**
 * Strips the envelopes Claude Code wraps around a prompt before storing it, so
 * a label reads as what the user typed rather than as markup.
 */
export const stripPromptEnvelopes = (text: string): string => {
  let stripped = text;

  // A leading caveat block, then any reminder or IDE-context block anywhere.
  stripped = stripped.replace(/^Caveat:[\s\S]*?(?:\n\s*\n|$)/u, '');
  stripped = stripped.replace(
    /<(system-reminder|local-command-stdout|local-command-stderr|task-notification)>[\s\S]*?<\/\1>/gu,
    ''
  );

  // Slash-command envelopes: keep the argument if there is one, else the name.
  const commandArgs = /<command-args>([\s\S]*?)<\/command-args>/u.exec(stripped);
  const commandMessage = /<command-message>([\s\S]*?)<\/command-message>/u.exec(stripped);
  const commandName = /<command-name>([\s\S]*?)<\/command-name>/u.exec(stripped);
  if (commandArgs || commandMessage || commandName) {
    const argument = commandArgs?.[1]?.trim();
    const label = (commandMessage?.[1] ?? commandName?.[1] ?? '').trim();
    const rest = stripped.replace(/<\/?command-[a-z-]+>/gu, ' ').trim();
    stripped = argument ? `${label} ${argument}`.trim() : label || rest;
  }

  return stripped.replace(/\s+/gu, ' ').trim();
};

const INTERRUPT = /^\s*\[Request interrupted by user(?: for tool use)?\]\s*$/u;

export const userLineKind = (text: string): UserLineKind => {
  if (INTERRUPT.test(text)) return 'interrupt';
  if (/^\s*<task-notification>/u.test(text)) return 'notification';
  if (stripPromptEnvelopes(text) === '') return 'command-output';
  return 'prompt';
};

/** ANSI colour sequences, as a local command's echoed output carries them. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

/** The text inside the envelopes, for a mark row that is nothing but envelope. */
export const innerText = (text: string): string =>
  text
    .replace(
      /<\/?(system-reminder|local-command-stdout|local-command-stderr|task-notification|command-[a-z-]+)>/gu,
      ' '
    )
    .replace(ANSI, '')
    .replace(/\s+/gu, ' ')
    .trim();
