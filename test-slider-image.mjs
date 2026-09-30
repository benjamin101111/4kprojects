// check-slider-image.mjs
import fs from 'fs';
import { PNG } from 'pngjs';

const live = PNG.sync.read(fs.readFileSync('./diff-results/live-1440.png'));
const local = PNG.sync.read(fs.readFileSync('./diff-results/local-1440.png'));

// Sample 5 points down the middle of the slider (Y = 600, 800, 1000, 1200, 1400)
console.log('🖼️ Slider Pixel Comparison (Live vs Local at 1440px):\n');
[600, 800, 1000, 1200, 1400].forEach(y => {
  const x = 720; // center of 1440
  const idx = (1440 * y + x) << 2;
  const liveRgb = `rgb(${live.data[idx]}, ${live.data[idx+1]}, ${live.data[idx+2]})`;
  const localRgb = `rgb(${local.data[idx]}, ${local.data[idx+1]}, ${local.data[idx+2]})`;
  const isMatch = liveRgb === localRgb;
  console.log(`At Y: ${y}px -> Live: ${liveRgb.padEnd(18)} | Local: ${localRgb.padEnd(18)} | ${isMatch ? '✅ Match' : '❌ MISMATCH'}`);
});