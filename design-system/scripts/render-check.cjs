// Render each preview in each theme with Playwright. Report errors and overflow.
// Usage: NODE_PATH=apps/desktop/node_modules node design-system/scripts/render-check.cjs [Component,Component]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const HERE = path.join(__dirname, "..");
const D = path.join(HERE, "dist/project/components");
const OUT = path.join(HERE, ".build/shots");
const only = process.argv[2] ? process.argv[2].split(",") : null;
const read = (p) => fs.readFileSync(p, "utf8");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const head = `<style>${read(HERE + "/.build/tokens.css")}</style><style>${read(D + "/bundle.css")}</style>` +
    ["lib/react.js", "lib/react-dom.js", "bundle.js"].map((f) => `<script>${read(D + "/" + f)}</script>`).join("");
  const comps = fs.readdirSync(D).filter((f) => fs.existsSync(`${D}/${f}/preview.html`) && (!only || only.includes(f)));
  const browser = await chromium.launch();
  let bad = 0;
  for (const theme of ["retro", "modern", "website"]) {
    for (const c of comps) {
      let html = read(`${D}/${c}/preview.html`);
      const marker = html.split("\n")[0];
      const height = +/height=(\d+)/.exec(marker)[1];
      const width = +(/width=(\d+)/.exec(marker) || [0, c === "Cover" ? 960 : 760])[1];
      html = html.replace("<html>", `<html data-theme="${theme}">`).replace("<style>", () => head + "<style>");
      const page = await browser.newPage({ viewport: { width, height } });
      const errs = [];
      page.on("console", (m) => m.type() === "error" && !/ERR_/.test(m.text()) && errs.push(m.text()));
      page.on("pageerror", (e) => errs.push(e.message));
      await page.setContent(html, { waitUntil: "load" });
      await page.waitForTimeout(700);
      const scroll = await page.evaluate(() => document.documentElement.scrollHeight);
      const nodes = await page.evaluate(() => document.body.querySelectorAll("*").length);
      if (errs.length || scroll > height || nodes < 4) {
        bad++;
        console.log(`${c} [${theme}] height ${scroll}/${height}, ${nodes} nodes. ${errs.join(" | ").slice(0, 300)}`);
      }
      await page.screenshot({ path: `${OUT}/${c}-${theme}.png` });
      await page.close();
    }
  }
  await browser.close();
  console.log(bad ? `${bad} previews need a look. Screenshots: ${OUT}` : `All previews render. Screenshots: ${OUT}`);
  process.exit(bad ? 1 : 0);
})();
