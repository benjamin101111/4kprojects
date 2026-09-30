// scripts/snapshot.mjs
// Usage: node scripts/snapshot.mjs <url> <width> <outfile>
// Example: node scripts/snapshot.mjs https://4kprojects.com/about-us 1440 live-1440.json

import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const [, , url, widthArg, outFile] = process.argv;

if (!url || !widthArg || !outFile) {
  console.error('Usage: node scripts/snapshot.mjs <url> <width> <outfile>');
  process.exit(1);
}

const width = Number(widthArg);

// Everything we compare. Add props here and both sides pick them up.
const PROPS = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
  'letterSpacing', 'wordSpacing', 'textAlign', 'textTransform',
  'textDecorationLine', 'textIndent', 'whiteSpace',
  'color', 'backgroundColor', 'backgroundImage', 'opacity',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'borderTopStyle', 'borderRadius',
  'display', 'position', 'top', 'right', 'bottom', 'left',
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'gap',
  'rowGap', 'columnGap',
  'gridTemplateColumns', 'gridTemplateRows',
  'overflow', 'overflowX', 'overflowY',
  'zIndex', 'transform', 'boxShadow',
  'objectFit', 'objectPosition', 'aspectRatio',
  'visibility', 'pointerEvents',
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width, height: 900 },
  deviceScaleFactor: 1,
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

// Let fonts settle — this is the #1 source of false diffs.
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);

// Scroll the whole page so lazy content loads, then back to top.
await page.evaluate(async () => {
  const step = window.innerHeight;
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise(r => setTimeout(r, 120));
  }
  window.scrollTo(0, 0);
});
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);

const data = await page.evaluate((PROPS) => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // Build a stable, human-readable path for each element.
  function path(el) {
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      let idx = 1;
      if (parent) {
        let sib = node.previousElementSibling;
        while (sib) {
          if (sib.tagName === node.tagName) idx++;
          sib = sib.previousElementSibling;
        }
      }
      parts.unshift(`${tag}:nth-of-type(${idx})`);
      node = parent;
      depth++;
    }
    return parts.join(' > ');
  }

  // Only elements with direct visible text are interesting for text diffing.
  // But we ALSO snapshot layout containers (nav, header, footer, section,
  // grid wrappers) so padding/gap regressions surface.
  const CONTAINER_TAGS = new Set([
    'header', 'nav', 'main', 'section', 'footer', 'article',
    'ul', 'ol', 'li', 'div',
  ]);

  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);

    // Skip truly invisible things — they just create noise.
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (Number(cs.opacity) === 0) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    const directText = [...el.childNodes]
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent)
      .join(' ');
    const text = clean(directText);

    const tag = el.tagName.toLowerCase();
    const isContainer = CONTAINER_TAGS.has(tag);
    const isTextEl = text.length >= 2;

    // Keep text nodes, and containers that have non-trivial box styles.
    if (!isTextEl && !isContainer) continue;

    const style = {};
    for (const p of PROPS) style[p] = cs[p];

    out.push({
      key: path(el) + '|' + (text || '').slice(0, 40),
      tag,
      text: text.slice(0, 120),
      box: {
        x: Math.round(rect.x * 10) / 10,
        y: Math.round(rect.y * 10) / 10,
        w: Math.round(rect.width * 10) / 10,
        h: Math.round(rect.height * 10) / 10,
      },
      style,
    });
  }
  return out;
}, PROPS);

await fs.writeFile(outFile, JSON.stringify({ url, width, elements: data }, null, 2));
console.log(`Wrote ${data.length} elements to ${outFile}`);
await browser.close();