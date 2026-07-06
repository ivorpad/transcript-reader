---
name: verify
description: How to build, launch, and drive Prism (Lit + Vite Claude session viewer) to verify changes at its GUI surface.
---

# Verifying Prism

## Launch

```bash
npx vite --port 5199 --strictPort   # dev server, background
# headless Chrome for chrome-devtools MCP (needs port 9222):
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir=<scratch>/chrome-profile \
  --no-first-run --no-default-browser-check --headless=new about:blank
```

Then `mcp__chrome-devtools__new_page` → http://localhost:5199. The app
preloads a demo session (`mock-session.jsonl`, built in-memory in
src/prism-app.ts) — no fixture files needed.

## Driving the shadow DOM

Everything lives behind nested shadow roots; use `evaluate_script`:
`prism-app` → shadowRoot → `prism-timeline` → shadowRoot → `prism-message-card` /
`prism-message-hidden`. Await `el.updateComplete` after every click.

- Preferences panel: `button[aria-label="Preferences"]` (toggles — check if
  panel already open before clicking).
- Theme: `.mode-segmented .segment` buttons (Light/Dark/System),
  `button.variant-card[data-variant="slate"|"warm"]`. State lands on
  `document.documentElement.dataset.theme/darkVariant` and localStorage keys
  `prism-theme-mode` / `prism-theme-variant`.
- Focus Mode (produces `prism-message-hidden` stubs): expand via
  `button.focus-toggle`, click a `.chip-group` → `button.focus-chip`
  (e.g. Author → "user" hides all non-user messages).
- Share menu: `button[aria-label="Share"]` in the timeline toggles via a
  round-trip through prism-app state — await both app and timeline
  `updateComplete`; a second click closes it again.
- Panel drag: mousedown on `.title-bar`, mousemove/mouseup on `document`;
  position persists to `prism.preferencePanel.position`.

## Gotchas

- Demo session's tool_call message has role `assistant`; parser-produced
  tool_call messages have role `tool` (src/adapters/claude/parser.ts:349).
  Role-based CSS must handle both.
- `resize_page` may not shrink the headless window below ~756px; to test
  narrow-viewport branches, `Object.defineProperty(window, 'innerWidth', ...)`
  before dispatching events, then `delete window.innerWidth`.
- Headless Chrome defaults to dark `prefers-color-scheme`, so `system` mode
  resolves dark on first load.
