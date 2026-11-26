const postcss = require("postcss"), fs = require("fs");
const [src, namesFile, out] = process.argv.slice(2);
const names = new Set(JSON.parse(fs.readFileSync(namesFile, "utf8")).map((n) => "--" + n));
const root = postcss.parse(fs.readFileSync(src, "utf8"));
let stripped = 0, dup = 0;
const RETRO = /\[data-theme=("?)retro\1\]/;
root.walkRules((rule) => {
  const modern = /data-theme=("?)modern/.test(rule.selector);
  rule.walkDecls((d) => {
    if (!names.has(d.prop)) return;
    if (modern && d.prop === "--radius-modal") return; // tokens.json holds one radius per name
    d.remove(); stripped++;
  });
  // The page must grow with its content inside a preview frame.
  if (rule.selector === "body") rule.walkDecls(/^(overflow|min-height)$/, (d) => d.remove());
  if (rule.selector === "#root") { rule.remove(); return; }
  if (RETRO.test(rule.selector)) {
    rule.selectors = rule.selectors.flatMap((s) => RETRO.test(s) ? [s, s.replace(RETRO, '[data-theme="website"]')] : [s]); dup++;
  }
  if (rule.nodes && rule.nodes.length === 0) rule.remove();
});
const head = `/* Be Right Back component styles.
   Built from apps/desktop/src/styles/globals.css with Tailwind CSS v4 (vite build) by design-system/build.sh.
   Changes for the design system:
   - Custom properties that tokens.json declares are removed, so tokens.css is their one source.
   - body overflow and min-height and the #root rule are removed, so a preview frame can grow.
   - Each [data-theme="retro"] selector also matches [data-theme="website"].
   - The Website block below is added. Its values come from apps/website/src/app/globals.css. */
`;
const web = `
[data-theme="website"] {
  --font-display: var(--font-inter);
  --font-body: var(--font-inter);
  --font-mono: var(--font-jetbrains);
  --font-terminal: var(--primitive-font-vt323);
  --text-glow: 0 0 4px currentColor;
  --text-glow-strong: 0 0 6px currentColor;
  --box-glow: none;
  --shadow-glow: none;
}
`;
let css = head + root.toString() + web;
if (/<\/style/i.test(css)) throw new Error("style close tag in css");
fs.writeFileSync(out, css);
console.log("stripped", stripped, "retro selectors widened", dup, (css.length / 1024 | 0) + " KB");
