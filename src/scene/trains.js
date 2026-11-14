// A single low-poly freight train for the railroad-crossing tile.
import * as THREE from 'three';
import { lambert } from './builders.js';

export function createTrainFleet(trains) {
  const group = new THREE.Group();
  group.name = 'rail-traffic';
  const meshes = new Map();

  const wheelGeometry = new THREE.CylinderGeometry(0.022, 0.022, 0.014, 8);
  wheelGeometry.rotateZ(Math.PI / 2);
  const wheelMaterial = lambert('#2c2e2f');
  const bodyMaterial = lambert('#5c6b70');
  const noseMaterial = lambert('#d39a3f');
  const windowMaterial = lambert('#253238');

  for (const train of trains) {
    const trainGroup = new THREE.Group();
    trainGroup.name = `train-${train.id}`;

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(train.width * 1.6, train.length),
      new THREE.MeshBasicMaterial({
        color: '#2d2b26',
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.002;
    trainGroup.add(shadow);

    // Locomotive.
    const locomotive = new THREE.Mesh(
      new THREE.BoxGeometry(train.width, 0.13, train.length * 0.52),
      bodyMaterial,
    );
    locomotive.position.set(0, 0.085, -train.length * 0.17);
    trainGroup.add(locomotive);

    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(train.width * 0.88, 0.08, train.length * 0.14),
      noseMaterial,
    );
    nose.position.set(0, 0.07, train.length * 0.32);
    trainGroup.add(nose);

    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(train.width * 0.7, 0.055, train.length * 0.12),
      windowMaterial,
    );
    cab.position.set(0, 0.17, -train.length * 0.05);
    trainGroup.add(cab);

    // Two trailing cars.
    for (let index = 0; index < 2; index += 1) {
      const car = new THREE.Mesh(
        new THREE.BoxGeometry(train.width * 0.9, 0.1, train.length * 0.17),
        bodyMaterial,
      );
      car.position.set(0, 0.075, -train.length * (0.48 + index * 0.21));
      trainGroup.add(car);
    }

    for (const x of [-train.width * 0.48, train.width * 0.48]) {
      for (const z of [-train.length * 0.28, train.length * 0.25]) {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.position.set(x, 0.027, z);
        trainGroup.add(wheel);
      }
    }

    group.add(trainGroup);
    meshes.set(train.id, trainGroup);
  }

  return {
    group,
    update(snapshots) {
      for (const snapshot of snapshots) {
        const mesh = meshes.get(snapshot.id);
        if (!mesh) {
          continue;
        }
        mesh.position.set(snapshot.pose.x, 0.013, snapshot.pose.z);
        mesh.rotation.y = snapshot.pose.heading;
      }
    },
  };
}
