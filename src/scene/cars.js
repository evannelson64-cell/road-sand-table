// Three cars are enough for Stage 1, but each is assembled from only a few
// low-poly parts and shares geometry/material instances where possible.
import * as THREE from 'three';
import { CAR_LENGTH, CAR_WIDTH } from '../sim/simulation.js';
import { lambert } from './builders.js';

const COLORS = {
  focus: '#2f6fd6',
  other: '#cf5148',
};

const BODY_HEIGHT = 0.052;
const BODY_Y = 0.052;
const GROUP_Y = 0.012;

export function createCarFleet(cars) {
  const group = new THREE.Group();
  group.name = 'traffic';
  const meshes = new Map();

  const wheelGeometry = new THREE.CylinderGeometry(0.019, 0.019, 0.012, 8);
  wheelGeometry.rotateZ(Math.PI / 2);
  const wheelMaterial = lambert('#2e3031');
  const cabinMaterial = lambert('#33444d');

  const shadowGeometry = new THREE.CircleGeometry(0.14, 16);
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: '#2d2b26',
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });

  for (const car of cars) {
    const carGroup = new THREE.Group();
    carGroup.name = `car-${car.id}`;
    carGroup.userData.carId = car.id;

    const bodyMaterial = lambert(COLORS[car.color] ?? COLORS.other);

    // A flat, soft contact patch replaces a real-time shadow.
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.001;
    shadow.scale.set(0.7, 1.18, 1);
    carGroup.add(shadow);

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(CAR_WIDTH, BODY_HEIGHT, CAR_LENGTH),
      bodyMaterial,
    );
    body.position.y = BODY_Y;
    carGroup.add(body);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(CAR_WIDTH * 0.78, 0.04, CAR_LENGTH * 0.48),
      cabinMaterial,
    );
    cabin.position.set(0, BODY_Y + BODY_HEIGHT / 2 + 0.019, -0.018);
    carGroup.add(cabin);

    for (const x of [-CAR_WIDTH * 0.49, CAR_WIDTH * 0.49]) {
      for (const z of [-CAR_LENGTH * 0.31, CAR_LENGTH * 0.31]) {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.position.set(x, 0.022, z);
        carGroup.add(wheel);
      }
    }

    group.add(carGroup);
    meshes.set(car.id, carGroup);
  }

  return {
    group,
    update(carSnapshots) {
      for (const snapshot of carSnapshots) {
        const mesh = meshes.get(snapshot.id);
        if (!mesh) {
          continue;
        }
        mesh.position.set(snapshot.pose.x, GROUP_Y, snapshot.pose.z);
        mesh.rotation.y = snapshot.pose.heading;
      }
    },
  };
}
