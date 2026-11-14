// Desktop scene shell: renderer, camera, lights, tabletop and orbit controls.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createTabletop } from './tabletop.js';
import { createRoads } from './roads.js';
import { createScenery } from './scenery.js';
import { createCarFleet } from './cars.js';

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

  const tabletop = createTabletop(scenario);
  scene.add(tabletop);
  scene.add(createRoads(scenario));
  scene.add(createScenery(scenario));

  const fleet = createCarFleet(cars);
  scene.add(fleet.group);

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
  scene.add(conflictRing);

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    if (!userHasMovedCamera) {
      frameCamera();
    }
  }

  window.addEventListener('resize', resize);
  resize();

  return {
    renderer,
    scene,
    camera,
    controls,
    conflictRing,
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
      controls.update();
      renderer.render(scene, camera);
    },
  };
}
