import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRoadNetwork } from '../../src/map/graph.js';
import {
  DriveController,
  chooseOption,
  classifyTurn,
  junctionOptions,
  pickSpawnLane,
} from '../../src/map/drive.js';

const document = JSON.parse(
  readFileSync(new URL('../../data/maps/yorkville-heartland.json', import.meta.url), 'utf8'),
);
const network = buildRoadNetwork(document);

function drive(controller, seconds, cars = []) {
  const steps = Math.round(seconds * 60);
  for (let step = 0; step < steps; step += 1) {
    controller.update(1 / 60, cars);
  }
}

test('turn classification follows the map heading convention', () => {
  const eastLane = {
    edgeId: 1,
    endDirection: { x: 1, z: 0 },
  };
  const turnLane = (edgeId, x, z) => ({ edgeId, startDirection: { x, z } });

  assert.equal(classifyTurn(eastLane, turnLane(2, 1, 0)).side, 'straight');
  // +Z is south, so southbound from an eastbound approach is a right turn.
  const right = classifyTurn(eastLane, turnLane(3, 0, 1));
  assert.equal(right.side, 'right');
  assert.ok(right.angle > 0, 'right turns have a positive cross product');
  assert.equal(classifyTurn(eastLane, turnLane(4, 0, -1)).side, 'left');
  assert.equal(classifyTurn(eastLane, turnLane(1, -1, 0)).side, 'uturn');
  // An edge reversing onto itself is a U-turn even if the chord is odd.
  assert.equal(classifyTurn(eastLane, turnLane(1, 1, 0.2)).side, 'uturn');
});

test('junction options list only real continuations and never the current lane', () => {
  const lane = network.lanes.find((entry) => {
    if (!entry.drivable) {
      return false;
    }
    return junctionOptions(network, entry).length >= 3;
  });
  assert.ok(lane, 'the extract has a junction with at least three choices');

  const options = junctionOptions(network, lane);
  assert.ok(options.length >= 3);
  for (const option of options) {
    assert.notEqual(option.lane.id, lane.id);
    assert.equal(option.lane.drivable, true);
    assert.ok(['left', 'straight', 'right', 'uturn'].includes(option.side));
    assert.ok(Number.isFinite(option.angle));
  }
  for (let index = 1; index < options.length; index += 1) {
    assert.ok(options[index - 1].deviation <= options[index].deviation);
  }
});

test('a missing turn falls back to a drivable option instead of null', () => {
  const onlyRight = [{ side: 'right', lane: {}, name: 'Right Road', deviation: 0 }];
  assert.equal(chooseOption(onlyRight, 'left').side, 'right');
  assert.equal(chooseOption(onlyRight, 'uturn').side, 'right');
  assert.equal(chooseOption(onlyRight, 'straight').side, 'right');
  assert.equal(chooseOption([], 'left'), null);
});

test('the spawn lane is drivable and has room to run', () => {
  const spawn = pickSpawnLane(network);
  assert.ok(spawn);
  assert.equal(spawn.lane.drivable, true);
  assert.ok(spawn.lane.length >= 40);
  assert.ok(spawn.s >= 0 && spawn.s < spawn.lane.length);
});

test('the car drives the real network for a minute without NaNs or stalls', () => {
  const controller = new DriveController(network);
  assert.equal(controller.start(), true);
  drive(controller, 60);

  const state = controller.getState();
  assert.ok(state.junctions >= 1, 'the drive reaches at least one junction');
  assert.ok(Number.isFinite(state.pose.x) && Number.isFinite(state.pose.z));
  assert.ok(Number.isFinite(state.speed) && state.speed >= 0);
  assert.ok(state.lane.length > 0);
  assert.ok(state.distanceToJunction >= 0);
  assert.equal(controller.recoveries, 0, 'open road needs no failsafe');
});

test('choosing a right turn takes the right-hand lane at the junction', () => {
  let picked = null;
  for (const lane of network.lanes) {
    if (!lane.drivable || lane.length < 40) {
      continue;
    }
    const option = junctionOptions(network, lane).find((entry) => entry.side === 'right');
    if (option) {
      picked = { lane, option };
      break;
    }
  }
  assert.ok(picked, 'the extract has a right turn to take');

  const controller = new DriveController(network);
  controller.start(picked.lane, picked.lane.length - 25);
  controller.setRequest('right');
  for (let step = 0; step < 30 * 60 && controller.junctions === 0; step += 1) {
    controller.update(1 / 60);
  }

  assert.equal(controller.junctions, 1);
  const taken = controller.segment === 'connector'
    ? controller.connector.toLane
    : controller.lane;
  assert.equal(taken.id, picked.option.lane.id);
  assert.equal(controller.uturns, 0);
  // The request resets so the next junction is not silently another right.
  assert.equal(controller.getState().requested, 'straight');
});

test('a dead end turns the car around instead of stopping it', () => {
  const tiny = {
    size: { width: 100, depth: 100 },
    nodes: [
      { id: 'a', x: 0, z: 0 },
      { id: 'b', x: 0, z: 60 },
    ],
    edges: [{
      id: 0,
      from: 0,
      to: 1,
      points: [[0, 0], [0, 60]],
      width: 7,
      speed: 10,
      class: 'residential',
      drivable: true,
      oneway: false,
      name: 'Dead End Lane',
    }],
  };
  const tinyNetwork = buildRoadNetwork(tiny);
  const lane = tinyNetwork.lanes.find((entry) => entry.drivable && entry.forward);
  const controller = new DriveController(tinyNetwork);
  controller.start(lane, lane.length - 12);

  drive(controller, 40);

  const state = controller.getState();
  assert.ok(state.junctions >= 1);
  assert.ok(state.uturns >= 1, 'the dead end is resolved with a U-turn');
  assert.ok(Number.isFinite(state.speed));
  assert.equal(state.lane, 'Dead End Lane');
  assert.ok(Math.abs(state.pose.x) <= 4, 'the car stays on the road corridor');
  assert.ok(state.pose.z >= -5 && state.pose.z <= 65);
});

test('traffic blocking the lane is ghosted through and the drive resumes', () => {
  const controller = new DriveController(network);
  controller.start();
  drive(controller, 1);

  // A stationary car glued six metres ahead would stop a naive follower
  // forever. The failsafe should ghost past it within a few seconds.
  const obstacle = () => ({
    x: controller.pose.x + controller.pose.dirX * 6,
    z: controller.pose.z + controller.pose.dirZ * 6,
    heading: controller.pose.heading,
    speed: 0,
  });
  for (let step = 0; step < 8 * 60; step += 1) {
    controller.update(1 / 60, [obstacle()]);
  }

  const state = controller.getState();
  assert.ok(state.recoveries >= 1, 'the stall was detected');
  assert.equal(state.ghost, true, 'traffic is ignored while easing past');
  assert.ok(state.speed > 0.25 || state.segment === 'connector');
});
