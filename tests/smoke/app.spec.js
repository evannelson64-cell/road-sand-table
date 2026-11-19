import { test, expect } from '@playwright/test';

async function openApp(page) {
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

  await page.goto('/');
  await page.waitForFunction(() => window.__sandTableReady === true);
  await expect(page.locator('#scene')).toBeVisible();
  await expect(page.locator('#loading')).toHaveClass(/is-hidden/);

  return { consoleErrors, pageErrors, failedRequests };
}

async function collisionState(page) {
  return page.evaluate(() => window.__sandTable.getState());
}

test('loads, advances traffic and pauses cleanly with no console errors', async ({ page }) => {
  const errors = await openApp(page);

  await page.waitForFunction(() => window.__sandTable.getState().frameIndex > 20);
  await page.locator('#play').click();
  await page.waitForFunction(() => !window.__sandTable.getState().playing);

  const state = await page.evaluate(() => window.__sandTable.getState());
  expect(state.behaviorId).toBe('rules');
  expect(state.collision).toBeNull();
  expect(state.frameIndex).toBeGreaterThan(20);
  expect(state.cars).toHaveLength(3);

  await page.waitForTimeout(250);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
  expect(errors.failedRequests).toEqual([]);
});

test('a no-yield run pauses at contact and can show the safe version', async ({ page }) => {
  const errors = await openApp(page);

  await page.locator('[data-behavior="no-yield"]').click();
  await page.waitForFunction(() => window.__sandTable.getState().collision !== null);

  await expect(page.locator('#collision-scrim')).toBeVisible();
  await expect(page.locator('#collision-title')).toContainText('Conflict at');
  await expect(page.locator('#show-avoid')).toBeVisible();

  const crashed = await collisionState(page);
  expect(crashed.playing).toBe(false);
  expect(crashed.collision.carIds.sort()).toEqual(['cross', 'focus']);

  await page.locator('#show-avoid').click();
  await page.waitForFunction(() => window.__sandTable.getState().behaviorId === 'rules');

  const safe = await collisionState(page);
  expect(safe.playing).toBe(true);
  expect(safe.rate).toBe(0.5);
  expect(safe.collision).toBeNull();
  await expect(page.locator('#collision-scrim')).toBeHidden();
  await expect(page.locator('#lesson-banner')).toBeVisible();
  await expect(page.locator('#lesson-banner')).toContainText('waits for both Main Street cars');

  await page.waitForTimeout(400);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
  expect(errors.failedRequests).toEqual([]);
});

test('slow-motion replay and the scrubber return to recorded frames exactly', async ({ page }) => {
  const errors = await openApp(page);

  await page.locator('[data-behavior="no-yield"]').click();
  await page.waitForFunction(() => window.__sandTable.getState().collision !== null);
  const collisionFrame = (await collisionState(page)).frameIndex;

  await page.locator('#replay-slow').click();
  await page.waitForFunction(() => window.__sandTable.getState().rate === 0.25);
  const replay = await collisionState(page);
  expect(replay.playing).toBe(true);
  expect(replay.frameIndex).toBeGreaterThanOrEqual(Math.max(0, collisionFrame - 90));
  expect(replay.frameIndex).toBeLessThan(collisionFrame);

  await page.waitForFunction(
    (startFrame) => window.__sandTable.getState().frameIndex > startFrame,
    replay.frameIndex,
  );

  await page.evaluate(() => window.__sandTable.pause());
  const targetFrame = Math.max(1, collisionFrame - 150);
  await page.locator('#scrub').evaluate((input, frame) => {
    input.value = String(frame);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, targetFrame);

  const scrubbed = await collisionState(page);
  expect(scrubbed.playing).toBe(false);
  expect(scrubbed.frameIndex).toBe(targetFrame);

  await page.evaluate(() => window.__sandTable.stepBack());
  expect((await collisionState(page)).frameIndex).toBe(targetFrame - 1);
  await page.evaluate(() => window.__sandTable.stepForward());
  expect((await collisionState(page)).frameIndex).toBe(targetFrame);

  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
  expect(errors.failedRequests).toEqual([]);
});

test('the scenario menu loads different road layouts', async ({ page }) => {
  const errors = await openApp(page);

  await page.selectOption('#scenario-select', 'signal-unprotected-left');
  await page.waitForFunction(
    () => window.__sandTable.getState().scenarioId === 'signal-unprotected-left',
  );

  let state = await page.evaluate(() => window.__sandTable.getState());
  expect(state.scenarioTitle).toBe('Unprotected left');
  expect(state.scenarioCount).toBe(10);
  expect(state.cars).toHaveLength(2);
  await expect(page.locator('#scene-title')).toHaveText('Unprotected left');
  await expect(page.locator('#stage-label')).toContainText('1/10');
  await expect(page.locator('[data-behavior="no-yield"]')).toBeVisible();

  await page.selectOption('#scenario-select', 'railroad-crossing');
  await page.waitForFunction(
    () => window.__sandTable.getState().scenarioId === 'railroad-crossing',
  );
  state = await page.evaluate(() => window.__sandTable.getState());
  expect(state.cars).toHaveLength(2);
  expect(state.trains).toHaveLength(1);
  await expect(page.locator('#scene-title')).toHaveText('Railroad crossing');

  await page.waitForTimeout(300);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
  expect(errors.failedRequests).toEqual([]);
});

test('the sandbox view zooms from a whole diorama down to one junction and resets', async ({ page }) => {
  const errors = await openApp(page);
  const home = (await page.evaluate(() => window.__sandTable.getState())).camera;
  expect(home.distance).toBeGreaterThan(4);
  expect(home.minDistance).toBeLessThan(1);

  await page.evaluate(() => {
    const canvas = document.querySelector('#scene');
    const rect = canvas.getBoundingClientRect();
    for (let i = 0; i < 160; i += 1) {
      canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -120,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        cancelable: true,
      }));
    }
  });
  await page.waitForFunction(() => window.__sandTable.getState().camera.distance < 1);

  const close = (await page.evaluate(() => window.__sandTable.getState())).camera;
  expect(close.distance).toBeLessThan(1);

  await page.locator('#reset-view').click();
  await page.waitForFunction(
    (distance) => window.__sandTable.getState().camera.distance > distance * 0.8,
    home.distance,
  );
  expect((await page.evaluate(() => window.__sandTable.getState())).camera.distance)
    .toBeGreaterThan(4);

  await page.waitForTimeout(250);
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.pageErrors).toEqual([]);
  expect(errors.failedRequests).toEqual([]);
});
