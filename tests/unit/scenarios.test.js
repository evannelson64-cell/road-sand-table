import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Simulation } from '../../src/sim/simulation.js';

const catalog = JSON.parse(
  readFileSync(new URL('../../data/scenarios.json', import.meta.url), 'utf8'),
);

function loadScenario(entry) {
  return JSON.parse(
    readFileSync(new URL(`../../data/${entry.file}`, import.meta.url), 'utf8'),
  );
}

function runFrames(sim, maxFrames = 1800) {
  let frames = 0;
  while (frames < maxFrames && !sim.collision) {
    if (!sim.stepFrame()) {
      break;
    }
    frames += 1;
  }
  return frames;
}

test('all ten scenario tiles load with complete lesson metadata', () => {
  assert.equal(catalog.scenarios.length, 10);
  const ids = new Set();

  for (const entry of catalog.scenarios) {
    const scenario = loadScenario(entry);
    assert.equal(scenario.id, entry.id);
    assert.ok(scenario.title);
    assert.ok(scenario.caption?.rule);
    assert.ok(scenario.behaviors.length >= 2);
    assert.ok(scenario.behaviors.some((behavior) => behavior.isCorrect === true));
    assert.ok(scenario.behaviors.some((behavior) => behavior.isCorrect === false));
    assert.ok(scenario.cars.some((car) => car.color === 'focus'));
    assert.ok(!ids.has(scenario.id));
    ids.add(scenario.id);
  }

  assert.equal(ids.size, 10);
});

for (const entry of catalog.scenarios) {
  test(`${entry.title}: the correct preset is collision-free and the failure preset collides`, () => {
    const scenario = loadScenario(entry);
    const correct = scenario.behaviors.find((behavior) => behavior.isCorrect);
    const failure = scenario.behaviors.find((behavior) => behavior.isCorrect === false);

    const safe = new Simulation(scenario, { behaviorId: correct.id });
    runFrames(safe, 1800);
    assert.equal(
      safe.collision,
      null,
      `${entry.title} correct preset collided at ${safe.timeSeconds}s`,
    );

    const unsafe = new Simulation(scenario, { behaviorId: failure.id });
    runFrames(unsafe, 1800);
    assert.ok(
      unsafe.collision,
      `${entry.title} failure preset never collided`,
    );

    const replay = new Simulation(scenario, { behaviorId: failure.id });
    runFrames(replay, unsafe.frameIndex);
    assert.deepEqual(replay.collision, unsafe.collision);
  });
}
