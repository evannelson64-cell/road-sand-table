// Runtime road network built from the static OSM-derived map document.
// Pure data and math: no DOM, no Three.js. Unit-testable in Node.

import { buildPolyline, poseAt } from '../sim/geometry.js';

const CLASS_WEIGHT = {
  motorway: 1.7,
  trunk: 1.5,
  primary: 1.35,
  secondary: 1.25,
  tertiary: 1.1,
  unclassified: 1,
  residential: 1,
  living_street: 0.8,
  service: 0.55,
  road: 0.9,
};

function directionAt(points, atEnd) {
  const count = points.length;
  if (count < 2) {
    return { x: 0, z: 1 };
  }
  const a = atEnd ? points[count - 2] : points[0];
  const b = atEnd ? points[count - 1] : points[1];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

/** Offset a centreline to the right of the travel direction. */
export function offsetPolyline(points, offset) {
  if (!offset) {
    return points.map(([x, z]) => [x, z]);
  }
  const result = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    if (previous === next) {
      result.push([points[index][0], points[index][1]]);
      continue;
    }
    const dx = next[0] - previous[0];
    const dz = next[1] - previous[1];
    const length = Math.hypot(dx, dz) || 1;
    // Right-hand side when +Z is south.
    const rightX = -dz / length;
    const rightZ = dx / length;
    result.push([
      points[index][0] + rightX * offset,
      points[index][1] + rightZ * offset,
    ]);
  }
  return result;
}

function sampleCubic(a, c1, c2, b, steps) {
  const points = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const u = 1 - t;
    const x =
      u * u * u * a[0] +
      3 * u * u * t * c1[0] +
      3 * u * t * t * c2[0] +
      t * t * t * b[0];
    const z =
      u * u * u * a[1] +
      3 * u * u * t * c1[1] +
      3 * u * t * t * c2[1] +
      t * t * t * b[1];
    points.push([x, z]);
  }
  return points;
}

function angleBetween(a, b) {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z));
  return Math.acos(dot);
}

function laneAxis(lane) {
  const dir = directionAt(lane.points, true);
  return Math.abs(dir.z) >= Math.abs(dir.x) ? 'NS' : 'EW';
}

/**
 * Build directed lanes and the node connectivity the traffic model needs.
 * @param {object} document static map JSON
 */
export function buildRoadNetwork(document) {
  const nodes = document.nodes.map((node, index) => ({
    index,
    id: node.id,
    x: node.x,
    z: node.z,
    incoming: [],
    outgoing: [],
  }));

  const edges = [];
  const lanes = [];

  for (const raw of document.edges) {
    const points = raw.points;
    if (!Array.isArray(points) || points.length < 2) {
      continue;
    }
    let length = 0;
    for (let index = 1; index < points.length; index += 1) {
      length += Math.hypot(
        points[index][0] - points[index - 1][0],
        points[index][1] - points[index - 1][1],
      );
    }
    if (length < 1) {
      continue;
    }

    const laneOffset = raw.oneway ? 0 : Math.min(3.4, raw.width * 0.25);
    const edge = {
      ...raw,
      index: edges.length,
      length,
      laneOffset,
      forward: null,
      backward: null,
    };
    edges.push(edge);

    const forward = makeLane(edge, points, laneOffset, true);
    edge.forward = forward;
    lanes.push(forward);
    nodes[edge.from].outgoing.push(forward);
    nodes[edge.to].incoming.push(forward);

    if (!raw.oneway) {
      const backward = makeLane(edge, points.slice().reverse(), laneOffset, false);
      edge.backward = backward;
      lanes.push(backward);
      nodes[edge.to].outgoing.push(backward);
      nodes[edge.from].incoming.push(backward);
    }
  }

  for (const lane of lanes) {
    lane.axis = laneAxis(lane);
    lane.endDirection = directionAt(lane.points, true);
    lane.startDirection = directionAt(lane.points, false);
    lane.control = null;
    lane.controlNode = null;
  }

  // Signs are mapped to the approach lane they actually face, not to every
  // lane that touches the node. This keeps a two-way stop a two-way stop.
  for (const [kind, positions] of [
    ['stop', document.stops ?? []],
    ['yield', document.yields ?? []],
  ]) {
    for (const [x, z] of positions) {
      let best = null;
      let bestScore = Infinity;
      for (const lane of lanes) {
        if (!lane.drivable) {
          continue;
        }
        const dx = x - lane.to.x;
        const dz = z - lane.to.z;
        const along = dx * lane.endDirection.x + dz * lane.endDirection.z;
        const rightX = -lane.endDirection.z;
        const rightZ = lane.endDirection.x;
        const lateral = dx * rightX + dz * rightZ;
        if (along < -22 || along > 8 || lateral < 0.5 || lateral > 14) {
          continue;
        }
        const score = Math.abs(along + 5) + Math.abs(lateral - 5);
        if (score < bestScore) {
          bestScore = score;
          best = lane;
        }
      }
      if (best && best.control === null) {
        best.control = kind;
        best.controlNode = best.toNode;
      }
    }
  }

  const controls = new Map();
  const controlsByPosition = [
    ['signal', document.signals ?? []],
    ['stop', document.stops ?? []],
    ['yield', document.yields ?? []],
  ];
  for (const [kind, positions] of controlsByPosition) {
    for (const [x, z] of positions) {
      let best = null;
      let bestDistance = 22;
      for (const node of nodes) {
        if (node.outgoing.length < 2) {
          continue;
        }
        const distance = Math.hypot(node.x - x, node.z - z);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = node;
        }
      }
      if (best && !controls.has(best.index)) {
        controls.set(best.index, kind);
      }
    }
  }

  const network = {
    document,
    nodes,
    edges,
    lanes,
    controls,
    bounds: document.size,
    center: { x: 0, z: 0 },
    laneById: new Map(lanes.map((lane) => [lane.id, lane])),
    connectorCache: new Map(),
    totalLaneLength: lanes.reduce((sum, lane) => sum + lane.length, 0),
  };

  for (const node of nodes) {
    node.control = controls.get(node.index) ?? null;
  }

  network.selectNextLane = (laneIndex, random) => selectNextLane(network, laneIndex, random);
  network.connector = (fromLane, toLane) => connectorFor(network, fromLane, toLane);
  network.signalIsGreen = (lane, time) => signalIsGreen(lane, time);
  return network;
}

function makeLane(edge, points, offset, forward) {
  const lanePoints = offsetPolyline(points, offset);
  const path = buildPolyline(lanePoints.map(([x, z]) => ({ x, z })));
  return {
    id: `${edge.id}:${forward ? 'f' : 'b'}`,
    edgeId: edge.id,
    edgeIndex: edge.index,
    forward,
    points: lanePoints,
    path,
    length: path.length,
    speed: edge.speed,
    width: edge.width,
    class: edge.class,
    name: edge.name,
    drivable: edge.drivable,
    fromNode: forward ? edge.from : edge.to,
    toNode: forward ? edge.to : edge.from,
    from: path.points[0],
    to: path.points[path.points.length - 1],
  };
}

function selectNextLane(network, lane, random) {
  const node = network.nodes[lane.toNode];
  const candidates = [];
  let uturn = null;

  for (const candidate of node.outgoing) {
    if (!candidate.drivable || candidate.id === lane.id) {
      continue;
    }
    if (candidate.edgeId === lane.edgeId) {
      // Only taken when a dead end leaves no other way back onto the network.
      uturn = candidate;
      continue;
    }
    const straightness = Math.max(
      0,
      lane.endDirection.x * candidate.startDirection.x +
        lane.endDirection.z * candidate.startDirection.z,
    );
    const weight =
      (CLASS_WEIGHT[candidate.class] ?? 0.8) * (0.35 + straightness * straightness * 2.2);
    candidates.push({ lane: candidate, weight });
  }

  if (candidates.length === 0) {
    return uturn;
  }

  const total = candidates.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
  for (const entry of candidates) {
    roll -= entry.weight;
    if (roll <= 0) {
      return entry.lane;
    }
  }
  return candidates[candidates.length - 1].lane;
}

function connectorFor(network, fromLane, toLane) {
  const key = `${fromLane.id}>${toLane.id}`;
  const cached = network.connectorCache.get(key);
  if (cached) {
    return cached;
  }

  const a = [fromLane.to.x, fromLane.to.z];
  const b = [toLane.from.x, toLane.from.z];
  const aDir = directionAt(fromLane.points, true);
  const bDir = directionAt(toLane.points, false);
  const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const angle = angleBetween(aDir, bDir);

  // A U-turn needs a short teardrop; longer handles would leave the street.
  const isUTurn = angle > 2.35;
  const reach = isUTurn
    ? 2.6 + span * 0.25
    : Math.min(26, Math.max(4.5, span * 0.55 + 2.5));
  const c1 = [a[0] + aDir.x * reach, a[1] + aDir.z * reach];
  const c2 = [b[0] - bDir.x * reach, b[1] - bDir.z * reach];

  const steps = Math.max(6, Math.min(18, Math.round(6 + angle * 7)));
  const points = sampleCubic(a, c1, c2, b, steps);
  const path = buildPolyline(points.map(([x, z]) => ({ x, z })));

  const connector = {
    id: key,
    points,
    path,
    length: path.length,
    angle,
    speedFactor: Math.max(0.32, 1 - (angle / Math.PI) * 0.75),
    fromLane,
    toLane,
  };
  network.connectorCache.set(key, connector);
  return connector;
}

/** Two-phase signal, 24 s cycle. Returns true when this approach may go. */
export function signalIsGreen(lane, time) {
  const phase = ((time % 24) + 24) % 24;
  if (lane.axis === 'NS') {
    return phase < 10;
  }
  return phase >= 12 && phase < 22;
}

/** Car pose helper shared by the simulation and tests. */
export function lanePose(path, distance) {
  return poseAt(path, distance);
}
