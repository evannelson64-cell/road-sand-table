// App shell: load the static scenario, advance fixed simulation frames from a
// render loop, and connect the controls to the deterministic replay history.

import { FIXED_DT, Simulation } from './sim/simulation.js';
import { createWorld } from './scene/world.js';
import { UI } from './ui.js';

const SCENARIO_URL = new URL('../data/scenario-two-way-stop.json', import.meta.url);
const MAX_STEPS_PER_RENDER = 8;

async function loadScenario() {
  const response = await fetch(SCENARIO_URL);
  if (!response.ok) {
    throw new Error(`Scenario request failed with HTTP ${response.status}.`);
  }
  return response.json();
}

function start() {
  const canvas = document.querySelector('#scene');
  let scenario;
  let simulation;
  let world;
  let ui;
  let behaviorId = 'rules';
  let playing = true;
  let rate = 1;
  let accumulator = 0;
  let lastRenderTime = performance.now();
  let lastUIUpdate = 0;
  let collisionDialogOpen = false;

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

    if (simulation.collision) {
      if (announceCollision && !collisionDialogOpen) {
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
    refreshControls();
  }

  function replaySlowMotion() {
    const collisionFrame = simulation.findCollisionFrame();
    if (collisionFrame < 0) {
      return;
    }

    // Rewind 1.5 simulated seconds. At 0.25x that is a six-second replay.
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
    refreshControls();
  }

  function tryAgain() {
    simulation.reset(behaviorId);
    playing = true;
    rate = 1;
    accumulator = 0;
    collisionDialogOpen = false;
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
    // Scrubbing across the conflict shows the ring but does not steal focus
    // with the dialog. Playing into the same frame does show the dialog.
    collisionDialogOpen = false;
    ui.hideCollision();
    ui.setPlayback(false);
    refreshControls();
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
  }

  function tick(now) {
    const deltaSeconds = Math.min(0.1, (now - lastRenderTime) / 1000);
    lastRenderTime = now;

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
          playing = false;
          collisionDialogOpen = true;
          ui.setPlayback(false);
          ui.showCollision({
            time: simulation.collision.time,
            detail: collisionDetail(),
          });
          break;
        }
      }

      // Do not build a large backlog if the tab was throttled.
      if (steps === MAX_STEPS_PER_RENDER) {
        accumulator = 0;
      }
    }

    refreshVisuals();
    world.render();

    if (now - lastUIUpdate > 100 || !playing) {
      lastUIUpdate = now;
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

    requestAnimationFrame(tick);
  }

  loadScenario()
    .then((loadedScenario) => {
      scenario = loadedScenario;
      simulation = new Simulation(scenario, { behaviorId });
      world = createWorld(canvas, scenario, simulation.scenario.cars);

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
      });

      ui.setBehavior(behaviorId);
      ui.setSpeed(rate);
      ui.setPlayback(playing);
      refreshControls();

      lastRenderTime = performance.now();
      requestAnimationFrame(tick);

      // A short delay lets the first frame paint before the loading layer fades.
      requestAnimationFrame(() => {
        ui.hideLoading();
        window.__sandTableReady = true;
      });

      // Small, read-only-friendly test/support surface. No external requests.
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
