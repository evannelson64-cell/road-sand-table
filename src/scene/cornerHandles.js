// Four tactile corner grips are the main direct-manipulation targets in VR.
// Each handle stores its local position so input code can raycast or test a
// pinch against a predictable point.
import * as THREE from 'three';
import { lambert } from './builders.js';

const HANDLE_RADIUS = 0.105;
const HANDLE_HEIGHT = 0.028;
const KNOB_RADIUS = 0.048;

export function createCornerHandles(scenario, options = {}) {
  const { scale = 1, inset = 0.13, y = 0 } = options;
  const group = new THREE.Group();
  group.name = 'corner-handles';
  const handles = [];

  const halfWidth = scenario.table.playWidth / 2 - inset;
  const halfDepth = scenario.table.playDepth / 2 - inset;
  const positions = [
    { id: 'corner-nw', x: -halfWidth, z: -halfDepth },
    { id: 'corner-ne', x: halfWidth, z: -halfDepth },
    { id: 'corner-sw', x: -halfWidth, z: halfDepth },
    { id: 'corner-se', x: halfWidth, z: halfDepth },
  ];

  const baseGeometry = new THREE.CylinderGeometry(
    HANDLE_RADIUS,
    HANDLE_RADIUS,
    HANDLE_HEIGHT,
    12,
  );
  const knobGeometry = new THREE.SphereGeometry(KNOB_RADIUS, 10, 6);
  const ringGeometry = new THREE.TorusGeometry(HANDLE_RADIUS * 0.66, 0.008, 5, 16);

  for (const position of positions) {
    const handle = new THREE.Group();
    handle.name = position.id;
    handle.userData.handleId = position.id;
    handle.scale.setScalar(scale);

    const material = lambert('#b68a4e', {
      emissive: new THREE.Color('#000000'),
    });

    const base = new THREE.Mesh(baseGeometry, material);
    base.position.y = 0.03;
    handle.add(base);

    const ring = new THREE.Mesh(ringGeometry, material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.047;
    handle.add(ring);

    const knob = new THREE.Mesh(knobGeometry, material);
    knob.position.y = 0.077;
    handle.add(knob);

    // A dark inset makes the grab point readable from above.
    const insetDot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.006, 12),
      lambert('#4d4338'),
    );
    insetDot.position.y = 0.046;
    handle.add(insetDot);

    handle.position.set(position.x, y, position.z);
    group.add(handle);

    handles.push({
      id: position.id,
      object: handle,
      material,
      centerLocal: new THREE.Vector3(0, 0.065, 0),
    });
  }

  return { group, handles };
}
