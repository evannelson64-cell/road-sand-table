// Low-poly 3D rendering of a real OpenStreetMap extract.
//
// The same calm materials as the sand-table scenes are reused here: no shadows,
// no textures, flat-shaded geometry and a warm paper-and-sand palette. The map
// sits on a wooden plinth so it reads as a physical model rather than a GIS
// viewer.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { lambert } from './builders.js';
import { createCornerHandles } from './cornerHandles.js';
import { MAP_CAR_LENGTH, MAP_CAR_WIDTH } from '../map/traffic.js';
import { mulberry32 } from '../map/traffic.js';

const PALETTE = {
  sand: '#d9d0b8',
  wood: '#b69368',
  woodDark: '#8f6e4e',
  sidewalk: '#cdc7b8',
  road: '#5b6065',
  paint: '#e7c565',
  park: '#b6cba2',
  green: '#bccfa7',
  water: '#a9c7d2',
  parking: '#c7c3b7',
  plaza: '#d8cdb6',
  stream: '#a9c7d2',
  glass: '#3d4b52',
  shadow: '#2c2b26',
  trunk: '#7b5f45',
};

const BUILDING_COLORS = {
  house: ['#eadcc4', '#e4d4bb', '#efe3cf', '#ddcdb6'],
  retail: ['#e8d8bc', '#e2cdae', '#e9d9c0'],
  commercial: ['#e3d6c2', '#dccdb8', '#e6d9c7'],
  office: ['#dfe1d6', '#d7dbd2', '#e4e6dd'],
  apartments: ['#e4d6c0', '#dccdb7', '#e7dac6'],
  residential: ['#e6d9c3', '#ddcfb8', '#e9ddc9'],
  hotel: ['#e5d3b8', '#dcc7a9'],
  church: ['#e9e3d3', '#dfd8c6'],
  industrial: ['#d8d6cc', '#cfcdc2'],
  government: ['#e5e0d0', '#dcd6c5'],
  garage: ['#d6d1c4', '#cec9bb'],
  shed: ['#d9d2c2', '#d1cabb'],
  parking: ['#d3cfc2', '#ccc8ba'],
  default: ['#e6dac5', '#ded1bb', '#e9decb'],
};

// Muted roofs echo the hand-painted houses on the sand table: warm brown for
// homes and shops, cool grey for offices and civic blocks.
const ROOF_COLORS = {
  house: ['#b58d69', '#a87f5f', '#bd9673', '#a17a59'],
  retail: ['#ad8b6b', '#b69374', '#a38265'],
  commercial: ['#a99b8b', '#b2a493', '#9e9081'],
  office: ['#9ea3a0', '#949a97', '#a7aca8'],
  apartments: ['#ad8c6d', '#a28163', '#b59375'],
  residential: ['#b08e6e', '#a38263', '#b89575'],
  hotel: ['#a47f60', '#947156'],
  church: ['#938b7e', '#857e72'],
  industrial: ['#9b9891', '#918e87'],
  government: ['#a79f90', '#9b9485'],
  garage: ['#a09789', '#958d80'],
  shed: ['#a5917b', '#9a8772'],
  parking: ['#a29e94', '#97938a'],
  default: ['#ac947a', '#a18970', '#b69e85'],
};

const WALL_SHADE_X = 0.985;
const WALL_SHADE_Z = 0.93;

// Cars are modelled at roughly true size, then drawn a little larger so they
// read at the default overview distance. The simulation still uses real metres.
const CAR_VISUAL_SCALE = 1.4;
const CAR_GROUND_Y = 0.09;
const CAR_BODY_HEIGHT = 0.78;
const CAR_CABIN_HEIGHT = 0.6;

function hashColor(list, index) {
  // Mix the index so neighbouring footprints do not step through the palette
  // in order, which reads as a subtle stripe from above.
  const mixed = Math.imul(index + 1, 2654435761) >>> 0;
  return list[mixed % list.length];
}

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const zi = ring[i][1];
    const xj = ring[j][0];
    const zj = ring[j][1];
    if (
      zi > z !== zj > z &&
      x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-9) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function signedArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [ax, az] = ring[index];
    const [bx, bz] = ring[(index + 1) % ring.length];
    area += ax * bz - bx * az;
  }
  return area / 2;
}

function ringCentroid(ring) {
  let x = 0;
  let z = 0;
  for (const point of ring) {
    x += point[0];
    z += point[1];
  }
  return [x / ring.length, z / ring.length];
}

function segmentDistanceSq(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 0
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq))
    : 0;
  const x = ax + dx * t;
  const z = az + dz * t;
  return (px - x) ** 2 + (pz - z) ** 2;
}

function buildBuildingsGeometry(buildings) {
  const positions = [];
  const colors = [];
  const indices = [];
  const color = new THREE.Color();
  const roofColor = new THREE.Color();

  for (let index = 0; index < buildings.length; index += 1) {
    const building = buildings[index];
    let ring = building.points;
    if (ring.length < 3) {
      continue;
    }
    if (signedArea(ring) < 0) {
      ring = ring.slice().reverse();
    }

    const palette = BUILDING_COLORS[building.kind] ?? BUILDING_COLORS.default;
    color.set(hashColor(palette, index));
    const roofs = ROOF_COLORS[building.kind] ?? ROOF_COLORS.default;
    roofColor.set(hashColor(roofs, index * 3 + 1));

    const height = building.height;
    // A slightly darker coping band at the top of each wall gives the blocks a
    // crisp edge from above without adding shadows.
    const band = Math.min(0.9, Math.max(0.35, height * 0.14));
    const bodyHeight = Math.max(0.1, height - band);
    const [cx, cz] = ringCentroid(ring);

    for (let edge = 0; edge < ring.length; edge += 1) {
      const [ax, az] = ring[edge];
      const [bx, bz] = ring[(edge + 1) % ring.length];
      const dx = bx - ax;
      const dz = bz - az;
      if (Math.abs(dx) + Math.abs(dz) < 0.05) {
        continue;
      }
      const shade = Math.abs(dx) > Math.abs(dz) ? WALL_SHADE_Z : WALL_SHADE_X;
      const bandShade = shade * 0.83;
      const base = positions.length / 3;
      positions.push(
        ax, 0, az,
        bx, 0, bz,
        bx, bodyHeight, bz,
        ax, bodyHeight, az,
        bx, height, bz,
        ax, height, az,
      );
      for (let vertex = 0; vertex < 4; vertex += 1) {
        colors.push(color.r * shade, color.g * shade, color.b * shade);
      }
      for (let vertex = 0; vertex < 2; vertex += 1) {
        colors.push(color.r * bandShade, color.g * bandShade, color.b * bandShade);
      }
      indices.push(
        base, base + 1, base + 2,
        base, base + 2, base + 3,
        base + 3, base + 2, base + 4,
        base + 3, base + 4, base + 5,
      );
    }

    // A centroid fan is robust enough for hand-mapped footprints and gives the
    // roof a single calm tone.
    const roofBase = positions.length / 3;
    positions.push(cx, height, cz);
    colors.push(roofColor.r, roofColor.g, roofColor.b);
    for (const [x, z] of ring) {
      positions.push(x, height, z);
      colors.push(roofColor.r, roofColor.g, roofColor.b);
    }
    for (let vertex = 0; vertex < ring.length; vertex += 1) {
      const next = (vertex + 1) % ring.length;
      indices.push(roofBase, roofBase + 1 + vertex, roofBase + 1 + next);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function appendRibbon(positions, indices, points, width, y) {
  if (points.length < 2) {
    return;
  }
  const base = positions.length / 3;
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next[0] - previous[0];
    const dz = next[1] - previous[1];
    const length = Math.hypot(dx, dz) || 1;
    const perpX = -dz / length;
    const perpZ = dx / length;
    positions.push(
      points[index][0] + perpX * width * 0.5, y, points[index][1] + perpZ * width * 0.5,
      points[index][0] - perpX * width * 0.5, y, points[index][1] - perpZ * width * 0.5,
    );
    if (index > 0) {
      const current = base + (index - 1) * 2;
      indices.push(current, current + 2, current + 1, current + 1, current + 2, current + 3);
    }
  }
}

function buildRoadGeometry(edges, widthOffset) {
  const positions = [];
  const indices = [];
  for (const edge of edges) {
    appendRibbon(positions, indices, edge.points, edge.width + widthOffset, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildDashes(edges) {
  const transforms = [];
  for (const edge of edges) {
    if (edge.oneway || edge.class === 'service' || edge.width < 6.2) {
      continue;
    }
    let carried = 0;
    for (let index = 1; index < edge.points.length; index += 1) {
      const [ax, az] = edge.points[index - 1];
      const [bx, bz] = edge.points[index];
      const dx = bx - ax;
      const dz = bz - az;
      const length = Math.hypot(dx, dz);
      if (length < 0.001) {
        continue;
      }
      const dirX = dx / length;
      const dirZ = dz / length;
      const angle = Math.atan2(dirX, dirZ);
      for (let distance = 8 - carried; distance < length - 8; distance += 11) {
        if (distance < 0) {
          continue;
        }
        transforms.push({
          x: ax + dirX * distance,
          z: az + dirZ * distance,
          angle,
        });
      }
      carried = (carried + length) % 11;
    }
  }
  return transforms;
}

function makeAreaMesh(area) {
  const shape = new THREE.Shape();
  area.points.forEach(([x, z], index) => {
    if (index === 0) {
      shape.moveTo(x, -z);
    } else {
      shape.lineTo(x, -z);
    }
  });
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);

  const color = {
    park: PALETTE.park,
    green: PALETTE.green,
    water: PALETTE.water,
    parking: PALETTE.parking,
    plaza: PALETTE.plaza,
  }[area.kind] ?? PALETTE.green;

  return new THREE.Mesh(geometry, lambert(color));
}

function treePositions(network, document, random) {
  const trees = [];
  const buildingRings = document.buildings.map((building) => building.points);

  for (const area of document.areas) {
    if (!['park', 'green', 'plaza'].includes(area.kind)) {
      continue;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of area.points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const areaSq = Math.abs(signedArea(area.points));
    const target = Math.min(70, Math.max(4, Math.round(areaSq / 150)));
    let placed = 0;
    for (let attempt = 0; attempt < target * 8 && placed < target; attempt += 1) {
      const x = minX + random() * (maxX - minX);
      const z = minZ + random() * (maxZ - minZ);
      if (!pointInRing(x, z, area.points)) {
        continue;
      }
      if (buildingRings.some((ring) => pointInRing(x, z, ring))) {
        continue;
      }
      trees.push({ x, z, scale: 0.7 + random() * 0.8 });
      placed += 1;
    }
  }

  const edges = network.edges;
  for (const lane of network.lanes) {
    if (!lane.drivable || lane.length < 26) {
      continue;
    }
    for (let distance = 14; distance < lane.length - 10; distance += 26) {
      if (random() > 0.34) {
        continue;
      }
      const step = Math.min(lane.path.points.length - 1, Math.floor((distance / lane.length) * (lane.path.points.length - 1)));
      const point = lane.path.points[step];
      const next = lane.path.points[Math.min(lane.path.points.length - 1, step + 1)];
      const dx = next.x - point.x;
      const dz = next.z - point.z;
      const length = Math.hypot(dx, dz) || 1;
      const offset = lane.width * 0.5 + 3.2;
      const x = point.x - (dz / length) * offset;
      const z = point.z + (dx / length) * offset;

      let blocked = false;
      for (const edge of edges) {
        for (let index = 1; index < edge.points.length; index += 1) {
          const [ax, az] = edge.points[index - 1];
          const [bx, bz] = edge.points[index];
          if (segmentDistanceSq(x, z, ax, az, bx, bz) < (edge.width * 0.5 + 2.6) ** 2) {
            blocked = true;
            break;
          }
        }
        if (blocked) {
          break;
        }
      }
      if (blocked || buildingRings.some((ring) => pointInRing(x, z, ring))) {
        continue;
      }
      trees.push({ x, z, scale: 0.65 + random() * 0.7 });
    }
  }

  return trees;
}

function createTrees(trees) {
  const group = new THREE.Group();
  group.name = 'map-trees';
  if (trees.length === 0) {
    return group;
  }

  const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.32, 3.2, 5);
  const crownGeometry = new THREE.IcosahedronGeometry(2.25, 0);
  const trunks = new THREE.InstancedMesh(trunkGeometry, lambert(PALETTE.trunk), trees.length);
  const crowns = new THREE.InstancedMesh(crownGeometry, lambert('#ffffff'), trees.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const color = new THREE.Color();
  const scale = new THREE.Vector3();

  trees.forEach((tree, index) => {
    scale.set(tree.scale, tree.scale, tree.scale);
    matrix.compose(
      new THREE.Vector3(tree.x, 1.6 * tree.scale, tree.z),
      quaternion,
      scale,
    );
    trunks.setMatrixAt(index, matrix);

    matrix.compose(
      new THREE.Vector3(tree.x, 4.7 * tree.scale, tree.z),
      quaternion,
      scale,
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

function createCarMeshes(capacity = 260) {
  const bodyGeometry = new THREE.BoxGeometry(MAP_CAR_WIDTH, 0.78, MAP_CAR_LENGTH);
  const cabinGeometry = new THREE.BoxGeometry(MAP_CAR_WIDTH * 0.86, 0.6, MAP_CAR_LENGTH * 0.46);
  const shadowGeometry = new THREE.PlaneGeometry(MAP_CAR_WIDTH * 1.3, MAP_CAR_LENGTH * 1.12);
  shadowGeometry.rotateX(-Math.PI / 2);

  const bodyMaterial = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  const cabinMaterial = lambert(PALETTE.glass);
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: PALETTE.shadow,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });

  const bodies = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, capacity);
  const cabins = new THREE.InstancedMesh(cabinGeometry, cabinMaterial, capacity);
  const shadows = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, capacity);
  for (const mesh of [bodies, cabins, shadows]) {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  bodies.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(capacity * 3),
    3,
  );
  cabinGeometry.translate(0, 0, -0.18);

  return { bodies, cabins, shadows };
}

const carQuaternion = new THREE.Quaternion();
const carAxis = new THREE.Vector3(0, 1, 0);
const carPosition = new THREE.Vector3();
const carScale = new THREE.Vector3();

function copyPose(matrix, x, z, heading, y, scale = 1) {
  carQuaternion.setFromAxisAngle(carAxis, heading);
  carPosition.set(x, y, z);
  carScale.set(scale, scale, scale);
  matrix.compose(carPosition, carQuaternion, carScale);
}

export function createMapView({ renderer, document, network, traffic }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e2e9e6');
  scene.fog = new THREE.Fog('#e2e9e6', 620, 1900);

  const camera = new THREE.PerspectiveCamera(40, 1, 1, 4000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.minDistance = 26;
  controls.maxDistance = 2200;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = Math.PI * 0.47;

  const root = new THREE.Group();
  root.name = 'osm-map';
  scene.add(root);

  const hemisphere = new THREE.HemisphereLight(0xfff4df, 0x8f9784, 2.35);
  scene.add(hemisphere);
  const keyLight = new THREE.DirectionalLight(0xfff1d2, 2.15);
  keyLight.position.set(-260, 480, 240);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xdce9f5, 0.6);
  fillLight.position.set(320, 200, -360);
  scene.add(fillLight);

  // Immersive mode puts the miniature in a quiet room, matching the sand
  // table's floor reference. It stays hidden on desktop.
  const room = new THREE.Group();
  room.name = 'map-xr-room';
  room.visible = false;

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 48),
    new THREE.MeshBasicMaterial({ color: '#d8d2c3' }),
  );
  floor.rotation.x = -Math.PI / 2;
  room.add(floor);

  const grid = new THREE.GridHelper(6.4, 26, 0x8d958d, 0xb7b8ad);
  grid.position.y = 0.002;
  grid.material.transparent = true;
  grid.material.opacity = 0.24;
  grid.material.depthWrite = false;
  room.add(grid);

  const roomEdge = new THREE.Mesh(
    new THREE.RingGeometry(3.38, 3.44, 64),
    new THREE.MeshBasicMaterial({
      color: '#9fa89f',
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
    }),
  );
  roomEdge.rotation.x = -Math.PI / 2;
  roomEdge.position.y = 0.003;
  room.add(roomEdge);
  scene.add(room);

  const width = document.size.width;
  const depth = document.size.depth;
  const pad = 64;
  const plinthWidth = width + pad;
  const plinthDepth = depth + pad;

  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(plinthWidth, 14, plinthDepth),
    lambert(PALETTE.wood),
  );
  plinth.position.y = -7.1;
  root.add(plinth);

  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(plinthWidth + 3, 3.4, plinthDepth + 3),
    lambert(PALETTE.woodDark),
  );
  edge.position.y = -13.4;
  root.add(edge);

  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(width + pad - 6, depth + pad - 6),
    lambert(PALETTE.sand),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = 0.02;
  root.add(sand);

  const areaGroup = new THREE.Group();
  areaGroup.name = 'map-areas';
  for (const area of document.areas) {
    const mesh = makeAreaMesh(area);
    mesh.position.y = 0.035;
    areaGroup.add(mesh);
  }
  root.add(areaGroup);

  const sidewalk = new THREE.Mesh(
    buildRoadGeometry(network.edges, 3.4),
    lambert(PALETTE.sidewalk),
  );
  sidewalk.position.y = 0.055;
  root.add(sidewalk);

  const roads = new THREE.Mesh(
    buildRoadGeometry(network.edges, 0),
    lambert(PALETTE.road),
  );
  roads.position.y = 0.085;
  root.add(roads);

  const streams = new THREE.Group();
  for (const stream of document.streams ?? []) {
    const positions = [];
    const indices = [];
    appendRibbon(positions, indices, stream.points, stream.width, 0);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, lambert(PALETTE.stream));
    mesh.position.y = 0.04;
    streams.add(mesh);
  }
  root.add(streams);

  const dashTransforms = buildDashes(network.edges);
  if (dashTransforms.length > 0) {
    const dashGeometry = new THREE.BoxGeometry(0.16, 0.02, 2.6);
    const dashes = new THREE.InstancedMesh(
      dashGeometry,
      new THREE.MeshBasicMaterial({ color: PALETTE.paint }),
      dashTransforms.length,
    );
    const matrix = new THREE.Matrix4();
    dashTransforms.forEach((transform, index) => {
      copyPose(matrix, transform.x, transform.z, transform.angle, 0.1);
      dashes.setMatrixAt(index, matrix);
    });
    dashes.instanceMatrix.needsUpdate = true;
    dashes.frustumCulled = false;
    root.add(dashes);
  }

  const buildingGeometry = buildBuildingsGeometry(document.buildings);
  const buildings = new THREE.Mesh(
    buildingGeometry,
    new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    }),
  );
  buildings.name = 'map-buildings';
  root.add(buildings);

  const random = mulberry32(0x0a5e17);
  const trees = createTrees(treePositions(network, document, random));
  root.add(trees);

  // Corner grips sized in map units so they read as tactile 2 cm knobs once the
  // miniature is placed in a room. Hidden outside immersive mode.
  const handlePack = createCornerHandles(
    { table: { playWidth: plinthWidth, playDepth: plinthDepth } },
    { scale: 82, inset: 14, y: 0.12 },
  );
  handlePack.group.name = 'map-corner-handles';
  handlePack.group.visible = false;
  root.add(handlePack.group);

  // Signal heads: small, readable, and only as numerous as OSM provides.
  const signalLamps = [];
  for (const signal of document.signals) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.2, 6.4, 6),
      lambert('#5c615f'),
    );
    pole.position.set(signal.x, 3.2, signal.z);
    root.add(pole);

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 2.4, 0.5),
      lambert('#3c4240'),
    );
    head.position.set(signal.x, 6.6, signal.z);
    root.add(head);

    const lamps = [];
    for (let index = 0; index < 3; index += 1) {
      const material = new THREE.MeshBasicMaterial({ color: '#3b3f3d' });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), material);
      lamp.position.set(signal.x, 7.35 - index * 0.72, signal.z + 0.3);
      root.add(lamp);
      lamps.push(material);
    }
    let node = null;
    let bestDistance = 30;
    for (const candidate of network.nodes) {
      const distance = Math.hypot(candidate.x - signal.x, candidate.z - signal.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        node = candidate;
      }
    }
    const lane = node?.incoming[0] ?? null;
    signalLamps.push({ lamps, axis: lane?.axis ?? 'NS' });
  }

  const carMeshes = createCarMeshes();
  root.add(carMeshes.shadows, carMeshes.bodies, carMeshes.cabins);

  const matrix = new THREE.Matrix4();
  const carColor = new THREE.Color();

  function updateCars(snapshots) {
    const count = Math.min(snapshots.length, carMeshes.bodies.instanceMatrix.count);
    const scale = CAR_VISUAL_SCALE;
    const bodyHeight = CAR_BODY_HEIGHT * scale;
    const cabinHeight = CAR_CABIN_HEIGHT * scale;
    const bodyY = CAR_GROUND_Y + bodyHeight * 0.5;
    const cabinY = CAR_GROUND_Y + bodyHeight + cabinHeight * 0.5;
    snapshots.forEach((car, index) => {
      copyPose(matrix, car.x, car.z, car.heading, bodyY, scale);
      carMeshes.bodies.setMatrixAt(index, matrix);
      copyPose(matrix, car.x, car.z, car.heading, cabinY, scale);
      carMeshes.cabins.setMatrixAt(index, matrix);
      copyPose(matrix, car.x, car.z, car.heading, CAR_GROUND_Y + 0.01, scale);
      carMeshes.shadows.setMatrixAt(index, matrix);

      carColor.set(car.color);
      carMeshes.bodies.setColorAt(index, carColor);
    });

    for (const mesh of [carMeshes.bodies, carMeshes.cabins, carMeshes.shadows]) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (carMeshes.bodies.instanceColor) {
      carMeshes.bodies.instanceColor.needsUpdate = true;
    }
  }

  // ---- Camera framing, navigation and car following ----------------------

  const target = new THREE.Vector3(0, 0, 0);
  const desiredPosition = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  let followId = null;
  let following = null;
  let dragging = false;
  let dragStart = null;
  let active = false;
  let xrActive = false;
  let desktopCameraState = null;

  function setActive(value) {
    active = value;
    controls.enabled = value && !following && !xrActive;
  }

  function enterXrMode() {
    if (xrActive) {
      return;
    }
    xrActive = true;
    desktopCameraState = {
      position: camera.position.clone(),
      target: controls.target.clone(),
      near: camera.near,
    };
    // Desktop can afford a 1-unit near plane across a 700 m map, but the
    // miniature sits less than 2 m away in VR. Keep the near plane at 5 cm
    // there so the front of the plinth and the room floor are not cut away.
    camera.near = 0.05;
    camera.updateProjectionMatrix();
    stopFollowing();
    controls.enabled = false;
    room.visible = true;
  }

  function setXrPlaced(placed) {
    handlePack.group.visible = Boolean(placed) && xrActive;
  }

  function exitXrMode() {
    if (!xrActive) {
      return;
    }
    xrActive = false;
    handlePack.group.visible = false;
    room.visible = false;
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.setScalar(1);
    controls.enabled = active && !following;
    if (desktopCameraState) {
      camera.position.copy(desktopCameraState.position);
      controls.target.copy(desktopCameraState.target);
      camera.near = desktopCameraState.near;
      camera.updateProjectionMatrix();
      camera.lookAt(controls.target);
      controls.update();
      desktopCameraState = null;
    }
  }

  function frameAll() {
    const span = Math.max(width, depth);
    camera.position.set(span * 0.6, span * 1.04, span * 1.15);
    target.set(0, 0, 0);
    controls.target.copy(target);
    controls.update();
  }

  function resetView() {
    stopFollowing();
    frameAll();
  }

  function follow(carId) {
    if (!carId) {
      stopFollowing();
      return null;
    }
    const car = traffic.cars.find((entry) => entry.id === carId) ?? null;
    if (!car) {
      return null;
    }
    followId = carId;
    following = car;
    controls.enabled = false;
    return carId;
  }

  function stopFollowing() {
    followId = null;
    following = null;
    controls.enabled = true;
  }

  function updateFollow(dt) {
    if (!following) {
      return;
    }
    const car = following;
    const blend = 1 - Math.exp(-7 * dt);
    const behindX = Math.sin(car.pose.heading);
    const behindZ = Math.cos(car.pose.heading);
    desiredPosition.set(
      car.pose.x - behindX * 32,
      18,
      car.pose.z - behindZ * 32,
    );
    desiredTarget.set(
      car.pose.x + behindX * 13,
      0.8,
      car.pose.z + behindZ * 13,
    );
    camera.position.lerp(desiredPosition, blend);
    target.lerp(desiredTarget, blend);
    camera.lookAt(target);
  }

  function panBy(x, z) {
    const distance = camera.position.distanceTo(controls.target);
    const speed = Math.max(12, distance * 0.85) * (1 / 60);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.001) {
      forward.set(0, 0, -1);
    }
    forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const delta = new THREE.Vector3()
      .addScaledVector(forward, z * speed)
      .addScaledVector(right, x * speed);
    camera.position.add(delta);
    controls.target.add(delta);
  }

  function rotateBy(angle) {
    const offset = camera.position.clone().sub(controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    camera.position.copy(controls.target).add(offset);
  }

  function zoomBy(factor) {
    const offset = camera.position.clone().sub(controls.target);
    const length = THREE.MathUtils.clamp(
      offset.length() * factor,
      controls.minDistance,
      controls.maxDistance,
    );
    offset.setLength(length);
    camera.position.copy(controls.target).add(offset);
  }

  const held = new Set();
  function onKeyDown(event) {
    if (!active) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, select, textarea')) {
      return;
    }
    const key = event.key.toLowerCase();
    // Escape must work while a control button still has focus.
    if (key !== 'escape' && target?.closest('button')) {
      return;
    }
    if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', '+', '-', '='].includes(key)) {
      held.add(key);
      event.preventDefault();
    }
    if (key === 'escape' && following) {
      stopFollowing();
      frameAll();
      onFollowChange?.(null);
    }
  }
  function onKeyUp(event) {
    held.delete(event.key.toLowerCase());
  }

  function applyKeys() {
    if (following) {
      return;
    }
    let x = 0;
    let z = 0;
    if (held.has('w') || held.has('arrowup')) z += 1;
    if (held.has('s') || held.has('arrowdown')) z -= 1;
    if (held.has('d') || held.has('arrowright')) x += 1;
    if (held.has('a') || held.has('arrowleft')) x -= 1;
    if (x !== 0 || z !== 0) {
      panBy(x, z);
    }
    if (held.has('q')) rotateBy(-0.02);
    if (held.has('e')) rotateBy(0.02);
    if (held.has('+') || held.has('=')) zoomBy(0.985);
    if (held.has('-')) zoomBy(1.015);
  }

  function onPointerDown(event) {
    if (!active) {
      return;
    }
    dragging = true;
    dragStart = { x: event.clientX, y: event.clientY, time: performance.now() };
  }

  function onPointerUp(event) {
    if (!active) {
      return;
    }
    if (!dragging || !dragStart) {
      dragging = false;
      return;
    }
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    const moved = Math.hypot(dx, dy);
    const elapsed = performance.now() - dragStart.time;
    dragging = false;
    if (moved < 6 && elapsed < 500) {
      const car = carAt(event.clientX, event.clientY);
      if (car) {
        follow(car.id);
        onFollowChange?.(car.id);
      }
    }
  }

  let onFollowChange = null;

  function carAt(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * 2 - 1;
    const py = -((clientY - rect.top) / rect.height) * 2 + 1;
    const point = new THREE.Vector3();
    let best = null;
    let bestScore = 0.0018;
    for (const car of traffic.cars) {
      point.set(car.pose.x, 1.2, car.pose.z).project(camera);
      if (point.z > 1) {
        continue;
      }
      const screenX = (point.x + 1) / 2;
      const screenY = (1 - point.y) / 2;
      const distance = Math.hypot(screenX - (px + 1) / 2, screenY - (py + 1) / 2);
      if (distance < bestScore) {
        bestScore = distance;
        best = car;
      }
    }
    return best;
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  function update(dt) {
    if (!xrActive) {
      applyKeys();
      updateFollow(dt);
      if (!following) {
        controls.update();
      }
    }
    updateCars(traffic.getSnapshots());

    const phase = traffic.time % 24;
    for (const signal of signalLamps) {
      const green = signal.axis === 'NS' ? phase < 10 : phase >= 12 && phase < 22;
      const yellow = signal.axis === 'NS'
        ? phase >= 10 && phase < 11.5
        : phase >= 22 && phase < 23.5;
      signal.lamps[0].color.set(green || yellow ? '#3b3f3d' : '#e05b4f');
      signal.lamps[1].color.set(yellow ? '#e7c565' : '#3b3f3d');
      signal.lamps[2].color.set(green ? '#7fc08a' : '#3b3f3d');
    }
  }

  function render() {
    renderer.render(scene, camera);
  }

  frameAll();
  resize();
  updateCars(traffic.getSnapshots());

  return {
    scene,
    camera,
    controls,
    root,
    plinthWidth,
    plinthDepth,
    tableBounds: {
      halfWidth: plinthWidth * 0.5 + 4,
      halfDepth: plinthDepth * 0.5 + 4,
      surfaceTolerance: 10,
    },
    get cornerHandles() {
      return handlePack.handles;
    },
    frameAll,
    resetView,
    follow,
    stopFollowing,
    carAt,
    setActive,
    enterXrMode,
    exitXrMode,
    setXrPlaced,
    set onFollowChange(handler) {
      onFollowChange = handler;
    },
    get followId() {
      return followId;
    },
    get following() {
      return Boolean(following);
    },
    get xrActive() {
      return xrActive;
    },
    update,
    render,
    resize,
  };
}
