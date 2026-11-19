import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  MAX_TABLE_HEIGHT,
  MAX_TABLE_SCALE,
  MIN_TABLE_HEIGHT,
  MIN_TABLE_SCALE,
  TablePlacement,
  VR_FORWARD_DISTANCE,
  VR_TABLE_HEIGHT,
  VR_TABLE_SCALE,
} from '../../src/xr/tablePlacement.js';

const viewer = {
  position: { x: 0, y: 1.6, z: 0 },
  forward: { x: 0, y: 0, z: -1 },
};

test('VR placement starts in front at room scale and resets cleanly', () => {
  const root = new THREE.Group();
  const placement = new TablePlacement(root);

  assert.equal(root.scale.x, 1, 'desktop starts at world scale');

  placement.placeInFront(viewer);
  assert.equal(root.position.y, VR_TABLE_HEIGHT);
  assert.equal(root.position.z, -VR_FORWARD_DISTANCE);
  assert.equal(root.scale.x, VR_TABLE_SCALE);
  assert.equal(root.rotation.y, Math.PI);
  assert.equal(placement.locked, false);

  placement.exitDesktop();
  assert.deepEqual(root.position.toArray(), [0, 0, 0]);
  assert.equal(root.scale.x, 1);
});

test('height is clamped, viewer-relative translation follows the head, and lock stops movement', () => {
  const root = new THREE.Group();
  const placement = new TablePlacement(root);
  placement.placeInFront(viewer);

  placement.nudgeHeight(10);
  assert.equal(root.position.y, MAX_TABLE_HEIGHT);
  placement.nudgeHeight(-10);
  assert.equal(root.position.y, MIN_TABLE_HEIGHT);

  const before = root.position.x;
  placement.moveRelativeToViewer(1, 0, viewer);
  assert.equal(root.position.x, before + 1, 'viewer right is +X when facing -Z');

  placement.setLocked(true);
  const locked = root.position.clone();
  placement.moveRelativeToViewer(1, 0, viewer);
  placement.rotateBy(1);
  assert.deepEqual(root.position.toArray(), locked.toArray());
});

test('scale steps are multiplicative and span the wide logarithmic range', () => {
  const root = new THREE.Group();
  const placement = new TablePlacement(root);
  placement.placeInFront(viewer);

  const start = root.scale.x;
  placement.scaleBy(1.14);
  assert.ok(root.scale.x / start > 1.13, 'a step is a fixed multiplier');
  assert.ok(root.scale.x / start < 1.15);

  for (let i = 0; i < 60; i += 1) {
    placement.scaleBy(1.14);
  }
  assert.equal(root.scale.x, MAX_TABLE_SCALE, 'scaling up stops at the wide ceiling');

  for (let i = 0; i < 200; i += 1) {
    placement.scaleBy(0.88);
  }
  assert.equal(root.scale.x, MIN_TABLE_SCALE, 'scaling down stops at the floor');
  assert.ok(
    MAX_TABLE_SCALE / MIN_TABLE_SCALE > 1000,
    'the rails span a thousandfold range, so scale feels unlimited',
  );
});
