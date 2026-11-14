// Small, dependency-free 2D geometry helpers.
// The simulation deliberately uses plain X/Z math so it can be unit-tested in Node.

/**
 * Build a polyline with cumulative distances.
 * @param {{x:number,z:number}[]} points
 */
export function buildPolyline(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('A path needs at least two points.');
  }

  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i].x - points[i - 1].x;
    const dz = points[i].z - points[i - 1].z;
    cumulative.push(cumulative[i - 1] + Math.hypot(dx, dz));
  }

  return {
    points,
    cumulative,
    length: cumulative[cumulative.length - 1],
  };
}

/** Return position and unit direction at a distance along a polyline. */
export function poseAt(path, distance) {
  const s = Math.max(0, Math.min(path.length, distance));
  let segment = 1;

  while (segment < path.cumulative.length - 1 && path.cumulative[segment] < s) {
    segment += 1;
  }

  const index = Math.max(1, segment);
  const start = path.points[index - 1];
  const end = path.points[index];
  const segmentStart = path.cumulative[index - 1];
  const segmentLength = path.cumulative[index] - segmentStart;
  const t = segmentLength > 0 ? (s - segmentStart) / segmentLength : 0;

  const dirX = segmentLength > 0 ? (end.x - start.x) / segmentLength : 1;
  const dirZ = segmentLength > 0 ? (end.z - start.z) / segmentLength : 0;

  return {
    x: start.x + (end.x - start.x) * t,
    z: start.z + (end.z - start.z) * t,
    dirX,
    dirZ,
    // Local +Z is the front of a rendered car.
    heading: Math.atan2(dirX, dirZ),
  };
}

/**
 * Project a point onto a polyline.
 * @returns {{s:number,x:number,z:number,distanceSq:number}}
 */
export function closestPointOnPath(path, point) {
  let best = { s: 0, x: path.points[0].x, z: path.points[0].z, distanceSq: Infinity };

  for (let index = 1; index < path.points.length; index += 1) {
    const a = path.points[index - 1];
    const b = path.points[index];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq > 0
      ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq))
      : 0;
    const x = a.x + dx * t;
    const z = a.z + dz * t;
    const distanceSq = (point.x - x) ** 2 + (point.z - z) ** 2;

    if (distanceSq < best.distanceSq) {
      best = {
        s: path.cumulative[index - 1] + Math.sqrt(lengthSq) * t,
        x,
        z,
        distanceSq,
      };
    }
  }

  return best;
}

/**
 * Oriented-box overlap test (separating axis theorem) using the floor plane.
 * Each box has a forward direction and dimensions in metres.
 *
 * @param {{x:number,z:number,dirX:number,dirZ:number,length:number,width:number}} a
 * @param {{x:number,z:number,dirX:number,dirZ:number,length:number,width:number}} b
 * @returns {{hit:boolean,point:{x:number,z:number}|null,depth:number}}
 */
export function orientedBoxesOverlap(a, b) {
  const aRight = { x: -a.dirZ, z: a.dirX };
  const bRight = { x: -b.dirZ, z: b.dirX };
  const axes = [
    { x: a.dirX, z: a.dirZ },
    aRight,
    { x: b.dirX, z: b.dirZ },
    bRight,
  ];
  const delta = { x: b.x - a.x, z: b.z - a.z };
  let smallestOverlap = Infinity;

  for (const axis of axes) {
    const aProjection =
      Math.abs((a.dirX * axis.x + a.dirZ * axis.z)) * (a.length / 2) +
      Math.abs((aRight.x * axis.x + aRight.z * axis.z)) * (a.width / 2);
    const bProjection =
      Math.abs((b.dirX * axis.x + b.dirZ * axis.z)) * (b.length / 2) +
      Math.abs((bRight.x * axis.x + bRight.z * axis.z)) * (b.width / 2);
    const distance = Math.abs(delta.x * axis.x + delta.z * axis.z);
    const overlap = aProjection + bProjection - distance;

    if (overlap <= 0) {
      return { hit: false, point: null, depth: 0 };
    }
    smallestOverlap = Math.min(smallestOverlap, overlap);
  }

  return {
    hit: true,
    // Midway between the two centres is stable and readable as a conflict point.
    point: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 },
    depth: smallestOverlap,
  };
}
