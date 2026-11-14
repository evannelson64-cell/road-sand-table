// The floating table and its sand-and-grass topography.
import * as THREE from 'three';
import { lambert } from './builders.js';

export function createTabletop(scenario) {
  const group = new THREE.Group();
  group.name = 'floating-sand-table';

  const { width, depth, playWidth, playDepth } = scenario.table;

  // Wooden slab with a thin profile.
  const wood = lambert('#b69368');
  const slab = new THREE.Mesh(new THREE.BoxGeometry(width, 0.12, depth), wood);
  slab.position.y = -0.075;
  group.add(slab);

  // A darker edge band gives the slab a hand-built look.
  const edgeMaterial = lambert('#8f6e4e');
  const edge = new THREE.Mesh(new THREE.BoxGeometry(width + 0.02, 0.035, depth + 0.02), edgeMaterial);
  edge.position.y = -0.122;
  group.add(edge);

  // Warm sand play surface.
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(playWidth, playDepth),
    lambert('#d7cfb6'),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = 0.003;
  group.add(sand);

  // Four calm grass blocks frame the streets.
  const grassMaterial = lambert('#b6cba2');
  const grassWidth = Math.min(playWidth, 1.18);
  const grassDepth = Math.min(playDepth, 0.63);
  const grassPositions = [
    [-1.0, 0.96],
    [1.0, 0.96],
    [-1.0, -0.96],
    [1.0, -0.96],
  ];

  for (const [x, z] of grassPositions) {
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(grassWidth, grassDepth), grassMaterial);
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(x, 0.005, z);
    group.add(grass);
  }

  // Low rim, just high enough to read as a tray edge.
  const rimMaterial = lambert('#866445');
  const rimHeight = 0.055;
  const rimThickness = 0.045;
  const rimY = rimHeight / 2 - 0.005;

  const northSouth = new THREE.BoxGeometry(rimThickness, rimHeight, playDepth + rimThickness * 2);
  const eastWest = new THREE.BoxGeometry(playWidth + rimThickness * 2, rimHeight, rimThickness);

  for (const x of [-playWidth / 2 - rimThickness / 2, playWidth / 2 + rimThickness / 2]) {
    const rim = new THREE.Mesh(northSouth, rimMaterial);
    rim.position.set(x, rimY, 0);
    group.add(rim);
  }

  for (const z of [-playDepth / 2 - rimThickness / 2, playDepth / 2 + rimThickness / 2]) {
    const rim = new THREE.Mesh(eastWest, rimMaterial);
    rim.position.set(0, rimY, z);
    group.add(rim);
  }

  return group;
}
