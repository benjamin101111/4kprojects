// check-team-photos.mjs
import fs from 'fs';
import { PNG } from 'pngjs';

const live = PNG.sync.read(fs.readFileSync('./diff-results/live-1440.png'));
const local = PNG.sync.read(fs.readFileSync('./diff-results/local-1440.png'));

// Card coordinates on 1440px:
// Row 1: Jon (X: 250), Anna (X: 720), Georgia (X: 1190) at Y: 2900
// Row 2: Giulia (X: 250), Paola (X: 720), Namik (X: 1190) at Y: 3500
const cards = [
  { name: '1. Jon Medlock', x: 250, y: 2900 },
  { name: '2. Anna Kawalec', x: 720, y: 2900 },
  { name: '3. Georgia Grigoriadi', x: 1190, y: 2900 },
  { name: '4. Giulia Zanotti', x: 250, y: 3500 },
  { name: '5. Paola Maria Baliki', x: 720, y: 3500 },
  { name: '6. Namik Pirkic', x: 1190, y: 3500 },
];

console.log('📸 Team Card Photo Check (1440px):\n');
cards.forEach(card => {
  const idx = (1440 * card.y + card.x) << 2;
  const liveRgb = `rgb(${live.data[idx]}, ${live.data[idx+1]}, ${live.data[idx+2]})`;
  const localRgb = `rgb(${local.data[idx]}, ${local.data[idx+1]}, ${local.data[idx+2]})`;
  const isMatch = liveRgb === localRgb;
  console.log(`${card.name.padEnd(24)} -> Live: ${liveRgb.padEnd(18)} | Local: ${localRgb.padEnd(18)} | ${isMatch ? '✅ Match' : '❌ MISMATCH'}`);
});