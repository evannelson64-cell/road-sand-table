// Scene shell for both desktop orbit mode and immersive WebXR.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createTabletop } from './tabletop.js';
import { createRoads } from './roads.js';
import { createScenery } from './scenery.js';
import { createCarFleet } from './cars.js';
import { createTrainFleet } from './trains.js';
import { createCornerHandles } from './cornerHandles.js';
import { createScenarioProps } from './props.js';

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
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  // The orbit distance is logarithmic too: one wheel notch is a fixed
  // percentage, so the range reaches from a single junction to the whole
  // diorama. Reset view restores the framed overview.
  controls.minDistance = 0.6;
  controls.maxDistance = 26;
  controls.minPolarAngle = 0.18;
  const baseMaxPolar = Math.PI * 0.46;
  controls.maxPolarAngle = baseMaxPolar;
  controls.zoomToCursor = true;
  // Aim at the sand surface so wheel/pinch zoom lands under the pointer.
  controls.target.set(0, 0.02, 0);

  let userHasMovedCamera = false;
  controls.addEventListener('start', () => {
    userHasMovedCamera = true;
  });

  function frameCamera() {
    // A tight zoom may have clamped the polar angle; the overview needs the
    // full range back.
    controls.maxPolarAngle = baseMaxPolar;
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const narrow = aspect < 1.25;
    camera.fov = narrow ? 50 : 34;
    camera.updateProjectionMatrix();
    camera.position.set(
      narrow ? 3.9 : 3.35,
      narrow ? 5.2 : 4.75,
      narrow ? 6.7 : 5.7,
    );
    controls.target.set(0, 0.02, 0);
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

  // Everything that belongs to the table lives under one persistent
  // transformable root. Loading a scenario swaps its children, preserving the
  // user's room placement and the four-corner handles' transform.
  const tableRoot = new THREE.Group();
  tableRoot.name = 'table-root';
  scene.add(tableRoot);

  let fleet = null;
  let trainFleet = null;
  let cornerHandles = [];
  let props = null;
  let conflictRing = null;

  function disposeContent(root) {
    root.traverse((object) => {
      if (object.geometry) {
        object.geometry.dispose();
      }
      if (object.material) {
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) {
          material.dispose();
        }
      }
    });
  }

  function loadScenario(nextScenario, cars) {
    for (const child of [...tableRoot.children]) {
      tableRoot.remove(child);
      disposeContent(child);
    }

    tableRoot.add(createTabletop(nextScenario));
    tableRoot.add(createRoads(nextScenario));
    tableRoot.add(createScenery(nextScenario));

    fleet = createCarFleet(cars);
    tableRoot.add(fleet.group);

    trainFleet = createTrainFleet(nextScenario.trains ?? []);
    tableRoot.add(trainFleet.group);

    const handlePack = createCornerHandles(nextScenario);
    cornerHandles = handlePack.handles;
    tableRoot.add(handlePack.group);

    props = createScenarioProps(nextScenario);
    tableRoot.add(props.group);

    conflictRing = new THREE.Mesh(
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
  }

  loadScenario(scenario, cars);

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

  // The closer the orbit goes, the more top-down it has to look, or the camera
  // ends up inside the wooden slab. Zooming out restores the shallow angles.
  const MIN_CAMERA_HEIGHT = 0.25;
  function updateOrbitLimits() {
    const distance = camera.position.distanceTo(controls.target);
    const ratio = (MIN_CAMERA_HEIGHT - controls.target.y) / Math.max(distance, 0.001);
    const limit = Math.acos(Math.min(1, Math.max(-1, ratio)));
    controls.maxPolarAngle = Math.min(
      baseMaxPolar,
      Math.max(controls.minPolarAngle, limit),
    );
  }

  return {
    renderer,
    scene,
    camera,
    controls,
    tableRoot,
    get cornerHandles() {
      return cornerHandles;
    },
    get conflictRing() {
      return conflictRing;
    },
    enterXrMode,
    exitXrMode,
    resetView() {
      userHasMovedCamera = false;
      frameCamera();
    },
    loadScenario,
    updateCars(snapshots) {
      fleet?.update(snapshots);
    },
    updateTrains(snapshots) {
      trainFleet?.update(snapshots);
    },
    updateProps(data) {
      props?.update(data);
    },
    setConflict(point) {
      if (!conflictRing) {
        return;
      }
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
        updateOrbitLimits();
        controls.update();
      }
      renderer.render(scene, camera);
    },
  };
}
