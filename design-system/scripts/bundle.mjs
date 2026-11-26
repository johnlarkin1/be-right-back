// Build components/bundle.js and the React copies in components/lib/.
// Usage: node scripts/bundle.mjs <output components dir>
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(HERE, "../src");
const APP = path.join(HERE, "../../apps/desktop");
const OUT = process.argv[2];
const require = createRequire(APP + "/package.json");
const esbuild = require("esbuild");
const reactVersion = require("react/package.json").version;

// Keep this list in step with src/entry.ts and project/components/index.d.ts.
const NAMES = ["Ghost", "ModeAwareMascot", "TopBar", "ThemeToggle", "Tooltip", "Accordion", "StepStatusIcon", "MarkdownRenderer",
  "MessageBubble", "TypingIndicator", "ChatInput", "PrivacyBadge", "CompactStatsBar", "ThinkingBlock", "ToolCallCard"];

const common = { bundle: true, format: "iife", minify: true, write: false, absWorkingDir: APP, nodePaths: [APP + "/node_modules"],
  target: "es2020", legalComments: "none", define: { "process.env.NODE_ENV": '"production"' } };

// The page loads scripts as classic scripts, so React comes from window globals.
const globals = { name: "react-globals", setup(b) {
  b.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "g" }));
  b.onResolve({ filter: /^react-dom(\/client)?$/ }, () => ({ path: "react-dom", namespace: "g" }));
  b.onLoad({ filter: /.*/, namespace: "g" }, (a) => ({ contents: `module.exports = window.${a.path === "react" ? "React" : "ReactDOM"};`, loader: "js" }));
}};
const app = { name: "app", setup(b) {
  b.onResolve({ filter: /stores\/themeStore$/ }, () => ({ path: SRC + "/themeStore.shim.ts" }));
  b.onResolve({ filter: /^@\// }, (a) => b.resolve("./src/" + a.path.slice(2), { resolveDir: APP, kind: a.kind }));
  b.onResolve({ filter: /^react\/jsx-(dev-)?runtime$/ }, () => ({ path: SRC + "/jsx-runtime.js" }));
}};
const safe = (js) => js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
const license = `/** @license React v${reactVersion}. MIT. Copyright (c) Meta Platforms, Inc. and affiliates. Built from node_modules by design-system/scripts/bundle.mjs. */\n`;

fs.mkdirSync(OUT + "/lib", { recursive: true });

const react = await esbuild.build({ ...common, stdin: { contents: 'window.React = require("react");', resolveDir: APP } });
fs.writeFileSync(OUT + "/lib/react.js", license + safe(react.outputFiles[0].text));

const dom = await esbuild.build({ ...common, plugins: [{ name: "react-only", setup(b) {
  b.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "g" }));
  b.onLoad({ filter: /.*/, namespace: "g" }, () => ({ contents: "module.exports = window.React;", loader: "js" }));
}}], stdin: { contents: 'window.ReactDOM = { ...require("react-dom"), ...require("react-dom/client") };', resolveDir: APP } });
fs.writeFileSync(OUT + "/lib/react-dom.js", license + safe(dom.outputFiles[0].text));

const r = await esbuild.build({ ...common, entryPoints: [SRC + "/entry.ts"], globalName: "BeRightBack", plugins: [app, globals], jsx: "automatic",
  metafile: true, define: { ...common.define, "import.meta.env.DEV": "false", "import.meta.env": "{}" } });
let js = r.outputFiles[0].text.replace(/^var BeRightBack=/, "window.BeRightBack=");
if (!js.startsWith("window.BeRightBack=")) throw new Error("unexpected bundle head: " + js.slice(0, 60));
const tauri = Object.keys(r.metafile.inputs).filter((k) => /@tauri-apps/.test(k));
if (tauri.length) throw new Error("the bundle pulls in Tauri, which cannot run in a browser: " + tauri[0]);
const head = `/* @ds-bundle: ${JSON.stringify({ format: 4, namespace: "BeRightBack", components: NAMES.map((name) => ({ name })) })} */\n`;
fs.writeFileSync(OUT + "/bundle.js", head + safe(js));
console.log(`bundle.js ${(js.length / 1024) | 0} KB, React ${reactVersion}`);
