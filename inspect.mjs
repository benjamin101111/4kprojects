import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const BREAKPOINTS = [1440, 1200, 810, 390];
const HEIGHT = 1000;

const TARGETS = {
  live:  'https://4kprojects.com/about-us',
  local: 'http://localhost:4321/about-us',
};

function parseArgs(argv) {
  const args = {
    target: 'live',
    root: null,
    depth: 4,
    openMenu: false,
    dumpBeforeAfter: false,   // NEW: dump twice, once per state
    selectors: [],
    label: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target')            args.target = argv[++i];
    else if (a === '--root')         args.root = argv[++i];
    else if (a === '--depth')        args.depth = parseInt(argv[++i], 10);
    else if (a === '--open-menu')    args.openMenu = true;
    else if (a === '--dump-before-after') args.dumpBeforeAfter = true;
    else if (a === '--label')        args.label = argv[++i];
    else if (!a.startsWith('--'))    args.selectors.push(a);
  }
  if (!args.root && !args.selectors.length) {
    console.error('Usage: node inspect.mjs --root "<sel>" [--open-menu] [--dump-before-after] ...');
    process.exit(1);
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── In-page walker (same as before) ───────────────────────────────────
function walk(el, depth, maxDepth) {
  const cs  = getComputedStyle(el);
  const bef = getComputedStyle(el, '::before');
  const aft = getComputedStyle(el, '::after');
  const r   = el.getBoundingClientRect();
  const sx  = window.scrollX, sy = window.scrollY;
  const pick = (o, keys) => keys.reduce((acc, k) => { acc[k] = o[k]; return acc; }, {});

  const STYLE_KEYS = [
    'display','position','top','right','bottom','left',
    'width','height','minWidth','maxWidth','minHeight','maxHeight',
    'paddingTop','paddingRight','paddingBottom','paddingLeft',
    'marginTop','marginRight','marginBottom','marginLeft',
    'boxSizing','overflow','overflowX','overflowY',
    'flexDirection','flexWrap','justifyContent','alignItems','alignSelf',
    'flexGrow','flexShrink','flexBasis',
    'gap','rowGap','columnGap',
    'gridTemplateColumns','gridTemplateRows','gridAutoRows','gridAutoFlow',
    'fontFamily','fontSize','fontWeight','fontStyle',
    'lineHeight','letterSpacing','wordSpacing',
    'textAlign','textTransform','textDecorationLine','textDecorationColor',
    'whiteSpace','textIndent','textRendering',
    'color','backgroundColor','backgroundImage','backgroundSize','backgroundPosition',
    'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
    'borderTopStyle','borderRightStyle','borderBottomStyle','borderLeftStyle',
    'borderTopColor','borderRightColor','borderBottomColor','borderLeftColor',
    'borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius',
    'opacity','zIndex','transform','transformOrigin','boxShadow',
    'filter','backdropFilter','mixBlendMode',
    'objectFit','objectPosition','aspectRatio',
    'transition','transitionDuration','transitionTimingFunction',
    'cursor','pointerEvents','visibility',
  ];
  const PSEUDO_KEYS = ['content','display','position','width','height','backgroundColor','color',
    'borderTopWidth','borderTopStyle','borderTopColor',
    'borderBottomWidth','borderBottomStyle','borderBottomColor',
    'transform','opacity'];

  const node = {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    className: typeof el.className === 'string' ? el.className : null,
    text: (el.childNodes.length && el.childNodes[0].nodeType === 3
            ? el.childNodes[0].textContent : '').trim().slice(0, 120),
    box: {
      x: Math.round((r.left + sx) * 100) / 100,
      y: Math.round((r.top  + sy) * 100) / 100,
      w: Math.round(r.width  * 100) / 100,
      h: Math.round(r.height * 100) / 100,
    },
    style: pick(cs, STYLE_KEYS),
    before: pick(bef, PSEUDO_KEYS),
    after:  pick(aft, PSEUDO_KEYS),
    childCount: el.children.length,
  };
  if (depth < maxDepth && el.children.length > 0) {
    node.children = Array.from(el.children).map((c) => walk(c, depth + 1, maxDepth));
  }
  return node;
}

// ── NEW: robust drawer open + wait ────────────────────────────────────
async function openDrawer(page, width) {
  const before = await page.evaluate(() => {
    return [...document.querySelectorAll('button')].map((b) => {
      const cs = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      return {
        cls: b.className,
        display: cs.display,
        visibility: cs.visibility,
        w: r.width, h: r.height,
        left: r.left, top: r.top,
        aria: b.getAttribute('aria-expanded'),
      };
    });
  });
  console.log(`  [debug ${width}px] buttons before click:`, JSON.stringify(before, null, 2));

  const clicked = await page.evaluate(() => {
    // Click candidate order:
    // 1. Framer burger class we identified
    // 2. Any visible button in the right 25% of the viewport, height 30–120
    // 3. Any visible button at all
    const visible = (b) => {
      const cs = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden'
             && r.width > 0 && r.height > 0
             && r.width < 200 && r.height < 200;
    };
    const cands = [
      ...document.querySelectorAll('button.framer-eEBwL'),
      ...[...document.querySelectorAll('button')].filter((b) => {
        const r = b.getBoundingClientRect();
        return visible(b) && r.left > window.innerWidth * 0.7;
      }),
      ...[...document.querySelectorAll('button')].filter(visible),
    ];
    const target = cands[0];
    if (!target) return { ok: false, reason: 'no candidate button' };
    target.click();
    return { ok: true, cls: target.className };
  });
  console.log(`  [debug ${width}px] click result:`, clicked);

  // Wait for SOMETHING to change: a new fixed-position element covering
  // most of the viewport with a transform transitioning to identity.
  const changed = await page.waitForFunction(() => {
    const all = [...document.querySelectorAll('*')];
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width < window.innerWidth * 0.5) continue;
      if (r.height < window.innerHeight * 0.5) continue;
      // Is it visibly on-screen now?
      if (r.left >= window.innerWidth) continue;   // still offscreen right
      // transform settling to identity?
      const t = cs.transform;
      if (t === 'none') return true;
      const m = t.match(/matrix\(([^)]+)\)/);
      if (m) {
        const e = parseFloat(m[1].split(',')[4]);
        if (Math.abs(e) < 2) return true;
      }
    }
    return false;
  }, { timeout: 5000, polling: 100 }).catch(() => null);

  console.log(`  [debug ${width}px] drawer-visible signal:`, changed ? 'yes' : 'NO — timed out');

  // Dump the full body structure right after the click so we can see what's new.
  const after = await page.evaluate(() => {
    const root = document.body;
    const out = [];
    for (const el of root.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      out.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        cls: typeof el.className === 'string' ? el.className.slice(0, 80) : null,
        box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        transform: cs.transform,
        opacity: cs.opacity,
        z: cs.zIndex,
      });
    }
    return out;
  });
  console.log(`  [debug ${width}px] fixed elements after click:`, JSON.stringify(after, null, 2));

  return changed !== null;
}

async function inspect() {
  const args = parseArgs(process.argv.slice(2));
  const url = TARGETS[args.target];
  if (!url) { console.error(`Unknown target "${args.target}"`); process.exit(1); }

  const browser = await puppeteer.launch({
    channel: 'chrome', headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const outDir  = path.resolve('./inspect-results');
  const shotDir = path.resolve('./inspect-screenshots');
  fs.mkdirSync(outDir,  { recursive: true });
  fs.mkdirSync(shotDir, { recursive: true });

  const report = {
    target: args.target, url, root: args.root, depth: args.depth,
    openMenu: args.openMenu, dumpBeforeAfter: args.dumpBeforeAfter,
    selectors: args.selectors, breakpoints: {},
  };

  for (const width of BREAKPOINTS) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: HEIGHT, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(1500);

    console.log(`\n══════════════ ${width}px  (${args.target}) ══════════════`);
    report.breakpoints[width] = {};

    const snap = async (tag) => {
      const data = {};
      if (args.root) {
        data[args.root] = await page.evaluate(
          (rootSel, maxDepth, walkerSrc) => {
            const walkFn = new Function('return ' + walkerSrc)();
            const el = document.querySelector(rootSel);
            if (!el) return { error: `No match for root "${rootSel}"` };
            return walkFn(el, 0, maxDepth);
          },
          args.root, args.depth, walk.toString()
        );
      }
      for (const sel of args.selectors) {
        data[sel] = await page.evaluate(
          (selector, maxDepth, walkerSrc) => {
            const walkFn = new Function('return ' + walkerSrc)();
            const els = [...document.querySelectorAll(selector)];
            if (!els.length) return { error: `No match for "${selector}"` };
            return els.map((el) => walkFn(el, 0, maxDepth));
          },
          sel, args.depth, walk.toString()
        );
      }
      report.breakpoints[width][tag] = data;
      return data;
    };

    // Snapshot BEFORE (only if we need it)
    if (args.dumpBeforeAfter) {
      console.log('  ── state: before ──');
      await snap('before');
    }

    // Open menu
    if (args.openMenu) {
      const ok = await openDrawer(page, width);
      if (!ok) console.warn(`  ⚠ drawer visibility not confirmed at ${width}px`);
      await sleep(500);
    }

    // Snapshot AFTER
    const tag = args.openMenu ? 'after' : 'closed';
    const data = await snap(tag);

    // Print
    for (const key of Object.keys(data)) {
      const v = data[key];
      if (v && v.error) { console.log(`  ✗ ${key}  →  ${v.error}`); continue; }
      if (Array.isArray(v)) {
        console.log(`\n  ── ${key} (${v.length} matches) ──`);
        v.forEach((n) => printTree(n, 2));
      } else {
        printTree(v, 1);
      }
    }

    const shotTag = args.openMenu ? 'menu-open' : 'menu-closed';
    const label = args.label ? `-${args.label}` : '';
    const shotPath = path.join(shotDir, `${args.target}${label}-${width}-${shotTag}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    console.log(`  📸 ${path.relative(process.cwd(), shotPath)}`);

    await page.close();
  }

  await browser.close();

  const fname = [
    args.target, args.label,
    args.root ? args.root.replace(/[^a-z0-9]/gi, '_') : 'selectors',
    args.openMenu ? 'open' : 'closed',
  ].filter(Boolean).join('-') + '.json';
  const out = path.join(outDir, fname);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n✨ Wrote ${path.relative(process.cwd(), out)}`);
}

function printTree(node, indent) {
  if (!node) return;
  const pad = '  '.repeat(indent);
  const cls = node.className ? ` class="${String(node.className).slice(0,60)}"` : '';
  const id  = node.id ? ` id="${node.id}"` : '';
  console.log(`${pad}<${node.tag}${id}${cls}>  [${node.box.x},${node.box.y} ${node.box.w}×${node.box.h}]`);
  if (node.text) console.log(`${pad}  "${node.text}"`);
  const s = node.style;
  console.log(`${pad}  display=${s.display} pos=${s.position} z=${s.zIndex} opacity=${s.opacity}`);
  console.log(`${pad}  pad=${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`);
  console.log(`${pad}  font=${s.fontFamily} / ${s.fontSize} / ${s.fontWeight} / ${s.lineHeight} / ls=${s.letterSpacing}`);
  console.log(`${pad}  color=${s.color} bg=${s.backgroundColor}`);
  if (s.display.includes('flex')) console.log(`${pad}  flex: dir=${s.flexDirection} jc=${s.justifyContent} ai=${s.alignItems} gap=${s.gap}`);
  if (s.transform && s.transform !== 'none') console.log(`${pad}  transform=${s.transform}`);
  if (node.children) for (const c of node.children) printTree(c, indent + 1);
}

inspect().catch((e) => { console.error(e); process.exit(1); });