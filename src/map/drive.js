// Player-driven car for the real street graph.
//
// This is the pure half of driver-seat mode: lane progression, turn choice and
// the "never get stuck" failsafes. No DOM and no Three.js, so it runs in Node
// tests against the same OSM network the traffic model uses.
//
// The car cruises on its own (like the rest of the traffic) and the driver only
// picks where to go at the next junction. Every node on the graph has at least
// the reverse of the incoming lane, so there is always a legal option:
//   - a dead end offers "turn around",
//   - a requested turn that does not exist falls back to straight, then to
//     whatever is actually there,
//   - a lane blocked by other traffic is ghosted through for a few seconds,
//   - anything still stopped is nudged across the junction onto the chosen road.

import { poseAt } from '../sim/geometry.js';
import { MAP_CAR_LENGTH } from './traffic.js';

export const DRIVE_SIDES = ['left', 'straight', 'right', 'uturn'];

// A ±30° heading change is still "straight"; beyond ±130° is a U-turn.
const STRAIGHT_ANGLE = Math.PI / 6;
const UTURN_ANGLE = Math.PI * 0.72;

// Show the junction buttons this far ahead of the stop line.
export const APPROACH_DISTANCE = 70;

const SENSE_GAP = 22;
const STOP_GAP = 4.2;
const STUCK_SECONDS = 3.2;
const GHOST_SECONDS = 6;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function angleDelta(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

const IDEAL_ANGLE = {
  straight: 0,
  right: Math.PI / 2,
  left: -Math.PI / 2,
  uturn: Math.PI,
};

/**
 * Classify the heading change from one lane to another.
 * +X is east, +Z is south and a positive cross is a right turn.
 */
export function classifyTurn(fromLane, toLane) {
  const a = fromLane.endDirection;
  const b = toLane.startDirection;
  const dot = clamp(a.x * b.x + a.z * b.z, -1, 1);
  const cross = a.x * b.z - a.z * b.x;
  const angle = Math.atan2(cross, dot);
  const sameEdge = toLane.edgeId === fromLane.edgeId;

  let side;
  if (sameEdge || Math.abs(angle) >= UTURN_ANGLE) {
    side = 'uturn';
  } else if (Math.abs(angle) <= STRAIGHT_ANGLE) {
    side = 'straight';
  } else {
    side = angle > 0 ? 'right' : 'left';
  }

  return { side, angle, dot };
}

/**
 * Every legal continuation at the end of `lane`, best first within each side.
 * The reverse of the current edge is included as the U-turn option.
 */
export function junctionOptions(network, lane) {
  const node = network.nodes[lane.toNode];
  if (!node) {
    return [];
  }

  const options = [];
  const seen = new Set();
  for (const candidate of node.outgoing) {
    if (!candidate.drivable || candidate.id === lane.id || seen.has(candidate.id)) {
      continue;
    }
    seen.add(candidate.id);
    const turn = classifyTurn(lane, candidate);
    options.push({
      side: turn.side,
      angle: turn.angle,
      deviation: angleDelta(turn.angle, IDEAL_ANGLE[turn.side]),
      lane: candidate,
      name: candidate.name || 'Unnamed road',
      roadClass: candidate.class,
    });
  }

  options.sort((a, b) => a.deviation - b.deviation);
  return options;
}

/**
 * Resolve the requested side against what the junction actually offers.
 * Never returns null when `options` is non-empty, which is what keeps the
 * driver from ever reaching a junction with no continuation.
 */
export function chooseOption(options, requested = 'straight') {
  if (!options || options.length === 0) {
    return null;
  }

  const best = new Map();
  for (const option of options) {
    if (!best.has(option.side)) {
      best.set(option.side, option);
    }
  }
  if (best.has(requested)) {
    return best.get(requested);
  }

  // Fall back to the least surprising drivable road. A missing left becomes
  // straight, then right, and only then a turn-around.
  const fallbackOrder = requested === 'uturn'
    ? ['straight', 'left', 'right']
    : requested === 'left'
      ? ['straight', 'right', 'uturn']
      : requested === 'right'
        ? ['straight', 'left', 'uturn']
        : ['left', 'right', 'uturn'];
  for (const side of fallbackOrder) {
    if (best.has(side)) {
      return best.get(side);
    }
  }
  return options[0];
}

/** Pick a long, central lane so a fresh drive has room before its first junction. */
export function pickSpawnLane(network) {
  let best = null;
  for (const lane of network.lanes) {
    if (!lane.drivable || lane.length < 40) {
      continue;
    }
    const points = lane.path.points;
    const middle = points[Math.floor(points.length / 2)];
    const centre = Math.hypot(middle.x, middle.z);
    // Prefer length, then closeness to the middle of the extract.
    const score = centre - Math.min(lane.length, 400) * 2;
    if (!best || score < best.score) {
      best = { lane, score };
    }
  }
  const lane = best?.lane ?? network.lanes.find((entry) => entry.drivable) ?? null;
  if (!lane) {
    return null;
  }
  return { lane, s: Math.min(12, lane.length * 0.25) };
}

export class DriveController {
  constructor(network, options = {}) {
    this.network = network;
    this.cruiseSpeed = options.cruiseSpeed ?? 13;
    this.time = 0;
    this.lane = null;
    this.segment = 'lane';
    this.connector = null;
    this.s = 0;
    this.speed = 0;
    this.requested = 'straight';
    this.approachLane = null;
    this.options = [];
    this.chosen = null;
    this.stuck = 0;
    this.ghostUntil = -1;
    this.recoveries = 0;
    this.ghosts = 0;
    this.junctions = 0;
    this.uturns = 0;
    this.pose = { x: 0, z: 0, heading: 0, dirX: 0, dirZ: 1 };
  }

  get driving() {
    return Boolean(this.lane);
  }

  start(lane = null, s = 0) {
    const spawn = lane ? { lane, s } : pickSpawnLane(this.network);
    if (!spawn || !spawn.lane) {
      return false;
    }
    this.lane = spawn.lane;
    this.segment = 'lane';
    this.connector = null;
    this.s = clamp(spawn.s, 0, this.lane.length);
    this.speed = Math.min(6, this.lane.speed);
    this.requested = 'straight';
    this.approachLane = null;
    this.options = [];
    this.chosen = null;
    this.stuck = 0;
    this.ghostUntil = -1;
    this.recoveries = 0;
    this.ghosts = 0;
    this.junctions = 0;
    this.uturns = 0;
    this.refreshApproach();
    this.updatePose();
    return true;
  }

  /**
   * Choose the next turn. The request applies to the junction ahead and resets
   * to straight once that junction has been taken, so a single keypress cannot
   * silently repeat forever.
   */
  setRequest(side) {
    if (!DRIVE_SIDES.includes(side)) {
      return false;
    }
    this.requested = side;
    this.refreshApproach();
    return true;
  }

  refreshApproach() {
    // Mid-turn, preview the junction on the road we are joining so the buttons
    // stay live instead of blanking for the length of the connector.
    const lane = this.segment === 'lane' ? this.lane : this.connector?.toLane;
    if (!lane) {
      this.options = [];
      this.chosen = null;
      return;
    }
    if (this.approachLane !== lane) {
      this.approachLane = lane;
      this.options = junctionOptions(this.network, lane);
    }
    this.chosen = chooseOption(this.options, this.requested);
  }

  update(dt, cars = []) {
    if (!this.lane) {
      return;
    }
    const step = clamp(dt, 0, 0.2);
    if (step <= 0) {
      return;
    }
    this.time += step;
    this.refreshApproach();

    let target = this.cruiseSpeed;
    if (this.segment === 'lane') {
      const lane = this.lane;
      const remaining = lane.length - this.s;
      target = Math.min(target, lane.speed);
      if (remaining < 26) {
        target = Math.min(target, Math.max(6, lane.speed * 0.62));
      }
    } else {
      const connector = this.connector;
      // Tight turns, especially a U-turn, are taken at the connector's pace.
      target = Math.min(
        target,
        connector.toLane.speed * connector.speedFactor * 1.15,
      );
    }

    // Flow with traffic unless a stall has ghosted us through it.
    if (this.time >= this.ghostUntil) {
      const gap = this.gapAhead(cars);
      if (gap < SENSE_GAP) {
        target = Math.min(target, Math.max(0, (gap - STOP_GAP) * 0.8));
      }
      if (gap < STOP_GAP) {
        target = 0;
      }
    }

    const acceleration = target > this.speed ? 3.4 : 9.5;
    this.speed = Math.max(
      0,
      this.speed + clamp(target - this.speed, -acceleration * step, acceleration * step),
    );
    if (this.speed < 0.15 && target < 0.3) {
      this.speed = 0;
    }

    const blocked = this.speed < 0.25 && target < 0.5;
    this.stuck = blocked ? this.stuck + step : 0;
    if (this.stuck > STUCK_SECONDS) {
      this.recover();
      this.updatePose();
      return;
    }

    this.s += this.speed * step;

    if (this.segment === 'lane') {
      if (this.s >= this.lane.length) {
        this.enterJunction();
      }
    } else if (this.s >= this.connector.length) {
      this.exitJunction();
    }

    this.updatePose();
  }

  enterJunction() {
    this.refreshApproach();
    const option = this.chosen;
    if (!option || !option.lane) {
      // Nothing at all to continue on: recycle onto the network.
      this.respawn();
      return;
    }

    this.junctions += 1;
    if (option.side === 'uturn') {
      this.uturns += 1;
    }
    this.connector = this.network.connector(this.lane, option.lane);
    this.segment = 'connector';
    this.s = 0;
    this.speed = Math.min(this.speed, this.connector.toLane.speed * 0.75);
    // Next junction starts predictable again.
    this.requested = 'straight';
    this.approachLane = null;
    this.options = [];
    this.chosen = null;
  }

  exitJunction() {
    const carry = this.s - this.connector.length;
    const lane = this.connector.toLane;
    this.lane = lane;
    this.connector = null;
    this.segment = 'lane';
    this.s = clamp(carry, 0, Math.max(0, lane.length - 0.01));
    this.approachLane = null;
    this.refreshApproach();
  }

  /**
   * A stall is either traffic (ghost through it) or geometry (hop across the
   * junction). Either way the drive resumes without the user doing anything.
   */
  recover() {
    this.recoveries += 1;
    this.stuck = 0;
    if (this.time >= this.ghostUntil) {
      this.ghosts += 1;
      this.ghostUntil = this.time + GHOST_SECONDS;
      this.speed = Math.max(this.speed, 2);
      return;
    }
    this.nudge();
  }

  nudge() {
    if (this.segment === 'connector' && this.connector) {
      this.exitJunction();
      this.s = Math.min(4, this.lane.length);
      this.speed = 2;
      return;
    }

    this.refreshApproach();
    const option = this.chosen;
    if (option?.lane) {
      this.lane = option.lane;
      this.segment = 'lane';
      this.connector = null;
      this.s = Math.min(6, option.lane.length);
      this.approachLane = null;
      this.speed = 2;
      this.ghostUntil = Math.max(this.ghostUntil, this.time + 2);
      this.refreshApproach();
      return;
    }

    this.respawn();
  }

  respawn() {
    const spawn = pickSpawnLane(this.network);
    if (!spawn) {
      return false;
    }
    this.lane = spawn.lane;
    this.segment = 'lane';
    this.connector = null;
    this.s = spawn.s;
    this.speed = 0;
    this.approachLane = null;
    this.refreshApproach();
    return true;
  }

  gapAhead(cars) {
    const pose = this.pose;
    let best = Infinity;
    for (const car of cars) {
      const other = car.pose ?? car;
      if (other === pose) {
        continue;
      }
      const dirX = other.dirX ?? Math.sin(other.heading ?? 0);
      const dirZ = other.dirZ ?? Math.cos(other.heading ?? 0);
      // Only follow traffic moving roughly our way.
      if (dirX * pose.dirX + dirZ * pose.dirZ < 0.55) {
        continue;
      }
      const dx = other.x - pose.x;
      const dz = other.z - pose.z;
      const forward = dx * pose.dirX + dz * pose.dirZ;
      if (forward <= 0 || forward > SENSE_GAP) {
        continue;
      }
      const lateral = Math.abs(dx * pose.dirZ - dz * pose.dirX);
      if (lateral > 3.2) {
        continue;
      }
      const gap = forward - MAP_CAR_LENGTH;
      if (gap < best) {
        best = gap;
      }
    }
    return best;
  }

  updatePose() {
    if (!this.lane) {
      return;
    }
    const path = this.segment === 'lane' ? this.lane.path : this.connector.path;
    const pose = poseAt(path, clamp(this.s, 0, path.length));
    this.pose.x = pose.x;
    this.pose.z = pose.z;
    this.pose.heading = pose.heading;
    this.pose.dirX = pose.dirX;
    this.pose.dirZ = pose.dirZ;
  }

  getState() {
    const lane = this.segment === 'lane' ? this.lane : this.connector?.toLane;
    const choices = { left: null, straight: null, right: null, uturn: null };
    for (const option of this.options) {
      if (!choices[option.side]) {
        choices[option.side] = option.name;
      }
    }

    let distanceToJunction = 0;
    if (this.segment === 'lane' && this.lane) {
      distanceToJunction = Math.max(0, this.lane.length - this.s);
    } else if (this.connector) {
      distanceToJunction = Math.max(0, this.connector.length - this.s) +
        this.connector.toLane.length;
    }

    return {
      lane: lane?.name || 'Unnamed road',
      laneClass: lane?.class ?? '',
      speed: this.speed,
      speedKmh: Math.round(this.speed * 3.6),
      segment: this.segment,
      distanceToJunction,
      approaching: distanceToJunction < APPROACH_DISTANCE,
      requested: this.requested,
      resolved: this.chosen
        ? { side: this.chosen.side, name: this.chosen.name }
        : null,
      choices,
      junctions: this.junctions,
      uturns: this.uturns,
      recoveries: this.recoveries,
      ghost: this.time < this.ghostUntil,
      pose: {
        x: this.pose.x,
        z: this.pose.z,
        heading: this.pose.heading,
      },
    };
  }
}
