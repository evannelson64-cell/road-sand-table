// App shell: desktop orbit mode plus an optional immersive WebXR mode.
// Simulation remains a fixed-step deterministic loop in both modes.

import * as THREE from 'three';
import { FIXED_DT, Simulation } from './sim/simulation.js';
import { createWorld } from './scene/world.js';
import { UI } from './ui.js';
import { XrSessionManager } from './xr/session.js';
import { TablePlacement } from './xr/tablePlacement.js';
import { XrControlPanel } from './xr/controlPanel.js';
import { XrInput } from './xr/input.js';
import { buildRoadNetwork } from './map/graph.js';
import { MapTraffic } from './map/traffic.js';
import { createMapView } from './scene/mapScene.js';

const CATALOG_URL = new URL('../data/scenarios.json', import.meta.url);
const MAP_URL = new URL('../data/maps/healdsburg-plaza.json', import.meta.url);
const MAX_STEPS_PER_RENDER = 8;
const XR_UI_INTERVAL_MS = 250;
const MAP_FIXED_DT = 1 / 60;
const MAP_DEFAULT_CARS = 64;

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}: ${url}`);
  }
  return response.json();
}

async function loadCatalog() {
  return fetchJson(CATALOG_URL);
}

async function loadScenarioFile(entry) {
  return fetchJson(new URL(`./${entry.file}`, CATALOG_URL));
}

function horizontalForward(vector) {
  const length = Math.hypot(vector.x, vector.z);
  if (length < 0.001) {
    return { x: 0, z: -1 };
  }
  return { x: vector.x / length, z: vector.z / length };
}

function start() {
  const canvas = document.querySelector('#scene');
  let catalog;
  let scenario;
  let scenarioIndex = 0;
  let simulation;
  let world;
  let ui;
  let xrManager;
  let xrPanel;
  let xrInput;
  let placement;
  let switchingScenario = false;

  let behaviorId = 'rules';
  let playing = true;
  let rate = 1;
  let accumulator = 0;
  let lastRenderTime = performance.now();
  let lastUIUpdate = 0;
  let lastXrPanelUpdate = 0;
  let collisionDialogOpen = false;
  let xrActive = false;
  let pendingXrPlacement = false;
  let xrPlaced = false;
  let handTracking = false;
  let viewerPose = null;
  let panelNotice = null;

  let mode = 'sandbox';
  let mapView = null;
  let mapTraffic = null;
  let mapDocument = null;
  let mapNetwork = null;
  let mapLoading = false;
  let mapPaused = false;
  let mapRate = 1;
  let mapCarCount = MAP_DEFAULT_CARS;
  let mapAccumulator = 0;
  let lastMapUiUpdate = 0;
  let sandboxWasPlaying = true;

  const panelPosition = new THREE.Vector3();

  function currentBehavior() {
    return scenario.behaviors.find((entry) => entry.id === behaviorId);
  }

  function collisionDetail() {
    const note = currentBehavior()?.note ?? '';
    const labels = simulation.collision.carIds.map((id) => {
      const car = simulation.cars.find((entry) => entry.id === id);
      const train = simulation.trains.find((entry) => entry.id === id);
      return car?.label ?? train?.label ?? id;
    });
    return `${labels.join(' and ')} made contact. ${note} The orange ring marks first contact; rewind to compare the safe choice.`;
  }

  function canStepForward() {
    return !(simulation.collision && simulation.frameIndex >= simulation.frameCount - 1);
  }

  function refreshVisuals() {
    world.updateCars(simulation.getCarSnapshots());
    world.updateTrains(simulation.getTrainSnapshots());

    const railStates = {};
    for (const crossing of scenario.railCrossings ?? []) {
      const node = simulation.scenario.nodesById.get(crossing.node);
      if (node) {
        railStates[crossing.node] = simulation.isRailCrossingActive(node);
      }
    }
    world.updateProps({
      signalStates: simulation.getSignalSnapshots(),
      railStates,
      time: simulation.timeSeconds,
    });
    world.setConflict(simulation.collision?.point ?? null);
  }

  function refreshXrPanel() {
    if (!xrPanel || !simulation || !placement) {
      return;
    }
    xrPanel.setState({
      playing,
      rate,
      behaviorId,
      scenarioIndex,
      scenarioCount: catalog?.scenarios.length ?? 1,
      locked: placement.locked,
      collision: simulation.collision,
      frameIndex: simulation.frameIndex,
      frameCount: simulation.frameCount,
      time: simulation.timeSeconds,
      scale: placement.root.scale.x,
      handTracking,
      notice: panelNotice,
    });
  }

  function refreshControls(announceCollision = false) {
    const timeline = {
      frameIndex: simulation.frameIndex,
      frameCount: simulation.frameCount,
      time: simulation.timeSeconds,
      canStepBack: simulation.frameIndex > 0,
      canStepForward: canStepForward(),
    };
    ui.setTimeline(timeline);
    ui.setPlayback(playing);
    ui.setPlayDisabled(!playing && !canStepForward());
    refreshVisuals();
    refreshXrPanel();

    if (simulation.collision) {
      if (announceCollision && !collisionDialogOpen && !xrActive) {
        collisionDialogOpen = true;
        ui.showCollision({
          time: simulation.collision.time,
          detail: collisionDetail(),
        });
      }
    } else if (collisionDialogOpen) {
      collisionDialogOpen = false;
      ui.hideCollision();
    }
  }

  function setBehavior(id) {
    behaviorId = id;
    simulation.setBehavior(id);
    playing = true;
    rate = 1;
    accumulator = 0;
    collisionDialogOpen = false;
    panelNotice = null;
    ui.hideCollision();
    ui.hideLesson();
    ui.setBehavior(id);
    ui.setSpeed(rate);
    ui.setPlayback(playing);
    refreshControls();
  }

  function resetRun() {
    simulation.reset(behaviorId);
    playing = true;
    rate = 1;
    accumulator = 0;
    collisionDialogOpen = false;
    panelNotice = null;
    ui.hideCollision();
    ui.hideLesson();
    ui.setSpeed(rate);
    ui.setPlayback(playing);
    refreshControls();
  }

  function play() {
    if (!canStepForward()) {
      return;
    }
    playing = true;
    accumulator = 0;
    collisionDialogOpen = false;
    ui.hideCollision();
    ui.setPlayback(true);
    refreshControls();
  }

  function pause() {
    playing = false;
    accumulator = 0;
    ui.setPlayback(false);
    refreshControls();
  }

  function showAvoidance() {
    const avoidance = scenario.avoidance;
    behaviorId = avoidance.behavior;
    simulation.reset(behaviorId);
    playing = true;
    rate = 0.5;
    accumulator = 0;
    collisionDialogOpen = false;
    ui.hideCollision();
    ui.setBehavior(behaviorId);
    ui.setSpeed(rate);
    ui.setPlayback(playing);
    ui.showLesson(avoidance.title, avoidance.text);
    panelNotice = { title: avoidance.title, text: avoidance.text };
    refreshControls();
  }

  function replaySlowMotion() {
    const collisionFrame = simulation.findCollisionFrame();
    if (collisionFrame < 0) {
      return;
    }

    simulation.seekFrame(Math.max(0, collisionFrame - 90));
    playing = true;
    rate = 0.25;
    accumulator = 0;
    collisionDialogOpen = false;
    ui.hideCollision();
    ui.setSpeed(rate);
    ui.setPlayback(true);
    ui.showLesson(
      'Slow-motion replay',
      'The same run, rewound 1.5 seconds. It will pause again at first contact.',
    );
    panelNotice = {
      title: 'Slow-motion replay',
      text: 'The same run, rewound 1.5 seconds. It pauses again at first contact.',
    };
    refreshControls();
  }

  function tryAgain() {
    simulation.reset(behaviorId);
    playing = true;
    rate = 1;
    accumulator = 0;
    collisionDialogOpen = false;
    panelNotice = null;
    ui.hideCollision();
    ui.hideLesson();
    ui.setSpeed(rate);
    ui.setPlayback(playing);
    refreshControls();
  }

  function seekToFrame(frame) {
    playing = false;
    accumulator = 0;
    simulation.seekFrame(frame);
    collisionDialogOpen = false;
    ui.hideCollision();
    ui.setPlayback(false);
    refreshControls();
  }

  function seekToFraction(fraction) {
    const frameCount = simulation.frameCount;
    const frame = Math.round(
      Math.max(0, Math.min(1, fraction)) * Math.max(0, frameCount - 1),
    );
    seekToFrame(frame);
  }

  function stepBack() {
    playing = false;
    accumulator = 0;
    simulation.stepBackward();
    collisionDialogOpen = false;
    ui.hideCollision();
    ui.setPlayback(false);
    refreshControls();
  }

  function stepForward() {
    playing = false;
    accumulator = 0;
    const result = simulation.stepForward();
    if (result !== 'blocked') {
      collisionDialogOpen = false;
      ui.hideCollision();
    }
    ui.setPlayback(false);
    refreshControls(Boolean(simulation.collision));
  }

  function changeSpeed(nextRate) {
    rate = nextRate;
    accumulator = 0;
    ui.setSpeed(rate);
    refreshXrPanel();
  }

  function togglePlacementLock() {
    if (!placement) {
      return;
    }
    placement.toggleLocked();
    if (placement.locked) {
      xrInput?.cancelAll();
    }
    refreshXrPanel();
  }

  function resetTablePosition() {
    if (!xrActive || !viewerPose || !placement) {
      return;
    }
    placement.placeInFront(viewerPose);
    xrInput?.cancelAll();
    refreshXrPanel();
  }

  function nudgeTableHeight(delta) {
    placement?.nudgeHeight(delta);
    refreshXrPanel();
  }

  function rotateTable(delta) {
    placement?.rotateBy(delta);
    refreshXrPanel();
  }

  function scaleTable(factor) {
    placement?.scaleBy(factor);
    refreshXrPanel();
  }

  function captureViewerPose(frame) {
    if (!xrActive || !frame) {
      return viewerPose;
    }
    const referenceSpace = world.renderer.xr.getReferenceSpace();
    if (!referenceSpace) {
      return viewerPose;
    }
    const pose = frame.getViewerPose(referenceSpace);
    if (!pose) {
      return viewerPose;
    }

    const { position, orientation } = pose.transform;
    const quaternion = new THREE.Quaternion(
      orientation.x,
      orientation.y,
      orientation.z,
      orientation.w,
    );
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
    const horizontal = horizontalForward(forward);
    return {
      position: { x: position.x, y: position.y, z: position.z },
      forward: { x: horizontal.x, y: 0, z: horizontal.z },
      quaternion: {
        x: quaternion.x,
        y: quaternion.y,
        z: quaternion.z,
        w: quaternion.w,
      },
    };
  }

  function placePanelForViewer(pose) {
    if (!pose || !xrPanel) {
      return;
    }
    const forward = horizontalForward(pose.forward);
    const right = { x: -forward.z, z: forward.x };
    panelPosition.set(
      pose.position.x + forward.x * 1.15 + right.x * 0.44,
      THREE.MathUtils.clamp(pose.position.y - 0.3, 1.0, 1.42),
      pose.position.z + forward.z * 1.15 + right.z * 0.44,
    );
    xrPanel.root.position.copy(panelPosition);
    xrPanel.root.lookAt(pose.position.x, pose.position.y, pose.position.z);
  }

  function beginXrPlacement() {
    if (!pendingXrPlacement || !viewerPose) {
      return;
    }
    pendingXrPlacement = false;
    xrPlaced = true;
    placement.setViewerPose(viewerPose);
    placement.placeInFront(viewerPose);
    placePanelForViewer(viewerPose);
    xrPanel.setVisible(true);
    xrInput.setActive(true);
    refreshXrPanel();
  }

  function enterXrMode() {
    xrActive = true;
    xrPlaced = false;
    pendingXrPlacement = true;
    viewerPose = null;
    handTracking = false;
    playing = false;
    accumulator = 0;
    document.body.classList.add('is-xr');
    world.enterXrMode();
    xrPanel.setVisible(false);
    xrInput.setActive(false);
    collisionDialogOpen = false;
    ui.hideCollision();
    ui.setPlayback(false);
    ui.setVrBusy(false);
    ui.hideVrToast();
  }

  function exitXrMode() {
    xrActive = false;
    xrPlaced = false;
    pendingXrPlacement = false;
    viewerPose = null;
    handTracking = false;
    document.body.classList.remove('is-xr');
    xrInput.setActive(false);
    xrPanel.setVisible(false);
    placement.exitDesktop();
    world.exitXrMode();
    ui.setVrBusy(false);
    ui.setVrSupported(xrManager?.supported ?? false);
    refreshControls(Boolean(simulation.collision));
  }

  function publishRoadMapSurface() {
    if (!mapView || !mapTraffic || !mapDocument) {
      return;
    }
    window.__roadMap = {
      getState: () => ({
        ready: true,
        active: mode === 'map',
        id: mapDocument.id,
        name: mapDocument.name,
        place: mapDocument.place,
        attribution: mapDocument.attribution,
        paused: mapPaused,
        rate: mapRate,
        following: mapView.followId,
        targetCars: mapCarCount,
        stats: mapTraffic.getStats(),
        network: {
          edges: mapNetwork.edges.length,
          lanes: mapNetwork.lanes.length,
          nodes: mapNetwork.nodes.length,
          signals: mapDocument.signals.length,
          stops: mapDocument.stops.length,
          buildings: mapDocument.buildings.length,
          areas: mapDocument.areas.length,
        },
        camera: {
          position: mapView.camera.position.toArray(),
          target: mapView.controls.target.toArray(),
          distance: mapView.camera.position.distanceTo(mapView.controls.target),
        },
        render: {
          calls: world.renderer.info.render.calls,
          triangles: world.renderer.info.render.triangles,
        },
      }),
      getCars: () => mapTraffic.getSnapshots(),
      follow: followMapCar,
      stopFollowing: () => {
        mapView?.stopFollowing();
        ui.setFollowing(null);
      },
      resetView: resetMapView,
      setDensity: setMapDensity,
      setRate: setMapRate,
      pause: () => setMapPaused(true),
      play: () => setMapPaused(false),
    };
    window.__roadMapReady = true;
  }

  async function ensureMapLoaded() {
    if (mapView) {
      return true;
    }
    if (mapLoading) {
      return false;
    }
    mapLoading = true;
    ui.showLoading('Charting real streets from OpenStreetMap…');
    try {
      mapDocument = await fetchJson(MAP_URL);
      if (!Array.isArray(mapDocument.edges) || mapDocument.edges.length === 0) {
        throw new Error('The map extract has no street edges.');
      }
      mapNetwork = buildRoadNetwork(mapDocument);
      mapTraffic = new MapTraffic(mapNetwork, {
        carCount: mapCarCount,
        seed: 0x5eed1234,
      });
      mapView = createMapView({
        renderer: world.renderer,
        document: mapDocument,
        network: mapNetwork,
        traffic: mapTraffic,
      });
      mapView.onFollowChange = (carId) => ui.setFollowing(carId);
      mapView.setActive(false);
      publishRoadMapSurface();
      return true;
    } catch (error) {
      console.error(error);
      ui.showVrToast(`The real map could not be loaded: ${error.message}`);
      return false;
    } finally {
      mapLoading = false;
      ui.hideLoading();
    }
  }

  async function setMode(nextMode) {
    if (nextMode === mode) {
      return mode;
    }
    if (xrActive) {
      ui.showVrToast('Exit VR before switching to the real map.');
      return mode;
    }

    if (nextMode === 'map') {
      if (!(await ensureMapLoaded())) {
        return mode;
      }
      sandboxWasPlaying = playing;
      playing = false;
      accumulator = 0;
      ui.setPlayback(false);

      mode = 'map';
      mapPaused = false;
      mapAccumulator = 0;
      world.controls.enabled = false;
      mapView.setActive(true);
      ui.setMode('map');
      ui.setMapMeta({
        name: mapDocument.name,
        place: mapDocument.place,
        attribution: mapDocument.attribution,
        stats: mapDocument.stats,
      });
      ui.setMapStats(mapTraffic.getStats());
      ui.setMapRate(mapRate);
      ui.setMapDensity(mapCarCount);
      ui.setMapPlaying(!mapPaused);
      ui.setFollowing(null);

      document.title = `${mapDocument.name} · Road Sand Table`;
      const url = new URL(window.location.href);
      url.searchParams.set('mode', 'map');
      window.history.replaceState(null, '', url);
    } else {
      mode = 'sandbox';
      mapPaused = true;
      mapAccumulator = 0;
      mapView?.setActive(false);
      mapView?.stopFollowing();
      ui.setFollowing(null);
      world.controls.enabled = true;
      ui.setMode('sandbox');
      playing = sandboxWasPlaying;
      ui.setPlayback(playing);
      refreshControls();

      document.title = `${scenario.title} · Road Sand Table`;
      const url = new URL(window.location.href);
      url.searchParams.delete('mode');
      window.history.replaceState(null, '', url);
    }
    return mode;
  }

  function setMapPaused(paused) {
    mapPaused = Boolean(paused);
    mapAccumulator = 0;
    ui.setMapPlaying(!mapPaused);
  }

  function setMapRate(nextRate) {
    mapRate = nextRate;
    mapAccumulator = 0;
    ui.setMapRate(mapRate);
  }

  function setMapDensity(value) {
    mapCarCount = Math.max(0, Math.min(180, Math.round(value)));
    if (mapTraffic) {
      mapTraffic.setCarCount(mapCarCount);
      ui.setMapStats(mapTraffic.getStats());
      publishRoadMapSurface();
    }
    ui.setMapDensity(mapCarCount);
  }

  function followMapCar(carId) {
    if (!mapView || !mapTraffic) {
      return null;
    }
    let id = carId;
    if (!id) {
      const moving = mapTraffic.cars.filter((car) => car.speed > 2);
      const pool = moving.length > 0 ? moving : mapTraffic.cars;
      if (pool.length === 0) {
        return null;
      }
      id = pool[Math.floor(Math.random() * pool.length)].id;
    }
    const followed = mapView.follow(id);
    ui.setFollowing(followed);
    return followed;
  }

  function toggleMapFollow() {
    if (!mapView) {
      return;
    }
    if (mapView.followId) {
      mapView.stopFollowing();
      mapView.frameAll();
      ui.setFollowing(null);
      return;
    }
    followMapCar();
  }

  function resetMapView() {
    mapView?.resetView();
    ui.setFollowing(null);
  }

  async function switchScenario(id) {
    if (switchingScenario || !catalog) {
      return;
    }
    const nextIndex = catalog.scenarios.findIndex((entry) => entry.id === id);
    if (nextIndex < 0) {
      return;
    }

    switchingScenario = true;
    try {
      const entry = catalog.scenarios[nextIndex];
      const nextScenario = await loadScenarioFile(entry);

      xrInput?.cancelAll();
      scenario = nextScenario;
      scenarioIndex = nextIndex;
      behaviorId = scenario.behaviors[0].id;
      simulation = new Simulation(scenario, { behaviorId });
      behaviorId = simulation.behaviorId;
      world.loadScenario(scenario, simulation.scenario.cars);

      placement.setLocked(false);
      if (!xrActive) {
        placement.exitDesktop();
      }

      collisionDialogOpen = false;
      panelNotice = null;
      playing = !xrActive;
      rate = 1;
      accumulator = 0;
      ui.hideCollision();
      ui.hideLesson();
      ui.setScenario(scenario, scenarioIndex, catalog.scenarios.length);
      ui.setBehavior(behaviorId);
      ui.setSpeed(rate);
      ui.setPlayback(playing);
      xrPanel.setScenario(scenario, scenarioIndex, catalog.scenarios.length);
      refreshControls();

      document.title = `${scenario.title} · Road Sand Table`;
      const url = new URL(window.location.href);
      url.searchParams.set('scenario', scenario.id);
      window.history.replaceState(null, '', url);
    } catch (error) {
      console.warn('Scenario could not be loaded:', error);
      ui.showVrToast(`That scenario could not be loaded: ${error.message}`);
    } finally {
      switchingScenario = false;
    }
  }

  function cycleScenario(delta) {
    if (!catalog) {
      return;
    }
    const nextIndex = (
      scenarioIndex + delta + catalog.scenarios.length
    ) % catalog.scenarios.length;
    switchScenario(catalog.scenarios[nextIndex].id);
  }

  async function enterVr() {
    if (mode === 'map' || !xrManager?.supported) {
      return;
    }
    ui.setVrBusy(true);
    const entered = await xrManager.enter();
    ui.setVrBusy(false);
    if (!entered) {
      ui.setVrSupported(xrManager.supported);
    }
  }

  function handleCollisionDetected() {
    playing = false;
    ui.setPlayback(false);
    if (xrActive) {
      refreshXrPanel();
    } else {
      collisionDialogOpen = true;
      ui.showCollision({
        time: simulation.collision.time,
        detail: collisionDetail(),
      });
    }
  }

  function tick(time, frame) {
    const deltaSeconds = Math.min(0.1, Math.max(0, (time - lastRenderTime) / 1000));
    lastRenderTime = time;

    if (mode === 'map') {
      if (!mapView || !mapTraffic) {
        return;
      }
      if (!mapPaused) {
        mapAccumulator += deltaSeconds * mapRate;
        let steps = 0;
        while (mapAccumulator >= MAP_FIXED_DT && steps < 6) {
          mapTraffic.advance(MAP_FIXED_DT);
          mapAccumulator -= MAP_FIXED_DT;
          steps += 1;
        }
        if (steps === 6) {
          mapAccumulator = 0;
        }
      }
      mapView.update(deltaSeconds);

      if (time - lastMapUiUpdate > 220) {
        lastMapUiUpdate = time;
        ui.setMapStats(mapTraffic.getStats());
      }
      mapView.render();
      return;
    }

    if (xrActive) {
      const nextViewerPose = captureViewerPose(frame);
      if (nextViewerPose) {
        viewerPose = nextViewerPose;
        placement.setViewerPose(viewerPose);
      }
      beginXrPlacement();
    }

    if (playing) {
      accumulator += deltaSeconds * rate;
      let steps = 0;

      while (
        accumulator >= FIXED_DT &&
        steps < MAX_STEPS_PER_RENDER &&
        playing &&
        !simulation.collision
      ) {
        const atLatest = simulation.frameIndex >= simulation.frameCount - 1;
        if (atLatest) {
          simulation.stepFrame();
        } else {
          simulation.stepForward();
        }
        accumulator -= FIXED_DT;
        steps += 1;

        if (simulation.collision) {
          handleCollisionDetected();
          break;
        }
      }

      if (steps === MAX_STEPS_PER_RENDER) {
        accumulator = 0;
      }
    }

    refreshVisuals();

    if (xrActive && xrPlaced) {
      xrInput.update(deltaSeconds, viewerPose);
      if (time - lastXrPanelUpdate > XR_UI_INTERVAL_MS) {
        lastXrPanelUpdate = time;
        refreshXrPanel();
      }
    }

    world.render();

    if (time - lastUIUpdate > 100) {
      lastUIUpdate = time;
      const canForward = canStepForward();
      ui.setTimeline({
        frameIndex: simulation.frameIndex,
        frameCount: simulation.frameCount,
        time: simulation.timeSeconds,
        canStepBack: simulation.frameIndex > 0,
        canStepForward: canForward,
      });
      ui.setPlayDisabled(!playing && !canForward);
    }
  }

  loadCatalog()
    .then(async (loadedCatalog) => {
      catalog = loadedCatalog;
      if (!Array.isArray(catalog.scenarios) || catalog.scenarios.length === 0) {
        throw new Error('The scenario catalog is empty.');
      }

      const requestedId = new URLSearchParams(window.location.search).get('scenario');
      const initialIndex = catalog.scenarios.findIndex((entry) => (
        entry.id === (requestedId ?? catalog.default)
      ));
      scenarioIndex = initialIndex >= 0 ? initialIndex : 0;
      scenario = await loadScenarioFile(catalog.scenarios[scenarioIndex]);
      behaviorId = scenario.behaviors[0].id;
      simulation = new Simulation(scenario, { behaviorId });
      behaviorId = simulation.behaviorId;
      world = createWorld(canvas, scenario, simulation.scenario.cars);

      placement = new TablePlacement(world.tableRoot);

      xrPanel = new XrControlPanel(scenario, {
        onBehavior: setBehavior,
        onPlayPause: () => (playing ? pause() : play()),
        onStepBack: stepBack,
        onStepForward: stepForward,
        onSpeed: changeSpeed,
        onToggleLock: togglePlacementLock,
        onResetTable: resetTablePosition,
        onNudgeHeight: nudgeTableHeight,
        onRotate: rotateTable,
        onScale: scaleTable,
        onReplaySlow: replaySlowMotion,
        onShowAvoid: showAvoidance,
        onTryAgain: tryAgain,
        onExitVr: () => xrManager?.exit(),
        onSeekFraction: seekToFraction,
        onScenarioPrev: () => cycleScenario(-1),
        onScenarioNext: () => cycleScenario(1),
      });
      world.scene.add(xrPanel.root);
      xrPanel.setScenario(scenario, scenarioIndex, catalog.scenarios.length);

      xrInput = new XrInput({
        renderer: world.renderer,
        scene: world.scene,
        world,
        placement,
        panel: xrPanel,
        callbacks: {
          onSeekFraction: seekToFraction,
          onHandTracking: (tracked) => {
            handTracking = tracked;
            refreshXrPanel();
          },
        },
      });

      xrManager = new XrSessionManager({
        renderer: world.renderer,
        onStart: enterXrMode,
        onEnd: exitXrMode,
        onSupport: (supported) => ui.setVrSupported(supported),
        onError: (message) => {
          ui.setVrBusy(false);
          ui.showVrToast(`VR could not start: ${message}`);
        },
      });

      ui = new UI(scenario, catalog.scenarios, {
        onBehavior: setBehavior,
        onPlayPause: () => (playing ? pause() : play()),
        onStepBack: stepBack,
        onStepForward: stepForward,
        onReset: resetRun,
        onReplaySlow: replaySlowMotion,
        onShowAvoid: showAvoidance,
        onTryAgain: tryAgain,
        onSpeed: changeSpeed,
        onScrubStart: pause,
        onSeek: seekToFrame,
        onEnterVr: enterVr,
        onScenario: switchScenario,
        onMode: setMode,
        onMapPlayPause: () => setMapPaused(!mapPaused),
        onMapSpeed: setMapRate,
        onMapDensity: setMapDensity,
        onMapFollow: toggleMapFollow,
        onMapResetView: resetMapView,
      });
      ui.setScenario(scenario, scenarioIndex, catalog.scenarios.length);
      ui.setBehavior(behaviorId);
      ui.setSpeed(rate);
      ui.setPlayback(playing);
      refreshControls();

      world.renderer.setAnimationLoop(tick);
      requestAnimationFrame(() => {
        ui.hideLoading();
        window.__sandTableReady = true;

        if (new URLSearchParams(window.location.search).get('mode') === 'map') {
          setMode('map');
        }
      });

      xrManager.init();

      // Small test/support surface. It never performs external requests.
      window.__sandTable = {
        getState: () => ({
          ready: true,
          mode,
          scenarioId: scenario.id,
          scenarioTitle: scenario.title,
          scenarioIndex,
          scenarioCount: catalog.scenarios.length,
          frameIndex: simulation.frameIndex,
          frameCount: simulation.frameCount,
          time: simulation.timeSeconds,
          playing,
          rate,
          behaviorId,
          collision: simulation.collision
            ? structuredClone(simulation.collision)
            : null,
          cars: simulation.getCarSnapshots(),
          trains: simulation.getTrainSnapshots(),
          signals: simulation.getSignalSnapshots(),
          xr: {
            supported: xrManager?.supported ?? false,
            active: xrActive,
            placed: xrPlaced,
            handTracking,
            notice: panelNotice,
            panelVisible: xrPanel?.root.visible ?? false,
            panelPosition: xrPanel ? xrPanel.root.position.toArray() : null,
            panelHeader: xrPanel?.getHeaderWorldPosition()?.toArray() ?? null,
            panelTimeline: xrPanel?.getTimelineWorldPosition(0.5)?.toArray() ?? null,
            enabledFeatures: world.renderer.xr.getSession()
              ? Array.from(world.renderer.xr.getSession().enabledFeatures ?? [])
              : [],
            table: placement?.getState() ?? null,
            tableCorners: world.cornerHandles.map((handle) => {
              handle.object.updateMatrixWorld(true);
              const center = handle.object.localToWorld(handle.centerLocal.clone());
              return { id: handle.id, position: center.toArray() };
            }),
            panelButtons: Object.fromEntries(
              [
                'play',
                'lock',
                'height-up',
                'height-down',
                'rotate-left',
                'rotate-right',
                'scale-up',
                'scale-down',
                'reset-table',
                'exit-vr',
                'scenario-prev',
                'scenario-next',
                'behavior-rules',
                'behavior-no-yield',
                'replay-slow',
                'show-avoid',
                'try-again',
              ]
                .map((id) => {
                  const point = xrPanel?.getButtonWorldPosition(id);
                  return [id, point ? point.toArray() : null];
                }),
            ),
            input: xrInput?.getDebugState() ?? null,
            render: {
              calls: world.renderer.info.render.calls,
              triangles: world.renderer.info.render.triangles,
            },
          },
        }),
        play,
        pause,
        reset: resetRun,
        setBehavior,
        showAvoidance,
        stepBack,
        stepForward,
        seekFrame: seekToFrame,
        setSpeed: changeSpeed,
        loadScenario: switchScenario,
        getScenarioList: () => catalog.scenarios.map((entry) => ({ ...entry })),
        setMode,
        getMapState: () => window.__roadMap?.getState() ?? null,
        setMapDensity,
        setMapRate,
        mapPlay: () => setMapPaused(false),
        mapPause: () => setMapPaused(true),
        followCar: followMapCar,
        resetMapView,
        toggleMapFollow,
        enterVr,
        exitVr: () => xrManager?.exit(),
        resetTable: resetTablePosition,
        toggleLock: togglePlacementLock,
        getPanelButtonPosition: (id) => {
          const point = xrPanel?.getButtonWorldPosition(id);
          return point ? point.toArray() : null;
        },
      };
    })
    .catch((error) => {
      console.error(error);
      const errorScreen = document.querySelector('#error-screen');
      const errorMessage = document.querySelector('#error-message');
      const loading = document.querySelector('#loading');
      if (loading) {
        loading.classList.add('is-hidden');
      }
      if (errorScreen && errorMessage) {
        errorScreen.hidden = false;
        errorMessage.textContent = error.message;
      }
    });
}

start();
