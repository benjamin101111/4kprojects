// scripts/diff.mjs
// Usage: node scripts/diff.mjs <live.json> <local.json> [--box-threshold=2]

import fs from 'node:fs/promises';

const [, , liveFile, localFile, ...flags] = process.argv;
if (!liveFile || !localFile) {
  console.error('Usage: node scripts/diff.mjs <live.json> <local.json> [--box-threshold=2]');
  process.exit(1);
}

const boxThreshold = Number(
  (flags.find(f => f.startsWith('--box-threshold=')) || '').split('=')[1] || 2
);

const live = JSON.parse(await fs.readFile(liveFile, 'utf8'));
const local = JSON.parse(await fs.readFile(localFile, 'utf8'));

// --- Properties we care about, grouped by severity ---
const STYLE_PROPS = Object.keys(live.elements[0]?.style || {});
const BOX_PROPS = ['x', 'y', 'w', 'h'];

// --- Index both sides by key. Keys can collide (same path, same text)
//     in nested layouts, so we store arrays and match in order. ---
function index(el) {
  const m = new Map();
  for (const e of el) {
    if (!m.has(e.key)) m.set(e.key, []);
    m.get(e.key).push(e);
  }
  return m;
}

const li = index(live.elements);
const lo = index(local.elements);

const diffs = [];
let matched = 0;
let missingLocal = 0;
let missingLive = 0;

for (const [key, liveArr] of li) {
  const localArr = lo.get(key);
  if (!localArr) {
    missingLocal += liveArr.length;
    diffs.push({ kind: 'missing-in-local', key, liveCount: liveArr.length });
    continue;
  }
  const n = Math.min(liveArr.length, localArr.length);
  for (let i = 0; i < n; i++) {
    matched++;
    const L = liveArr[i];
    const R = localArr[i];

    // Style diffs
    for (const p of STYLE_PROPS) {
      if (L.style[p] !== R.style[p]) {
        diffs.push({
          kind: 'style',
          key,
          prop: p,
          live: L.style[p],
          local: R.style[p],
        });
      }
    }

    // Box diffs — only flag above threshold
    for (const p of BOX_PROPS) {
      const d = Math.abs((L.box[p] || 0) - (R.box[p] || 0));
      if (d > boxThreshold) {
        diffs.push({
          kind: 'box',
          key,
          prop: p,
          live: L.box[p],
          local: R.box[p],
          delta: Math.round(d * 10) / 10,
        });
      }
    }
  }
  if (liveArr.length !== localArr.length) {
    diffs.push({
      kind: 'count',
      key,
      liveCount: liveArr.length,
      localCount: localArr.length,
    });
  }
}

// Anything in local that isn't in live
for (const [key, localArr] of lo) {
  if (!li.has(key)) {
    missingLive += localArr.length;
    diffs.push({ kind: 'extra-in-local', key, localCount: localArr.length });
  }
}

// --- Report ---
console.log(`\n=== ${liveFile}  vs  ${localFile} ===`);
console.log(`viewport: ${live.width}px`);
console.log(`live elements: ${live.elements.length}`);
console.log(`local elements: ${local.elements.length}`);
console.log(`matched: ${matched}`);
console.log(`missing in local: ${missingLocal}`);
console.log(`extra in local: ${missingLive}`);
console.log(`total diffs: ${diffs.length}\n`);

// Group by property so you see patterns, not a wall of one-offs.
const byProp = new Map();
for (const d of diffs) {
  const tag = d.kind === 'style' || d.kind === 'box' ? d.prop : d.kind;
  if (!byProp.has(tag)) byProp.set(tag, []);
  byProp.get(tag).push(d);
}

// Print the top 25 noisiest props
const sorted = [...byProp.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [prop, list] of sorted) {
  console.log(`\n## ${prop}  (${list.length})`);
  for (const d of list.slice(0, 8)) {
    console.log(`   ${d.key}`);
    if (d.kind === 'style') console.log(`      live=${d.live}  local=${d.local}`);
    if (d.kind === 'box')   console.log(`      live=${d.live}  local=${d.local}  Δ=${d.delta}`);
    if (d.kind === 'count') console.log(`      liveCount=${d.liveCount}  localCount=${d.localCount}`);
  }
  if (list.length > 8) console.log(`   … and ${list.length - 8} more`);
}

// Also dump full JSON next to the inputs for deeper digging
await fs.writeFile(
  liveFile.replace(/\.json$/, '.diff.json'),
  JSON.stringify(diffs, null, 2)
);
console.log(`\nFull diff written to ${liveFile.replace(/\.json$/, '.diff.json')}`);