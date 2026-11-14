// Scenario-specific tabletop props: signals, arrows, roundabout islands,
// parked vehicles and railroad crossings.
import * as THREE from 'three';
import { lambert, flatBox } from './builders.js';

const PAINT_Y = 0.017;

function facingYaw(facing) {
  return {
    south: 0,
    north: Math.PI,
    east: Math.PI / 2,
    west: -Math.PI / 2,
  }[facing] ?? 0;
}

function createTrafficLights(scenario) {
  const group = new THREE.Group();
  const lights = [];
  const poleMaterial = lambert('#54585a');
  const headMaterial = lambert('#242829');

  for (const definition of scenario.trafficLights ?? []) {
    const lightGroup = new THREE.Group();
    lightGroup.position.set(definition.x, 0, definition.z);
    lightGroup.rotation.y = facingYaw(definition.facing);

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.008, 0.16, 6),
      poleMaterial,
    );
    pole.position.y = 0.08;
    lightGroup.add(pole);

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.145, 0.028),
      headMaterial,
    );
    head.position.set(0, 0.19, 0);
    lightGroup.add(head);

    const bulbGeometry = new THREE.SphereGeometry(0.017, 8, 6);
    const bulbs = {};
    const positions = {
      red: 0.235,
      yellow: 0.19,
      green: 0.145,
    };

    for (const [color, y] of Object.entries(positions)) {
      const material = new THREE.MeshBasicMaterial({ color: '#37302b' });
      for (const z of [-0.017, 0.017]) {
        const bulb = new THREE.Mesh(bulbGeometry, material);
        bulb.position.set(0, y, z);
        lightGroup.add(bulb);
      }
      bulbs[color] = material;
    }

    group.add(lightGroup);
    lights.push({
      node: definition.node,
      approach: definition.approach,
      bulbs,
    });
  }

  return {
    group,
    update(signalStates = {}) {
      for (const light of lights) {
        const state = signalStates[light.node]?.[light.approach] ?? 'red';
        light.bulbs.red.color.set(state === 'red' ? '#ff604d' : '#37302b');
        light.bulbs.yellow.color.set(state === 'yellow' ? '#ffd25f' : '#37302b');
        light.bulbs.green.color.set(state === 'green' ? '#5ed788' : '#37302b');
      }
    },
  };
}

function arrowShape() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.015, -0.06);
  shape.lineTo(0.015, -0.06);
  shape.lineTo(0.015, 0.025);
  shape.lineTo(0.045, 0.025);
  shape.lineTo(0, 0.075);
  shape.lineTo(-0.045, 0.025);
  shape.lineTo(-0.015, 0.025);
  shape.closePath();
  return shape;
}

function createLaneArrows(scenario) {
  const group = new THREE.Group();
  const geometry = new THREE.ShapeGeometry(arrowShape());
  const material = new THREE.MeshBasicMaterial({
    color: '#eee9dc',
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
  });

  for (const arrow of scenario.laneArrows ?? []) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -Math.PI / 2 - (arrow.heading ?? 0);
    mesh.position.set(arrow.x, PAINT_Y, arrow.z);
    const scale = arrow.scale ?? 1;
    mesh.scale.setScalar(scale);
    group.add(mesh);
  }

  return group;
}

function createRoundabouts(scenario) {
  const group = new THREE.Group();

  for (const roundabout of scenario.roundabouts ?? []) {
    const island = new THREE.Mesh(
      new THREE.CircleGeometry(roundabout.innerRadius, 32),
      lambert('#b5cc9f'),
    );
    island.rotation.x = -Math.PI / 2;
    island.position.set(roundabout.x, 0.013, roundabout.z);
    group.add(island);

    const curb = new THREE.Mesh(
      new THREE.RingGeometry(
        roundabout.innerRadius,
        roundabout.innerRadius + 0.035,
        32,
      ),
      new THREE.MeshBasicMaterial({ color: '#beb9ac', side: THREE.DoubleSide }),
    );
    curb.rotation.x = -Math.PI / 2;
    curb.position.set(roundabout.x, 0.014, roundabout.z);
    group.add(curb);

    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.018, 0.08, 5),
      lambert('#7b5f45'),
    );
    trunk.position.y = 0.05;
    tree.add(trunk);
    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.1, 0),
      lambert('#789a62'),
    );
    crown.position.y = 0.15;
    tree.add(crown);
    tree.position.set(roundabout.x, 0.012, roundabout.z);
    group.add(tree);
  }

  return group;
}

function createParkedVehicles(scenario) {
  const group = new THREE.Group();

  for (const vehicle of scenario.parkedVehicles ?? []) {
    const van = new THREE.Group();
    van.position.set(vehicle.x, 0.014, vehicle.z);
    van.rotation.y = vehicle.rotation ?? 0;

    const bodyMaterial = lambert(vehicle.color ?? '#d8d4c7');
    const body = flatBox(0.16, 0.115, 0.36, bodyMaterial);
    body.position.y = 0.075;
    van.add(body);

    const roof = flatBox(0.145, 0.06, 0.23, bodyMaterial);
    roof.position.set(0, 0.162, -0.03);
    van.add(roof);

    const windshield = flatBox(0.13, 0.032, 0.008, lambert('#2d3d44'));
    windshield.position.set(0, 0.145, 0.19);
    van.add(windshield);

    const wheelGeometry = new THREE.CylinderGeometry(0.017, 0.017, 0.012, 8);
    wheelGeometry.rotateZ(Math.PI / 2);
    for (const x of [-0.084, 0.084]) {
      for (const z of [-0.11, 0.11]) {
        const wheel = new THREE.Mesh(wheelGeometry, lambert('#2c2e2f'));
        wheel.position.set(x, 0.02, z);
        van.add(wheel);
      }
    }

    group.add(van);
  }

  return group;
}

function createRailCrossing(definition, signalMaterials) {
  const group = new THREE.Group();
  group.position.set(definition.x, 0, definition.z);
  group.rotation.y = definition.rotation ?? 0;

  const railMaterial = lambert('#777a78');
  const tieMaterial = lambert('#6c5540');

  for (const offset of [-0.06, 0.06]) {
    const rail = flatBox(0.014, 0.012, 2.9, railMaterial);
    rail.position.set(offset, 0.019, 0);
    group.add(rail);
  }

  const tieGeometry = new THREE.BoxGeometry(0.26, 0.008, 0.036);
  const ties = new THREE.InstancedMesh(tieGeometry, tieMaterial, 18);
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < 18; index += 1) {
    matrix.makeTranslation(0, 0.013, -1.35 + index * 0.16);
    ties.setMatrixAt(index, matrix);
  }
  ties.instanceMatrix.needsUpdate = true;
  ties.frustumCulled = false;
  group.add(ties);

  // Crossbuck and flashing lamps on the right-hand side of the road.
  const signPost = new THREE.Group();
  signPost.position.set(0.54, 0, 0.18);
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.007, 0.008, 0.2, 6),
    lambert('#76716a'),
  );
  post.position.y = 0.1;
  signPost.add(post);

  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const board = flatBox(0.18, 0.024, 0.012, lambert('#f5f0e4'));
    board.position.set(0, 0.19, 0.015);
    board.rotation.z = angle;
    signPost.add(board);
  }

  const lampGeometry = new THREE.SphereGeometry(0.021, 8, 6);
  for (const x of [-0.055, 0.055]) {
    const lamp = new THREE.Mesh(lampGeometry, signalMaterials.red);
    lamp.position.set(x, 0.245, 0.018);
    signPost.add(lamp);
  }
  group.add(signPost);

  return group;
}

function createRailCrossings(scenario) {
  const group = new THREE.Group();
  const signalMaterials = {
    red: new THREE.MeshBasicMaterial({ color: '#4a2723' }),
  };
  const crossings = [];

  for (const definition of scenario.railCrossings ?? []) {
    group.add(createRailCrossing(definition, signalMaterials));
    crossings.push(definition);
  }

  let blinkState = false;
  let lastBlink = -1;

  return {
    group,
    update(railStates = {}, time = 0) {
      const active = Object.values(railStates).some(Boolean);
      const blinkIndex = Math.floor(time * 2.2);
      if (blinkIndex !== lastBlink) {
        lastBlink = blinkIndex;
        blinkState = !blinkState;
      }
      signalMaterials.red.color.set(
        active && blinkState ? '#ff5949' : active ? '#a7352d' : '#4a2723',
      );
    },
    crossings,
  };
}

export function createScenarioProps(scenario) {
  const group = new THREE.Group();
  group.name = 'scenario-props';

  const trafficLights = createTrafficLights(scenario);
  const laneArrows = createLaneArrows(scenario);
  const roundabouts = createRoundabouts(scenario);
  const parkedVehicles = createParkedVehicles(scenario);
  const railCrossings = createRailCrossings(scenario);

  group.add(
    trafficLights.group,
    laneArrows,
    roundabouts,
    parkedVehicles,
    railCrossings.group,
  );

  return {
    group,
    update({ signalStates, railStates, time }) {
      trafficLights.update(signalStates);
      railCrossings.update(railStates, time);
    },
  };
}
