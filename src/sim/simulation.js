// Deterministic, fixed-step traffic simulation.
// Rendering reads this state but never writes to it.

import {
  buildPolyline,
  closestPointOnPath,
  orientedBoxesOverlap,
  poseAt,
  smoothPolyline,
} from './geometry.js';
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
const ALL_WAY_TIE_WINDOW = 0.15;
const RIGHT_OF_APPROACH = {
  west: 'south',
  south: 'east',
  east: 'north',
  north: 'west',
};

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
    const controlPoints = rawLane.points.map(([x, z]) => ({ x, z }));
    const sampledPoints = rawLane.smooth
      ? smoothPolyline(controlPoints, rawLane.samplesPerSegment ?? 12)
      : controlPoints;
    const path = buildPolyline(sampledPoints);
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
    const control = lane.control ?? lane.node.controls?.[lane.approach] ?? 'none';
    const hasStopControl = ['stop', 'yield', 'signal', 'rail'].includes(control);

    if (hasStopControl) {
      const stopDistance = lane.stopAt !== undefined
        ? Math.max(0, lane.stopAt)
        : Math.max(0, lane.nodeS - lane.node.half - STOP_LINE_SETBACK);
      const hold = control === 'stop'
        ? STOP_HOLD_SECONDS
        : control === 'yield'
          ? 0.3
          : 0;
      stop = {
        nodeId: lane.node.id,
        node: lane.node,
        approach: lane.approach,
        control,
        s: stopDistance,
        hold,
        yieldTo: lane.node.yield?.[lane.approach] ?? [],
        arrived: false,
        released: false,
        holdTimer: 0,
        arrivedAt: null,
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
    ignoreAllWay: behavior.violations?.[carDefinition.id] === 'allway',
    ignoreRail: behavior.violations?.[carDefinition.id] === 'rail',
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

    this.trains = (this.scenario.trains ?? []).map((definition) => {
      const lane = this.scenario.lanesById.get(definition.lane);
      if (!lane) {
        throw new Error(`Train ${definition.id} references missing lane ${definition.lane}`);
      }
      return {
        id: definition.id,
        label: definition.label ?? definition.id,
        lane,
        s: Math.max(0, Math.min(lane.path.length, definition.start ?? 0)),
        speed: definition.speed ?? 0.2,
        length: definition.length ?? 0.9,
        width: definition.width ?? 0.22,
        color: definition.color ?? 'train',
      };
    });

    this.recorder.reset(this.createSnapshot());
  }

  setBehavior(behaviorId) {
    this.reset(behaviorId);
  }

  getSignalState(node, approach, time = this.time) {
    const phases = node?.signal?.phases;
    if (!Array.isArray(phases) || phases.length === 0) {
      return null;
    }

    const period = phases.reduce((total, phase) => total + phase.duration, 0);
    if (period <= 0) {
      return null;
    }

    let localTime = (time + (node.signal.offset ?? 0)) % period;
    if (localTime < 0) {
      localTime += period;
    }

    for (const phase of phases) {
      if (localTime < phase.duration) {
        if (phase.green?.includes(approach)) {
          return 'green';
        }
        if (phase.yellow?.includes(approach)) {
          return 'yellow';
        }
        return 'red';
      }
      localTime -= phase.duration;
    }

    return 'red';
  }

  getSignalSnapshots() {
    const snapshot = {};
    for (const node of this.scenario.nodes) {
      if (!node.signal) {
        continue;
      }
      snapshot[node.id] = {};
      for (const approach of Object.keys(node.controls ?? {})) {
        if (node.controls[approach] === 'signal') {
          snapshot[node.id][approach] = this.getSignalState(node, approach);
        }
      }
    }
    return snapshot;
  }

  isRailCrossingActive(node) {
    if (!node?.railroad) {
      return false;
    }
    const activationDistance = node.railroad.activationDistance ?? 1.0;
    for (const train of this.trains) {
      const pose = poseAt(train.lane.path, train.s);
      const distance = Math.hypot(pose.x - node.x, pose.z - node.z);
      if (distance < activationDistance + train.length / 2) {
        return true;
      }
    }
    return false;
  }

  canProceedAllWay(car) {
    const nodeId = car.stop.nodeId;
    const waiting = this.cars
      .filter((other) => (
        other.stop?.nodeId === nodeId &&
        other.stop.arrived &&
        !other.stop.released
      ))
      .sort((a, b) => {
        const arrivalDelta = (a.stop.arrivedAt ?? Infinity) - (b.stop.arrivedAt ?? Infinity);
        if (Math.abs(arrivalDelta) > ALL_WAY_TIE_WINDOW) {
          return arrivalDelta;
        }

        // Near-simultaneous arrivals yield to the car on the right.
        if (RIGHT_OF_APPROACH[a.stop.approach] === b.stop.approach) {
          return 1;
        }
        if (RIGHT_OF_APPROACH[b.stop.approach] === a.stop.approach) {
          return -1;
        }
        return arrivalDelta || a.id.localeCompare(b.id);
      });

    if (waiting.length === 0 || waiting[0].id !== car.id) {
      return false;
    }

    for (const other of this.cars) {
      if (other.id === car.id || other.stop?.nodeId !== nodeId || !other.stop?.released) {
        continue;
      }
      const distancePast = other.s - other.lane.nodeS;
      if (distancePast < 0.85) {
        return false;
      }
    }

    return true;
  }

  hasRoundaboutConflict(car) {
    const roundabout = car.stop.node?.roundabout;
    if (!roundabout) {
      return false;
    }

    const direction = {
      north: { x: 0, z: -1 },
      south: { x: 0, z: 1 },
      east: { x: 1, z: 0 },
      west: { x: -1, z: 0 },
    }[car.stop.approach];
    if (!direction) {
      return false;
    }

    const entryX = car.stop.node.x + direction.x * roundabout.radius;
    const entryZ = car.stop.node.z + direction.z * roundabout.radius;
    const threshold = roundabout.conflictRadius ?? 0.36;

    for (const other of this.cars) {
      if (other.id === car.id || !other.lane.roundabout) {
        continue;
      }
      const pose = this.getCarPose(other);
      if (Math.hypot(pose.x - entryX, pose.z - entryZ) < threshold) {
        return true;
      }
    }
    return false;
  }

  shouldStopForControl(car) {
    if (!car.stop || car.stop.released) {
      return false;
    }

    const { control, node, approach } = car.stop;

    if (control === 'signal') {
      const state = this.getSignalState(node, approach);
      if (state !== 'green') {
        return true;
      }
      return !car.ignoreYield && this.hasConflictingTraffic(car);
    }

    if (control === 'rail') {
      return !car.ignoreRail && this.isRailCrossingActive(node);
    }

    if (control === 'stop') {
      return true;
    }

    if (control === 'yield') {
      if (car.ignoreYield) {
        return false;
      }
      // Teaching yield signs as a deliberate pause at the line makes the gap
      // check legible and keeps roundabout/ramp geometry predictable.
      return true;
    }

    return false;
  }

  canProceedFromStop(car) {
    if (!car.stop || car.stop.holdTimer > 0) {
      return false;
    }

    const { control, node, approach } = car.stop;

    if (control === 'signal') {
      if (this.getSignalState(node, approach) !== 'green') {
        return false;
      }
      return car.ignoreYield || !this.hasConflictingTraffic(car);
    }

    if (control === 'rail') {
      return car.ignoreRail || !this.isRailCrossingActive(node);
    }

    if (node.allWayStop) {
      return car.ignoreAllWay || this.canProceedAllWay(car);
    }

    if (control === 'yield') {
      if (car.ignoreYield) {
        return true;
      }
      if (node.roundabout) {
        return !this.hasRoundaboutConflict(car);
      }
      return !this.hasConflictingTraffic(car);
    }

    return car.ignoreYield || !this.hasConflictingTraffic(car);
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

    let brakingForStop = false;

    if (car.stop && !car.stop.released) {
      // A green signal, an empty yield or a cleared crossing can be taken
      // without stopping. Once the nose is past the stop point, commit.
      if (!car.stop.arrived && car.s > car.stop.s + 0.02) {
        car.stop.released = true;
      } else {
        const mustStop = this.shouldStopForControl(car);

        if (!car.stop.arrived) {
          if (mustStop) {
            brakingForStop = true;
            const gapToStop = car.stop.s - car.s;

            if (gapToStop <= 0.02) {
              car.s = car.stop.s;
              car.speed = 0;
              car.stop.arrived = true;
              car.stop.arrivedAt = this.time;
              car.stop.holdTimer = car.stop.hold;
              targetSpeed = 0;
            } else {
              targetSpeed = Math.min(targetSpeed, speedForGap(Math.max(0, gapToStop - 0.008)));
            }
          }
        }

        if (car.stop.arrived) {
          car.stop.holdTimer = Math.max(0, car.stop.holdTimer - dt);

          if (this.canProceedFromStop(car)) {
            car.stop.released = true;
          } else {
            targetSpeed = 0;
          }
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

    // Never overshoot a stop line that the car committed to braking for.
    if (car.stop && !car.stop.arrived && brakingForStop && car.s >= car.stop.s) {
      car.s = car.stop.s;
      car.speed = 0;
      car.stop.arrived = true;
      car.stop.arrivedAt = this.time;
      car.stop.holdTimer = car.stop.hold;
    }

    if (car.s >= car.lane.path.length) {
      car.s = car.lane.path.length;
      car.speed = 0;
    }
  }

  updateTrain(train, dt) {
    train.s = Math.min(train.lane.path.length, train.s + train.speed * dt);
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

    for (const train of this.trains) {
      const trainPose = this.getTrainPose(train);
      for (const car of this.cars) {
        const carPose = this.getCarPose(car);
        const result = orientedBoxesOverlap(
          { ...carPose, length: car.length, width: car.width },
          { ...trainPose, length: train.length, width: train.width },
        );
        if (result.hit) {
          return {
            carIds: [car.id, train.id],
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
    for (const train of this.trains) {
      this.updateTrain(train, this.fixedDt);
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
              arrivedAt: car.stop.arrivedAt,
            }
          : null,
      })),
      trains: this.trains.map((train) => ({
        id: train.id,
        s: train.s,
        speed: train.speed,
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
        car.stop.arrivedAt = carSnapshot.stop.arrivedAt;
      }
    }

    for (const train of this.trains) {
      const trainSnapshot = snapshot.trains?.find((entry) => entry.id === train.id);
      if (trainSnapshot) {
        train.s = trainSnapshot.s;
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

  getTrainPose(train) {
    return poseAt(train.lane.path, train.s);
  }

  getTrainSnapshots() {
    return this.trains.map((train) => ({
      id: train.id,
      label: train.label,
      color: train.color,
      pose: this.getTrainPose(train),
      length: train.length,
      width: train.width,
      speed: train.speed,
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
