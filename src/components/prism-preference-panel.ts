import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { PrismChannel, PrismRole } from '../types/prism';
import type { DarkVariant, ThemeMode } from '../utils/theme';
import { renderIcon } from '../utils/icons';

export type PrismMessageHeightMode = 'automatic' | 'no-limit' | 'custom';
export type PrismLayoutMode = 'list' | 'grid';
export type PrismFocusChipState = 'neutral' | 'include' | 'exclude';
export type PrismFocusFieldName = 'author' | 'recipient' | 'contentType';

export interface PrismFocusBucket<T extends string> {
  include: T[];
  exclude: T[];
}

export interface PrismFocusModeSettings {
  author: PrismFocusBucket<PrismRole>;
  recipient: PrismFocusBucket<string>;
  contentType: PrismFocusBucket<PrismChannel>;
  strictFocus: boolean;
}

export interface PrismViewSettings {
  showAbsoluteTimestamp: boolean;
  maxMessageHeightMode: PrismMessageHeightMode;
  customMaxMessageHeight: number;
  layoutMode: PrismLayoutMode;
  gridColumnWidth: number;
}

export const MIN_CUSTOM_MAX_MESSAGE_HEIGHT = 120;
export const MAX_CUSTOM_MAX_MESSAGE_HEIGHT = 3000;
export const DEFAULT_CUSTOM_MAX_MESSAGE_HEIGHT = 300;
export const MIN_GRID_COLUMN_WIDTH = 220;
export const MAX_GRID_COLUMN_WIDTH = 640;
export const DEFAULT_GRID_COLUMN_WIDTH = 373;

const POSITION_STORAGE_KEY = 'prism.preferencePanel.position';
const EDGE_SNAP_THRESHOLD = 24;
const EDGE_MARGIN = 16;
const PANEL_WIDTH = 520;

export const clampCustomMessageHeight = (value: number): number =>
  Math.max(
    MIN_CUSTOM_MAX_MESSAGE_HEIGHT,
    Math.min(MAX_CUSTOM_MAX_MESSAGE_HEIGHT, value)
  );

export const clampGridColumnWidth = (value: number): number =>
  Math.max(MIN_GRID_COLUMN_WIDTH, Math.min(MAX_GRID_COLUMN_WIDTH, value));

const createEmptyFocusBucket = <T extends string>(): PrismFocusBucket<T> => ({
  include: [],
  exclude: []
});

export const createDefaultFocusModeSettings = (): PrismFocusModeSettings => ({
  author: createEmptyFocusBucket<PrismRole>(),
  recipient: createEmptyFocusBucket<string>(),
  contentType: createEmptyFocusBucket<PrismChannel>(),
  strictFocus: false
});

export const createDefaultViewSettings = (): PrismViewSettings => ({
  showAbsoluteTimestamp: false,
  maxMessageHeightMode: 'automatic',
  customMaxMessageHeight: DEFAULT_CUSTOM_MAX_MESSAGE_HEIGHT,
  layoutMode: 'list',
  gridColumnWidth: DEFAULT_GRID_COLUMN_WIDTH
});

const getBucketState = <T extends string>(
  bucket: PrismFocusBucket<T>,
  value: T
): PrismFocusChipState => {
  if (bucket.include.includes(value)) return 'include';
  if (bucket.exclude.includes(value)) return 'exclude';
  return 'neutral';
};

interface PanelPosition {
  x: number;
  y: number;
}

const readStoredPosition = (): PanelPosition | null => {
  try {
    const raw = window.localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PanelPosition;
    if (
      typeof parsed?.x === 'number' &&
      typeof parsed?.y === 'number' &&
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y)
    ) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
};

const writeStoredPosition = (position: PanelPosition): void => {
  try {
    window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    /* ignore */
  }
};

const clampPosition = (position: PanelPosition): PanelPosition => {
  if (typeof window === 'undefined') {
    return position;
  }
  const maxX = Math.max(
    EDGE_MARGIN,
    window.innerWidth - PANEL_WIDTH - EDGE_MARGIN
  );
  const maxY = Math.max(EDGE_MARGIN, window.innerHeight - 80);
  return {
    x: Math.min(Math.max(EDGE_MARGIN, position.x), maxX),
    y: Math.min(Math.max(EDGE_MARGIN, position.y), maxY)
  };
};

const getDefaultPosition = (): PanelPosition => {
  if (typeof window === 'undefined') {
    return { x: 0, y: 64 };
  }
  return {
    x: Math.max(EDGE_MARGIN, window.innerWidth - PANEL_WIDTH - EDGE_MARGIN),
    y: 64
  };
};

@customElement('prism-preference-panel')
export class PrismPreferencePanel extends LitElement {
  @state()
  private position: PanelPosition = clampPosition(
    readStoredPosition() ?? getDefaultPosition()
  );

  @state()
  private isFocusModeOpen = false;

  @state()
  private isDragging = false;

  private dragPointerOffsetX = 0;
  private dragPointerOffsetY = 0;

  @property({ attribute: false })
  availableAuthors: PrismRole[] = [];

  @property({ attribute: false })
  availableRecipients: string[] = [];

  @property({ attribute: false })
  availableContentTypes: PrismChannel[] = [];

  @property({ attribute: false })
  settings: PrismFocusModeSettings = createDefaultFocusModeSettings();

  @property({ attribute: false })
  viewSettings: PrismViewSettings = createDefaultViewSettings();

  @property({ type: String })
  themeMode: ThemeMode = 'system';

  @property({ type: String })
  darkVariant: DarkVariant = 'slate';

  render() {
    return html`
      <div
        class="window ${this.isDragging ? 'dragging' : ''}"
        style=${`left: ${this.position.x}px; top: ${this.position.y}px;`}
        @click=${(event: Event) => event.stopPropagation()}
      >
        <div class="title-bar" @mousedown=${this.#handleDragStart}>
          <span class="title-left">
            <span class="grip" aria-hidden="true"
              >${renderIcon('GripVertical', { size: 12 })}</span
            >
            <span class="title">Preferences</span>
          </span>
          <button
            class="close-button"
            type="button"
            aria-label="Close preferences"
            title="Close (Esc)"
            @click=${this.#handleClose}
          >
            ${renderIcon('X', { size: 14 })}
          </button>
        </div>

        <div class="content">
          ${this.#renderAppearanceSection()}

          <div class="block">
            <div class="block-label">Max message height</div>
            ${this.#renderSegmented(
              this.viewSettings.maxMessageHeightMode,
              [
                { value: 'automatic', label: 'Auto' },
                { value: 'no-limit', label: 'No limit' },
                { value: 'custom', label: 'Custom' }
              ],
              value =>
                this.#emitViewSettings({
                  maxMessageHeightMode: value as PrismMessageHeightMode
                })
            )}
            ${this.viewSettings.maxMessageHeightMode === 'custom'
              ? html`
                  <div class="row">
                    <input
                      class="num"
                      type="number"
                      min=${MIN_CUSTOM_MAX_MESSAGE_HEIGHT}
                      max=${MAX_CUSTOM_MAX_MESSAGE_HEIGHT}
                      step="10"
                      .value=${String(this.viewSettings.customMaxMessageHeight)}
                      @change=${this.#handleCustomMessageHeightChange}
                    />
                    <span class="hint"
                      >px ·
                      ${MIN_CUSTOM_MAX_MESSAGE_HEIGHT}–${MAX_CUSTOM_MAX_MESSAGE_HEIGHT}</span
                    >
                  </div>
                `
              : null}
          </div>

          <div class="block">
            <div class="block-label">Layout</div>
            ${this.#renderSegmented(
              this.viewSettings.layoutMode,
              [
                { value: 'list', label: 'List' },
                { value: 'grid', label: 'Grid' }
              ],
              value =>
                this.#emitViewSettings({
                  layoutMode: value as PrismLayoutMode
                })
            )}
            ${this.viewSettings.layoutMode === 'grid'
              ? html`
                  <div class="row">
                    <span class="row-label">Column width</span>
                    <input
                      class="num narrow"
                      type="number"
                      min=${MIN_GRID_COLUMN_WIDTH}
                      max=${MAX_GRID_COLUMN_WIDTH}
                      step="1"
                      .value=${String(this.viewSettings.gridColumnWidth)}
                      @change=${this.#handleGridColumnWidthChange}
                    />
                    <span class="hint">px</span>
                  </div>
                `
              : null}
          </div>

          <div class="block">
            <div class="block-label">Message labels</div>
            ${this.#renderToggleRow(
              'Absolute timestamp',
              this.viewSettings.showAbsoluteTimestamp,
              next =>
                this.#emitViewSettings({ showAbsoluteTimestamp: next })
            )}
          </div>

          <div class="block focus-block">
            <button
              class="focus-toggle"
              type="button"
              @click=${this.#toggleFocusMode}
            >
              <span class="focus-toggle-left">
                <span
                  class="disclosure"
                  ?data-open=${this.isFocusModeOpen}
                  aria-hidden="true"
                  >${renderIcon('ChevronRight', { size: 12 })}</span
                >
                Focus mode
              </span>
              <span class="focus-state">${this.#getFocusStateLabel()}</span>
            </button>
            ${this.isFocusModeOpen
              ? html`
                  <div class="focus-content">
                    ${this.#renderToggleRow(
                      'Strict focus (hide unmatched)',
                      this.settings.strictFocus,
                      next => this.#emitFocusSettings({ strictFocus: next })
                    )}
                    <div class="hint">
                      Click to include · Shift+Click to exclude · Click again to
                      clear
                    </div>
                    ${this.#renderChipGroup(
                      'Author',
                      this.availableAuthors,
                      this.settings.author as PrismFocusBucket<string>,
                      'author'
                    )}
                    ${this.#renderChipGroup(
                      'Recipient',
                      this.availableRecipients,
                      this.settings.recipient,
                      'recipient',
                      'No recipients in this session'
                    )}
                    ${this.#renderChipGroup(
                      'Content type',
                      this.availableContentTypes,
                      this.settings.contentType as PrismFocusBucket<string>,
                      'contentType'
                    )}
                  </div>
                `
              : null}
          </div>
        </div>
      </div>
    `;
  }

  #renderSegmented(
    value: string,
    options: Array<{ value: string; label: string }>,
    onChange: (value: string) => void,
    className = ''
  ) {
    return html`
      <div class=${`segmented ${className}`}>
        ${options.map(option => {
          const active = option.value === value;
          return html`
            <button
              class="segment ${active ? 'active' : ''}"
              type="button"
              aria-pressed=${active}
              @click=${() => onChange(option.value)}
            >
              ${option.label}
            </button>
          `;
        })}
      </div>
    `;
  }

  #renderAppearanceSection() {
    const variantDisabled = this.themeMode === 'light';

    return html`
      <div class="block appearance-block">
        <div class="appearance-row">
          <div>
            <div class="appearance-title">Appearance</div>
            <div class="appearance-copy">Choose when the dark theme is shown.</div>
          </div>
          ${this.#renderSegmented(
            this.themeMode,
            [
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' }
            ],
            value => this.#emitThemeMode(value as ThemeMode),
            'mode-segmented'
          )}
        </div>

        <div class="variant-label-row">
          <span>Dark variant</span>
          ${variantDisabled
            ? html`<span class="variant-disabled-note"
                >not used in Light mode</span
              >`
            : null}
        </div>

        <div class="variant-grid">
          ${this.#renderThemeVariantCard({
            variant: 'slate',
            label: 'Slate',
            subcopy: 'Cool, neutral dark.',
            selected: !variantDisabled && this.darkVariant === 'slate',
            disabled: variantDisabled,
            swatches: [
              'var(--theme-slate-base)',
              'var(--theme-slate-raised)',
              'var(--theme-slate-text)',
              'var(--theme-slate-accent)'
            ]
          })}
          ${this.#renderThemeVariantCard({
            variant: 'warm',
            label: 'Graphite Warm',
            subcopy: 'Warm, low-contrast dark.',
            selected: !variantDisabled && this.darkVariant === 'warm',
            disabled: variantDisabled,
            swatches: [
              'var(--theme-warm-base)',
              'var(--theme-warm-raised)',
              'var(--theme-warm-text)',
              'var(--theme-warm-accent)'
            ]
          })}
        </div>

        <div class="theme-helper">${this.#getThemeHelperText()}</div>
      </div>
    `;
  }

  #renderThemeVariantCard(options: {
    variant: DarkVariant;
    label: string;
    subcopy: string;
    selected: boolean;
    disabled: boolean;
    swatches: [string, string, string, string];
  }) {
    const [base, raised, text, accent] = options.swatches;

    return html`
      <button
        class="variant-card ${options.selected ? 'selected' : ''}"
        type="button"
        data-variant=${options.variant}
        ?disabled=${options.disabled}
        aria-pressed=${options.selected}
        @click=${() => this.#emitDarkVariant(options.variant)}
      >
        <span
          class="variant-preview"
          style=${`--preview-base: ${base}; --preview-raised: ${raised}; --preview-text: ${text}; --preview-accent: ${accent};`}
          aria-hidden="true"
        >
          <span class="preview-base"></span>
          <span class="preview-raised">
            <span class="preview-line strong"></span>
            <span class="preview-line medium"></span>
            <span class="preview-line accent"></span>
          </span>
        </span>
        <span class="variant-meta">
          <span class="variant-copy">
            <span class="variant-name">${options.label}</span>
            <span class="variant-subcopy">${options.subcopy}</span>
          </span>
          <span class="variant-radio" aria-hidden="true">
            ${options.selected ? html`<span></span>` : null}
          </span>
        </span>
      </button>
    `;
  }

  #renderToggleRow(
    label: string,
    value: boolean,
    onChange: (next: boolean) => void
  ) {
    return html`
      <label class="toggle-row">
        <span>${label}</span>
        <button
          class="switch ${value ? 'on' : ''}"
          type="button"
          role="switch"
          aria-checked=${value}
          @click=${(event: Event) => {
            event.preventDefault();
            onChange(!value);
          }}
        >
          <span class="thumb"></span>
        </button>
      </label>
    `;
  }

  #renderChipGroup(
    title: string,
    values: string[],
    bucket: PrismFocusBucket<string>,
    field: PrismFocusFieldName,
    emptyHint?: string
  ) {
    return html`
      <div class="chip-group">
        <div class="chip-group-title">${title}</div>
        ${values.length === 0 && emptyHint
          ? html`<div class="hint">${emptyHint}</div>`
          : html`
              <div class="chip-row">
                ${values.map(value => {
                  const state = getBucketState(bucket, value);
                  return html`
                    <button
                      class="focus-chip"
                      type="button"
                      data-state=${state}
                      @click=${(event: MouseEvent) =>
                        this.#handleFocusChipClick(field, value, event.shiftKey)}
                    >
                      <span class="chip-symbol" aria-hidden="true">
                        ${state === 'include'
                          ? renderIcon('Check', { size: 10 })
                          : state === 'exclude'
                            ? renderIcon('Minus', { size: 10 })
                            : ''}
                      </span>
                      <span class="chip-label">${value}</span>
                    </button>
                  `;
                })}
              </div>
            `}
      </div>
    `;
  }

  #handleCustomMessageHeightChange = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const parsed = Number.parseInt(input.value, 10);
    const next = Number.isNaN(parsed)
      ? this.viewSettings.customMaxMessageHeight
      : clampCustomMessageHeight(parsed);
    input.value = String(next);
    this.#emitViewSettings({ customMaxMessageHeight: next });
  };

  #handleGridColumnWidthChange = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const parsed = Number.parseInt(input.value, 10);
    const next = Number.isNaN(parsed)
      ? this.viewSettings.gridColumnWidth
      : clampGridColumnWidth(parsed);
    input.value = String(next);
    this.#emitViewSettings({ gridColumnWidth: next });
  };

  #handleFocusChipClick = (
    field: PrismFocusFieldName,
    rawValue: string,
    shiftKey: boolean
  ) => {
    const currentState = getBucketState(
      this.settings[field] as PrismFocusBucket<string>,
      rawValue
    );
    const nextState = this.#getNextFocusChipState(currentState, shiftKey);
    const nextBucket = this.#setBucketState(
      this.settings[field] as PrismFocusBucket<string>,
      rawValue,
      nextState
    );
    this.#emitFocusSettings({
      [field]: nextBucket
    } as Partial<PrismFocusModeSettings>);
  };

  #getNextFocusChipState(
    currentState: PrismFocusChipState,
    shiftKey: boolean
  ): PrismFocusChipState {
    if (shiftKey) {
      return currentState === 'exclude' ? 'neutral' : 'exclude';
    }
    return currentState === 'include' ? 'neutral' : 'include';
  }

  #setBucketState<T extends string>(
    bucket: PrismFocusBucket<T>,
    value: T,
    nextState: PrismFocusChipState
  ): PrismFocusBucket<T> {
    const include = bucket.include.filter(item => item !== value);
    const exclude = bucket.exclude.filter(item => item !== value);
    if (nextState === 'include') include.push(value);
    else if (nextState === 'exclude') exclude.push(value);
    return { include, exclude };
  }

  #toggleFocusMode = () => {
    this.isFocusModeOpen = !this.isFocusModeOpen;
  };

  #emitThemeMode(mode: ThemeMode): void {
    this.themeMode = mode;
    this.dispatchEvent(
      new CustomEvent<ThemeMode>('prism-theme-mode-change', {
        detail: mode,
        bubbles: true,
        composed: true
      })
    );
  }

  #emitDarkVariant(variant: DarkVariant): void {
    this.darkVariant = variant;
    this.dispatchEvent(
      new CustomEvent<DarkVariant>('prism-theme-variant-change', {
        detail: variant,
        bubbles: true,
        composed: true
      })
    );
  }

  #getThemeHelperText(): string {
    const variantLabel =
      this.darkVariant === 'slate' ? 'Slate' : 'Graphite Warm';

    if (this.themeMode === 'light') {
      return 'Always uses the light theme. Dark variant is ignored.';
    }

    if (this.themeMode === 'dark') {
      return `Always uses dark — currently ${variantLabel}.`;
    }

    return `Follows your OS. When the OS is in dark mode, ${variantLabel} is used.`;
  }

  #getFocusStateLabel(): string {
    if (this.settings.strictFocus) {
      return 'strict';
    }
    const { author, recipient, contentType } = this.settings;
    const hasFilters =
      author.include.length +
        author.exclude.length +
        recipient.include.length +
        recipient.exclude.length +
        contentType.include.length +
        contentType.exclude.length >
      0;
    return hasFilters ? 'filtered' : 'off';
  }

  #handleClose = (event: Event) => {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('prism-request-close', {
        bubbles: true,
        composed: true
      })
    );
  };

  #handleDragStart = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, label')) {
      return;
    }
    event.preventDefault();
    this.isDragging = true;
    this.dragPointerOffsetX = event.clientX - this.position.x;
    this.dragPointerOffsetY = event.clientY - this.position.y;
    document.addEventListener('mousemove', this.#handleDragMove);
    document.addEventListener('mouseup', this.#handleDragEnd);
  };

  #handleDragMove = (event: MouseEvent) => {
    this.position = clampPosition({
      x: event.clientX - this.dragPointerOffsetX,
      y: event.clientY - this.dragPointerOffsetY
    });
  };

  #handleDragEnd = () => {
    if (this.isDragging) {
      const distFromRight =
        window.innerWidth - (this.position.x + PANEL_WIDTH);
      if (distFromRight >= 0 && distFromRight < EDGE_SNAP_THRESHOLD) {
        this.position = {
          x: Math.max(EDGE_MARGIN, window.innerWidth - PANEL_WIDTH - EDGE_MARGIN),
          y: this.position.y
        };
      }
      writeStoredPosition(this.position);
    }
    this.isDragging = false;
    document.removeEventListener('mousemove', this.#handleDragMove);
    document.removeEventListener('mouseup', this.#handleDragEnd);
  };

  #emitFocusSettings(partial: Partial<PrismFocusModeSettings>): void {
    const next: PrismFocusModeSettings = { ...this.settings, ...partial };
    this.settings = next;
    this.dispatchEvent(
      new CustomEvent<PrismFocusModeSettings>('prism-focus-mode-change', {
        detail: next,
        bubbles: true,
        composed: true
      })
    );
  }

  #emitViewSettings(partial: Partial<PrismViewSettings>): void {
    const next: PrismViewSettings = { ...this.viewSettings, ...partial };
    this.viewSettings = next;
    this.dispatchEvent(
      new CustomEvent<PrismViewSettings>('prism-view-settings-change', {
        detail: next,
        bubbles: true,
        composed: true
      })
    );
  }

  connectedCallback(): void {
    super.connectedCallback();
    // Re-clamp every time the panel mounts so a position saved on a wider
    // viewport doesn't leave the panel off-screen on a narrower one.
    this.position = clampPosition(this.position);
    window.addEventListener('resize', this.#handleResize);
  }

  disconnectedCallback(): void {
    this.#handleDragEnd();
    window.removeEventListener('resize', this.#handleResize);
    super.disconnectedCallback();
  }

  #handleResize = () => {
    this.position = clampPosition(this.position);
  };

  static styles = css`
    :host {
      display: block;
      position: fixed;
      z-index: 50;
      top: 0;
      left: 0;
      pointer-events: none;
    }

    .window {
      pointer-events: auto;
      position: absolute;
      width: ${PANEL_WIDTH}px;
      max-width: calc(100vw - ${EDGE_MARGIN * 2}px);
      max-height: calc(100vh - 80px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--surface-overlay);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      box-shadow: var(--shadow-menu);
      font-size: 12.5px;
    }

    .window.dragging {
      transition: none;
      cursor: grabbing;
    }

    /* ---- Title bar ---- */
    .title-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--surface-raised);
      cursor: grab;
      user-select: none;
    }

    .window.dragging .title-bar {
      cursor: grabbing;
    }

    .title-left {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .grip {
      display: inline-flex;
      color: var(--text-4);
    }

    .title {
      font-weight: 600;
      font-size: 13px;
      color: var(--text-1);
    }

    .close-button {
      all: unset;
      width: 22px;
      height: 22px;
      display: grid;
      place-items: center;
      border-radius: 5px;
      color: var(--text-3);
      cursor: pointer;
    }

    .close-button:hover {
      background: var(--surface-sunken);
      color: var(--text-1);
    }

    .close-button:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }

    /* ---- Content ---- */
    .content {
      padding: 4px 0;
      overflow-y: auto;
    }

    .block {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 12px;
      border-top: 1px solid var(--border-subtle);
    }

    .block:first-child {
      border-top: none;
    }

    .block-label {
      font-size: 10.5px;
      color: var(--text-3);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 500;
    }

    .appearance-block {
      gap: 12px;
      padding: 16px;
    }

    .appearance-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .appearance-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-1);
    }

    .appearance-copy {
      margin-top: 2px;
      font-size: 11.5px;
      line-height: 1.35;
      color: var(--text-3);
    }

    .variant-label-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      color: var(--text-3);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .variant-disabled-note {
      color: var(--text-4);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0;
      text-transform: none;
      white-space: nowrap;
    }

    .variant-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .variant-card {
      all: unset;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      background: var(--surface-base);
      cursor: pointer;
      transition: background 150ms ease, border-color 150ms ease,
        box-shadow 150ms ease, opacity 150ms ease;
    }

    .variant-card.selected {
      border-color: var(--accent);
      background: var(--accent-soft);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }

    .variant-card:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .variant-card:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }

    .variant-preview {
      display: flex;
      overflow: hidden;
      height: 56px;
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
    }

    .preview-base {
      flex: 2;
      background: var(--preview-base);
    }

    .preview-raised {
      flex: 1;
      border-left: 1px solid var(--border-subtle);
      background: var(--preview-raised);
    }

    .preview-line {
      display: block;
      height: 6px;
      margin: 6px 8px 0;
      border-radius: 2px;
      background: var(--preview-text);
    }

    .preview-line.strong {
      height: 10px;
      margin-top: 8px;
      opacity: 0.9;
    }

    .preview-line.medium {
      width: 60%;
      opacity: 0.5;
    }

    .preview-line.accent {
      width: 40%;
      background: var(--preview-accent);
    }

    .variant-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .variant-copy {
      display: grid;
      gap: 2px;
      min-width: 0;
    }

    .variant-name {
      color: var(--text-1);
      font-size: 13px;
      font-weight: 600;
    }

    .variant-subcopy {
      color: var(--text-3);
      font-size: 11.5px;
      line-height: 1.4;
    }

    .variant-radio {
      flex: none;
      width: 16px;
      height: 16px;
      display: grid;
      place-items: center;
      border: 1.5px solid var(--border-strong);
      border-radius: 999px;
    }

    .variant-card.selected .variant-radio {
      border-color: var(--accent);
      background: var(--accent);
    }

    .variant-radio span {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--surface-base);
    }

    .theme-helper {
      padding: 10px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      background: var(--surface-sunken);
      color: var(--text-2);
      font-size: 11.5px;
      line-height: 1.5;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .row-label {
      font-size: 11.5px;
      color: var(--text-2);
    }

    .hint {
      font-size: 11px;
      color: var(--text-3);
      line-height: 1.4;
    }

    .num {
      width: 80px;
      height: 26px;
      padding: 0 8px;
      border: 1px solid var(--border-strong);
      border-radius: 5px;
      font: inherit;
      font-size: 12px;
      color: var(--text-1);
      font-variant-numeric: tabular-nums;
      background: var(--surface-base);
      outline: none;
    }

    .num.narrow {
      width: 72px;
    }

    .num:focus-visible {
      border-color: var(--focus-ring);
    }

    /* ---- Segmented ---- */
    .segmented {
      display: inline-flex;
      gap: 2px;
      padding: 2px;
      border-radius: 6px;
      background: var(--surface-sunken);
      width: fit-content;
    }

    .segment {
      all: unset;
      box-sizing: border-box;
      padding: 4px 10px;
      border: 1px solid transparent;
      border-radius: 4px;
      font-size: 12px;
      color: var(--text-2);
      cursor: pointer;
      transition: background 100ms, color 100ms;
    }

    .segment:hover {
      color: var(--text-1);
    }

    .segment.active {
      background: var(--surface-base);
      color: var(--text-1);
      font-weight: 500;
      border: 1px solid var(--border-subtle);
      box-shadow: var(--shadow-low);
    }

    .mode-segmented {
      flex: none;
      padding: 3px;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
    }

    .mode-segmented .segment {
      padding: 5px 14px;
      border-radius: 6px;
      font-size: 12.5px;
      font-weight: 500;
      color: var(--text-3);
    }

    .mode-segmented .segment.active {
      color: var(--text-1);
      font-weight: 600;
    }

    /* ---- Toggle row ---- */
    .toggle-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      font-size: 12.5px;
      color: var(--text-2);
    }

    .switch {
      all: unset;
      box-sizing: border-box;
      width: 28px;
      height: 16px;
      border-radius: 999px;
      background: var(--border-strong);
      position: relative;
      cursor: pointer;
      transition: background 120ms ease;
    }

    .switch.on {
      background: var(--accent);
    }

    .thumb {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--surface-base);
      box-shadow: var(--shadow-low);
      transition: left 120ms ease;
    }

    .switch.on .thumb {
      left: 14px;
    }

    /* ---- Focus mode collapsible ---- */
    .focus-block {
      padding: 0;
    }

    .focus-toggle {
      all: unset;
      box-sizing: border-box;
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      padding: 10px 12px;
      cursor: pointer;
      font-size: 12.5px;
      font-weight: 500;
      color: var(--text-1);
    }

    .focus-toggle-left {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .disclosure {
      display: inline-flex;
      color: var(--text-3);
      transition: transform 120ms ease;
    }

    .disclosure[data-open] {
      transform: rotate(90deg);
    }

    .focus-state {
      font-size: 11px;
      color: var(--text-3);
      font-weight: 400;
    }

    .focus-content {
      padding: 0 12px 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .chip-group-title {
      font-size: 10.5px;
      color: var(--text-3);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 500;
      margin-bottom: 6px;
    }

    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .focus-chip {
      all: unset;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      color: var(--text-2);
      border: 1px solid var(--border-strong);
      background: var(--surface-base);
      cursor: pointer;
      max-width: 100%;
    }

    .chip-symbol {
      display: inline-flex;
      width: 10px;
      height: 10px;
      align-items: center;
      justify-content: center;
    }

    .chip-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .focus-chip[data-state='include'] {
      border-color: color-mix(in srgb, var(--accent) 35%, var(--surface-base));
      background: color-mix(in srgb, var(--accent) 10%, var(--surface-base));
      color: var(--accent);
    }

    .focus-chip[data-state='exclude'] {
      border-color: color-mix(in srgb, var(--danger) 35%, var(--surface-base));
      background: color-mix(in srgb, var(--danger) 9%, var(--surface-base));
      color: var(--danger);
    }

    .focus-chip:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'prism-preference-panel': PrismPreferencePanel;
  }
}
