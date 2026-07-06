import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, test } from 'vitest';

import '../src/prism-app';
import type { PrismApp } from '../src/prism-app';

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8');

const markdownSession = [
  JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: 'Please format this'
    },
    uuid: 'user-1',
    timestamp: '2026-04-22T12:00:00.000Z',
    sessionId: 'markdown-session'
  }),
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Hello **world**\n\n- first item\n- second item'
        },
        {
          type: 'tool_use',
          id: 'toolu_markdown',
          name: 'Bash',
          input: {
            command: 'printf "**raw**"'
          }
        }
      ]
    },
    uuid: 'assistant-1',
    timestamp: '2026-04-22T12:00:01.000Z',
    sessionId: 'markdown-session'
  }),
  JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_markdown',
          content: '**tool output**',
          is_error: false
        }
      ]
    },
    uuid: 'tool-result-1',
    timestamp: '2026-04-22T12:00:02.000Z',
    sessionId: 'markdown-session'
  })
].join('\n');

const mountApp = async () => {
  const app = document.createElement('prism-app') as PrismApp;
  document.body.innerHTML = '';
  document.body.append(app);
  await app.updateComplete;
  return app;
};

const normalizeText = (text: string | null | undefined) =>
  (text ?? '').replace(/\s+/g, ' ').trim();

const findButtonByText = (
  root: ParentNode | null | undefined,
  label: string
) =>
  ([...(root?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]).find(
    button => normalizeText(button.textContent) === label
  ) as HTMLButtonElement;

const getTimelines = (app: PrismApp) =>
  [
    ...(app.shadowRoot?.querySelectorAll('prism-timeline') ?? [])
  ] as HTMLElement[];

const getTimeline = (app: PrismApp, index = 0) =>
  getTimelines(app)[index] as HTMLElement;

const getTimelineText = (timeline: Element | undefined | null) =>
  timeline instanceof HTMLElement
    ? (timeline.shadowRoot?.textContent ?? timeline.textContent ?? '')
    : '';

const getConversationContainers = (app: PrismApp) =>
  app.shadowRoot?.querySelectorAll('prism-timeline') ?? [];

const openActionsMenu = async (app: PrismApp) => {
  const button = app.shadowRoot?.querySelector(
    'button.action-toggle'
  ) as HTMLButtonElement;
  button.click();
  await app.updateComplete;
  return app.shadowRoot?.querySelector('.actions-menu') as HTMLElement;
};

const openPreferences = async (app: PrismApp) => {
  const button = app.shadowRoot?.querySelector(
    'button[aria-label="Preferences"]'
  ) as HTMLButtonElement;
  button.click();
  await app.updateComplete;
  return app.shadowRoot?.querySelector('prism-preference-panel') as HTMLElement;
};

const expandFocusMode = async (panel: HTMLElement) => {
  const toggle = panel.shadowRoot?.querySelector(
    'button.focus-toggle'
  ) as HTMLButtonElement;
  toggle.click();
  await (panel as HTMLElement & { updateComplete: Promise<unknown> })
    .updateComplete;
  return panel;
};

type FocusChipTestName = 'focusAuthor' | 'focusRecipient' | 'focusContentType';

const focusGroupTitleByName: Record<FocusChipTestName, string> = {
  focusAuthor: 'Author',
  focusRecipient: 'Recipient',
  focusContentType: 'Content type'
};

const getFocusGroup = (panel: HTMLElement, name: FocusChipTestName) =>
  ([
    ...(panel.shadowRoot?.querySelectorAll('.chip-group') ?? [])
  ] as HTMLElement[]).find(
    candidate =>
      normalizeText(candidate.querySelector('.chip-group-title')?.textContent) ===
      focusGroupTitleByName[name]
  );

const getFocusChip = (
  panel: HTMLElement,
  name: FocusChipTestName,
  value: string
) => {
  const group = getFocusGroup(panel, name);
  const chips = [
    ...(group?.querySelectorAll('button.focus-chip') ?? [])
  ] as HTMLButtonElement[];

  return chips.find(
    button => normalizeText(button.textContent) === value
  ) as HTMLButtonElement;
};

const getFocusChips = (panel: HTMLElement, name: FocusChipTestName) =>
  [
    ...(getFocusGroup(panel, name)?.querySelectorAll('button.focus-chip') ?? [])
  ] as HTMLButtonElement[];

const getSwitchByLabel = (panel: HTMLElement, label: string) => {
  const row = ([
    ...(panel.shadowRoot?.querySelectorAll('.toggle-row') ?? [])
  ] as HTMLElement[]).find(candidate =>
    normalizeText(candidate.textContent).includes(label)
  );
  return row?.querySelector('button[role="switch"]') as HTMLButtonElement;
};

const installTestLocalStorage = () => {
  const store = new Map<string, string>();
  const storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    }
  } satisfies Storage;

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage
  });
};

beforeEach(() => {
  installTestLocalStorage();
  localStorage.removeItem('prism-theme-mode');
  localStorage.removeItem('prism-theme-variant');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-dark-variant');
});

const clickFocusChip = async (
  panel: HTMLElement,
  chip: HTMLButtonElement,
  options?: { shiftKey?: boolean }
) => {
  chip.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      shiftKey: options?.shiftKey ?? false
    })
  );
  await (panel as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
};

const openShareMenu = async (app: PrismApp, index = 0) => {
  const timeline = getTimeline(app, index);
  const button = timeline.shadowRoot?.querySelector(
    'button[aria-label="Share"]'
  ) as HTMLButtonElement;
  button.click();
  await app.updateComplete;
  return getTimeline(app, index);
};

describe('prism-app', () => {
  test('preloads a mock session with a compact project overview', async () => {
    const app = await mountApp();

    const rootText = normalizeText(app.shadowRoot?.textContent);

    expect(rootText).toContain('Prism reads Claude Code JSONL sessions');
    expect(rootText).toContain('tracing the run');
    expect(rootText).toContain('Your files stay in the browser');
    expect(rootText).toContain('mock-session.jsonl');
    expect(getTimelines(app)).toHaveLength(1);
    expect(getTimelineText(getTimeline(app))).toContain('Review a Claude Code run');

    const loadSession = app.shadowRoot?.querySelector(
      'button[name="openLoadMenu"]'
    ) as HTMLButtonElement;
    loadSession.click();
    await app.updateComplete;

    expect(app.shadowRoot?.querySelector('.actions-menu')?.textContent ?? '').toContain(
      'Load local files'
    );
  });

  test('loads a Claude session JSONL and renders summary, timeline, and metadata', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'main-session.jsonl',
        text: fixture('main-session.jsonl')
      }
    ]);
    await app.updateComplete;
    await new Promise(resolve => setTimeout(resolve, 0));

    const rootText = app.shadowRoot?.textContent ?? '';
    const metadataPanel = app.shadowRoot?.querySelector(
      'prism-metadata-panel'
    ) as HTMLElement | null;
    const statusBar = app.shadowRoot?.querySelector('.status-bar') as HTMLElement | null;

    expect(rootText).toContain('Claude Session Viewer');
    expect(rootText).toContain('main-session.jsonl');
    expect(statusBar?.textContent ?? '').toContain('1');
    expect(statusBar?.textContent ?? '').toContain('conversations');
    expect(rootText).not.toContain('file staged');
    expect(
      app.shadowRoot?.querySelector('button.header-btn.load') as HTMLButtonElement
    ).toHaveProperty('disabled', true);
    expect(metadataPanel?.shadowRoot?.textContent ?? '').toContain('No metadata selected.');
  });

  test('keeps parent and subagent session files separate when sessionId matches', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'main-session.jsonl',
        text: fixture('main-session.jsonl')
      },
      {
        name: 'subagent-session.jsonl',
        text: fixture('subagent-session.jsonl')
      }
    ]);
    await app.updateComplete;
    await new Promise(resolve => setTimeout(resolve, 0));

    const containers = [...getConversationContainers(app)];

    expect(getTimelines(app)).toHaveLength(2);
    expect(containers).toHaveLength(2);
    expect(getTimelineText(containers[0])).toContain('main-session.jsonl');
    expect(getTimelineText(containers[1])).toContain('subagent-session.jsonl');
    expect(app.shadowRoot?.textContent ?? '').toContain('2');
    expect(app.shadowRoot?.textContent ?? '').toContain('conversations');
  });

  test('renders markdown from the conversation toolbar and keeps tool output raw', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'markdown-session.jsonl',
        text: markdownSession
      }
    ]);
    await app.updateComplete;
    await new Promise(resolve => setTimeout(resolve, 0));

    const timeline = getTimeline(app);
    const initialCards = timeline.shadowRoot?.querySelectorAll('prism-message-card') ?? [];
    const assistantCard = initialCards[1] as HTMLElement;
    const assistantText = assistantCard.shadowRoot?.querySelector(
      'prism-message-text'
    ) as HTMLElement | null;

    expect(assistantText?.shadowRoot?.innerHTML ?? '').not.toContain('<strong>world</strong>');
    expect(assistantText?.shadowRoot?.textContent ?? '').toContain('Hello **world**');

    const toggleMarkdown = timeline.shadowRoot?.querySelector(
      'button[name="toggleMarkdown"]'
    ) as HTMLButtonElement;
    toggleMarkdown.click();
    await app.updateComplete;
    await new Promise(resolve => setTimeout(resolve, 0));

    const updatedCards = timeline.shadowRoot?.querySelectorAll('prism-message-card') ?? [];
    const updatedAssistantCard = updatedCards[1] as HTMLElement;
    const updatedAssistantText = updatedAssistantCard.shadowRoot?.querySelector(
      'prism-message-text'
    ) as HTMLElement | null;
    const toolResultCard = [...updatedCards].find(
      card => card.getAttribute('data-channel') === 'tool_result'
    ) as HTMLElement | undefined;

    expect(updatedAssistantText?.shadowRoot?.innerHTML ?? '').toContain(
      '<strong>world</strong>'
    );
    expect(updatedAssistantText?.shadowRoot?.querySelectorAll('li').length).toBe(2);
    expect(toolResultCard?.shadowRoot?.querySelector('pre')?.textContent ?? '').toContain(
      '**tool output**'
    );
  });

  test('shows conversation actions and keeps translate as a placeholder action', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'main-session.jsonl',
        text: fixture('main-session.jsonl')
      }
    ]);
    await app.updateComplete;

    const timeline = getTimeline(app);
    const actionNames = [
      'toggleMarkdown',
      'toggleMetadata',
      'translateConversation'
    ];

    for (const actionName of actionNames) {
      expect(
        timeline.shadowRoot?.querySelector(`button[name="${actionName}"]`)
      ).not.toBeNull();
    }
    expect(
      timeline.shadowRoot?.querySelector('button[aria-label="Share"]')
    ).not.toBeNull();

    const actionsMenu = await openActionsMenu(app);
    expect(actionsMenu.textContent ?? '').toContain('Load local files');
    expect(actionsMenu.textContent ?? '').not.toContain('Preferences');

    await openShareMenu(app);
    const shareLabels = [
      'Copy shareable URL',
      'Copy conversation JSON',
      'Download',
      'Claude render view'
    ];

    for (const label of shareLabels) {
      expect(timeline.shadowRoot?.textContent ?? '').toContain(label);
    }

    const translateButton = timeline.shadowRoot?.querySelector(
      'button[name="translateConversation"]'
    ) as HTMLButtonElement;
    translateButton.click();
    await app.updateComplete;
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(timeline.shadowRoot?.textContent ?? '').toContain(
      'Translation API not configured'
    );
  });

  test('keeps file loading behind a persistent load button after staging files', async () => {
    const app = await mountApp();

    const actionsMenu = await openActionsMenu(app);
    const fileInput = actionsMenu.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const stagedFile = new File([fixture('main-session.jsonl')], 'main-session.jsonl', {
      type: 'application/json'
    });

    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [stagedFile]
    });

    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await app.updateComplete;
    await new Promise(resolve => setTimeout(resolve, 0));

    const rootTextBeforeLoad = app.shadowRoot?.textContent ?? '';
    expect(normalizeText(rootTextBeforeLoad)).toContain('1 file staged');
    expect(rootTextBeforeLoad).toContain('main-session.jsonl');
    expect(rootTextBeforeLoad).toContain('mock-session.jsonl');
    expect(getTimelineText(getTimeline(app))).toContain('Review a Claude Code run');

    const loadButton = app.shadowRoot?.querySelector(
      'button.header-btn.load'
    ) as HTMLButtonElement;
    expect(loadButton.disabled).toBe(false);

    loadButton.click();
    await app.updateComplete;
    await new Promise(resolve => setTimeout(resolve, 0));

    const rootTextAfterLoad = app.shadowRoot?.textContent ?? '';
    expect(rootTextAfterLoad).toContain('Claude session JSONL');
    expect(rootTextAfterLoad).toContain('main-session.jsonl');
    expect(rootTextAfterLoad).not.toContain('mock-session.jsonl');
    expect(rootTextAfterLoad).not.toContain('file staged');
  });

  test('opens preferences as a separate popover from the actions menu', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'main-session.jsonl',
        text: fixture('main-session.jsonl')
      }
    ]);
    await app.updateComplete;

    expect(app.shadowRoot?.querySelector('button.pref-toggle')).toBeNull();

    const actionsMenu = await openActionsMenu(app);
    expect(actionsMenu.querySelector('prism-preference-panel')).toBeNull();
    expect(actionsMenu.textContent ?? '').not.toContain('Preferences');

    const panel = await openPreferences(app);

    expect(panel).not.toBeNull();
    expect(app.shadowRoot?.querySelector('.actions-menu')).toBeNull();
    expect(panel.shadowRoot?.textContent ?? '').toContain('Message labels');
    expect(panel.shadowRoot?.textContent ?? '').toContain('Preferences');
  });

  test('persists theme mode and dark variant from preferences', async () => {
    const app = await mountApp();
    const panel = await openPreferences(app);

    expect(panel.shadowRoot?.textContent ?? '').toContain('Appearance');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.darkVariant).toBe('slate');

    const darkMode = findButtonByText(panel.shadowRoot, 'Dark');
    darkMode.click();
    await app.updateComplete;
    await panel.updateComplete;

    expect(localStorage.getItem('prism-theme-mode')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(panel.shadowRoot?.textContent ?? '').toContain(
      'Always uses dark'
    );

    const warmVariant = panel.shadowRoot?.querySelector(
      'button[data-variant="warm"]'
    ) as HTMLButtonElement;
    warmVariant.click();
    await app.updateComplete;
    await panel.updateComplete;

    expect(localStorage.getItem('prism-theme-variant')).toBe('warm');
    expect(document.documentElement.dataset.darkVariant).toBe('warm');
    expect(panel.shadowRoot?.textContent ?? '').toContain('Graphite Warm');

    const lightMode = findButtonByText(panel.shadowRoot, 'Light');
    lightMode.click();
    await app.updateComplete;
    await panel.updateComplete;

    const slateVariant = panel.shadowRoot?.querySelector(
      'button[data-variant="slate"]'
    ) as HTMLButtonElement;
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(slateVariant.disabled).toBe(true);
    expect(warmVariant.disabled).toBe(true);
    expect(panel.shadowRoot?.textContent ?? '').toContain(
      'Always uses the light theme. Dark variant is ignored.'
    );
  });

  test('keeps the preference popover open on outside click and closes on Escape', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'main-session.jsonl',
        text: fixture('main-session.jsonl')
      }
    ]);
    await app.updateComplete;

    expect(await openPreferences(app)).not.toBeNull();

    document.body.click();
    await app.updateComplete;

    expect(app.shadowRoot?.querySelector('prism-preference-panel')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await app.updateComplete;

    expect(app.shadowRoot?.querySelector('prism-preference-panel')).toBeNull();
  });

  test('closes the preference popover from its close button', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'main-session.jsonl',
        text: fixture('main-session.jsonl')
      }
    ]);
    await app.updateComplete;

    const panel = await openPreferences(app);
    const closeButton = panel.shadowRoot?.querySelector(
      'button.close-button'
    ) as HTMLButtonElement;

    closeButton.click();
    await app.updateComplete;

    expect(app.shadowRoot?.querySelector('prism-preference-panel')).toBeNull();
  });

  test('allows dragging the preference popover by its header', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'main-session.jsonl',
        text: fixture('main-session.jsonl')
      }
    ]);
    await app.updateComplete;

    const panel = await openPreferences(app);
    const header = panel.shadowRoot?.querySelector('.title-bar') as HTMLElement;
    const windowElement = panel.shadowRoot?.querySelector(
      '.window'
    ) as HTMLElement;
    const initialLeft = Number.parseInt(windowElement.style.left, 10);
    const initialTop = Number.parseInt(windowElement.style.top, 10);

    header.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        clientX: initialLeft + 20,
        clientY: initialTop + 30
      })
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: initialLeft - 25,
        clientY: initialTop + 90
      })
    );
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await panel.updateComplete;

    expect(windowElement.style.left).toBe(`${initialLeft - 45}px`);
    expect(windowElement.style.top).toBe(`${initialTop + 60}px`);
  });

  test('applies max message height modes from preferences to message cards', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'markdown-session.jsonl',
        text: markdownSession
      }
    ]);
    await app.updateComplete;

    const panel = await openPreferences(app);
    const noLimit = findButtonByText(panel.shadowRoot, 'No limit');
    noLimit.click();
    await app.updateComplete;

    const timeline = getTimeline(app);
    const card = timeline.shadowRoot?.querySelector(
      'prism-message-card'
    ) as HTMLElement & { maxMessageHeight?: string };

    expect(card.maxMessageHeight).toBe('none');

    const customMode = findButtonByText(panel.shadowRoot, 'Custom');
    customMode.click();
    await app.updateComplete;
    await panel.updateComplete;

    const maxMessageHeight = panel.shadowRoot?.querySelector(
      'input.num'
    ) as HTMLInputElement;
    maxMessageHeight.value = '300';
    maxMessageHeight.dispatchEvent(new Event('change', { bubbles: true }));
    await app.updateComplete;

    expect(card.maxMessageHeight).toBe('300px');
    expect(panel.shadowRoot?.textContent ?? '').toContain('px ·');
  });

  test('switches conversation layout between list and grid and syncs grid width to the URL', async () => {
    window.history.replaceState({}, '', '/');

    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'main-session.jsonl',
        text: fixture('main-session.jsonl')
      },
      {
        name: 'secondary-session.jsonl',
        text: fixture('secondary-session.jsonl')
      }
    ]);
    await app.updateComplete;

    const panel = await openPreferences(app);
    const gridMode = findButtonByText(panel.shadowRoot, 'Grid');
    gridMode.click();
    await app.updateComplete;
    await panel.updateComplete;

    const gridWidth = panel.shadowRoot?.querySelector(
      'input.num.narrow'
    ) as HTMLInputElement;
    gridWidth.value = '373';
    gridWidth.dispatchEvent(new Event('change', { bubbles: true }));
    await app.updateComplete;

    const conversationList = app.shadowRoot?.querySelector(
      '.conversation-list'
    ) as HTMLElement | null;
    const timelines = getTimelines(app);
    const containers = getConversationContainers(app);

    expect(timelines.length).toBe(2);
    expect(containers.length).toBe(2);
    expect(conversationList?.getAttribute('data-layout')).toBe('grid');
    expect(new URL(window.location.href).searchParams.get('grid')).toBe('373');

    const listMode = findButtonByText(panel.shadowRoot, 'List');
    listMode.click();
    await app.updateComplete;

    expect(conversationList?.getAttribute('data-layout')).toBe('list');
    expect(new URL(window.location.href).searchParams.get('grid')).toBeNull();
  });

  test('renders one full timeline per loaded jsonl file', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'main-session.jsonl',
        text: fixture('main-session.jsonl')
      },
      {
        name: 'secondary-session.jsonl',
        text: fixture('secondary-session.jsonl')
      }
    ]);
    await app.updateComplete;

    const containers = [...getConversationContainers(app)] as HTMLElement[];
    const timelines = getTimelines(app);

    expect(timelines).toHaveLength(2);
    expect(containers).toHaveLength(2);
    expect(getTimelineText(containers[0])).toContain('main-session.jsonl');
    expect(getTimelineText(containers[1])).toContain('secondary-session.jsonl');
  });

  test('keeps previously loaded conversations when loading another jsonl later', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'main-session.jsonl',
        text: fixture('main-session.jsonl')
      }
    ]);
    await app.updateComplete;

    await app.ingestFiles([
      {
        name: 'secondary-session.jsonl',
        text: fixture('secondary-session.jsonl')
      }
    ]);
    await app.updateComplete;

    const containers = [...getConversationContainers(app)] as HTMLElement[];
    const timelines = getTimelines(app);

    expect(timelines).toHaveLength(2);
    expect(containers).toHaveLength(2);
    expect(
      containers.some(container =>
        getTimelineText(container).includes('main-session.jsonl')
      )
    ).toBe(true);
    expect(
      containers.some(container =>
        getTimelineText(container).includes('secondary-session.jsonl')
      )
    ).toBe(true);
  });

  test('focus chips support include and exclude states with click and shift-click', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'main-session.jsonl',
        text: fixture('main-session.jsonl')
      }
    ]);
    await app.updateComplete;

    const panel = await expandFocusMode(await openPreferences(app));
    const assistant = getFocusChip(panel, 'focusAuthor', 'assistant');
    const thinking = getFocusChip(panel, 'focusContentType', 'thinking');

    await clickFocusChip(panel, assistant);
    expect(assistant.getAttribute('data-state')).toBe('include');

    await clickFocusChip(panel, thinking, { shiftKey: true });
    expect(thinking.getAttribute('data-state')).toBe('exclude');

    await clickFocusChip(panel, thinking, { shiftKey: true });
    expect(thinking.getAttribute('data-state')).toBe('neutral');

    expect(panel.shadowRoot?.textContent ?? '').toContain('filtered');
  });

  test('non-strict focus expands included messages and folds all non-included messages', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'main-session.jsonl',
        text: fixture('main-session.jsonl')
      }
    ]);
    await app.updateComplete;

    const panel = await expandFocusMode(await openPreferences(app));
    const assistant = getFocusChip(panel, 'focusAuthor', 'assistant');
    const thinking = getFocusChip(panel, 'focusContentType', 'thinking');
    await clickFocusChip(panel, assistant);
    await clickFocusChip(panel, thinking, { shiftKey: true });
    await new Promise(resolve => setTimeout(resolve, 0));

    const timeline = getTimeline(app);
    const visibleMessages = timeline.shadowRoot?.querySelectorAll(
      'prism-message-card[data-role]'
    );
    const foldedMessages = timeline.shadowRoot?.querySelectorAll(
      'prism-message-hidden'
    );
    const foldedThinking = [...(foldedMessages ?? [])].filter(
      node =>
        (node.shadowRoot?.textContent ?? '').includes('thinking') ||
        (node.shadowRoot?.textContent ?? '').includes('Show thinking message')
    );
    const visibleThinking = timeline.shadowRoot?.querySelectorAll(
      'prism-message-card[data-channel="thinking"]'
    );

    expect(
      [...(visibleMessages ?? [])].every(
        node => node.getAttribute('data-role') === 'assistant'
      )
    ).toBe(true);
    expect(foldedMessages && foldedMessages.length).toBeGreaterThan(0);
    expect(foldedThinking.length).toBeGreaterThan(0);
    expect(visibleThinking?.length ?? 0).toBe(0);
  });

  test('strict focus keeps only included messages after exclude rules are applied', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'main-session.jsonl',
        text: fixture('main-session.jsonl')
      }
    ]);
    await app.updateComplete;

    const panel = await expandFocusMode(await openPreferences(app));
    const assistant = getFocusChip(panel, 'focusAuthor', 'assistant');
    const thinking = getFocusChip(panel, 'focusContentType', 'thinking');
    await clickFocusChip(panel, assistant);
    await clickFocusChip(panel, thinking, { shiftKey: true });

    const strictFocus = getSwitchByLabel(panel, 'Strict focus');
    strictFocus.click();
    await app.updateComplete;
    await new Promise(resolve => setTimeout(resolve, 0));

    const timeline = getTimeline(app);
    const visibleMessages = timeline.shadowRoot?.querySelectorAll(
      'prism-message-card[data-role]'
    );
    const foldedMessages = timeline.shadowRoot?.querySelectorAll(
      'prism-message-hidden'
    );
    const visibleThinking = timeline.shadowRoot?.querySelectorAll(
      'prism-message-card[data-channel="thinking"]'
    );

    expect(visibleMessages && visibleMessages.length).toBeGreaterThan(0);
    expect(
      [...(visibleMessages ?? [])].every(
        node => node.getAttribute('data-role') === 'assistant'
      )
    ).toBe(true);
    expect(foldedMessages?.length ?? 0).toBe(0);
    expect(visibleThinking?.length ?? 0).toBe(0);
  });

  test('supports selecting multiple include values for a focus field', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'main-session.jsonl',
        text: fixture('main-session.jsonl')
      }
    ]);
    await app.updateComplete;

    const panel = await expandFocusMode(await openPreferences(app));
    const assistant = getFocusChip(panel, 'focusAuthor', 'assistant');
    const tool = getFocusChip(panel, 'focusAuthor', 'tool');
    await clickFocusChip(panel, assistant);
    await clickFocusChip(panel, tool);
    await new Promise(resolve => setTimeout(resolve, 0));

    const timeline = getTimeline(app);
    const messages = timeline.shadowRoot?.querySelectorAll(
      'prism-message-card[data-role]'
    );
    expect(messages && messages.length).toBeGreaterThan(0);
    expect(
      [...(messages ?? [])].every(
        node => ['assistant', 'tool'].includes(node.getAttribute('data-role') ?? '')
      )
    ).toBe(true);
  });

  test('filters by recipient from focus chips', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'subagent-session.jsonl',
        text: fixture('subagent-session.jsonl')
      }
    ]);
    await app.updateComplete;

    const panel = await expandFocusMode(await openPreferences(app));
    const bash = getFocusChip(panel, 'focusRecipient', 'Bash');
    await clickFocusChip(panel, bash);
    await new Promise(resolve => setTimeout(resolve, 0));

    const timeline = getTimeline(app);
    const messages = timeline.shadowRoot?.querySelectorAll(
      'prism-message-card[data-recipient]'
    );
    expect(messages && messages.length).toBeGreaterThan(0);
    expect(
      [...(messages ?? [])].every(
        node => node.getAttribute('data-recipient') === 'Bash'
      )
    ).toBe(true);
  });

  test('recipient focus chips hide internal UUID-like identifiers', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'main-session.jsonl',
        text: fixture('main-session.jsonl')
      }
    ]);
    await app.updateComplete;

    const panel = await expandFocusMode(await openPreferences(app));
    const recipientButtons = [
      ...getFocusChips(panel, 'focusRecipient')
    ];
    const values = recipientButtons.map(input => normalizeText(input.textContent));

    expect(values).toContain('Bash');
    expect(values).toContain('Grep');
    expect(
      values.some(value =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          value
        )
      )
    ).toBe(false);
  });

  test('updates the metadata panel when a message is selected from another conversation', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'main-session.jsonl',
        text: fixture('main-session.jsonl')
      },
      {
        name: 'secondary-session.jsonl',
        text: fixture('secondary-session.jsonl')
      }
    ]);
    await app.updateComplete;
    await new Promise(resolve => setTimeout(resolve, 0));

    const timeline = getTimeline(app, 1);
    const toggleMetadata = timeline.shadowRoot?.querySelector(
      'button[name="toggleMetadata"]'
    ) as HTMLButtonElement;
    toggleMetadata.click();
    await app.updateComplete;

    const firstMessage = timeline.shadowRoot?.querySelector(
      'prism-message-card'
    ) as HTMLElement;
    firstMessage.click();
    await app.updateComplete;
    await new Promise(resolve => setTimeout(resolve, 0));

    const metadataPanel = app.shadowRoot?.querySelector('prism-metadata-panel');
    expect(metadataPanel?.shadowRoot?.textContent ?? '').toContain(
      '73ce5455-964d-4bf0-9351-19d85151938c'
    );
    expect(metadataPanel?.shadowRoot?.textContent ?? '').toContain('"type"');
  });

  test('shows a structured meta summary prompt when only a meta file is loaded', async () => {
    const app = await mountApp();

    await app.ingestFiles([
      {
        name: 'subagent-session.meta.json',
        text: fixture('subagent-session.meta.json')
      }
    ]);
    await app.updateComplete;

    const rootText = app.shadowRoot?.textContent ?? '';

    expect(rootText).toContain('Meta Summary');
    expect(rootText).toContain('Need a paired JSONL to render the timeline');
    expect(rootText).toContain('general-purpose');
  });
});
