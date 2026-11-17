// Regenerate the real-map screenshots used in README.md.
//
// Usage: start `npm run serve` in another terminal, then:
//   node scripts/preview-map.mjs
//
// This is a documentation helper, not part of the app or the test suite.

import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const OUT = fileURLToPath(new URL('../docs/', import.meta.url));

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader'],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (error) => console.log('pageerror', error.message));

await page.goto(`${BASE}/?mode=map`);
await page.waitForFunction(() => window.__roadMapReady === true, null, { timeout: 30_000 });
await page.waitForFunction(() => window.__roadMap.getState().stats.moving > 40);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}stage-4-map-overview.png` });

// Pick a car near the plaza and a little way from the map edge, so the ride-along
// screenshot shows the downtown blocks rather than an empty fringe.
const car = await page.evaluate(() => {
  const cars = window.__roadMap.getCars();
  const scored = cars
    .filter((entry) => entry.speed > 4)
    .map((entry) => ({
      entry,
      score: Math.hypot(entry.x, entry.z) + (entry.class === 'secondary' ? -40 : 0),
    }))
    .sort((a, b) => a.score - b.score);
  return scored.length > 0 ? scored[0].entry : cars[0];
});
if (car) {
  await page.evaluate((id) => window.__roadMap.follow(id), car.id);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUT}stage-4-map-follow.png` });
}

const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
mobile.on('pageerror', (error) => console.log('mobile pageerror', error.message));
await mobile.goto(`${BASE}/?mode=map`);
await mobile.waitForFunction(() => window.__roadMapReady === true, null, { timeout: 30_000 });
await mobile.waitForTimeout(1200);
await mobile.screenshot({ path: `${OUT}stage-4-map-mobile.png` });

await browser.close();
console.log('Wrote docs/stage-4-map-overview.png, docs/stage-4-map-follow.png and docs/stage-4-map-mobile.png');
