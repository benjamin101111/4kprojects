import puppeteer from 'puppeteer-core';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import fs from 'fs';

const BREAKPOINTS = [1440, 1200, 810, 390];
const LIVE_URL = 'https://4kprojects.com/about-us';
const LOCAL_URL = 'http://localhost:4321/';

if (!fs.existsSync('./diff-results')) {
  fs.mkdirSync('./diff-results');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to pad images to the exact same size so pixelmatch never crashes
function padToSize(img, targetWidth, targetHeight) {
  const padded = new PNG({ width: targetWidth, height: targetHeight });
  // Fill with empty pixels
  padded.data.fill(0);
  // Copy original image into the top-left
  PNG.bitblt(img, padded, 0, 0, img.width, img.height, 0, 0);
  return padded;
}

async function runDiff() {
  console.log('🚀 Launching Chrome to compare with live 4kprojects.com...');

  const browser = await puppeteer.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  for (const width of BREAKPOINTS) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 1000, deviceScaleFactor: 1 });

    console.log(`\n📸 Testing Viewport: ${width}px...`);

    // 1. Live site
    await page.goto(LIVE_URL, { waitUntil: 'networkidle2' });
    await sleep(1500);
    const liveBuffer = await page.screenshot({ fullPage: true });
    fs.writeFileSync(`./diff-results/live-${width}.png`, liveBuffer);

    // 2. Local site
    await page.goto(LOCAL_URL, { waitUntil: 'networkidle2' });
    await sleep(1500);
    const localBuffer = await page.screenshot({ fullPage: true });
    fs.writeFileSync(`./diff-results/local-${width}.png`, localBuffer);

    // 3. Read and normalize dimensions
    const img1 = PNG.sync.read(liveBuffer);
    const img2 = PNG.sync.read(localBuffer);

    const maxWidth = Math.max(img1.width, img2.width);
    const maxHeight = Math.max(img1.height, img2.height);

    console.log(`   📏 Heights: Live is ${img1.height}px | Local is ${img2.height}px (Diff: ${Math.abs(img1.height - img2.height)}px)`);

    // Pad both images to the max width/height
    const paddedImg1 = padToSize(img1, maxWidth, maxHeight);
    const paddedImg2 = padToSize(img2, maxWidth, maxHeight);

    const diff = new PNG({ width: maxWidth, height: maxHeight });

    const mismatchedPixels = pixelmatch(
      paddedImg1.data,
      paddedImg2.data,
      diff.data,
      maxWidth,
      maxHeight,
      { threshold: 0.1 }
    );

    const totalPixels = maxWidth * maxHeight;
    const score = ((mismatchedPixels / totalPixels) * 100).toFixed(2);

    fs.writeFileSync(`./diff-results/diff-${width}.png`, PNG.sync.write(diff));

    if (parseFloat(score) < 3.0) {
      console.log(`   ✅ [PASS] ${width}px Diff Score: ${score}% (Target is < 3%)`);
    } else {
      console.log(`   ⚠️ [NEEDS TWEAK] ${width}px Diff Score: ${score}%`);
    }

    await page.close();
  }

  await browser.close();
  console.log('\n✨ Finished! Check ./diff-results/ folder to see the visual diffs.');
}

runDiff().catch(console.error);