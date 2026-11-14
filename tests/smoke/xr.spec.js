import { test, expect } from 'playwright-webxr';
import { aimQuaternion } from 'playwright-webxr/examples/aim-controller';

test.use({
  xrDeviceName: 'metaQuest2',
  xrStereoEnabled: false,
});

const PANEL_ORIGIN = [0.35, 1.2, -0.4];

async function state(page) {
  return page.evaluate(() => window.__sandTable.getState());
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
  expect(target, `${buttonId} should be on the panel`).toBeTruthy();
  await aimAt(xr, target, origin);
  await xr.pressButton('right', 'trigger');
  await xr.waitForFrames(3);
}

async function enterVr(page, xr) {
  await page.goto('/');
  await page.waitForFunction(() => window.__sandTableReady === true);
  await expect(page.locator('#enter-vr')).toBeVisible();
  await xr.enterVR({ button: '#enter-vr', timeout: 20_000 });
  await xr.waitForFrames(5);
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

test('immersive VR has four corner grips, placement controls and a movable panel', async ({ page, xr }) => {
  const errors = watchErrors(page);
  await enterVr(page, xr);

  let current = await state(page);
  expect(current.xr.active).toBe(true);
  expect(current.xr.placed).toBe(true);
  expect(current.xr.panelVisible).toBe(true);
  expect(current.xr.handTracking).toBe(false);
  expect(current.xr.enabledFeatures).toContain('hand-tracking');
  expect(current.xr.table.scale).toBeCloseTo(0.28, 2);
  expect(current.xr.tableCorners).toHaveLength(4);
  expect(current.playing).toBe(false);

  await clickPanel(page, xr, 'height-up');
  current = await state(page);
  expect(current.xr.table.position.y).toBeGreaterThan(0.85);

  const yawBefore = current.xr.table.yaw;
  await clickPanel(page, xr, 'rotate-right');
  current = await state(page);
  expect(current.xr.table.yaw).not.toBeCloseTo(yawBefore, 3);

  await clickPanel(page, xr, 'scale-up');
  current = await state(page);
  expect(current.xr.table.scale).toBeGreaterThan(0.28);

  await clickPanel(page, xr, 'play');
  current = await state(page);
  expect(current.playing).toBe(true);
  await clickPanel(page, xr, 'play');
  current = await state(page);
  expect(current.playing).toBe(false);

  // The world panel timeline can jump to an exact recorded frame.
  current = await state(page);
  expect(current.frameCount).toBeGreaterThan(10);
  const halfFrame = Math.round((current.frameCount - 1) * 0.5);
  await aimAt(xr, current.xr.panelTimeline);
  await xr.pressButton('right', 'trigger');
  await xr.waitForFrames(3);
  current = await state(page);
  expect(current.playing).toBe(false);
  expect(Math.abs(current.frameIndex - halfFrame)).toBeLessThanOrEqual(4);

  // Left thumbstick translates the whole table relative to the viewer.
  const beforeStick = current.xr.table.position;
  await xr.holdAxes('left', 0, -1, { frames: 8, release: true });
  await xr.waitForFrames(2);
  current = await state(page);
  expect(current.xr.table.position.z).not.toBeCloseTo(beforeStick.z, 2);

  // Lock blocks both thumbstick movement and a direct corner grab.
  await clickPanel(page, xr, 'lock');
  current = await state(page);
  expect(current.xr.table.locked).toBe(true);
  const lockedPosition = current.xr.table.position;
  await xr.holdAxes('left', 0, -1, { frames: 6, release: true });
  await xr.waitForFrames(2);
  current = await state(page);
  expect(current.xr.table.position).toEqual(lockedPosition);

  const lockedCorner = current.xr.tableCorners.find((entry) => entry.id === 'corner-nw').position;
  const lockedOrigin = [lockedCorner[0] + 0.12, lockedCorner[1] + 0.3, lockedCorner[2] + 0.3];
  await xr.setGripPose('right', { position: lockedOrigin, quaternion: [0, 0, 0, 1] });
  await xr.setControllerPose('right', {
    position: lockedOrigin,
    quaternion: aimQuaternion(lockedOrigin, lockedCorner),
  });
  await xr.waitForFrames(3);
  await xr.hold('right', 'squeeze', { frames: 2 });
  await xr.waitForFrames(2);
  expect((await state(page)).xr.input.tableGrabs).toBe(0);
  await xr.release('right', 'squeeze');
  await xr.waitForFrames(2);

  await clickPanel(page, xr, 'reset-table');
  current = await state(page);
  expect(current.xr.table.locked).toBe(false);
  expect(current.xr.table.scale).toBeCloseTo(0.28, 2);
  expect(current.xr.table.position.z).toBeCloseTo(-1.02, 1);

  // The world-space panel itself can be grabbed by its dashed header.
  const panelBefore = current.xr.panelPosition;
  const header = current.xr.panelHeader;
  const handleStart = [0.55, 1.25, -0.55];
  await xr.setGripPose('right', { position: handleStart, quaternion: [0, 0, 0, 1] });
  await xr.setControllerPose('right', {
    position: handleStart,
    quaternion: aimQuaternion(handleStart, header),
  });
  await xr.waitForFrames(3);
  await xr.hold('right', 'squeeze', { frames: 2 });
  await xr.setGripPose('right', { position: [0.65, 1.31, -0.6], quaternion: [0, 0, 0, 1] });
  await xr.waitForFrames(4);
  await xr.release('right', 'squeeze');
  await xr.waitForFrames(2);
  current = await state(page);
  expect(current.xr.panelPosition).not.toEqual(panelBefore);

  // A single corner grab translates the table in all three axes.
  const corner = current.xr.tableCorners.find((entry) => entry.id === 'corner-nw').position;
  const grabOrigin = [corner[0] + 0.12, corner[1] + 0.3, corner[2] + 0.3];
  await xr.setGripPose('right', { position: grabOrigin, quaternion: [0, 0, 0, 1] });
  await xr.setControllerPose('right', {
    position: grabOrigin,
    quaternion: aimQuaternion(grabOrigin, corner),
  });
  await xr.waitForFrames(3);
  const tableBefore = (await state(page)).xr.table.position;
  await xr.hold('right', 'squeeze', { frames: 2 });
  await xr.waitForFrames(2);
  expect((await state(page)).xr.input.tableGrabs).toBe(1);
  await xr.setGripPose('right', {
    position: [grabOrigin[0] + 0.08, grabOrigin[1] + 0.05, grabOrigin[2] - 0.03],
    quaternion: [0, 0, 0, 1],
  });
  await xr.waitForFrames(4);
  await xr.release('right', 'squeeze');
  await xr.waitForFrames(2);
  current = await state(page);
  expect(current.xr.table.position.x).not.toBeCloseTo(tableBefore.x, 2);
  expect(current.xr.table.position.y).not.toBeCloseTo(tableBefore.y, 2);
  expect(current.xr.table.position.z).not.toBeCloseTo(tableBefore.z, 2);
  expect(current.xr.input.tableGrabs).toBe(0);

  expect(current.xr.render.calls).toBeLessThan(200);

  await page.evaluate(() => window.__sandTable.exitVr());
  await page.waitForFunction(() => window.__sandTable.getState().xr.active === false);
  await expect(page.locator('body')).not.toHaveClass(/is-xr/);
  await expect(page.locator('#enter-vr')).toBeVisible();
  expect(await xr.sessionMode()).toBeNull();

  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});

test('two-hand scaling and the collision lesson work in immersive VR', async ({ page, xr }, testInfo) => {
  const errors = watchErrors(page);
  await enterVr(page, xr);

  let current = await state(page);
  const leftCorner = current.xr.tableCorners.find((entry) => entry.id === 'corner-nw').position;
  const rightCorner = current.xr.tableCorners.find((entry) => entry.id === 'corner-ne').position;
  const leftPos = [leftCorner[0] + 0.12, leftCorner[1] + 0.28, leftCorner[2] + 0.3];
  const rightPos = [rightCorner[0] - 0.12, rightCorner[1] + 0.28, rightCorner[2] + 0.3];

  await xr.setGripPose('left', { position: leftPos, quaternion: [0, 0, 0, 1] });
  await xr.setGripPose('right', { position: rightPos, quaternion: [0, 0, 0, 1] });
  await xr.waitForFrames(2);
  await xr.setControllerPose('left', {
    position: leftPos,
    quaternion: aimQuaternion(leftPos, leftCorner),
  });
  await xr.setControllerPose('right', {
    position: rightPos,
    quaternion: aimQuaternion(rightPos, rightCorner),
  });
  await xr.waitForFrames(3);

  await xr.hold('left', 'squeeze', { frames: 2 });
  await xr.hold('right', 'squeeze', { frames: 2 });
  await xr.waitForFrames(2);
  expect((await state(page)).xr.input.tableGrabs).toBe(2);

  await xr.setGripPose('left', {
    position: [leftPos[0] + 0.18, leftPos[1], leftPos[2]],
    quaternion: [0, 0, 0, 1],
  });
  await xr.setGripPose('right', {
    position: [rightPos[0] - 0.18, rightPos[1], rightPos[2]],
    quaternion: [0, 0, 0, 1],
  });
  await xr.waitForFrames(4);
  await xr.release('left', 'squeeze');
  await xr.release('right', 'squeeze');
  await xr.waitForFrames(2);
  current = await state(page);
  expect(current.xr.table.scale).toBeGreaterThan(0.3);

  await clickPanel(page, xr, 'reset-table');
  current = await state(page);
  expect(current.xr.table.scale).toBeCloseTo(0.28, 2);
  expect(current.xr.table.locked).toBe(false);

  await clickPanel(page, xr, 'behavior-no-yield');
  await page.waitForFunction(
    () => window.__sandTable.getState().collision !== null,
    null,
    { timeout: 30_000 },
  );
  current = await state(page);
  expect(current.playing).toBe(false);
  expect(current.collision.carIds.sort()).toEqual(['cross', 'focus']);

  await xr.setHeadPose({ euler: [-0.6, 0, 0] });
  await xr.waitForFrames(3);
  await xr.screenshot(testInfo.outputPath('vr-collision.png'));

  await clickPanel(page, xr, 'show-avoid');
  await xr.waitForFrames(3);
  current = await state(page);
  expect(current.behaviorId).toBe('rules');
  expect(current.playing).toBe(true);
  expect(current.rate).toBe(0.5);
  expect(current.collision).toBeNull();
  expect(current.xr.notice?.title).toBe('Correct behavior');

  await xr.screenshot(testInfo.outputPath('vr-safe.png'));

  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});

test('scenario navigation works inside immersive VR', async ({ page, xr }) => {
  const errors = watchErrors(page);
  await enterVr(page, xr);

  let current = await state(page);
  expect(current.scenarioId).toBe('two-way-stop');
  expect(current.xr.panelVisible).toBe(true);

  await clickPanel(page, xr, 'scenario-next');
  await page.waitForFunction(
    () => window.__sandTable.getState().scenarioId === 't-intersection',
  );
  current = await state(page);
  expect(current.scenarioTitle).toBe('T-intersection');
  expect(current.playing).toBe(false);
  expect(current.xr.panelVisible).toBe(true);
  expect(current.xr.tableCorners).toHaveLength(4);

  await clickPanel(page, xr, 'scenario-prev');
  await page.waitForFunction(
    () => window.__sandTable.getState().scenarioId === 'two-way-stop',
  );

  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
});
