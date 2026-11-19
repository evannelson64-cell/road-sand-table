import { test, expect } from '@playwright/test';

/**
 * The satellite page streams live data at runtime. This test stubs the two
 * network sources with a tiny fixture so it stays fast and hermetic while
 * still exercising the real load pipeline, the merged-geometry budget and the
 * quality switch.
 */

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const LAT = 41.655;
const LON = -88.43;

function buildFixture() {
  const elements = [];
  let id = 1;
  const nodes = [];

  const addNode = (lat, lon) => {
    const node = { type: 'node', id: id++, lat, lon };
    elements.push(node);
    nodes.push(node);
    return node;
  };

  const addWay = (tags, list) => {
    elements.push({ type: 'way', id: id++, nodes: list.map((node) => node.id), tags });
  };

  // Two crossing residential streets, each 400 m long.
  const span = 0.0018;
  const main = [];
  for (let step = 0; step <= 8; step += 1) {
    main.push(addNode(LAT, LON - span + (step * (2 * span)) / 8));
  }
  addWay({ highway: 'residential', lanes: '2', name: 'Main Street', surface: 'asphalt' }, main);

  const cross = [];
  for (let step = 0; step <= 8; step += 1) {
    cross.push(addNode(LAT - span + (step * (2 * span)) / 8, LON));
  }
  addWay({ highway: 'tertiary', lanes: '2', name: 'Oak Lane' }, cross);

  // One named building so the storefront-sign path runs.
  const half = 0.00028;
  const corners = [
    addNode(LAT + 0.0009 - half, LON + 0.0009 - half),
    addNode(LAT + 0.0009 - half, LON + 0.0009 + half),
    addNode(LAT + 0.0009 + half, LON + 0.0009 + half),
    addNode(LAT + 0.0009 + half, LON + 0.0009 - half),
  ];
  addWay({ building: 'yes', name: 'Test Cafe', 'building:levels': '2' }, corners);

  return { version: 0.6, elements };
}

async function stubNetwork(page) {
  const fixture = JSON.stringify(buildFixture());
  await page.route('**/api/interpreter', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: fixture,
  }));
  await page.route('**/World_Imagery/MapServer/tile/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    headers: { 'access-control-allow-origin': '*' },
    body: PIXEL_PNG,
  }));
  await page.route('**/elevation-tiles-prod/terrarium/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    headers: { 'access-control-allow-origin': '*' },
    body: PIXEL_PNG,
  }));
}

test.describe.configure({ timeout: 180_000 });

test('satellite drive loads, merges and switches quality', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await stubNetwork(page);
  await page.goto('/quest-drive.html?r=300');

  await page.waitForFunction(() => window.__questDrive?.getState().ready === true, null, { timeout: 120_000 });
  await page.waitForFunction(() => window.__questDrive.getState().counts !== null, null, { timeout: 120_000 });
  await expect(page.locator('#loading')).toBeHidden();

  const initial = await page.evaluate(() => window.__questDrive.getState());
  expect(initial.quality).toBe('high');
  expect(initial.counts.roads).toBeGreaterThan(0);
  expect(initial.counts.buildings).toBeGreaterThan(0);
  expect(initial.calls).toBeLessThan(120);

  const toPerformance = await page.evaluate(async () => {
    await window.__questDrive.setQuality('performance');
    return window.__questDrive.getState();
  });
  expect(toPerformance.quality).toBe('performance');
  expect(toPerformance.calls).toBeLessThan(120);

  const backToHigh = await page.evaluate(async () => {
    await window.__questDrive.setQuality('high');
    return window.__questDrive.getState();
  });
  expect(backToHigh.quality).toBe('high');
  expect(backToHigh.calls).toBeLessThan(120);

  // A standard wheel/pedal mapping: left-stick X plus the right trigger.
  const gamepad = await page.evaluate(async () => {
    const button = (value) => ({ value, pressed: value > 0.5, touched: value > 0 });
    const buttons = Array.from({ length: 17 }, () => button(0));
    buttons[7] = button(1);
    const pad = { connected: true, axes: [0.4, 0, 0, 0], buttons };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true });
    await new Promise((resolve) => setTimeout(resolve, 900));
    const after = window.__questDrive.getState().car;
    Object.defineProperty(navigator, 'getGamepads', { value: () => [], configurable: true });
    return after;
  });
  expect(gamepad.speed).toBeGreaterThan(0.5);

  expect(errors, 'no uncaught page errors').toHaveLength(0);
});

test('satellite drive and the map link to each other', async ({ page }) => {
  await page.goto('/');
  const forward = page.locator('a.brand-link');
  await expect(forward).toBeVisible();
  await expect(forward).toHaveAttribute('href', './quest-drive.html');

  await page.goto('/quest-drive.html');
  const back = page.locator('a.back');
  await expect(back).toBeVisible();
  await expect(back).toHaveAttribute('href', './?mode=map');
  await expect(back).toContainText('Road sand table');
});
