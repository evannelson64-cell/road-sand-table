import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPolyline, closestPointOnPath, orientedBoxesOverlap, poseAt } from '../../src/sim/geometry.js';

test('oriented boxes detect overlap and separation', () => {
  const carA = { x: 0, z: 0, dirX: 1, dirZ: 0, length: 0.32, width: 0.16 };
  const carB = { x: 0.1, z: 0.02, dirX: 1, dirZ: 0, length: 0.32, width: 0.16 };
  const separated = { x: 0.4, z: 0, dirX: 1, dirZ: 0, length: 0.32, width: 0.16 };
  const crossing = { x: 0.05, z: 0.1, dirX: 0, dirZ: 1, length: 0.32, width: 0.16 };

  assert.equal(orientedBoxesOverlap(carA, carB).hit, true);
  assert.equal(orientedBoxesOverlap(carA, separated).hit, false);
  assert.equal(orientedBoxesOverlap(carA, crossing).hit, true);
});

test('collision point is between box centres', () => {
  const a = { x: -0.05, z: 0, dirX: 1, dirZ: 0, length: 0.3, width: 0.16 };
  const b = { x: 0.05, z: 0.04, dirX: 0, dirZ: 1, length: 0.3, width: 0.16 };
  const result = orientedBoxesOverlap(a, b);

  assert.equal(result.hit, true);
  assert.ok(Math.abs(result.point.x) < 0.0001);
  assert.ok(Math.abs(result.point.z - 0.02) < 0.0001);
});

test('polyline pose and closest projection are stable', () => {
  const path = buildPolyline([
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 1, z: 1 },
  ]);

  assert.equal(path.length, 2);
  const midpoint = poseAt(path, 0.5);
  assert.equal(midpoint.x, 0.5);
  assert.equal(midpoint.heading, Math.PI / 2);

  const nearest = closestPointOnPath(path, { x: 0.8, z: 0.75 });
  assert.equal(nearest.s, 1.75);
  assert.ok(Math.abs(nearest.x - 1) < 0.0001);
  assert.ok(Math.abs(nearest.z - 0.75) < 0.0001);
});
