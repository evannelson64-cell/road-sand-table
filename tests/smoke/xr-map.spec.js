import { test, expect } from 'playwright-webxr';
import { aimQuaternion } from 'playwright-webxr/examples/aim-controller';

test.use({
  xrDeviceName: 'metaQuest2',
  xrStereoEnabled: false,
});

test.describe.configure({ timeout: 240_000 });

const PANEL_ORIGIN = [0.3, 1.24, -0.32];
// The miniature is 1.68 m wide across the widest side of the ~10.2 km plinth.
const DEFAULT_MAP_SCALE = 1.68 / 10219.176;

async function state(page) {
  return page.evaluate(() => window.__roadMap.getState());
}

async function aimAt(xr, target, origin = PANEL_ORIGIN) {
  await xr.setControllerPose('right', {
    position: origin,
    quaternion: aimQuaternion(origin, target),
  });
  await xr.waitForFrames(3);
}

async function clickPanel(page, xr, buttonId, origin = PANEL_ORIGIN) {
  const current = await state(page);
  const target = current.xr.panelButtons[buttonId];
  expect(target, `${buttonId} should be on the map panel`).toBeTruthy();
  await aimAt(xr, target, origin);
  await xr.pressButton('right', 'trigger');
  await xr.waitForFrames(3);
}

async function enterMapVr(page, xr) {
  await page.goto('/?mode=map');
  await page.waitForFunction(() => window.__roadMapReady === true);
  await page.waitForFunction(() => window.__roadMap.getState().stats.moving > 10);
  await expect(page.locator('#enter-vr')).toBeVisible();
  await xr.enterVR({ button: '#enter-vr', timeout: 120_000 });
  await page.waitForFunction(() => window.__roadMap.getState().xr.active === true);
  await page.waitForFunction(() => window.__roadMap.getState().xr.placed === true);
  await xr.waitForFrames(4);
}

function watchErrors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

test('the real map becomes a room-scale table in immersive VR', async ({ page, xr }, testInfo) => {
  const errors = watchErrors(page);
  await enterMapVr(page, xr);

  let current = await state(page);
  expect(current.active).toBe(true);
  expect(current.xr.active).toBe(true);
  expect(current.xr.placed).toBe(true);
  expect(current.xr.panelVisible).toBe(true);
  expect(current.xr.handTracking).toBe(false);
  expect(current.xr.table.scale).toBeCloseTo(DEFAULT_MAP_SCALE, 5);
  expect(current.xr.table.position.y).toBeCloseTo(0.9, 2);
  expect(current.xr.table.position.z).toBeCloseTo(-1.62, 1);
  expect(current.xr.tableCorners).toHaveLength(4);
  expect(current.paused).toBe(true);
  expect(current.xr.render.calls).toBeLessThan(200);
  // The miniature is under 2 m away, so VR must use a near plane small enough
  // not to slice the front of the plinth. Desktop keeps its 1 m near plane.
  expect(current.camera.near).toBeCloseTo(0.05, 2);

  // Play the live traffic, then check it actually advances inside the session.
  const beforeTime = current.stats.time;
  await clickPanel(page, xr, 'map-play');
  current = await state(page);
  expect(current.paused).toBe(false);
  await page.waitForTimeout(1200);
  current = await state(page);
  expect(current.stats.time).toBeGreaterThan(beforeTime + 0.6);

  await clickPanel(page, xr, 'map-speed-2');
  current = await state(page);
  expect(current.rate).toBe(2);

  // Density steps change the fleet and the panel's live numbers.
  const carsBefore = current.stats.cars;
  await clickPanel(page, xr, 'map-density-up');
  current = await state(page);
  expect(current.targetCars).toBe(carsBefore + 16);
  expect(current.stats.cars).toBe(carsBefore + 16);

  // Table placement controls move the miniature, and reset returns home.
  const scaleBefore = current.xr.table.scale;
  await clickPanel(page, xr, 'map-scale-up');
  current = await state(page);
  expect(current.xr.table.scale).toBeGreaterThan(scaleBefore);
  // Scale +/- multiply the miniature and the rails sit 32x out, so there is no
  // tucked-in ceiling the way the old fixed 2.5 m width had.
  expect(current.xr.table.maxScale / current.xr.table.home.scale).toBeGreaterThan(30);

  const heightBefore = current.xr.table.position.y;
  await clickPanel(page, xr, 'map-height-up');
  current = await state(page);
  expect(current.xr.table.position.y).toBeGreaterThan(heightBefore);

  const yawBefore = current.xr.table.yaw;
  await clickPanel(page, xr, 'map-rotate-right');
  current = await state(page);
  expect(current.xr.table.yaw).not.toBeCloseTo(yawBefore, 3);

  await clickPanel(page, xr, 'map-reset-table');
  current = await state(page);
  expect(current.xr.table.scale).toBeCloseTo(DEFAULT_MAP_SCALE, 5);
  expect(current.xr.table.position.y).toBeCloseTo(0.9, 2);
  expect(current.xr.table.position.z).toBeCloseTo(-1.62, 1);
  expect(current.xr.table.locked).toBe(false);

  // Left thumbstick slides the table relative to the viewer.
  const beforeStick = current.xr.table.position;
  await xr.holdAxes('left', 0, -1, { frames: 8, release: true });
  await xr.waitForFrames(2);
  current = await state(page);
  expect(current.xr.table.position.z).not.toBeCloseTo(beforeStick.z, 2);

  // Lock blocks stick movement.
  await clickPanel(page, xr, 'map-lock');
  current = await state(page);
  expect(current.xr.table.locked).toBe(true);
  const lockedPosition = current.xr.table.position;
  await xr.holdAxes('left', 0, -1, { frames: 6, release: true });
  await xr.waitForFrames(2);
  current = await state(page);
  expect(current.xr.table.position).toEqual(lockedPosition);
  await clickPanel(page, xr, 'map-lock');

  await xr.setHeadPose({ euler: [-0.42, -0.55, 0] });
  await xr.waitForFrames(3);
  await xr.screenshot(testInfo.outputPath('vr-map-table.png'));

  // The world panel exposes Exit VR; leave through the manager so the test can
  // keep observing the teardown.
  current = await state(page);
  expect(current.xr.panelButtons['map-exit-vr']).toBeTruthy();
  await page.evaluate(() => window.__sandTable.exitVr());
  await page.waitForFunction(() => window.__roadMap.getState().xr.active === false);
  await expect(page.locator('body')).not.toHaveClass(/is-xr/);
  await expect(page.locator('#enter-vr')).toBeVisible();
  await expect(page.locator('#map-panel')).toBeVisible();
  expect(await xr.sessionMode()).toBeNull();

  current = await state(page);
  expect(current.active).toBe(true);
  expect(current.paused).toBe(false);
  expect(current.xr.table.scale).toBeCloseTo(1, 5);
  expect(current.camera.distance).toBeGreaterThan(300);
  // The desktop near plane is scale-aware for a 10 km extract, not the old
  // fixed 1 unit.
  const desktopNear = Math.max(
    1,
    Math.max(current.size.width, current.size.depth) * 0.0016,
  );
  expect(current.camera.near).toBeCloseTo(desktopNear, 1);

  // The sand table still works after map VR.
  await page.locator('#mode-sandbox').click();
  await page.waitForFunction(() => window.__sandTable.getState().mode === 'sandbox');
  const sandbox = await page.evaluate(() => window.__sandTable.getState());
  expect(sandbox.cars).toHaveLength(3);
  expect(sandbox.collision).toBeNull();

  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});

test('entering VR from the sandbox still works after the map has loaded', async ({ page, xr }) => {
  const errors = watchErrors(page);

  await page.goto('/?mode=map');
  await page.waitForFunction(() => window.__roadMapReady === true);
  await page.locator('#mode-sandbox').click();
  await page.waitForFunction(() => window.__sandTable.getState().mode === 'sandbox');

  await expect(page.locator('#enter-vr')).toBeVisible();
  await xr.enterVR({ button: '#enter-vr', timeout: 120_000 });
  await page.waitForFunction(() => window.__sandTable.getState().xr.placed === true);
  await xr.waitForFrames(3);

  const sandbox = await page.evaluate(() => window.__sandTable.getState());
  expect(sandbox.xr.active).toBe(true);
  expect(sandbox.xr.panelVisible).toBe(true);
  expect(sandbox.xr.table.scale).toBeCloseTo(0.28, 2);
  expect(sandbox.xr.tableCorners).toHaveLength(4);

  await page.evaluate(() => window.__sandTable.exitVr());
  await page.waitForFunction(() => window.__sandTable.getState().xr.active === false);
  await page.waitForFunction(() => window.__sandTable.getState().frameIndex > 0);

  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});
