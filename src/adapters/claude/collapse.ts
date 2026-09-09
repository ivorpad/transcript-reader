import { classifyMessage, dispositionOfMessage } from './catalog';
import type { NormalizedMessage, Severity } from '../../types/reader';

const SEVERITY_ORDER: Severity[] = ['info', 'notice', 'warning', 'error'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The `toolUseID` an attachment names, when it names one. */
const scopedToolUseId = (message: NormalizedMessage): string | undefined => {
  const attachment = isRecord(message.raw.attachment) ? message.raw.attachment : null;
  const id = attachment?.toolUseID ?? message.raw.toolUseID;
  return typeof id === 'string' ? id : undefined;
};

const worst = (messages: NormalizedMessage[]): Severity => {
  let rank = 0;
  for (const message of messages) {
    const at = SEVERITY_ORDER.indexOf(message.severity ?? 'info');
    if (at > rank) rank = at;
  }
  return SEVERITY_ORDER[rank];
};

/**
 * Claude Code writes one assistant line per content block. A reasoning turn
 * arrives as an empty signature-only thinking block at `apiBlockIndex` 0 and,
 * when the API returns one, a summary at index 1 — two lines sharing a
 * requestId. Where the summary exists the empty block adds nothing, so it goes.
 *
 * Only that case. The ~86,000 empty blocks whose request has no summary keep
 * their row: it is the sole record that the model reasoned there, and dropping
 * it would erase the turn rather than de-duplicate it.
 */
const dropSupersededThinking = (
  messages: NormalizedMessage[]
): NormalizedMessage[] => {
  const requestsWithSummary = new Set<string>();
  for (const message of messages) {
    if (
      message.channel === 'thinking' &&
      message.thinkingTextStored === true &&
      message.requestId
    ) {
      requestsWithSummary.add(message.requestId);
    }
  }

  if (requestsWithSummary.size === 0) return messages;

  const superseded = (message: NormalizedMessage): boolean =>
    message.channel === 'thinking' &&
    message.thinkingTextStored === false &&
    message.requestId !== undefined &&
    requestsWithSummary.has(message.requestId);

  // Attach the superseded block to the summary that replaced it rather than
  // dropping it. A dropped line cannot be accounted for in the ledger, and a
  // ledger that does not reconcile is the reason to distrust everything above
  // it.
  const droppedByRequest = new Map<string, NormalizedMessage[]>();
  for (const message of messages) {
    if (!superseded(message)) continue;
    const existing = droppedByRequest.get(message.requestId as string);
    if (existing) existing.push(message);
    else droppedByRequest.set(message.requestId as string, [message]);
  }

  return messages.flatMap(message => {
    if (superseded(message)) return [];
    if (
      message.channel !== 'thinking' ||
      message.thinkingTextStored !== true ||
      !message.requestId
    ) {
      return [message];
    }

    const attached = droppedByRequest.get(message.requestId);
    if (!attached) return [message];

    return [
      {
        ...message,
        groupedMessages: [...attached, ...(message.groupedMessages ?? [])]
      }
    ];
  });
};

/**
 * Folds a consecutive run of same-kind drawn event rows into one. That is
 * what "repeats collapsed" means for an unknown type, and it keeps ten
 * identical marks from being ten lines. Conversational rows are never touched.
 */
const collapseEventRuns = (
  messages: NormalizedMessage[]
): NormalizedMessage[] => {
  const collapsed: NormalizedMessage[] = [];
  let at = 0;

  while (at < messages.length) {
    const head = messages[at];
    if (head.channel !== 'event' || !head.eventKind || head.groupCount) {
      collapsed.push(head);
      at++;
      continue;
    }

    let end = at + 1;
    while (
      end < messages.length &&
      messages[end].channel === 'event' &&
      messages[end].eventKind === head.eventKind &&
      !messages[end].groupCount
    ) {
      end++;
    }

    const run = messages.slice(at, end);
    if (run.length === 1) {
      collapsed.push(head);
    } else {
      const distinct = [...new Set(run.map(message => message.text))];
      const detail = distinct.length <= 3 ? ` · ${distinct.join(' · ')}` : '';
      collapsed.push({
        ...head,
        text: `${run.length} × ${head.name ?? head.eventKind}${detail}`,
        severity: worst(run),
        groupCount: run.length,
        groupedMessages: run,
        folded: run.flatMap(message => message.folded ?? [])
      });
    }
    at = end;
  }

  return collapsed;
};

export interface FoldResult {
  /** The rows drawn in sequence. */
  rows: NormalizedMessage[];
  /** Lines routed to a panel, or folded lines that found no row to attach to. */
  folded: NormalizedMessage[];
}

/**
 * Routes every line by its class. Conversational rows are drawn; an event is
 * drawn, folded onto a host row, or sent to a panel according to its
 * disposition. A folded line attaches to the tool call it names by toolUseID,
 * else to the line it was written under by parentUuid, else to the nearest
 * drawn row before it. Nothing is dropped: what is not drawn is in `folded`
 * or on a row's `folded` list, and the ledger sums both.
 */
export const foldByClass = (messages: NormalizedMessage[]): FoldResult => {
  const classified = dropSupersededThinking(messages).map(message => ({
    ...message,
    lineClass: classifyMessage(message),
    disposition: dispositionOfMessage(message)
  }));

  const drawsRow = (message: NormalizedMessage): boolean =>
    message.channel !== 'event' ||
    message.disposition === 'own-row' ||
    message.disposition === 'mark';

  // Hosts are resolved against the drawn rows, so they are known first.
  const ownerByToolUseId = new Map<string, string>();
  const rowIdByUuid = new Map<string, string>();
  for (const message of classified) {
    if (!drawsRow(message)) continue;
    if (message.toolUseId && message.channel === 'tool_call') {
      if (!ownerByToolUseId.has(message.toolUseId)) {
        ownerByToolUseId.set(message.toolUseId, message.id);
      }
    }
    if (message.uuid) rowIdByUuid.set(message.uuid, message.id);
  }

  const attached = new Map<string, NormalizedMessage[]>();
  const panel: NormalizedMessage[] = [];
  const drawn: NormalizedMessage[] = [];
  let previousRowId: string | undefined;

  const attach = (message: NormalizedMessage, hostId: string) => {
    const entry = { ...message, hostId };
    const existing = attached.get(hostId);
    if (existing) existing.push(entry);
    else attached.set(hostId, [entry]);
  };

  for (const message of classified) {
    if (drawsRow(message)) {
      drawn.push(message);
      previousRowId = message.id;
      continue;
    }

    if (message.disposition === 'panel') {
      panel.push(message);
      continue;
    }

    // disposition 'row': find the host.
    const toolUseId = scopedToolUseId(message);
    const hostId =
      (toolUseId ? ownerByToolUseId.get(toolUseId) : undefined) ??
      (message.parentUuid ? rowIdByUuid.get(message.parentUuid) : undefined) ??
      previousRowId;

    if (hostId) attach(message, hostId);
    else panel.push(message);
  }

  const rows = collapseEventRuns(
    drawn.map(message => {
      const folded = attached.get(message.id);
      return folded ? { ...message, folded } : message;
    })
  );

  return { rows, folded: panel };
};
