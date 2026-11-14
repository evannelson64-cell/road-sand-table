// Low-poly houses and trees around the roads.
import * as THREE from 'three';
import { lambert, roofGeometry } from './builders.js';

function createHouse(house) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(house.w, house.h, house.d),
    lambert(house.body),
  );
  body.position.y = house.h / 2 + 0.012;
  group.add(body);

  const roof = new THREE.Mesh(
    roofGeometry(house.w, house.d, house.h * 0.6),
    lambert(house.roof),
  );
  roof.position.y = house.h + 0.012;
  group.add(roof);

  // A simple front door reads as a house without adding many draw calls.
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, house.h * 0.48, 0.008),
    lambert('#725a4b'),
  );
  door.position.set(0, house.h * 0.24 + 0.012, house.d / 2 + 0.006);
  group.add(door);

  group.position.set(house.x, 0, house.z);
  return group;
}

function createTrees(trees) {
  const group = new THREE.Group();
  const trunkGeometry = new THREE.CylinderGeometry(0.011, 0.016, 0.08, 5);
  const crownGeometry = new THREE.IcosahedronGeometry(0.095, 0);
  const trunkMaterial = lambert('#7b5f45');
  const crownMaterial = lambert('#ffffff');

  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, trees.length);
  const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, trees.length);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();

  trees.forEach((tree, index) => {
    const scale = tree.scale ?? 1;
    matrix.compose(
      new THREE.Vector3(tree.x, 0.045 * scale + 0.008, tree.z),
      new THREE.Quaternion(),
      new THREE.Vector3(scale, scale, scale),
    );
    trunks.setMatrixAt(index, matrix);

    matrix.compose(
      new THREE.Vector3(tree.x, (0.14 + 0.055) * scale + 0.008, tree.z),
      new THREE.Quaternion(),
      new THREE.Vector3(scale, scale * 1.15, scale),
    );
    crowns.setMatrixAt(index, matrix);

    color.set(index % 2 === 0 ? '#789a62' : '#6d8c5a');
    crowns.setColorAt(index, color);
  });

  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) {
    crowns.instanceColor.needsUpdate = true;
  }
  trunks.frustumCulled = false;
  crowns.frustumCulled = false;

  group.add(trunks, crowns);
  return group;
}

export function createScenery(scenario) {
  const group = new THREE.Group();
  group.name = 'neighborhood-scenery';

  for (const house of scenario.scenery?.houses ?? []) {
    group.add(createHouse(house));
  }

  const trees = scenario.scenery?.trees ?? [];
  if (trees.length > 0) {
    group.add(createTrees(trees));
  }

  return group;
}
