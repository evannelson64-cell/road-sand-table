// Road ribbons, lane paint, stop bars and simple signage.
import * as THREE from 'three';
import { lambert, ribbonGeometry, flatBox } from './builders.js';

const ROAD_Y = 0.011;
const PAINT_Y = 0.017;

let stopTexture = null;
let oneWayTexture = null;

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

function getOneWayTexture() {
  if (oneWayTexture) {
    return oneWayTexture;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = '#1f2426';
  context.fillRect(0, 0, 256, 128);
  context.strokeStyle = '#f6efe2';
  context.lineWidth = 7;
  context.strokeRect(8, 8, 240, 112);
  context.fillStyle = '#f6efe2';
  context.font = '800 27px system-ui, sans-serif';
  context.textAlign = 'center';
  context.fillText('ONE WAY', 128, 38);
  context.beginPath();
  context.moveTo(208, 81);
  context.lineTo(160, 58);
  context.lineTo(160, 69);
  context.lineTo(48, 69);
  context.lineTo(48, 93);
  context.lineTo(160, 93);
  context.lineTo(160, 104);
  context.closePath();
  context.fill();
  oneWayTexture = new THREE.CanvasTexture(canvas);
  oneWayTexture.colorSpace = THREE.SRGBColorSpace;
  return oneWayTexture;
}

function makeSignPole() {
  const poleMaterial = lambert('#756f65');
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.15, 6), poleMaterial);
  pole.position.y = 0.078;
  return pole;
}

function createStopSign() {
  const group = new THREE.Group();
  group.add(makeSignPole());

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

function createYieldSign() {
  const group = new THREE.Group();
  group.add(makeSignPole());

  const shape = new THREE.Shape();
  shape.moveTo(-0.085, 0.07);
  shape.lineTo(0.085, 0.07);
  shape.lineTo(0, -0.085);
  shape.closePath();

  const border = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: '#d95b4f', side: THREE.DoubleSide }),
  );
  border.position.y = 0.175;
  group.add(border);

  const inner = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: '#fff8ea', side: THREE.DoubleSide }),
  );
  inner.scale.setScalar(0.72);
  inner.position.set(0, 0.181, 0.001);
  group.add(inner);

  return group;
}

function createOneWaySign() {
  const group = new THREE.Group();
  group.add(makeSignPole());
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.20, 0.10),
    new THREE.MeshBasicMaterial({
      map: getOneWayTexture(),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  face.position.y = 0.18;
  group.add(face);
  return group;
}

function signYaw(facing) {
  return {
    south: 0,
    north: Math.PI,
    east: Math.PI / 2,
    west: -Math.PI / 2,
  }[facing] ?? 0;
}

function lineSpecs(road) {
  let center = 'yellow';
  if (road.centerLine) {
    center = road.centerLine;
  } else if (road.marking === 'none') {
    center = 'none';
  } else if (road.marking === 'dashed-white') {
    center = 'white';
  }

  const specs = [];
  if (center !== 'none') {
    specs.push({ offset: 0, style: center });
  }
  for (const offset of road.laneDividers ?? []) {
    specs.push({ offset, style: road.dividerStyle ?? 'white' });
  }
  return specs;
}

function dashTransforms(scenario) {
  const transforms = [];
  const nodes = scenario.nodes ?? [];

  for (const road of scenario.roads) {
    const specs = lineSpecs(road);

    for (let index = 1; index < road.points.length; index += 1) {
      const [ax, az] = road.points[index - 1];
      const [bx, bz] = road.points[index];
      const dx = bx - ax;
      const dz = bz - az;
      const length = Math.hypot(dx, dz);
      const dirX = dx / length;
      const dirZ = dz / length;
      const perpX = -dirZ;
      const perpZ = dirX;
      const angle = Math.atan2(-dirZ, dirX);

      for (const spec of specs) {
        for (let distance = 0.22; distance < length - 0.12; distance += 0.3) {
          const x = ax + dirX * distance + perpX * spec.offset;
          const z = az + dirZ * distance + perpZ * spec.offset;

          const insideNode = nodes.some(
            (node) => Math.abs(x - node.x) < node.half + 0.075 &&
              Math.abs(z - node.z) < node.half + 0.075,
          );
          if (!insideNode) {
            transforms.push({ x, z, angle, style: spec.style });
          }
        }
      }
    }
  }

  return transforms;
}

function createLaneDashes(scenario) {
  const transforms = dashTransforms(scenario);
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(0.14, 0.004, 0.02);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();

  for (const [style, color] of [['yellow', '#e6c15b'], ['white', '#eee9dc']]) {
    const subset = transforms.filter((transform) => transform.style === style);
    if (subset.length === 0) {
      continue;
    }
    const dashes = new THREE.InstancedMesh(geometry, lambert(color), subset.length);
    subset.forEach((transform, index) => {
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
    group.add(dashes);
  }

  return group;
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
    if (node.junction === false) {
      continue;
    }
    const junction = new THREE.Mesh(
      new THREE.PlaneGeometry(
        node.junction?.width ?? node.half * 2,
        node.junction?.depth ?? node.half * 2,
      ),
      roadMaterial,
    );
    junction.rotation.x = -Math.PI / 2;
    junction.position.set(
      node.x + (node.junction?.offsetX ?? 0),
      ROAD_Y + 0.0015,
      node.z + (node.junction?.offsetZ ?? 0),
    );
    group.add(junction);
  }

  group.add(createLaneDashes(scenario));

  const whitePaint = new THREE.MeshBasicMaterial({ color: '#f3eee2' });
  for (const stopLine of scenario.stopLines ?? []) {
    const bar = flatBox(stopLine.width, 0.003, stopLine.depth, whitePaint);
    bar.position.set(stopLine.x, PAINT_Y, stopLine.z);
    bar.rotation.y = stopLine.rotation ?? 0;
    group.add(bar);
  }

  for (const sign of scenario.signs ?? []) {
    let mesh = null;
    if (sign.type === 'stop') {
      mesh = createStopSign();
    } else if (sign.type === 'yield') {
      mesh = createYieldSign();
    } else if (sign.type === 'oneway') {
      mesh = createOneWaySign();
    }
    if (!mesh) {
      continue;
    }
    mesh.position.set(sign.x, 0.008, sign.z);
    mesh.rotation.y = signYaw(sign.facing);
    group.add(mesh);
  }

  return group;
}
