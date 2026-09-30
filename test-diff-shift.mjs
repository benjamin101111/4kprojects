// diagnose-all.mjs
import fs from 'fs';
import { PNG } from 'pngjs';

const VIEWPORTS = [1440, 1200, 810, 390];

// Expected section markers by test viewport
const SECTION_DEFS = {
  1440: [
    { name: '1. Hero', start: 0, end: 528 },
    { name: '2. Work Slider', start: 528, end: 1774 },
    { name: '3. Our Story', start: 1774, end: 2475 },
    { name: '4. The 4K Team', start: 2475, end: 4401 },
    { name: '5. FAQ Section', start: 4401, end: 5153 },
    { name: '6. Footer', start: 5153, end: null }
  ],
  1200: [
    { name: '1. Hero', start: 0, end: 528 },
    { name: '2. Work Slider', start: 528, end: 1525 },
    { name: '3. Our Story', start: 1525, end: 2225 },
    { name: '4. The 4K Team', start: 2225, end: 4151 },
    { name: '5. FAQ Section', start: 4151, end: 4900 },
    { name: '6. Footer', start: 4900, end: null }
  ],
  810: [
    { name: '1. Hero', start: 0, end: 550 },
    { name: '2. Work Slider', start: 550, end: 1223 },
    { name: '3. Our Story', start: 1223, end: 2000 },
    { name: '4. The 4K Team', start: 2000, end: 4700 },
    { name: '5. FAQ Section', start: 4700, end: 5500 },
    { name: '6. Footer', start: 5500, end: null }
  ],
  390: [
    { name: '1. Hero', start: 0, end: 600 },
    { name: '2. Work Slider', start: 600, end: 1098 },
    { name: '3. Our Story', start: 1098, end: 2100 },
    { name: '4. The 4K Team', start: 2100, end: 6700 },
    { name: '5. FAQ Section', start: 6700, end: 7700 },
    { name: '6. Footer', start: 7700, end: null }
  ]
};

function isPixelRedOrYellow(r, g, b) {
  // Pixelmatch diff markers (pure red or AA yellow)
  return (r === 255 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 0);
}

function analyzeViewport(width) {
  const diffPath = `./diff-results/diff-${width}.png`;
  const livePath = `./diff-results/live-${width}.png`;
  const localPath = `./diff-results/local-${width}.png`;

  if (!fs.existsSync(diffPath) || !fs.existsSync(livePath) || !fs.existsSync(localPath)) {
    console.log(`⚠️ Missing screenshots for ${width}px. Run node test-diff.mjs first.`);
    return;
  }

  const diff = PNG.sync.read(fs.readFileSync(diffPath));
  const live = PNG.sync.read(fs.readFileSync(livePath));
  const local = PNG.sync.read(fs.readFileSync(localPath));

  const totalHeight = diff.height;
  const sections = SECTION_DEFS[width];

  console.log(`\n===============================================================`);
  console.log(`📊 VIEWPORT: ${width}px | Heights: Live ${live.height}px vs Local ${local.height}px (Δ: ${local.height - live.height}px)`);
  console.log(`===============================================================`);

  let totalDiffPixels = 0;
  const rows = [];

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const startY = sec.start;
    const endY = sec.end === null ? totalHeight : Math.min(sec.end, totalHeight);
    const sectionHeight = endY - startY;
    const sectionTotalPixels = width * sectionHeight;

    let secDiffCount = 0;

    for (let y = startY; y < endY; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (width * y + x) << 2;
        const r = diff.data[idx];
        const g = diff.data[idx + 1];
        const b = diff.data[idx + 2];

        if (isPixelRedOrYellow(r, g, b)) {
          secDiffCount++;
        }
      }
    }

    totalDiffPixels += secDiffCount;
    const secError = ((secDiffCount / sectionTotalPixels) * 100).toFixed(2);
    const pageImpact = ((secDiffCount / (width * totalHeight)) * 100).toFixed(2);

    rows.push({
      Section: sec.name,
      'Y Range': `${startY}px - ${endY}px`,
      'Section Error': `${secError}%`,
      'Impact on Page': `${pageImpact}%`,
      Status: parseFloat(secError) < 5.0 ? '✅ Pass' : '❌ Needs Tweak'
    });
  }

  console.table(rows);
  const totalScore = ((totalDiffPixels / (width * totalHeight)) * 100).toFixed(2);
  console.log(`🎯 Overall Viewport Score: ${totalScore}% (Target: < 3%)\n`);
}

for (const vp of VIEWPORTS) {
  analyzeViewport(vp);
}