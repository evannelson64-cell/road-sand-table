import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Simulation } from '../../src/sim/simulation.js';

const scenario = JSON.parse(
  readFileSync(new URL('../../data/scenario-two-way-stop.json', import.meta.url), 'utf8'),
);

function runUntilCollision(sim, maxFrames = 1800) {
  let frames = 0;
  while (frames < maxFrames && !sim.collision) {
    if (!sim.stepFrame()) {
      break;
    }
    frames += 1;
  }
  return frames;
}

test('the rules-following scenario stays collision-free', () => {
  const sim = new Simulation(scenario, { behaviorId: 'rules' });
  runUntilCollision(sim, 1200);

  assert.equal(sim.collision, null);
  assert.ok(sim.frameCount > 1000);
});

test('the no-yield scenario produces a deterministic collision', () => {
  const first = new Simulation(scenario, { behaviorId: 'no-yield' });
  const second = new Simulation(scenario, { behaviorId: 'no-yield' });

  runUntilCollision(first);
  runUntilCollision(second);

  assert.ok(first.collision);
  assert.deepEqual(first.collision.carIds, ['focus', 'cross']);
  assert.deepEqual(first.collision, second.collision);
  assert.equal(first.timeSeconds, second.timeSeconds);
});

test('rewinding restores exact state and stepping forward replays the same frame', () => {
  const sim = new Simulation(scenario, { behaviorId: 'no-yield' });
  for (let i = 0; i < 180; i += 1) {
    sim.stepFrame();
  }

  const captured = structuredClone(sim.createSnapshot());
  const capturedPose = sim.getCarPose(sim.cars[0]);

  sim.stepBackward();
  sim.stepBackward();
  assert.notDeepEqual(sim.createSnapshot(), captured);

  while (sim.frameIndex < 180) {
    sim.stepForward();
  }

  assert.deepEqual(sim.createSnapshot(), captured);
  assert.deepEqual(sim.getCarPose(sim.cars[0]), capturedPose);
});
