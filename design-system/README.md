# Design system producer

This folder builds the files of the Be Right Back design system.
The design system lives in a Claude artifact named "Be Right Back Design System".

## Build

To build the files, run:

```bash
make design-system
```

The build needs Node, Python 3 and the desktop app's npm dependencies. It installs the dependencies if they are missing.

The output goes to `design-system/dist/project/`. Git ignores it.

## What the build does

1. Copies `project/` to `dist/project/`. This is the hand-written content.
2. Runs `scripts/tokens.py`. It writes `tokens.json`.
3. Runs `vite build` in `apps/desktop`, then `scripts/css.cjs`. It writes `components/bundle.css`.
4. Runs `scripts/bundle.mjs`. It writes `components/bundle.js` and the React copies in `components/lib/`.

## What to edit

| To change | Edit |
| --- | --- |
| A component | The component in `apps/desktop/src`. Then rebuild. |
| The component list | `src/entry.ts`, the `NAMES` list in `scripts/bundle.mjs`, and `project/components/index.d.ts`. Add a `README.md` and a `preview.html` under `project/components/<Name>/`. |
| A token | The source CSS and `scripts/tokens.py`. The script warns when a primitive differs from `primitives.css`. |
| The brand book | `project/README.md` |
| A guideline or preview | `project/components/<Name>/` |

## Limits

- Only components with no Tauri calls can go in the bundle. The build fails if the bundle pulls in `@tauri-apps`.
- `src/themeStore.shim.ts` replaces the app's theme store. It follows `data-theme` and does not use localStorage.
- `tokens.py` is a hand-kept map. The build does not read semantic or website tokens from CSS.

## Check the previews

To render each preview in each theme, run:

```bash
node design-system/scripts/render-check.cjs
```

The check needs Playwright with a Chromium browser. It writes screenshots to `design-system/.build/shots/`.

## Publish

Claude Code publishes the files. In a session with this repository, ask:

> Run `make design-system` and publish `design-system/dist/project` to the Be Right Back design system artifact.

The artifact keeps its own index file (`design-system.json`) and the logo uploads. The build does not make them.
