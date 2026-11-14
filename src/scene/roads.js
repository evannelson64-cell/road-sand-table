// Road ribbons, lane paint, stop bars and simple signage.
import * as THREE from 'three';
import { lambert, ribbonGeometry, flatBox } from './builders.js';

const ROAD_Y = 0.011;
const PAINT_Y = 0.017;

let stopTexture = null;

function getStopTexture() {
  if (stopTexture) {
    return stopTexture;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');

  context.translate(128, 128);
  context.beginPath();
  for (let index = 0; index < 8; index += 1) {
    const angle = Math.PI / 8 + (Math.PI * 2 * index) / 8;
    const x = Math.cos(angle) * 112;
    const y = Math.sin(angle) * 112;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }
  context.closePath();
  context.fillStyle = '#b83f38';
  context.fill();
  context.lineWidth = 12;
  context.strokeStyle = '#f6efe2';
  context.stroke();

  context.fillStyle = '#fff8ea';
  context.font = '800 61px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('STOP', 0, 3);

  stopTexture = new THREE.CanvasTexture(canvas);
  stopTexture.colorSpace = THREE.SRGBColorSpace;
  stopTexture.anisotropy = 2;
  return stopTexture;
}

function createStopSign() {
  const group = new THREE.Group();

  const poleMaterial = lambert('#756f65');
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.15, 6), poleMaterial);
  pole.position.y = 0.078;
  group.add(pole);

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.155, 0.155),
    new THREE.MeshBasicMaterial({
      map: getStopTexture(),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  face.position.y = 0.176;
  group.add(face);

  return group;
}

function dashTransforms(scenario) {
  const transforms = [];
  const nodes = scenario.nodes ?? [];

  for (const road of scenario.roads) {
    for (let index = 1; index < road.points.length; index += 1) {
      const [ax, az] = road.points[index - 1];
      const [bx, bz] = road.points[index];
      const dx = bx - ax;
      const dz = bz - az;
      const length = Math.hypot(dx, dz);
      const dirX = dx / length;
      const dirZ = dz / length;
      const angle = Math.atan2(-dirZ, dirX);

      for (let distance = 0.22; distance < length - 0.12; distance += 0.3) {
        const x = ax + dirX * distance;
        const z = az + dirZ * distance;

        const insideNode = nodes.some(
          (node) => Math.abs(x - node.x) < node.half + 0.075 && Math.abs(z - node.z) < node.half + 0.075,
        );
        if (!insideNode) {
          transforms.push({ x, z, angle });
        }
      }
    }
  }

  return transforms;
}

function createLaneDashes(scenario) {
  const transforms = dashTransforms(scenario);
  const geometry = new THREE.BoxGeometry(0.14, 0.004, 0.02);
  const material = lambert('#e6c15b');
  const dashes = new THREE.InstancedMesh(geometry, material, transforms.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();

  transforms.forEach((transform, index) => {
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), transform.angle);
    matrix.compose(
      new THREE.Vector3(transform.x, 0.015, transform.z),
      quaternion,
      new THREE.Vector3(1, 1, 1),
    );
    dashes.setMatrixAt(index, matrix);
  });

  dashes.instanceMatrix.needsUpdate = true;
  dashes.frustumCulled = false;
  return dashes;
}

export function createRoads(scenario) {
  const group = new THREE.Group();
  group.name = 'roads-and-markings';

  const sidewalkMaterial = lambert('#bdb9ac');
  const roadMaterial = lambert('#4f5459');

  // Wider concrete underlay peeks out of both sides as a simple sidewalk.
  scenario.roads.forEach((road, index) => {
    const points = road.points.map(([x, z]) => ({ x, z }));
    const sidewalk = new THREE.Mesh(ribbonGeometry(points, road.width + 0.17), sidewalkMaterial);
    sidewalk.position.y = 0.006 + index * 0.0002;
    group.add(sidewalk);

    const surface = new THREE.Mesh(ribbonGeometry(points, road.width), roadMaterial);
    surface.position.y = ROAD_Y + index * 0.0001;
    group.add(surface);
  });

  for (const node of scenario.nodes) {
    const junction = new THREE.Mesh(
      new THREE.PlaneGeometry(node.half * 2, node.half * 2),
      roadMaterial,
    );
    junction.rotation.x = -Math.PI / 2;
    junction.position.set(node.x, ROAD_Y + 0.0015, node.z);
    group.add(junction);
  }

  group.add(createLaneDashes(scenario));

  const whitePaint = new THREE.MeshBasicMaterial({ color: '#f3eee2' });
  for (const stopLine of scenario.stopLines ?? []) {
    const bar = flatBox(stopLine.width, 0.003, stopLine.depth, whitePaint);
    bar.position.set(stopLine.x, PAINT_Y, stopLine.z);
    group.add(bar);
  }

  for (const sign of scenario.signs ?? []) {
    if (sign.type !== 'stop') {
      continue;
    }
    const mesh = createStopSign();
    mesh.position.set(sign.x, 0.008, sign.z);
    mesh.rotation.y = sign.facing === 'north' ? Math.PI : 0;
    group.add(mesh);
  }

  return group;
}
