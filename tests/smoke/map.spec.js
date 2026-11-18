import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// The 3-mile Yorkville extract is ~1M flat-shaded triangles. Under the
// software renderer used by CI every interaction takes seconds, so give the
// map specs a generous budget.
test.describe.configure({ timeout: 180_000 });

const DEFAULT_ID = 'yorkville-heartland';
const DEFAULT_NAME = 'Heartland · Yorkville';
const DEFAULT_PLACE = 'Yorkville, Illinois';
const CONVERTED_FIXTURE = fileURLToPath(
  new URL('../../data/maps/healdsburg-plaza.json', import.meta.url),
);
const RAW_FIXTURE = fileURLToPath(
  new URL('../../data/osm/healdsburg-plaza.raw.json', import.meta.url),
);

async function openMap(page, path = '/?mode=map') {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto(path);
  await page.waitForFunction(() => window.__roadMapReady === true, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__roadMap.getState().active === true);
  await page.waitForFunction(() => window.__roadMap.getState().stats.moving > 10);
  await expect(page.locator('#loading')).toHaveClass(/is-hidden/);

  return { consoleErrors, pageErrors, failedRequests };
}

function expectClean(errors) {
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
  expect(errors.failedRequests).toEqual([]);
}

test('the real map loads the committed Heartland extract and runs traffic', async ({ page }) => {
  const errors = await openMap(page);
  const state = await page.evaluate(() => window.__roadMap.getState());

  expect(state.id).toBe(DEFAULT_ID);
  expect(state.name).toBe(DEFAULT_NAME);
  expect(state.place).toBe(DEFAULT_PLACE);
  expect(state.isDefault).toBe(true);
  expect(state.attribution).toBe('© OpenStreetMap contributors · ODbL 1.0');
  expect(state.size.width).toBeGreaterThan(9000);
  expect(state.size.depth).toBeGreaterThan(9000);
  expect(state.stats.cars).toBe(64);
  expect(state.network.edges).toBeGreaterThan(10_000);
  expect(state.network.buildings).toBeGreaterThan(8000);
  expect(state.network.signals).toBe(80);
  expect(state.render.calls).toBeGreaterThan(10);
  // The overview camera scales with the extract instead of sitting at the
  // Healdsburg distance.
  expect(state.camera.distance).toBeGreaterThan(5000);

  await expect(page.locator('#map-info')).toBeVisible();
  await expect(page.locator('#map-legend')).toBeVisible();
  await expect(page.locator('#map-panel')).toBeVisible();
  await expect(page.locator('#caption-card')).toBeHidden();
  await expect(page.locator('#sandbox-panel')).toBeHidden();
  await expect(page.locator('#mode-map')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#map-name')).toHaveText(DEFAULT_NAME);
  await expect(page.locator('#map-attribution')).toHaveText('© OpenStreetMap contributors · ODbL 1.0');
  await expect(page.locator('#map-default')).toBeHidden();
  await expect(page.locator('#map-load-note')).toContainText('Nothing is fetched at runtime');

  const before = await page.evaluate(() => window.__roadMap.getCars());
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => window.__roadMap.getCars());
  const moved = before.filter((car, index) => {
    const next = after[index];
    return Math.hypot(next.x - car.x, next.z - car.z) > 1;
  });
  expect(moved.length).toBeGreaterThan(10);

  expectClean(errors);
});

test('pausing freezes the traffic and the speed control changes the clock', async ({ page }) => {
  const errors = await openMap(page);

  await page.locator('#map-play').click();
  await page.waitForFunction(() => window.__roadMap.getState().paused === true);

  const frozen = await page.evaluate(() => window.__roadMap.getCars());
  await page.waitForTimeout(400);
  const stillFrozen = await page.evaluate(() => window.__roadMap.getCars());
  expect(stillFrozen).toEqual(frozen);
  await expect(page.locator('#map-play-label')).toHaveText('Play');

  await page.locator('#map-play').click();
  await page.waitForFunction(() => window.__roadMap.getState().paused === false);

  await page.locator('[data-map-speed="2"]').click();
  await page.waitForFunction(() => window.__roadMap.getState().rate === 2);
  await expect(page.locator('[data-map-speed="2"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-map-speed="1"]')).toHaveAttribute('aria-pressed', 'false');

  expectClean(errors);
});

test('the density slider reseeds the fleet', async ({ page }) => {
  const errors = await openMap(page);

  await page.locator('#map-density').evaluate((input) => {
    input.value = '96';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => window.__roadMap.getState().stats.cars === 96);

  const state = await page.evaluate(() => window.__roadMap.getState());
  expect(state.targetCars).toBe(96);
  await expect(page.locator('#map-density-value')).toHaveText('96');

  await page.locator('#map-density').evaluate((input) => {
    input.value = '24';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => window.__roadMap.getState().stats.cars === 24);

  expectClean(errors);
});

test('ride along follows a car, and Escape returns to the overview', async ({ page }) => {
  const errors = await openMap(page);

  await page.locator('#map-follow').click();
  await page.waitForFunction(() => window.__roadMap.getState().following !== null);

  const followed = (await page.evaluate(() => window.__roadMap.getState())).following;
  expect(followed).toMatch(/^car-\d+$/);
  await expect(page.locator('#map-follow')).toHaveText('Stop following');
  await expect(page.locator('#map-foot-note')).toContainText('Following a car');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__roadMap.getState().following === null);
  await expect(page.locator('#map-follow')).toHaveText('Ride along');

  expectClean(errors);
});

test('the mode switch works both ways without disturbing the sand table', async ({ page }) => {
  const errors = await openMap(page);

  await page.locator('#mode-sandbox').click();
  await page.waitForFunction(() => window.__sandTable.getState().mode === 'sandbox');
  await expect(page.locator('#sandbox-panel')).toBeVisible();
  await expect(page.locator('#caption-card')).toBeVisible();
  await expect(page.locator('#map-panel')).toBeHidden();
  await expect(page.locator('#mode-sandbox')).toHaveAttribute('aria-pressed', 'true');

  const sandbox = await page.evaluate(() => window.__sandTable.getState());
  expect(sandbox.cars).toHaveLength(3);
  expect(sandbox.collision).toBeNull();
  await page.waitForFunction(
    (frame) => window.__sandTable.getState().frameIndex > frame,
    sandbox.frameIndex,
  );

  await page.locator('#mode-map').click();
  await page.waitForFunction(() => window.__roadMap.getState().active === true);
  expect((await page.evaluate(() => window.__roadMap.getState())).stats.cars).toBe(64);

  await page.locator('#mode-sandbox').click();
  await page.waitForFunction(() => window.__sandTable.getState().mode === 'sandbox');
  expect((await page.evaluate(() => window.__sandTable.getState())).collision).toBeNull();

  expectClean(errors);
});

test('a saved converted map file loads from disk without a service call', async ({ page }) => {
  const errors = await openMap(page);

  await page.locator('#map-file').setInputFiles(CONVERTED_FIXTURE);
  await page.waitForFunction(
    (id) => window.__roadMap.getState().id === id,
    'healdsburg-plaza',
  );
  await page.waitForFunction(() => window.__roadMap.getState().stats.moving > 5);

  const state = await page.evaluate(() => window.__roadMap.getState());
  expect(state.id).toBe('healdsburg-plaza');
  expect(state.name).toBe('Healdsburg Plaza');
  expect(state.isDefault).toBe(false);
  expect(state.network.edges).toBe(237);
  expect(state.network.buildings).toBe(322);
  // The replacement map gets its own scale-appropriate camera.
  expect(state.camera.distance).toBeLessThan(1500);

  await expect(page.locator('#map-name')).toHaveText('Healdsburg Plaza');
  await expect(page.locator('#map-load-note')).toContainText('healdsburg-plaza.json');
  await expect(page.locator('#map-default')).toBeVisible();

  expectClean(errors);
});

test('a raw Overpass response converts in the browser and the default can be restored', async ({ page }) => {
  const errors = await openMap(page);

  await page.locator('#map-file').setInputFiles(RAW_FIXTURE);
  await page.waitForFunction(() => window.__roadMap.getState().isDefault === false);
  await page.waitForFunction(() => window.__roadMap.getState().stats.moving > 5);

  const custom = await page.evaluate(() => window.__roadMap.getState());
  expect(custom.id).toMatch(/^custom-/);
  expect(custom.place).toBe('Loaded from your device');
  // Converted in the browser from the raw Overpass response, so it may include
  // a few ways that the committed extract clipped to its bounds.
  expect(custom.network.edges).toBeGreaterThan(200);
  await expect(page.locator('#map-load-note')).toContainText('healdsburg-plaza.raw.json');

  await page.locator('#map-default').click();
  await page.waitForFunction(
    (id) => window.__roadMap.getState().id === id,
    DEFAULT_ID,
  );
  await page.waitForFunction(() => window.__roadMap.getState().stats.moving > 10);

  const restored = await page.evaluate(() => window.__roadMap.getState());
  expect(restored.isDefault).toBe(true);
  expect(restored.name).toBe(DEFAULT_NAME);
  await expect(page.locator('#map-name')).toHaveText(DEFAULT_NAME);
  await expect(page.locator('#map-default')).toBeHidden();

  expectClean(errors);
});

test('a file that is not a map keeps the current extract running', async ({ page }) => {
  const errors = await openMap(page);

  await page.locator('#map-file').setInputFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ hello: 'world' })),
  });
  await expect(page.locator('#map-load-note')).toContainText('Could not load notes.json');
  await expect(page.locator('#map-load-note')).toHaveClass(/is-error/);

  const state = await page.evaluate(() => window.__roadMap.getState());
  expect(state.id).toBe(DEFAULT_ID);
  expect(state.isDefault).toBe(true);
  // The failed file must not stop the map that is already running.
  const before = await page.evaluate(() => window.__roadMap.getCars());
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => window.__roadMap.getCars());
  expect(after).not.toEqual(before);

  expectClean(errors);
});
