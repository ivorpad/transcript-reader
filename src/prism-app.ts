import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import {
  isClaudeSessionJSONL,
  parseClaudeMeta,
  parseClaudeSession
} from './adapters/claude/parser';
import './components/prism-metadata-panel';
import './components/prism-preference-panel';
import './components/prism-timeline';
import {
  clampGridColumnWidth,
  createDefaultFocusModeSettings,
  createDefaultViewSettings
} from './components/prism-preference-panel';
import {
  getMode,
  getVariant,
  initTheme,
  setMode,
  setVariant
} from './utils/theme';
import type {
  PrismFocusBucket,
  PrismFocusChipState,
  PrismFocusModeSettings,
  PrismViewSettings
} from './components/prism-preference-panel';
import type { DarkVariant, ThemeMode } from './utils/theme';
import type {
  ClaudeMetaSummary,
  ClaudeSessionParseResult,
  NormalizedConversation,
  NormalizedMessage,
  PrismChannel,
  PrismConversationAction,
  PrismRole
} from './types/prism';
import { renderIcon } from './utils/icons';

export interface LoadedTextFile {
  name: string;
  text: string;
}

const INTERNAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INTERNAL_TOOL_ID_PATTERN = /^toolu_[a-z0-9]+$/i;
type PrismFocusClassification = 'include' | 'neutral' | 'exclude';

interface LoadedConversationRecord {
  key: string;
  fileName: string;
  fileText: string;
  conversation: NormalizedConversation;
  parseResult: ClaudeSessionParseResult;
}

interface SelectedMessageRef {
  conversationKey: string;
  messageId: string;
}

interface ConversationActionStatus {
  conversationKey: string;
  message: string;
}

const DEMO_FILE_NAME = 'mock-session.jsonl';
const DEMO_SESSION_ID = 'prism-demo-session';

const createDemoRaw = (
  lineType: string,
  message: Record<string, unknown>
): Record<string, unknown> => ({
  type: lineType,
  sessionId: DEMO_SESSION_ID,
  timestamp: message.timestamp,
  ...message
});

const createDemoMessage = (
  id: string,
  role: PrismRole,
  channel: PrismChannel,
  text: string,
  options: Partial<NormalizedMessage> = {}
): NormalizedMessage => {
  const timestamp = options.timestamp ?? '2026-05-06T09:30:00.000Z';
  const raw = createDemoRaw(options.lineType ?? role, {
    uuid: id,
    timestamp,
    message: {
      role,
      content: text
    },
    name: options.name,
    recipient: options.recipient,
    isSidechain: options.isSidechain ?? false
  });

  return {
    id,
    role,
    channel,
    text,
    timestamp,
    lineType: options.lineType ?? role,
    uuid: id,
    sessionId: DEMO_SESSION_ID,
    name: options.name,
    recipient: options.recipient,
    isSidechain: options.isSidechain ?? false,
    parentUuid: options.parentUuid ?? null,
    toolUseId: options.toolUseId,
    raw,
    ...options
  };
};

const createDemoConversationRecord = (): LoadedConversationRecord => {
  const messages: NormalizedMessage[] = [
    createDemoMessage(
      'demo-user-1',
      'user',
      'message',
      'Review a Claude Code run and find the moments that changed the plan.'
    ),
    createDemoMessage(
      'demo-assistant-1',
      'assistant',
      'thinking',
      'Classify the transcript into user intent, tool work, and sidechain context.',
      {
        parentUuid: 'demo-user-1'
      }
    ),
    createDemoMessage(
      'demo-tool-call-1',
      'assistant',
      'tool_call',
      'rg -n "sessionId|sidechain|metadata" src tests',
      {
        name: 'Bash',
        recipient: 'Bash',
        parentUuid: 'demo-assistant-1',
        toolUseId: 'toolu_prism_demo'
      }
    ),
    createDemoMessage(
      'demo-tool-result-1',
      'tool',
      'tool_result',
      'Found parser, timeline, metadata panel, and focus-mode test coverage.',
      {
        parentUuid: 'demo-tool-call-1',
        toolUseId: 'toolu_prism_demo'
      }
    ),
    createDemoMessage(
      'demo-sidechain-1',
      'assistant',
      'message',
      'Sidechain note: keep the subagent branch visible, but let Focus Mode collapse it when the reviewer wants the main path.',
      {
        isSidechain: true,
        parentUuid: 'demo-tool-result-1'
      }
    ),
    createDemoMessage(
      'demo-event-1',
      'meta',
      'event',
      'turn_duration: 18.4s',
      {
        lineType: 'turn_duration',
        parentUuid: 'demo-sidechain-1'
      }
    ),
    createDemoMessage(
      'demo-assistant-2',
      'assistant',
      'message',
      'Prism highlights the timeline, raw metadata, markdown toggle, sidechain filter, focus controls, and export actions in one local browser surface.',
      {
        parentUuid: 'demo-event-1'
      }
    )
  ];

  const conversation: NormalizedConversation = {
    id: DEMO_SESSION_ID,
    source: 'claude-session',
    sessionId: DEMO_SESSION_ID,
    title: 'Review a Claude Code run',
    startedAt: '2026-05-06T09:30:00.000Z',
    messages,
    metadata: {
      demo: true,
      project: 'Prism',
      privacy: 'local browser parsing'
    }
  };

  const fileText = messages.map(message => JSON.stringify(message.raw)).join('\n');

  return {
    key: `${DEMO_FILE_NAME}:${DEMO_SESSION_ID}`,
    fileName: DEMO_FILE_NAME,
    fileText,
    conversation,
    parseResult: {
      conversation,
      stats: {
        totalMessages: messages.length,
        toolCalls: 1,
        toolResults: 1,
        eventMessages: 1,
        thinkingMessages: 1,
        summaryMessages: 0,
        fileSnapshots: 0,
        queueOperations: 0,
        progressEvents: 0,
        compactBoundaries: 0,
        branchPoints: 1,
        conversationBranchPoints: 0,
        progressForks: 0,
        titleEvents: 0,
        metadataEvents: 1,
        malformedLines: 0,
        hasSidechain: true,
        hasCompact: false,
        hasToolUseResult: true
      },
      warnings: []
    }
  };
};

@customElement('prism-app')
export class PrismApp extends LitElement {
  @state()
  private stagedFiles: LoadedTextFile[] = [];

  @state()
  private loadedFileNames: string[] = [DEMO_FILE_NAME];

  @state()
  private detectionLabel = 'Mock Claude session';

  @state()
  private loadedConversations: LoadedConversationRecord[] = [
    createDemoConversationRecord()
  ];

  @state()
  private showingDemoSession = true;

  @state()
  private selectedMessageRef: SelectedMessageRef | null = null;

  @state()
  private metaSummary: ClaudeMetaSummary | null = null;

  @state()
  private metaOnly = false;

  @state()
  private metadataConversationKey: string | null = null;

  @state()
  private showActionsMenu = false;

  @state()
  private showPreferencePanel = false;

  @state()
  private focusModeSettings: PrismFocusModeSettings =
    createDefaultFocusModeSettings();

  @state()
  private viewSettings: PrismViewSettings = createDefaultViewSettings();

  @state()
  private themeMode: ThemeMode = getMode();

  @state()
  private darkVariant: DarkVariant = getVariant();

  @state()
  private renderMarkdown = false;

  @state()
  private sidechainOnly = false;

  @state()
  private conversationActionStatus: ConversationActionStatus | null = null;

  @state()
  private shareMenuConversationKey: string | null = null;

  @state()
  private focusModeExemptedMessageKeys: string[] = [];

  // NEW: per-message manual fold (independent of Focus Mode).
  // Stored as a flat list of `${conversationKey}:${messageId}` strings.
  @state()
  private manuallyFoldedKeys: string[] = [];

  async ingestFiles(files: LoadedTextFile[]): Promise<void> {
    this.stagedFiles = [];
    this.focusModeSettings = createDefaultFocusModeSettings();
    this.renderMarkdown = false;
    this.sidechainOnly = false;
    this.conversationActionStatus = null;
    this.metadataConversationKey = null;
    this.shareMenuConversationKey = null;
    this.showActionsMenu = false;
    this.showPreferencePanel = false;

    const parsedMetaFiles = files
      .filter(file => file.name.endsWith('.meta.json'))
      .map(file => ({
        name: file.name,
        raw: this.#safeParseJSON(file.text)
      }))
      .filter(
        (file): file is { name: string; raw: Record<string, unknown> } =>
          file.raw !== null && typeof file.raw === 'object'
      );
    const parsedSessions = this.#parseConversationFiles(files, parsedMetaFiles);

    if (parsedSessions.length > 0) {
      const existingFileNames = this.showingDemoSession
        ? []
        : this.loadedFileNames;
      if (this.showingDemoSession) {
        this.loadedConversations = [];
      }
      this.loadedConversations = this.#mergeLoadedConversations(parsedSessions);
      this.loadedFileNames = [
        ...new Set([
          ...existingFileNames,
          ...files.map(file => file.name)
        ])
      ];
      this.showingDemoSession = false;
      this.#pruneMessageKeyState();
      this.metaSummary = null;
      this.selectedMessageRef = null;
      this.detectionLabel = 'Claude session JSONL';
      this.metaOnly = false;
      return;
    }

    this.loadedConversations = [];
    this.showingDemoSession = false;
    this.selectedMessageRef = null;
    this.metadataConversationKey = null;
    this.shareMenuConversationKey = null;
    this.#pruneMessageKeyState();
    this.loadedFileNames = files.map(file => file.name);
    this.metaSummary = parsedMetaFiles[0]
      ? parseClaudeMeta(parsedMetaFiles[0].raw)
      : null;

    if (this.metaSummary) {
      this.detectionLabel = 'Claude meta JSON';
      this.metaOnly = true;
      return;
    }

    this.metaOnly = false;
    this.detectionLabel = 'Unsupported input';
  }

  render() {
    const totalMessages = this.loadedConversations.reduce(
      (count, entry) => count + entry.parseResult.stats.totalMessages,
      0
    );
    const totalToolCalls = this.loadedConversations.reduce(
      (count, entry) => count + entry.parseResult.stats.toolCalls,
      0
    );
    const totalEvents = this.loadedConversations.reduce(
      (count, entry) => count + entry.parseResult.stats.eventMessages,
      0
    );
    const sidebarConversationRecord = this.#getSidebarConversationRecord();
    const sidebarConversation = sidebarConversationRecord?.conversation ?? null;
    const sidebarSelectedMessage =
      this.metadataConversationKey === null
        ? null
        : this.#getSelectedMessageForConversation(this.metadataConversationKey);

    const hasLoadedSession = this.loadedConversations.length > 0;
    const hasStagedFiles = this.stagedFiles.length > 0;
    const hasContent = hasLoadedSession || this.metaOnly;
    const showSidebar = this.metaOnly || this.metadataConversationKey !== null;

    return html`
      <div class="app">
        <header class="header">
          <div class="header-inner">
            <div class="brand">
              <span class="brand-name">Prism</span>
              <span class="brand-sub">Claude Session Viewer</span>
            </div>

            <div
              class="dropzone"
              @dragover=${this.#handleDragOver}
              @drop=${this.#handleDrop}
            >
              ${this.stagedFiles.length > 0
                ? html`<span class="dropzone-text staged"
                    ><span class="staged-count"
                      >${this.stagedFiles.length}</span
                    >
                    file${this.stagedFiles.length === 1 ? '' : 's'} staged:
                    ${this.stagedFiles.map(f => f.name).join(', ')}</span
                  >`
                : html`<span class="dropzone-text"
                    >Drop <code>.jsonl</code> files here, or use the menu</span
                  >`}
            </div>

            <button
              class="header-btn load"
              type="button"
              ?disabled=${this.stagedFiles.length === 0}
              @click=${this.#handleLoadStagedFiles}
            >
              Load
            </button>

            <button
              class="header-btn icon"
              type="button"
              aria-label="Preferences"
              title="Preferences"
              ?data-active=${this.showPreferencePanel}
              @click=${this.#handlePreferenceDetailsToggle}
            >
              ${renderIcon('Settings')}
            </button>

            <div class="menu-anchor">
              <button
                class="header-btn icon action-toggle"
                type="button"
                aria-label="Actions"
                title="Actions"
                aria-expanded=${this.showActionsMenu}
                ?data-active=${this.showActionsMenu}
                @click=${this.#handleActionsToggle}
              >
                ${renderIcon('MoreHorizontal')}
              </button>
              ${this.showActionsMenu
                ? html`
                    <div class="actions-menu" @click=${this.#stopPropagation}>
                      <label class="menu-item file-menu-item">
                        <input
                          type="file"
                          multiple
                          accept=".jsonl,.json,.meta.json"
                          @change=${this.#handleFileSelection}
                        />
                        <span class="menu-item-icon">${renderIcon('Upload')}</span>
                        <span>Load local files</span>
                      </label>
                    </div>
                  `
                : nothing}
            </div>

            ${this.showPreferencePanel
              ? html`
                  <prism-preference-panel
                    .availableAuthors=${this.#availableAuthors()}
                    .availableRecipients=${this.#availableRecipients()}
                    .availableContentTypes=${this.#availableContentTypes()}
                    .settings=${this.focusModeSettings}
                    .viewSettings=${this.viewSettings}
                    .themeMode=${this.themeMode}
                    .darkVariant=${this.darkVariant}
                    @prism-request-close=${this.#handlePreferenceClose}
                    @prism-focus-mode-change=${this.#handleFocusModeChange}
                    @prism-view-settings-change=${this.#handleViewSettingsChange}
                    @prism-theme-mode-change=${this.#handleThemeModeChange}
                    @prism-theme-variant-change=${this
                      .#handleThemeVariantChange}
                  ></prism-preference-panel>
                `
              : nothing}
          </div>
        </header>

        <div class="content ${showSidebar ? 'has-sidebar' : ''}">
          <section class="content-center">
            ${hasLoadedSession
              ? this.showingDemoSession
                ? this.#renderDemoOverview()
                : nothing
              : nothing}

            ${hasLoadedSession
              ? html`
                  <div class="status-bar">
                    <span class="status-file">
                      ${renderIcon('FileJson', { size: 14 })}
                      <span class="status-file-name"
                        >${this.loadedFileNames.join(', ')}</span
                      >
                    </span>
                    <span class="status-sep">·</span>
                    <span class="status-detect">${this.detectionLabel}</span>
                    <span class="status-sep">·</span>
                    <span class="metric"
                      ><strong>${this.loadedConversations.length}</strong>
                      conversations</span
                    >
                    <span class="metric"
                      ><strong>${totalMessages}</strong> messages</span
                    >
                    <span class="metric"
                      ><strong>${totalToolCalls}</strong> tool calls</span
                    >
                    <span class="metric"
                      ><strong>${totalEvents}</strong> events</span
                    >
                    <span class="status-spacer"></span>
                    <label class="sidechain-toggle">
                      <input
                        type="checkbox"
                        name="sidechainOnly"
                        .checked=${this.sidechainOnly}
                        @change=${this.#handleSidechainToggle}
                      />
                      <span>Only sidechain</span>
                    </label>
                  </div>
                  ${this.#hasActiveFocusFilters()
                    ? html`<div class="filter-summary">
                        ${this.#getFilterSummary()}
                      </div>`
                    : nothing}
                `
              : nothing}

            ${this.loadedConversations.length > 0
              ? html`
                  <div
                    class="conversation-list"
                    data-layout=${this.viewSettings.layoutMode}
                    style=${`--prism-grid-column-width: ${this.viewSettings.gridColumnWidth}px;`}
                  >
                    ${this.loadedConversations.map((entry, index) => {
                      const baseMessages = this.#getTimelineMessages(entry);
                      const timelineMessages = baseMessages.filter(
                        message => !this.#isMessageRemovedByFocusMode(message)
                      );
                      const hiddenMessageIds = timelineMessages
                        .filter(message =>
                          this.#isMessageHidden(entry.key, message)
                        )
                        .map(message => message.id);
                      const selectedMessageId =
                        this.selectedMessageRef?.conversationKey === entry.key
                          ? this.selectedMessageRef.messageId
                          : null;

                      return html`
                        <prism-timeline
                          id=${`conversation-${index}`}
                          .conversation=${entry.conversation}
                          .fileName=${entry.fileName}
                          .conversationIndex=${index}
                          .messages=${timelineMessages}
                          .hiddenMessageIds=${hiddenMessageIds}
                          .selectedMessageId=${selectedMessageId}
                          .renderMarkdown=${this.renderMarkdown}
                          .showAbsoluteTimestamp=${this.viewSettings
                            .showAbsoluteTimestamp}
                          .maxMessageHeight=${this.#resolveMaxMessageHeight()}
                          .actionStatus=${this.conversationActionStatus
                            ?.conversationKey === entry.key
                            ? this.conversationActionStatus.message
                            : null}
                          .showShareMenu=${this.shareMenuConversationKey ===
                          entry.key}
                          @prism-select-message=${(
                            event: CustomEvent<{ messageId: string }>
                          ) => this.#handleMessageSelect(entry.key, event)}
                          @prism-reveal-message=${(
                            event: CustomEvent<{ messageId: string }>
                          ) => this.#handleRevealMessage(entry.key, event)}
                          @prism-fold-message=${(
                            event: CustomEvent<{ messageId: string }>
                          ) => this.#handleFoldMessage(entry.key, event)}
                          @prism-conversation-action=${(
                            event: CustomEvent<PrismConversationAction>
                          ) =>
                            this.#handleConversationAction(entry.key, event)}
                        ></prism-timeline>
                      `;
                    })}
                  </div>
                `
              : nothing}

            ${!hasContent
              ? hasStagedFiles
                ? html`
                    <section class="empty-state">
                      <div class="empty-state-title">
                        ${this.stagedFiles.length} file${this.stagedFiles
                          .length === 1
                          ? ''
                          : 's'}
                        staged
                      </div>
                      <div class="empty-state-body">
                        Click <strong>Load</strong> in the header to parse and
                        render the conversation.
                      </div>
                    </section>
                  `
                : html`
                    <section class="empty-state">
                      <div class="empty-state-title">No session loaded</div>
                      <div class="empty-state-body">
                        Drop Claude Code <code>.jsonl</code> files into the
                        header, or choose files from the actions menu.
                      </div>
                    </section>
                  `
              : nothing}

            ${this.metaOnly
              ? html`
                  <section class="empty-state">
                    <div class="empty-state-title">Meta Summary</div>
                    <div class="empty-state-body">
                      Need a paired JSONL to render the timeline. Detected
                      agent: ${this.metaSummary?.agentType ?? 'unknown'}.
                    </div>
                  </section>
                `
              : nothing}
          </section>

          <aside class="content-right" ?is-hidden=${!showSidebar}>
            <prism-metadata-panel
              title=${this.metaOnly
                ? 'Meta Summary'
                : this.metadataConversationKey === null
                  ? 'Metadata'
                  : sidebarSelectedMessage
                    ? 'Metadata'
                    : 'Conversation Metadata'}
              .data=${this.metaOnly
                ? (this.metaSummary?.raw ?? null)
                : this.metadataConversationKey !== null
                  ? (sidebarSelectedMessage?.raw ??
                    sidebarConversation?.metadata ??
                    null)
                  : null}
              .conversation=${sidebarConversation}
              .stats=${sidebarConversationRecord?.parseResult.stats ?? null}
              .warnings=${sidebarConversationRecord?.parseResult.warnings ?? []}
            ></prism-metadata-panel>
          </aside>
        </div>
      </div>
    `;
  }

  #renderDemoOverview() {
    return html`
      <section class="demo-overview">
        <div class="demo-copy">
          <div class="demo-kicker">What this app does</div>
          <h1>Prism reads Claude Code JSONL sessions.</h1>
          <p>
            It turns local transcripts into a review surface for tracing the
            run, checking tool work, comparing sidechain branches, and opening
            raw metadata when the timeline is not enough.
          </p>
        </div>

        <div class="demo-actions">
          <button
            class="demo-load"
            name="openLoadMenu"
            type="button"
            @click=${this.#handleActionsToggle}
          >
            Load local files
          </button>
          <span>Your files stay in the browser.</span>
        </div>

      </section>
    `;
  }

  #parseConversationFiles(
    files: LoadedTextFile[],
    parsedMetaFiles: Array<{ name: string; raw: Record<string, unknown> }>
  ): LoadedConversationRecord[] {
    const parsedMetaByStem = new Map(
      parsedMetaFiles.map(file => [this.#baseFileName(file.name), file.raw])
    );
    const fallbackMeta =
      files.filter(file => file.name.endsWith('.jsonl')).length === 1 &&
      parsedMetaFiles.length === 1
        ? parsedMetaFiles[0]?.raw
        : undefined;

    return files
      .filter(file => file.name.endsWith('.jsonl'))
      .flatMap(file => {
        const sessionLines = this.#parseJSONLText(file.text);
        if (!isClaudeSessionJSONL(sessionLines)) {
          return [];
        }

        const matchedMeta =
          parsedMetaByStem.get(this.#baseFileName(file.name)) ?? fallbackMeta;
        const parseResult = parseClaudeSession(sessionLines, matchedMeta);
        if (!parseResult) {
          return [];
        }

        return [
          {
            key: this.#getConversationKey(file.name, parseResult.conversation),
            fileName: file.name,
            fileText: file.text,
            conversation: parseResult.conversation,
            parseResult
          }
        ];
      });
  }

  #parseJSONLText(text: string): unknown[] {
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return line;
        }
      });
  }

  #safeParseJSON(text: string): unknown {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  #baseFileName(name: string): string {
    return name.replace(/\.meta\.json$/u, '').replace(/\.jsonl$/u, '');
  }

  #getConversationKey(
    fileName: string,
    conversation: NormalizedConversation
  ): string {
    return `${fileName}:${conversation.sessionId ?? conversation.id}`;
  }

  #mergeLoadedConversations(
    incomingConversations: LoadedConversationRecord[]
  ): LoadedConversationRecord[] {
    const mergedConversations = [...this.loadedConversations];

    for (const incomingConversation of incomingConversations) {
      const existingIndex = mergedConversations.findIndex(
        conversation => conversation.key === incomingConversation.key
      );

      if (existingIndex === -1) {
        mergedConversations.push(incomingConversation);
        continue;
      }

      mergedConversations.splice(existingIndex, 1, incomingConversation);
    }

    return mergedConversations;
  }

  #getConversationRecord(
    conversationKey: string | null
  ): LoadedConversationRecord | null {
    if (!conversationKey) {
      return null;
    }

    return (
      this.loadedConversations.find(
        conversation => conversation.key === conversationKey
      ) ?? null
    );
  }

  #getSidebarConversationRecord(): LoadedConversationRecord | null {
    return (
      this.#getConversationRecord(this.metadataConversationKey) ??
      this.loadedConversations[0] ??
      null
    );
  }

  #getSelectedMessageForConversation(
    conversationKey: string
  ): NormalizedMessage | null {
    if (this.selectedMessageRef?.conversationKey !== conversationKey) {
      return null;
    }

    return (
      this.#getConversationRecord(conversationKey)?.conversation.messages.find(
        message => message.id === this.selectedMessageRef?.messageId
      ) ?? null
    );
  }

  #getMessageRefKey(conversationKey: string, messageId: string): string {
    return `${conversationKey}:${messageId}`;
  }

  #getTimelineMessages(
    conversationRecord: LoadedConversationRecord
  ): NormalizedMessage[] {
    return conversationRecord.conversation.messages.filter(message => {
      if (this.sidechainOnly && !message.isSidechain) {
        return false;
      }

      return true;
    });
  }

  // Drop fold/exemption keys whose conversation+message no longer exist.
  // Called after a successful merge so per-message UI state survives an
  // incremental ingest of unrelated sessions.
  #pruneMessageKeyState(): void {
    const valid = new Set(
      this.loadedConversations.flatMap(record =>
        record.conversation.messages.map(message =>
          this.#getMessageRefKey(record.key, message.id)
        )
      )
    );
    this.manuallyFoldedKeys = this.manuallyFoldedKeys.filter(key =>
      valid.has(key)
    );
    this.focusModeExemptedMessageKeys = this.focusModeExemptedMessageKeys.filter(
      key => valid.has(key)
    );
  }

  #hasActiveFocusFilters(): boolean {
    const { author, recipient, contentType } = this.focusModeSettings;
    return (
      author.include.length > 0 ||
      author.exclude.length > 0 ||
      recipient.include.length > 0 ||
      recipient.exclude.length > 0 ||
      contentType.include.length > 0 ||
      contentType.exclude.length > 0
    );
  }

  #hasActiveFocusIncludes(): boolean {
    const { author, recipient, contentType } = this.focusModeSettings;
    return (
      author.include.length > 0 ||
      recipient.include.length > 0 ||
      contentType.include.length > 0
    );
  }

  #matchesFocusValue<T extends string>(
    bucket: PrismFocusBucket<T>,
    value: string | undefined,
    state: Exclude<PrismFocusChipState, 'neutral'>
  ): boolean {
    if (!value) {
      return false;
    }

    return bucket[state].includes(value as T);
  }

  #matchesAllActiveIncludes(message: NormalizedMessage): boolean {
    const checks: boolean[] = [];
    const { author, recipient, contentType } = this.focusModeSettings;

    if (author.include.length > 0) {
      checks.push(author.include.includes(message.role));
    }
    if (recipient.include.length > 0) {
      checks.push(
        Boolean(
          message.recipient && recipient.include.includes(message.recipient)
        )
      );
    }
    if (contentType.include.length > 0) {
      checks.push(contentType.include.includes(message.channel));
    }

    return checks.every(Boolean);
  }

  #classifyMessageByFocusMode(
    message: NormalizedMessage
  ): PrismFocusClassification {
    if (!this.#hasActiveFocusFilters()) {
      return 'include';
    }

    const { author, recipient, contentType } = this.focusModeSettings;
    const isExcluded =
      author.exclude.includes(message.role) ||
      this.#matchesFocusValue(recipient, message.recipient, 'exclude') ||
      contentType.exclude.includes(message.channel);

    if (isExcluded) {
      return 'exclude';
    }

    if (!this.#hasActiveFocusIncludes()) {
      return 'include';
    }

    return this.#matchesAllActiveIncludes(message) ? 'include' : 'neutral';
  }

  #isMessageFoldedByFocusMode(
    conversationKey: string,
    message: NormalizedMessage
  ): boolean {
    if (this.focusModeSettings.strictFocus) {
      return false;
    }

    if (
      this.focusModeExemptedMessageKeys.includes(
        this.#getMessageRefKey(conversationKey, message.id)
      )
    ) {
      return false;
    }

    return this.#classifyMessageByFocusMode(message) !== 'include';
  }

  #isMessageManuallyFolded(
    conversationKey: string,
    message: NormalizedMessage
  ): boolean {
    return this.manuallyFoldedKeys.includes(
      this.#getMessageRefKey(conversationKey, message.id)
    );
  }

  // A message renders as a hidden stub if EITHER focus mode hides it
  // OR the user manually folded it.
  #isMessageHidden(
    conversationKey: string,
    message: NormalizedMessage
  ): boolean {
    return (
      this.#isMessageManuallyFolded(conversationKey, message) ||
      this.#isMessageFoldedByFocusMode(conversationKey, message)
    );
  }

  #isMessageRemovedByFocusMode(message: NormalizedMessage): boolean {
    const classification = this.#classifyMessageByFocusMode(message);

    if (this.focusModeSettings.strictFocus && classification !== 'include') {
      return true;
    }

    return false;
  }

  #availableAuthors(): PrismRole[] {
    return [
      ...new Set(
        this.loadedConversations.flatMap(entry =>
          entry.conversation.messages.map(message => message.role)
        )
      )
    ].sort();
  }

  #availableRecipients(): string[] {
    return [
      ...new Set(
        this.loadedConversations
          .flatMap(entry => entry.conversation.messages)
          .map(message => message.recipient)
          .filter((recipient): recipient is string => {
            if (typeof recipient !== 'string') {
              return false;
            }

            return (
              !INTERNAL_UUID_PATTERN.test(recipient) &&
              !INTERNAL_TOOL_ID_PATTERN.test(recipient)
            );
          }) ?? []
      )
    ].sort();
  }

  #availableContentTypes(): PrismChannel[] {
    return [
      ...new Set(
        this.loadedConversations.flatMap(entry =>
          entry.conversation.messages.map(message => message.channel)
        )
      )
    ].sort() as PrismChannel[];
  }

  #getFilterSummary(): string {
    const parts: string[] = [];
    const fieldSummaries: Array<[string, PrismFocusBucket<string>]> = [
      ['author', this.focusModeSettings.author as PrismFocusBucket<string>],
      [
        'recipient',
        this.focusModeSettings.recipient as PrismFocusBucket<string>
      ],
      ['type', this.focusModeSettings.contentType as PrismFocusBucket<string>]
    ];

    for (const [label, bucket] of fieldSummaries) {
      const includePart =
        bucket.include.length > 0 ? `+${bucket.include.join(', +')}` : '';
      const excludePart =
        bucket.exclude.length > 0 ? `-${bucket.exclude.join(', -')}` : '';
      const summary = [includePart, excludePart].filter(Boolean).join(', ');

      if (summary) {
        parts.push(`${label}: ${summary}`);
      }
    }

    if (this.focusModeSettings.strictFocus) {
      parts.push('strict');
    }
    if (parts.length === 0) {
      return 'No focus filters';
    }
    return parts.join(' • ');
  }

  async #handleFileSelection(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) {
      return;
    }

    const loadedFiles = await Promise.all(
      files.map(async file => ({
        name: file.name,
        text: await file.text()
      }))
    );

    this.#stageFiles(loadedFiles);
    input.value = '';
  }

  async #handleDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) {
      return;
    }

    const loadedFiles = await Promise.all(
      files.map(async file => ({
        name: file.name,
        text: await file.text()
      }))
    );

    this.#stageFiles(loadedFiles);
  }

  #handleDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  #handleSidechainToggle(event: Event): void {
    this.sidechainOnly = (event.target as HTMLInputElement).checked;
  }

  #handleActionsToggle(event: Event): void {
    event.stopPropagation();
    this.showActionsMenu = !this.showActionsMenu;
  }

  #handlePreferenceDetailsToggle(event: Event): void {
    event.stopPropagation();
    this.showPreferencePanel = !this.showPreferencePanel;
    this.showActionsMenu = false;
  }

  async #handleLoadStagedFiles(): Promise<void> {
    if (this.stagedFiles.length === 0) {
      return;
    }

    await this.ingestFiles(this.stagedFiles);
  }

  #handleDocumentClick = (event: MouseEvent): void => {
    const path = event.composedPath();
    const menu = this.renderRoot.querySelector('.actions-menu');
    const toggle = this.renderRoot.querySelector('.action-toggle');

    if (
      this.showActionsMenu &&
      !((menu && path.includes(menu)) || (toggle && path.includes(toggle)))
    ) {
      this.showActionsMenu = false;
    }

    // Close any open share menu when the click lands outside its anchor.
    if (
      this.shareMenuConversationKey !== null &&
      !path.some(
        node =>
          node instanceof HTMLElement &&
          node.classList?.contains('share-anchor')
      )
    ) {
      this.shareMenuConversationKey = null;
    }
  };

  #handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      if (this.showActionsMenu) {
        this.showActionsMenu = false;
      }
      if (this.showPreferencePanel) {
        this.showPreferencePanel = false;
      }
      if (this.shareMenuConversationKey !== null) {
        this.shareMenuConversationKey = null;
      }
    }
  };

  #stopPropagation(event: Event): void {
    event.stopPropagation();
  }

  #stageFiles(files: LoadedTextFile[]): void {
    this.stagedFiles = files;
    this.showActionsMenu = false;
    this.conversationActionStatus = null;
  }

  connectedCallback(): void {
    super.connectedCallback();
    initTheme();
    this.themeMode = getMode();
    this.darkVariant = getVariant();
    this.viewSettings = this.#readViewSettingsFromLocation();
    document.addEventListener('click', this.#handleDocumentClick);
    document.addEventListener('keydown', this.#handleKeydown);
  }

  disconnectedCallback(): void {
    document.removeEventListener('click', this.#handleDocumentClick);
    document.removeEventListener('keydown', this.#handleKeydown);
    super.disconnectedCallback();
  }

  #handleFocusModeChange(event: CustomEvent<PrismFocusModeSettings>): void {
    this.focusModeSettings = event.detail;
    this.focusModeExemptedMessageKeys = [];
  }

  #handleViewSettingsChange(event: CustomEvent<PrismViewSettings>): void {
    this.viewSettings = event.detail;
    this.#syncViewSettingsToLocation();
  }

  #handleThemeModeChange(event: CustomEvent<ThemeMode>): void {
    this.themeMode = event.detail;
    setMode(event.detail);
  }

  #handleThemeVariantChange(event: CustomEvent<DarkVariant>): void {
    this.darkVariant = event.detail;
    setVariant(event.detail);
  }

  #handlePreferenceClose(): void {
    this.showPreferencePanel = false;
  }

  #resolveMaxMessageHeight(): string {
    switch (this.viewSettings.maxMessageHeightMode) {
      case 'no-limit':
        return 'none';
      case 'custom':
        return `${this.viewSettings.customMaxMessageHeight}px`;
      case 'automatic':
      default:
        return '100vh';
    }
  }

  #readViewSettingsFromLocation(): PrismViewSettings {
    const nextSettings = createDefaultViewSettings();
    const gridParam = new URL(window.location.href).searchParams.get('grid');
    if (!gridParam) {
      return nextSettings;
    }

    const parsedGridWidth = Number.parseInt(gridParam, 10);
    if (Number.isNaN(parsedGridWidth)) {
      return nextSettings;
    }

    return {
      ...nextSettings,
      layoutMode: 'grid',
      gridColumnWidth: clampGridColumnWidth(parsedGridWidth)
    };
  }

  #syncViewSettingsToLocation(): void {
    const url = new URL(window.location.href);

    if (this.viewSettings.layoutMode === 'grid') {
      url.searchParams.set('grid', String(this.viewSettings.gridColumnWidth));
    } else {
      url.searchParams.delete('grid');
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, '', nextUrl || '/');
  }

  #handleMessageSelect(
    conversationKey: string,
    event: CustomEvent<{ messageId: string }>
  ): void {
    this.selectedMessageRef = {
      conversationKey,
      messageId: event.detail.messageId
    };
  }

  #handleRevealMessage(
    conversationKey: string,
    event: CustomEvent<{ messageId: string }>
  ): void {
    const refKey = this.#getMessageRefKey(
      conversationKey,
      event.detail.messageId
    );

    // If the message was hidden by focus mode, exempt it.
    this.focusModeExemptedMessageKeys = [
      ...new Set([...this.focusModeExemptedMessageKeys, refKey])
    ];
    // If the message was manually folded, unfold it.
    this.manuallyFoldedKeys = this.manuallyFoldedKeys.filter(
      key => key !== refKey
    );
  }

  // NEW: user clicked the chevron-up "fold" button on a message card.
  #handleFoldMessage(
    conversationKey: string,
    event: CustomEvent<{ messageId: string }>
  ): void {
    const refKey = this.#getMessageRefKey(
      conversationKey,
      event.detail.messageId
    );
    if (this.manuallyFoldedKeys.includes(refKey)) {
      return;
    }
    this.manuallyFoldedKeys = [...this.manuallyFoldedKeys, refKey];
  }

  async #handleConversationAction(
    conversationKey: string,
    event: CustomEvent<PrismConversationAction>
  ): Promise<void> {
    switch (event.detail) {
      case 'toggleMarkdown':
        this.renderMarkdown = !this.renderMarkdown;
        break;
      case 'toggleMetadata':
        if (this.metadataConversationKey === conversationKey) {
          this.metadataConversationKey = null;
        } else {
          this.metadataConversationKey = conversationKey;
        }
        if (this.selectedMessageRef?.conversationKey !== conversationKey) {
          this.selectedMessageRef = null;
        }
        break;
      case 'toggleShareMenu':
        this.shareMenuConversationKey =
          this.shareMenuConversationKey === conversationKey
            ? null
            : conversationKey;
        break;
      case 'translateConversation':
        this.#setConversationActionStatus(
          conversationKey,
          'Translation API not configured'
        );
        break;
      case 'copyShareableUrl':
        await this.#copyShareableUrl(conversationKey);
        this.shareMenuConversationKey = null;
        break;
      case 'copyConversationJson':
        await this.#copyConversationJson(conversationKey);
        this.shareMenuConversationKey = null;
        break;
      case 'downloadConversation':
        this.#downloadConversation(conversationKey);
        this.shareMenuConversationKey = null;
        break;
      case 'openRenderView':
        this.#openRenderView(conversationKey);
        this.shareMenuConversationKey = null;
        break;
      default:
        break;
    }
  }

  #setConversationActionStatus(
    conversationKey: string,
    message: string
  ): void {
    this.conversationActionStatus = { conversationKey, message };
  }

  async #copyShareableUrl(conversationKey: string): Promise<void> {
    const conversationRecord = this.#getConversationRecord(conversationKey);
    if (!conversationRecord) {
      return;
    }

    const shareableUrl = `${window.location.href.split('#')[0]}#session=${conversationRecord.conversation.sessionId ?? conversationRecord.conversation.id}`;
    await this.#writeToClipboard(
      shareableUrl,
      'Shareable URL copied',
      conversationKey
    );
  }

  async #copyConversationJson(conversationKey: string): Promise<void> {
    const conversationRecord = this.#getConversationRecord(conversationKey);
    if (!conversationRecord) {
      return;
    }

    await this.#writeToClipboard(
      JSON.stringify(conversationRecord.conversation, null, 2),
      'Conversation JSON copied',
      conversationKey
    );
  }

  #downloadConversation(conversationKey: string): void {
    const conversationRecord = this.#getConversationRecord(conversationKey);
    if (!conversationRecord) {
      return;
    }

    const fileContent =
      conversationRecord.fileText ??
      JSON.stringify(conversationRecord.conversation, null, 2);
    const extension = conversationRecord.fileText ? 'jsonl' : 'json';
    const blob = new Blob([fileContent], {
      type: 'application/json;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${conversationRecord.conversation.sessionId ?? conversationRecord.conversation.id}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.#setConversationActionStatus(
      conversationKey,
      'Conversation download started'
    );
  }

  #openRenderView(conversationKey: string): void {
    const conversationRecord = this.#getConversationRecord(conversationKey);
    if (!conversationRecord) {
      return;
    }

    // 'noopener' would make window.open return null; we need the handle to write into.
    const openedWindow = window.open('', '_blank');
    if (!openedWindow) {
      this.#setConversationActionStatus(
        conversationKey,
        'Unable to open Claude render view'
      );
      return;
    }

    const palette = this.#getRenderViewPalette();
    const transcript = this.#getTimelineMessages(conversationRecord)
      .map(message => {
        const heading = [
          message.role,
          message.channel,
          message.name ?? message.recipient ?? ''
        ]
          .filter(Boolean)
          .join(' · ');

        return `<section style="margin:0 0 16px;padding:12px;border:1px solid ${palette.borderSubtle};border-radius:8px;background:${palette.surfaceBase};">
          <div style="margin:0 0 8px;color:${palette.text3};font:12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${this.#escapeHtml(heading)}</div>
          <pre style="margin:0;white-space:pre-wrap;word-break:break-word;color:${palette.text2};font:13px/1.5 ui-monospace,'SFMono-Regular',monospace;">${this.#escapeHtml(message.text)}</pre>
        </section>`;
      })
      .join('');

    openedWindow.document.write(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Claude Render View</title>
  </head>
  <body style="margin:0;padding:24px;background:${palette.surfaceRaised};color:${palette.text1};font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <h1 style="margin:0 0 16px;font-size:20px;">${this.#escapeHtml(conversationRecord.conversation.title)}</h1>
    ${transcript}
  </body>
</html>`);
    openedWindow.document.close();
    this.#setConversationActionStatus(
      conversationKey,
      'Opened Claude render view'
    );
  }

  #getRenderViewPalette() {
    return {
      surfaceBase: this.#readCssToken('--surface-base', 'Canvas'),
      surfaceRaised: this.#readCssToken('--surface-raised', 'Canvas'),
      borderSubtle: this.#readCssToken('--border-subtle', 'ButtonBorder'),
      text1: this.#readCssToken('--text-1', 'CanvasText'),
      text2: this.#readCssToken('--text-2', 'CanvasText'),
      text3: this.#readCssToken('--text-3', 'GrayText')
    };
  }

  #readCssToken(name: string, fallback: string): string {
    return (
      getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
      fallback
    );
  }

  async #writeToClipboard(
    text: string,
    successMessage: string,
    conversationKey: string
  ): Promise<void> {
    if (!navigator.clipboard?.writeText) {
      this.#setConversationActionStatus(
        conversationKey,
        'Clipboard API unavailable in this environment'
      );
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      this.#setConversationActionStatus(conversationKey, successMessage);
    } catch {
      this.#setConversationActionStatus(
        conversationKey,
        'Clipboard write failed'
      );
    }
  }

  #escapeHtml(text: string): string {
    return text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  static styles = css`
    :host {
      display: block;
      height: 100%;
      color: var(--text-2);
    }

    .app {
      width: 100%;
      min-height: 100%;
      display: flex;
      flex-direction: column;
      background: var(--surface-base);
    }

    /* ---- Header: 48px single row, content centered to 1100px ---- */
    .header {
      position: sticky;
      top: 0;
      z-index: 10;
      width: 100%;
      height: var(--header-height, 48px);
      background: var(--surface-base);
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      justify-content: center;
    }

    .header-inner {
      position: relative;
      width: 100%;
      max-width: var(--shell-max-width, 1100px);
      height: 100%;
      padding: 0 20px;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .brand {
      display: flex;
      align-items: baseline;
      gap: 8px;
      flex-shrink: 0;
    }

    .brand-name {
      font-weight: 700;
      font-size: 15px;
      letter-spacing: -0.01em;
      color: var(--text-1);
    }

    .brand-sub {
      font-size: 11.5px;
      color: var(--text-3);
    }

    .dropzone {
      flex: 1;
      min-width: 0;
      height: 30px;
      display: flex;
      align-items: center;
      padding: 0 12px;
      border: 1px dashed var(--border-strong);
      border-radius: 8px;
      background: var(--surface-raised);
      color: var(--text-3);
      font-size: 12px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      transition: border-color 120ms ease;
    }

    .dropzone:hover {
      border-color: var(--text-4);
    }

    .dropzone-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dropzone-text code {
      font-size: 11px;
      color: var(--text-2);
    }

    .staged-count {
      color: var(--text-2);
      font-weight: 500;
    }

    .header-btn {
      all: unset;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 30px;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      background: var(--surface-base);
      cursor: pointer;
      flex-shrink: 0;
      transition: background 120ms ease, color 120ms ease,
        border-color 120ms ease;
    }

    .header-btn.load {
      padding: 0 14px;
      color: var(--text-2);
      font-size: 13px;
      font-weight: 500;
    }

    .header-btn.load:hover:not(:disabled) {
      background: var(--surface-raised);
    }

    .header-btn.load:disabled {
      background: var(--surface-raised);
      color: var(--text-4);
      cursor: not-allowed;
    }

    .header-btn.icon {
      width: 30px;
      color: var(--text-2);
    }

    .header-btn.icon:hover {
      background: var(--surface-raised);
      color: var(--text-1);
    }

    .header-btn.icon[data-active] {
      background: var(--surface-sunken);
      color: var(--text-1);
    }

    .header-btn:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }

    .menu-anchor {
      position: relative;
      flex-shrink: 0;
    }

    .actions-menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      z-index: 11;
      display: grid;
      gap: 2px;
      min-width: 220px;
      padding: 4px;
      border-radius: 8px;
      background: var(--surface-overlay);
      border: 1px solid var(--border-subtle);
      box-shadow: var(--shadow-menu);
    }

    .menu-item {
      all: unset;
      position: relative;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 10px;
      border-radius: 5px;
      color: var(--text-2);
      cursor: pointer;
      font-size: 13px;
    }

    .menu-item:hover {
      background: var(--surface-sunken);
    }

    .menu-item-icon {
      display: inline-flex;
      color: var(--text-2);
    }

    .file-menu-item input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }

    /* ---- Body shell ---- */
    .content {
      flex: 1;
      width: 100%;
      max-width: 1200px;
      margin: 0 auto;
      padding: 16px 20px 24px;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
    }

    .content.has-sidebar {
      grid-template-columns: minmax(0, 1fr) 340px;
    }

    .content-center {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .content-right {
      min-width: 0;
    }

    .content-right[is-hidden] {
      display: none;
    }

    /* ---- Status bar: thin inline row with · separators ---- */
    .status-bar {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      font-size: 11.5px;
      color: var(--text-3);
      padding-bottom: 10px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border-subtle);
    }

    .status-file {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .status-file-name {
      color: var(--text-2);
    }

    .status-sep {
      color: var(--text-4);
    }

    .status-detect {
      color: var(--text-2);
    }

    .metric {
      color: var(--text-3);
    }

    .metric strong {
      font-weight: 500;
      color: var(--text-1);
      font-variant-numeric: tabular-nums;
    }

    .status-spacer {
      flex: 1;
    }

    .sidechain-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }

    .sidechain-toggle input {
      accent-color: var(--accent);
      margin: 0;
    }

    .filter-summary {
      margin-bottom: 10px;
      color: var(--text-2);
      font-size: 12px;
    }

    /* ---- Conversation list ---- */
    .conversation-list {
      display: grid;
      gap: 16px;
      grid-template-columns: minmax(0, 1fr);
      align-items: start;
    }

    .conversation-list[data-layout='grid'] {
      grid-template-columns: repeat(
        auto-fill,
        minmax(min(100%, var(--prism-grid-column-width, 373px)), 1fr)
      );
    }

    /* ---- Empty state ---- */
    .empty-state {
      padding: 40px 24px;
      border-radius: var(--radius, 8px);
      border: 1px dashed var(--border-strong);
      background: var(--surface-base);
      text-align: center;
    }

    .empty-state-title {
      color: var(--text-1);
      font-weight: 500;
      margin-bottom: 4px;
    }

    .empty-state-body {
      color: var(--text-2);
      font-size: 13px;
    }

    .empty-state code {
      padding: 1px 5px;
      background: var(--surface-sunken);
      border-radius: 3px;
      font-size: 12px;
    }

    /* ---- Demo overview: compact product context above the mock session ---- */
    .demo-overview {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px 28px;
      padding: 2px 0 14px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border-subtle);
    }

    .demo-copy {
      min-width: 0;
    }

    .demo-kicker {
      margin-bottom: 5px;
      color: var(--text-3);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .demo-copy h1 {
      margin: 0;
      color: var(--text-1);
      font-size: 18px;
      line-height: 1.25;
      font-weight: 650;
      letter-spacing: 0;
    }

    .demo-copy p {
      margin: 6px 0 0;
      max-width: 760px;
      color: var(--text-2);
      font-size: 13px;
      line-height: 1.5;
    }

    .demo-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
      color: var(--text-3);
      font-size: 12px;
    }

    .demo-load {
      all: unset;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 30px;
      padding: 0 12px;
      border-radius: 7px;
      background: var(--text-1);
      color: var(--surface-base);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 120ms ease, transform 120ms ease;
    }

    .demo-load:hover {
      background: var(--text-2);
      transform: translateY(-1px);
    }

    .demo-load:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }


    @media (max-width: 980px) {
      .content {
        grid-template-columns: 1fr;
      }

      .demo-overview {
        grid-template-columns: 1fr;
      }

      .demo-actions {
        justify-content: flex-start;
      }

    }

    @media (max-width: 720px) {
      .header-inner,
      .content {
        width: calc(100vw - 16px);
      }

      .brand {
        display: none;
      }

      .status-row.metrics {
        gap: 12px;
      }

      .sidechain-toggle {
        margin-left: 0;
        flex-basis: 100%;
      }

      .demo-actions {
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
      }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'prism-app': PrismApp;
  }
}
