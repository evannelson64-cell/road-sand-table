// Scene shell for both desktop orbit mode and immersive WebXR.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createTabletop } from './tabletop.js';
import { createRoads } from './roads.js';
import { createScenery } from './scenery.js';
import { createCarFleet } from './cars.js';
import { createCornerHandles } from './cornerHandles.js';

export function createWorld(canvas, scenario, cars) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = false;

  // local-floor keeps the table and virtual floor at real room height on Quest.
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 50);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = false;
  controls.minDistance = 2.6;
  controls.maxDistance = 11;
  controls.minPolarAngle = 0.18;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.target.set(0, -0.35, 0);

  let userHasMovedCamera = false;
  controls.addEventListener('start', () => {
    userHasMovedCamera = true;
  });

  function frameCamera() {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const narrow = aspect < 1.25;
    camera.fov = narrow ? 50 : 34;
    camera.updateProjectionMatrix();
    camera.position.set(
      narrow ? 3.9 : 3.35,
      narrow ? 5.2 : 4.75,
      narrow ? 6.7 : 5.7,
    );
    controls.target.set(0, narrow ? -0.45 : -0.35, 0);
    controls.update();
  }

  frameCamera();

  // Calm, bright studio-like light. No shadow maps anywhere.
  const hemisphere = new THREE.HemisphereLight(0xfff4df, 0x899176, 2.5);
  scene.add(hemisphere);

  const keyLight = new THREE.DirectionalLight(0xfff1d2, 2.25);
  keyLight.position.set(-3.5, 6.5, 4.5);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xdce9f5, 0.55);
  fillLight.position.set(4, 3, -4);
  scene.add(fillLight);

  // Everything that belongs to the table lives under one transformable root.
  // In VR this is scaled to a roughly 1.06 m wide miniature table.
  const tableRoot = new THREE.Group();
  tableRoot.name = 'table-root';
  tableRoot.add(createTabletop(scenario));
  tableRoot.add(createRoads(scenario));
  tableRoot.add(createScenery(scenario));

  const fleet = createCarFleet(cars);
  tableRoot.add(fleet.group);

  const cornerHandles = createCornerHandles(scenario);
  tableRoot.add(cornerHandles.group);

  const conflictRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.13, 0.011, 6, 32),
    new THREE.MeshBasicMaterial({
      color: '#ff8a3d',
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
      depthTest: false,
    }),
  );
  conflictRing.rotation.x = -Math.PI / 2;
  conflictRing.position.y = 0.025;
  conflictRing.visible = false;
  conflictRing.renderOrder = 6;
  tableRoot.add(conflictRing);

  scene.add(tableRoot);

  // A quiet virtual floor gives the floating table a room-scale reference in
  // immersive mode. It is hidden on desktop, where CSS supplies the backdrop.
  const room = new THREE.Group();
  room.name = 'xr-room-reference';
  room.visible = false;

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 48),
    new THREE.MeshBasicMaterial({ color: '#d8d2c3' }),
  );
  floor.rotation.x = -Math.PI / 2;
  room.add(floor);

  const grid = new THREE.GridHelper(6, 24, 0x8d958d, 0xb7b8ad);
  grid.position.y = 0.002;
  grid.material.transparent = true;
  grid.material.opacity = 0.24;
  grid.material.depthWrite = false;
  room.add(grid);

  const roomEdge = new THREE.Mesh(
    new THREE.RingGeometry(3.18, 3.24, 64),
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

  let desktopCameraState = null;

  function enterXrMode() {
    desktopCameraState = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      target: controls.target.clone(),
      fov: camera.fov,
    };
    controls.enabled = false;
    room.visible = true;
    scene.background = new THREE.Color('#b8c5c4');
    scene.fog = new THREE.Fog('#b8c5c4', 2.6, 5.6);
  }

  function exitXrMode() {
    controls.enabled = true;
    room.visible = false;
    scene.background = null;
    scene.fog = null;

    if (desktopCameraState) {
      camera.position.copy(desktopCameraState.position);
      camera.quaternion.copy(desktopCameraState.quaternion);
      camera.fov = desktopCameraState.fov;
      camera.updateProjectionMatrix();
      controls.target.copy(desktopCameraState.target);
      controls.update();
    }

    tableRoot.position.set(0, 0, 0);
    tableRoot.rotation.set(0, 0, 0);
    tableRoot.scale.setScalar(1);
  }

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (!renderer.xr.isPresenting) {
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

      if (!userHasMovedCamera) {
        frameCamera();
      }
    }
  }

  window.addEventListener('resize', resize);
  resize();

  return {
    renderer,
    scene,
    camera,
    controls,
    tableRoot,
    cornerHandles: cornerHandles.handles,
    conflictRing,
    enterXrMode,
    exitXrMode,
    updateCars(snapshots) {
      fleet.update(snapshots);
    },
    setConflict(point) {
      if (!point) {
        conflictRing.visible = false;
        return;
      }
      conflictRing.position.x = point.x;
      conflictRing.position.z = point.z;
      conflictRing.visible = true;
    },
    render() {
      if (!renderer.xr.isPresenting) {
        controls.update();
      }
      renderer.render(scene, camera);
    },
  };
}
