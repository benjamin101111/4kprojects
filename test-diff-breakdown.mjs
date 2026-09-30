// check-breakdown.mjs
import fs from 'fs';
import { PNG } from 'pngjs';

const diffImg = PNG.sync.read(fs.readFileSync('./diff-results/diff-1440.png'));
const width = diffImg.width;
const height = diffImg.height;

// Sections based on live Y-coordinates
const sections = [
  { name: '1. About Hero', start: 0, end: 528 },
  { name: '2. Work Slider', start: 528, end: 1774 },
  { name: '3. Our Story', start: 1774, end: 2475 },
  { name: '4. The 4K Team', start: 2475, end: 4401 },
  { name: '5. FAQ Section', start: 4401, end: 5153 },
  { name: '6. Footer', start: 5153, end: height },
];

console.log(`\n🔍 Section-by-Section Error Analysis (1440px):\n`);

let totalMismatched = 0;
const results = sections.map((sec) => {
  let sectionDiffPixels = 0;
  const sectionTotalPixels = width * (sec.end - sec.start);

  for (let y = sec.start; y < sec.end && y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      const r = diffImg.data[idx];
      const g = diffImg.data[idx + 1];
      const b = diffImg.data[idx + 2];

      // Pixelmatch marks errors in pure red or yellow (anti-aliasing)
      if ((r === 255 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 0)) {
        sectionDiffPixels++;
      }
    }
  }

  totalMismatched += sectionDiffPixels;
  const sectionErrorRate = ((sectionDiffPixels / sectionTotalPixels) * 100).toFixed(2);
  const contributionToPage = ((sectionDiffPixels / (width * height)) * 100).toFixed(2);

  return {
    Section: sec.name,
    'Height (px)': `${sec.end - sec.start}px`,
    'Section Error': `${sectionErrorRate}%`,
    'Contribution to Page': `${contributionToPage}%`
  };
});

console.table(results);
const totalScore = ((totalMismatched / (width * height)) * 100).toFixed(2);
console.log(`\nTotal Page Error: ${totalScore}%\n`);