// Lightweight, deterministic traffic on a real street graph.
//
// Cars follow offset lane centrelines, choose a weighted next lane at each
// node, slow for the car ahead, obey two-phase signals and wait their turn at
// stop signs. Only one car occupies a junction box at a time, which keeps
// crossings readable without a full reservation system.

import { poseAt } from '../sim/geometry.js';

const CAR_LENGTH = 4.4;
const CAR_WIDTH = 1.85;
const WHEELBASE_MARGIN = 2.2;

const PALETTE = [
  '#2f6fd6',
  '#c95046',
  '#d9c7a3',
  '#7d9b7a',
  '#8b93a6',
  '#c8874e',
  '#e6e2d6',
  '#6a7f8c',
  '#a45b52',
  '#5d7f96',
];

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class MapTraffic {
  constructor(network, options = {}) {
    this.network = network;
    this.random = mulberry32(options.seed ?? 0x5eed1234);
    this.time = 0;
    this.cars = [];
    this.nodeOccupant = new Map();
    this.nextId = 1;
    this.carCount = 0;

    this.spawnLanes = network.lanes.filter(
      (lane) => lane.drivable && lane.length > 24,
    );
    if (this.spawnLanes.length === 0) {
      throw new Error('The road network has no drivable lanes.');
    }

    this.totalWeight = this.spawnLanes.reduce((sum, lane) => sum + lane.length, 0);
    this.setCarCount(options.carCount ?? 90);
    for (const car of this.cars) {
      this.computePose(car);
    }
  }

  setCarCount(count) {
    const target = clamp(Math.round(count), 0, 400);
    while (this.cars.length < target) {
      const car = this.spawnCar();
      if (!car) {
        break;
      }
      this.cars.push(car);
    }
    while (this.cars.length > target) {
      const car = this.cars.pop();
      this.releaseNode(car);
    }
    this.carCount = this.cars.length;
  }

  randomLane() {
    let roll = this.random() * this.totalWeight;
    for (const lane of this.spawnLanes) {
      roll -= lane.length;
      if (roll <= 0) {
        return lane;
      }
    }
    return this.spawnLanes[this.spawnLanes.length - 1];
  }

  spawnCar() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const lane = this.randomLane();
      const s = 2 + this.random() * Math.max(1, lane.length - 6);

      let crowded = false;
      for (const other of this.cars) {
        if (other.lane !== lane) {
          continue;
        }
        if (Math.abs(other.s - s) < 18) {
          crowded = true;
          break;
        }
      }
      if (crowded && attempt < 19) {
        continue;
      }

      const color = PALETTE[Math.floor(this.random() * PALETTE.length)];
      return {
        id: `car-${this.nextId++}`,
        lane,
        s,
        speed: lane.speed * (0.35 + this.random() * 0.35),
        desired: lane.speed * (0.82 + this.random() * 0.26),
        color,
        segment: 'lane',
        nextLane: null,
        connector: null,
        occupiedNode: null,
        stoppedNode: null,
        stopWait: 0,
        stuck: 0,
        respawns: 0,
        pose: { x: 0, z: 0, heading: 0, dirX: 0, dirZ: 1 },
      };
    }
    return null;
  }

  respawn(car) {
    this.releaseNode(car);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const lane = this.randomLane();
      const s = 2 + this.random() * Math.max(1, lane.length - 6);
      let crowded = false;
      for (const other of this.cars) {
        if (other === car || other.lane !== lane) {
          continue;
        }
        if (Math.abs(other.s - s) < 20) {
          crowded = true;
          break;
        }
      }
      if (crowded) {
        continue;
      }
      car.lane = lane;
      car.s = s;
      car.speed = lane.speed * 0.5;
      car.segment = 'lane';
      car.nextLane = null;
      car.connector = null;
      car.stoppedNode = null;
      car.stopWait = 0;
      car.stuck = 0;
      car.respawns += 1;
      return;
    }
    car.speed = 0;
  }

  releaseNode(car) {
    if (
      car.occupiedNode !== null &&
      this.nodeOccupant.get(car.occupiedNode) === car.id
    ) {
      this.nodeOccupant.delete(car.occupiedNode);
    }
    car.occupiedNode = null;
  }

  advance(deltaSeconds) {
    const dt = clamp(deltaSeconds, 0, 0.2);
    if (dt <= 0) {
      return;
    }
    this.time += dt;

    for (const car of this.cars) {
      this.updateCar(car, dt);
    }

    // Poses are recomputed after every car moved so the renderer can read them
    // without knowing about lanes, connectors or junctions.
    for (const car of this.cars) {
      this.computePose(car);
    }
  }

  updateCar(car, dt) {
    let target = 0;
    let stopLine = Infinity;

    if (car.segment === 'lane') {
      const lane = car.lane;
      const remaining = lane.length - car.s;
      target = Math.min(car.desired, lane.speed);

      if (car.nextLane === null && remaining < 45) {
        car.nextLane = this.network.selectNextLane(lane, this.random);
        if (car.nextLane === null) {
          // A true dead end: recycle the car elsewhere.
          this.respawn(car);
          return;
        }
      }

      const node = this.network.nodes[lane.toNode];
      const control = lane.control ?? (node.control === 'signal' ? 'signal' : null);
      const occupant = this.nodeOccupant.get(node.index);
      const blocked = occupant !== undefined && occupant !== car.id;

      // A controlled junction reserves its box. Uncontrolled junctions only
      // yield to a car that is already in the box, which keeps a dense grid
      // moving instead of treating every corner as an all-way stop.
      if (blocked && remaining > 6 && remaining < (control ? 26 : 15)) {
        stopLine = lane.length - 4.6;
      }

      if (remaining < 34 && remaining > 8) {
        if (control === 'signal' && !this.network.signalIsGreen(lane, this.time)) {
          stopLine = lane.length - 7;
        } else if (control === 'stop' && car.stoppedNode !== node.index) {
          stopLine = lane.length - 7;
          if (remaining < 10 && car.speed < 0.5) {
            car.stopWait += dt;
            if (car.stopWait > 0.6) {
              car.stoppedNode = node.index;
              car.stopWait = 0;
              stopLine = Infinity;
            }
          } else if (remaining >= 10 || car.speed >= 0.5) {
            car.stopWait = 0;
          }
        } else if (control === 'yield' && blocked) {
          stopLine = lane.length - 9;
        }
      }

      // Do not overshoot a red light, stop sign or queue: settle right at the
      // line instead of dropping the target speed to zero far in advance.
      if (stopLine !== Infinity) {
        const distance = stopLine - car.s;
        target = Math.min(target, Math.max(0, (distance - 0.35) * 1.7));
      }
    } else {
      const connector = car.connector;
      target = Math.min(car.desired, connector.toLane.speed) * connector.speedFactor;
      if (connector.length - car.s < 3) {
        target = Math.min(target, connector.speedFactor * 6);
      }
    }

    // Car following across segment boundaries.
    const gap = this.gapAhead(car);
    if (gap < 26) {
      const leader = this.leaderSpeed(car);
      const safe = Math.max(0, (gap - 3.2) * 0.85);
      target = Math.min(target, Math.min(leader + safe, safe + 2));
      if (gap < 4.2) {
        target = 0;
      }
    }

    const acceleration = target > car.speed ? 3.4 : 9.5;
    const change = clamp(target - car.speed, -acceleration * dt, acceleration * dt);
    car.speed = Math.max(0, car.speed + change);

    if (car.speed < 0.15 && target < 0.4) {
      car.speed = 0;
    }

    car.stuck = car.speed < 0.2 ? car.stuck + dt : 0;
    if (car.stuck > 40) {
      this.respawn(car);
      return;
    }

    car.s += car.speed * dt;

    if (car.segment === 'lane') {
      if (car.s >= car.lane.length) {
        if (!car.nextLane) {
          this.respawn(car);
          return;
        }
        // Never enter the junction if the next block has no room: that is how
        // a real grid locks, and it also stops cross traffic in this model.
        if (!this.exitClear(car.nextLane, car)) {
          car.s = car.lane.length - 0.02;
          car.speed = 0;
          return;
        }
        const connector = this.network.connector(car.lane, car.nextLane);
        car.connector = connector;
        car.segment = 'connector';
        car.s = Math.min(1.2, connector.length);
        const nodeIndex = car.lane.toNode;
        this.nodeOccupant.set(nodeIndex, car.id);
        car.occupiedNode = nodeIndex;
        car.stoppedNode = null;
      }
    } else if (car.s >= car.connector.length) {
      const carry = car.s - car.connector.length;
      car.lane = car.connector.toLane;
      car.nextLane = null;
      car.connector = null;
      car.segment = 'lane';
      car.s = Math.min(carry, car.lane.length - 0.01);
      // The connector spans the junction box, so the lock can be released as
      // soon as the car is on its next lane. Holding it longer can deadlock
      // when the next block is already queued.
      this.releaseNode(car);
    }
  }

  exitClear(lane, car) {
    for (const other of this.cars) {
      if (other === car) {
        continue;
      }
      if (other.lane === lane && other.s < 12) {
        return false;
      }
      if (
        other.segment === 'connector' &&
        other.connector?.toLane === lane &&
        other.connector.length - other.s < 8
      ) {
        return false;
      }
    }
    return true;
  }

  gapAhead(car) {
    const pose = car.pose;
    let best = Infinity;
    for (const other of this.cars) {
      if (other === car) {
        continue;
      }
      // Only follow traffic moving roughly the same way. Without this, cars on
      // a narrow two-way street brake for oncoming traffic as if it were
      // queued ahead of them.
      if (
        other.pose.dirX * pose.dirX + other.pose.dirZ * pose.dirZ < 0.55
      ) {
        continue;
      }
      const dx = other.pose.x - pose.x;
      const dz = other.pose.z - pose.z;
      const forward = dx * pose.dirX + dz * pose.dirZ;
      if (forward <= 0 || forward > 24) {
        continue;
      }
      const lateral = Math.abs(dx * pose.dirZ - dz * pose.dirX);
      if (lateral > 2.9) {
        continue;
      }
      const gap = forward - CAR_LENGTH;
      if (gap < best) {
        best = gap;
      }
    }
    return best;
  }

  leaderSpeed(car) {
    const pose = car.pose;
    let speed = Infinity;
    let best = Infinity;
    for (const other of this.cars) {
      if (other === car) {
        continue;
      }
      if (
        other.pose.dirX * pose.dirX + other.pose.dirZ * pose.dirZ < 0.55
      ) {
        continue;
      }
      const dx = other.pose.x - pose.x;
      const dz = other.pose.z - pose.z;
      const forward = dx * pose.dirX + dz * pose.dirZ;
      if (forward <= 0 || forward > 24) {
        continue;
      }
      const lateral = Math.abs(dx * pose.dirZ - dz * pose.dirX);
      if (lateral > 2.9 || forward >= best) {
        continue;
      }
      best = forward;
      speed = other.speed;
    }
    return Number.isFinite(speed) ? speed : 12;
  }

  computePose(car) {
    const path = car.segment === 'lane' ? car.lane.path : car.connector.path;
    const pose = poseAt(path, clamp(car.s, 0, path.length));
    car.pose.x = pose.x;
    car.pose.z = pose.z;
    car.pose.heading = pose.heading;
    car.pose.dirX = pose.dirX;
    car.pose.dirZ = pose.dirZ;
  }

  getSnapshots() {
    return this.cars.map((car) => ({
      id: car.id,
      x: car.pose.x,
      z: car.pose.z,
      heading: car.pose.heading,
      speed: car.speed,
      color: car.color,
      lane: car.lane.name,
      class: car.lane.class,
    }));
  }

  getStats() {
    let moving = 0;
    let speedSum = 0;
    for (const car of this.cars) {
      if (car.speed > 0.4) {
        moving += 1;
      }
      speedSum += car.speed;
    }
    return {
      cars: this.cars.length,
      moving,
      averageSpeed: this.cars.length ? speedSum / this.cars.length : 0,
      time: this.time,
    };
  }

  reset(seed = 0x5eed1234) {
    this.random = mulberry32(seed);
    this.time = 0;
    this.nodeOccupant.clear();
    this.nextId = 1;
    const count = this.cars.length;
    this.cars = [];
    this.setCarCount(count);
  }
}

export const MAP_CAR_LENGTH = CAR_LENGTH;
export const MAP_CAR_WIDTH = CAR_WIDTH;
export const MAP_CAR_MARGIN = WHEELBASE_MARGIN;
