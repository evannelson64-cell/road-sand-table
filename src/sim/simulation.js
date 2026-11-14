// Deterministic, fixed-step traffic simulation.
// Rendering reads this state but never writes to it.

import { buildPolyline, closestPointOnPath, orientedBoxesOverlap, poseAt } from './geometry.js';
import { ReplayRecorder } from './recorder.js';

export const FIXED_DT = 1 / 60;
export const CAR_LENGTH = 0.32;
export const CAR_WIDTH = 0.16;

const CAR_ACCELERATION = 0.22; // m/s^2 on the miniature table
const CAR_DECELERATION = 0.34;
const STOP_LINE_SETBACK = 0.12;
const STOP_HOLD_SECONDS = 0.8;
const YIELD_LOOKAHEAD = 1.7;
const YIELD_CLEARANCE = 0.55;
const FOLLOW_LOOKAHEAD = 0.9;

function moveTowards(current, target, delta, acceleration, deceleration) {
  if (target > current) {
    return Math.min(target, current + acceleration * delta);
  }
  return Math.max(target, current - deceleration * delta);
}

function speedForGap(gap) {
  return Math.sqrt(Math.max(0, 2 * CAR_DECELERATION * gap));
}

/**
 * Turn the JSON scenario into the small amount of derived data the simulation
 * needs. Keeping this in one place makes the scenario files pleasant to author.
 */
export function prepareScenario(rawScenario) {
  const nodesById = new Map(rawScenario.nodes.map((node) => [node.id, node]));
  const lanesById = new Map();

  for (const rawLane of rawScenario.lanes) {
    const path = buildPolyline(rawLane.points.map(([x, z]) => ({ x, z })));
    const node = nodesById.get(rawLane.node);
    let nodeS = null;

    if (node) {
      nodeS = closestPointOnPath(path, { x: node.x, z: node.z }).s;
    }

    lanesById.set(rawLane.id, {
      ...rawLane,
      path,
      node,
      nodeS,
    });
  }

  return {
    ...rawScenario,
    nodesById,
    lanesById,
  };
}

function buildInitialCar(carDefinition, lane, behavior, index) {
  let stop = null;

  if (lane.node && lane.nodeS !== null) {
    const control = lane.node.controls?.[lane.approach] ?? 'none';
    const hasStopControl = control === 'stop' || control === 'yield';

    if (hasStopControl) {
      const stopDistance = Math.max(0, lane.nodeS - lane.node.half - STOP_LINE_SETBACK);
      stop = {
        nodeId: lane.node.id,
        control,
        s: stopDistance,
        hold: control === 'stop' ? STOP_HOLD_SECONDS : 0.35,
        yieldTo: lane.node.yield?.[lane.approach] ?? [],
        arrived: false,
        released: false,
        holdTimer: 0,
      };
    }
  }

  return {
    id: carDefinition.id,
    index,
    label: carDefinition.label ?? carDefinition.id,
    color: carDefinition.color ?? 'other',
    lane,
    s: Math.max(0, Math.min(lane.path.length, carDefinition.start ?? 0)),
    speed: lane.speed,
    stop,
    ignoreYield: behavior.violations?.[carDefinition.id] === 'yield',
    length: CAR_LENGTH,
    width: CAR_WIDTH,
  };
}

export class Simulation {
  constructor(rawScenario, options = {}) {
    this.scenario = prepareScenario(rawScenario);
    this.fixedDt = FIXED_DT;
    this.recorder = new ReplayRecorder(options.historyFrames ?? 7200);
    this.behaviorId = options.behaviorId ?? rawScenario.behaviors[0].id;
    this.cars = [];
    this.time = 0;
    this.collision = null;
    this.reset(this.behaviorId);
  }

  reset(behaviorId = this.behaviorId) {
    const behavior = this.scenario.behaviors.find((entry) => entry.id === behaviorId);
    if (!behavior) {
      throw new Error(`Unknown behavior: ${behaviorId}`);
    }

    this.behaviorId = behavior.id;
    this.behavior = behavior;
    this.time = 0;
    this.collision = null;
    this.cars = this.scenario.cars.map((definition, index) => {
      const lane = this.scenario.lanesById.get(definition.lane);
      if (!lane) {
        throw new Error(`Car ${definition.id} references missing lane ${definition.lane}`);
      }
      return buildInitialCar(definition, lane, behavior, index);
    });
    this.recorder.reset(this.createSnapshot());
  }

  setBehavior(behaviorId) {
    this.reset(behaviorId);
  }

  /** True when another car on a lane we must yield to is approaching or inside. */
  hasConflictingTraffic(car) {
    if (!car.stop || car.stop.yieldTo.length === 0) {
      return false;
    }

    for (const laneId of car.stop.yieldTo) {
      const otherLane = this.scenario.lanesById.get(laneId);
      if (!otherLane || otherLane.nodeS === null) {
        continue;
      }

      for (const other of this.cars) {
        if (other.id === car.id || other.lane.id !== laneId) {
          continue;
        }

        const distanceBeforeNode = otherLane.nodeS - other.s;
        const distancePastNode = other.s - otherLane.nodeS;
        const approaching =
          distanceBeforeNode >= 0 &&
          distanceBeforeNode <= YIELD_LOOKAHEAD &&
          other.speed > 0.02;
        const stillInside = distancePastNode >= 0 && distancePastNode < YIELD_CLEARANCE;

        if (approaching || stillInside) {
          return true;
        }
      }
    }

    return false;
  }

  nearestCarAhead(car) {
    let nearest = null;
    let nearestGap = Infinity;

    for (const other of this.cars) {
      if (other.id === car.id || other.lane.id !== car.lane.id) {
        continue;
      }

      const distanceAhead = other.s - car.s;
      if (distanceAhead <= 0 || distanceAhead > FOLLOW_LOOKAHEAD) {
        continue;
      }

      const gap = distanceAhead - (car.length + other.length) / 2;
      if (gap < nearestGap) {
        nearest = other;
        nearestGap = gap;
      }
    }

    return { car: nearest, gap: nearestGap };
  }

  updateCar(car, dt) {
    let targetSpeed = car.lane.speed;

    // Do not drive beyond the modelled lane.
    const remainingLane = car.lane.path.length - car.s;
    if (remainingLane < 0.25) {
      targetSpeed = Math.min(targetSpeed, speedForGap(Math.max(0, remainingLane - 0.015)));
    }

    // Safe following distance on the same lane.
    const lead = this.nearestCarAhead(car);
    if (lead.car) {
      const followingLimit = speedForGap(Math.max(0, lead.gap - 0.035));
      targetSpeed = Math.min(targetSpeed, followingLimit);
    }

    if (car.stop && !car.stop.released) {
      if (!car.stop.arrived) {
        const gapToStop = car.stop.s - car.s;

        if (gapToStop <= 0.02) {
          car.s = car.stop.s;
          car.speed = 0;
          car.stop.arrived = true;
          car.stop.holdTimer = car.stop.hold;
          targetSpeed = 0;
        } else {
          targetSpeed = Math.min(targetSpeed, speedForGap(Math.max(0, gapToStop - 0.008)));
        }
      }

      if (car.stop.arrived) {
        car.stop.holdTimer = Math.max(0, car.stop.holdTimer - dt);

        const mayProceed =
          car.stop.holdTimer <= 0 &&
          (car.ignoreYield || !this.hasConflictingTraffic(car));

        if (mayProceed) {
          car.stop.released = true;
        } else {
          targetSpeed = 0;
        }
      }
    }

    car.speed = moveTowards(
      car.speed,
      targetSpeed,
      dt,
      CAR_ACCELERATION,
      CAR_DECELERATION,
    );

    car.s += car.speed * dt;

    // Never overshoot the stop line, even with a coarse accumulator step.
    if (car.stop && !car.stop.arrived && car.s >= car.stop.s) {
      car.s = car.stop.s;
      car.speed = 0;
      car.stop.arrived = true;
      car.stop.holdTimer = car.stop.hold;
    }

    if (car.s >= car.lane.path.length) {
      car.s = car.lane.path.length;
      car.speed = 0;
    }
  }

  detectCollision() {
    for (let i = 0; i < this.cars.length; i += 1) {
      for (let j = i + 1; j < this.cars.length; j += 1) {
        const a = this.cars[i];
        const b = this.cars[j];
        const poseA = this.getCarPose(a);
        const poseB = this.getCarPose(b);
        const result = orientedBoxesOverlap(
          { ...poseA, length: a.length, width: a.width },
          { ...poseB, length: b.length, width: b.width },
        );

        if (result.hit) {
          return {
            carIds: [a.id, b.id],
            point: result.point,
            time: this.time,
            depth: result.depth,
          };
        }
      }
    }

    return null;
  }

  stepFrame() {
    if (this.collision) {
      return false;
    }

    for (const car of this.cars) {
      this.updateCar(car, this.fixedDt);
    }

    this.time += this.fixedDt;
    this.collision = this.detectCollision();
    this.recorder.record(this.createSnapshot());
    return true;
  }

  createSnapshot() {
    return {
      time: this.time,
      behaviorId: this.behaviorId,
      cars: this.cars.map((car) => ({
        id: car.id,
        s: car.s,
        speed: car.speed,
        stop: car.stop
          ? {
              arrived: car.stop.arrived,
              released: car.stop.released,
              holdTimer: car.stop.holdTimer,
            }
          : null,
      })),
      collision: this.collision ? structuredClone(this.collision) : null,
    };
  }

  restoreSnapshot(snapshot) {
    if (!snapshot) {
      return;
    }

    this.time = snapshot.time;
    this.collision = snapshot.collision ? structuredClone(snapshot.collision) : null;

    for (const car of this.cars) {
      const carSnapshot = snapshot.cars.find((entry) => entry.id === car.id);
      if (!carSnapshot) {
        continue;
      }
      car.s = carSnapshot.s;
      car.speed = carSnapshot.speed;
      if (car.stop && carSnapshot.stop) {
        car.stop.arrived = carSnapshot.stop.arrived;
        car.stop.released = carSnapshot.stop.released;
        car.stop.holdTimer = carSnapshot.stop.holdTimer;
      }
    }
  }

  seekFrame(index) {
    const snapshot = this.recorder.seek(index);
    this.restoreSnapshot(snapshot);
    return snapshot;
  }

  stepForward() {
    if (this.recorder.hasFuture) {
      this.recorder.stepForward();
      this.restoreSnapshot(this.recorder.currentFrame);
      return 'replay';
    }

    if (this.stepFrame()) {
      return 'simulated';
    }
    return 'blocked';
  }

  stepBackward() {
    if (this.recorder.index <= 0) {
      return false;
    }
    this.recorder.stepBack();
    this.restoreSnapshot(this.recorder.currentFrame);
    return true;
  }

  get frameIndex() {
    return this.recorder.index;
  }

  get frameCount() {
    return this.recorder.frameCount;
  }

  get timeSeconds() {
    return this.time;
  }

  getCarPose(car) {
    return poseAt(car.lane.path, car.s);
  }

  getCarSnapshots() {
    return this.cars.map((car) => ({
      id: car.id,
      label: car.label,
      color: car.color,
      pose: this.getCarPose(car),
      speed: car.speed,
    }));
  }

  /** Binary search the recorded collision frame, used by the replay button. */
  findCollisionFrame() {
    for (let index = this.frameCount - 1; index >= 0; index -= 1) {
      const frame = this.recorder.frames[index];
      if (frame.collision) {
        return index;
      }
    }
    return -1;
  }
}
