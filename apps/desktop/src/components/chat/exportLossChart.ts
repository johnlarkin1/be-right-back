/**
 * Render the training loss chart to PNG bytes.
 *
 * Recharts draws an SVG whose colors are CSS variables. A standalone SVG
 * cannot resolve them, so the clone gets each element's computed colors
 * inlined. The legend is HTML, so it is drawn on the canvas directly.
 */

/** Presentation properties copied from the live chart into the clone. */
const STYLE_PROPS = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-opacity",
  "fill-opacity",
  "opacity",
  "font-size",
  "font-family",
] as const;

/** One legend entry drawn above the chart. */
export interface LegendEntry {
  label: string;
  value: string;
  color: string;
  dashed: boolean;
}

/** Copy computed styles onto a cloned SVG so it renders without the page CSS. */
function inlineStyles(source: SVGElement, clone: SVGElement) {
  const sources = [source, ...source.querySelectorAll<SVGElement>("*")];
  const clones = [clone, ...clone.querySelectorAll<SVGElement>("*")];
  sources.forEach((el, i) => {
    const target = clones[i];
    if (!target) return;
    const computed = getComputedStyle(el);
    for (const prop of STYLE_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (value) target.style.setProperty(prop, value);
    }
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not render the chart image"));
    img.src = url;
  });
}

/** Resolve a CSS color (including `var(...)`) against an element. */
export function resolveColor(el: Element, color: string): string {
  const probe = document.createElement("span");
  probe.style.color = color;
  el.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || color;
}

/**
 * Draw the figure's chart and legend to a PNG at 2x scale.
 * Throws when the figure holds no chart.
 */
export async function renderLossChartPng(
  figure: HTMLElement,
  legend: LegendEntry[],
  title: string,
): Promise<Uint8Array> {
  const svg = figure.querySelector<SVGSVGElement>("svg.recharts-surface");
  if (!svg) throw new Error("No chart to save yet");

  const { width, height } = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  const svgText = new XMLSerializer().serializeToString(clone);
  const image = await loadImage(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`,
  );

  const figureStyle = getComputedStyle(figure);
  const scale = 2;
  const pad = 16;
  const header = 32;
  const canvas = document.createElement("canvas");
  canvas.width = (width + pad * 2) * scale;
  canvas.height = (height + header + pad * 2) * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.scale(scale, scale);

  ctx.fillStyle = figureStyle.backgroundColor || "#0f172a";
  ctx.fillRect(0, 0, width + pad * 2, height + header + pad * 2);

  // Legend row: title, then a line sample, label and value per series.
  const font = figureStyle.fontFamily || "sans-serif";
  const muted = resolveColor(figure, "var(--color-text-muted)");
  const primary = resolveColor(figure, "var(--color-text-primary)");
  ctx.font = `12px ${font}`;
  ctx.textBaseline = "middle";
  const y = pad + 10;
  let x = pad;
  ctx.fillStyle = primary;
  ctx.fillText(title, x, y);
  x += ctx.measureText(title).width + 16;
  for (const entry of legend) {
    ctx.strokeStyle = resolveColor(figure, entry.color);
    ctx.lineWidth = 2;
    ctx.setLineDash(entry.dashed ? [4, 3] : []);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 16, y);
    ctx.stroke();
    x += 22;
    ctx.fillStyle = muted;
    ctx.fillText(entry.label, x, y);
    x += ctx.measureText(entry.label).width + 6;
    ctx.fillStyle = primary;
    ctx.fillText(entry.value, x, y);
    x += ctx.measureText(entry.value).width + 16;
  }
  ctx.setLineDash([]);

  ctx.drawImage(image, pad, pad + header, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Could not encode the chart image");
  return new Uint8Array(await blob.arrayBuffer());
}
