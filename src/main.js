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

const SCENARIO_URL = new URL('../data/scenario-two-way-stop.json', import.meta.url);
const MAX_STEPS_PER_RENDER = 8;
const XR_UI_INTERVAL_MS = 250;

async function loadScenario() {
  const response = await fetch(SCENARIO_URL);
  if (!response.ok) {
    throw new Error(`Scenario request failed with HTTP ${response.status}.`);
  }
  return response.json();
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
  let scenario;
  let simulation;
  let world;
  let ui;
  let xrManager;
  let xrPanel;
  let xrInput;
  let placement;

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

  const panelPosition = new THREE.Vector3();

  function currentBehavior() {
    return scenario.behaviors.find((entry) => entry.id === behaviorId);
  }

  function collisionDetail() {
    const note = currentBehavior()?.note ?? '';
    return `${note} The orange ring marks first contact. The run is paused there, so you can rewind and compare the safe choice.`;
  }

  function canStepForward() {
    return !(simulation.collision && simulation.frameIndex >= simulation.frameCount - 1);
  }

  function refreshVisuals() {
    world.updateCars(simulation.getCarSnapshots());
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

  async function enterVr() {
    if (!xrManager?.supported) {
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

  loadScenario()
    .then((loadedScenario) => {
      scenario = loadedScenario;
      simulation = new Simulation(scenario, { behaviorId });
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
      });
      world.scene.add(xrPanel.root);

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

      ui = new UI(scenario, {
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
      });

      ui.setBehavior(behaviorId);
      ui.setSpeed(rate);
      ui.setPlayback(playing);
      refreshControls();

      world.renderer.setAnimationLoop(tick);
      requestAnimationFrame(() => {
        ui.hideLoading();
        window.__sandTableReady = true;
      });

      xrManager.init();

      // Small test/support surface. It never performs external requests.
      window.__sandTable = {
        getState: () => ({
          ready: true,
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
