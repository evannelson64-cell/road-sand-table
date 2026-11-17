// All DOM wiring lives here. The simulation and renderer know nothing about
// buttons, captions or accessibility state.

function formatTime(seconds) {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const minutes = Math.floor(totalMilliseconds / 60000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

export class UI {
  constructor(scenario, scenarios, callbacks) {
    this.scenario = scenario;
    this.scenarios = scenarios;
    this.callbacks = callbacks;
    this.behaviorButtons = new Map();
    this.isScrubbing = false;
    this.activeBehaviorId = null;

    this.elements = {
      stage: document.querySelector('#stage-label'),
      title: document.querySelector('#scene-title'),
      subtitle: document.querySelector('#scene-subtitle'),
      rule: document.querySelector('#rule-text'),
      risk: document.querySelector('#risk-text'),
      habit: document.querySelector('#habit-text'),
      scenarioSelect: document.querySelector('#scenario-select'),
      footNote: document.querySelector('#foot-note'),
      behaviorNote: document.querySelector('#behavior-note'),
      behaviors: document.querySelector('#behaviors'),
      play: document.querySelector('#play'),
      playSymbol: document.querySelector('#play-symbol'),
      playLabel: document.querySelector('#play-label'),
      stepBack: document.querySelector('#step-back'),
      stepForward: document.querySelector('#step-forward'),
      reset: document.querySelector('#reset'),
      scrub: document.querySelector('#scrub'),
      timeCurrent: document.querySelector('#time-current'),
      timeTotal: document.querySelector('#time-total'),
      speedButtons: [...document.querySelectorAll('.speed-button[data-speed]')],
      lesson: document.querySelector('#lesson-banner'),
      lessonTitle: document.querySelector('#lesson-title'),
      lessonText: document.querySelector('#lesson-text'),
      collisionScrim: document.querySelector('#collision-scrim'),
      collisionTitle: document.querySelector('#collision-title'),
      collisionDetail: document.querySelector('#collision-detail'),
      replaySlow: document.querySelector('#replay-slow'),
      showAvoid: document.querySelector('#show-avoid'),
      tryAgain: document.querySelector('#try-again'),
      loading: document.querySelector('#loading'),
      loadingText: document.querySelector('#loading-text'),
      error: document.querySelector('#error-screen'),
      errorMessage: document.querySelector('#error-message'),
      enterVr: document.querySelector('#enter-vr'),
      vrToast: document.querySelector('#vr-toast'),

      modeSandbox: document.querySelector('#mode-sandbox'),
      modeMap: document.querySelector('#mode-map'),
      sandboxLegend: document.querySelector('#sandbox-legend'),
      captionCard: document.querySelector('#caption-card'),
      sandboxPanel: document.querySelector('#sandbox-panel'),

      mapLegend: document.querySelector('#map-legend'),
      mapInfo: document.querySelector('#map-info'),
      mapPanel: document.querySelector('#map-panel'),
      mapName: document.querySelector('#map-name'),
      mapBlurb: document.querySelector('#map-blurb'),
      mapAttribution: document.querySelector('#map-attribution'),
      mapStatCars: document.querySelector('#map-stat-cars'),
      mapStatMoving: document.querySelector('#map-stat-moving'),
      mapStatSpeed: document.querySelector('#map-stat-speed'),
      mapStatStreets: document.querySelector('#map-stat-streets'),
      mapPlay: document.querySelector('#map-play'),
      mapPlaySymbol: document.querySelector('#map-play-symbol'),
      mapPlayLabel: document.querySelector('#map-play-label'),
      mapSpeedButtons: [...document.querySelectorAll('[data-map-speed]')],
      mapDensity: document.querySelector('#map-density'),
      mapDensityValue: document.querySelector('#map-density-value'),
      mapFollow: document.querySelector('#map-follow'),
      mapResetView: document.querySelector('#map-reset-view'),
      mapFootNote: document.querySelector('#map-foot-note'),
    };

    this.mode = 'sandbox';
    this.vrSupported = false;
    this.mapMeta = null;

    this.populateScenarioMenu();
    this.setScenario(scenario);
    this.bindEvents();
  }

  populateScenarioMenu() {
    const select = this.elements.scenarioSelect;
    select.replaceChildren();
    for (const entry of this.scenarios) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.title;
      select.append(option);
    }
  }

  setScenario(scenario, index = 0, count = this.scenarios.length) {
    const { elements } = this;
    this.scenario = scenario;
    this.scenarioIndex = index;
    this.scenarioCount = count;
    elements.title.textContent = scenario.title;
    elements.subtitle.textContent = scenario.subtitle;
    elements.stage.textContent = count > 1 ? `Stage 3 · ${index + 1}/${count}` : 'Stage 3';
    elements.rule.textContent = scenario.caption.rule;
    elements.risk.textContent = scenario.caption.risk;
    elements.habit.textContent = scenario.caption.habit;
    elements.scenarioSelect.value = scenario.id;
    elements.footNote.textContent = `${scenario.title} · right-hand traffic`;

    this.behaviorButtons.clear();
    elements.behaviors.replaceChildren();
    for (const behavior of scenario.behaviors) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'behavior-button';
      button.dataset.behavior = behavior.id;
      button.setAttribute('aria-pressed', 'false');

      const dot = document.createElement('span');
      dot.className = 'behavior-dot';
      dot.setAttribute('aria-hidden', 'true');
      button.append(dot, document.createTextNode(behavior.label));

      button.addEventListener('click', () => {
        this.callbacks.onBehavior(behavior.id);
      });

      elements.behaviors.append(button);
      this.behaviorButtons.set(behavior.id, button);
    }
  }

  bindEvents() {
    const { elements } = this;

    elements.play.addEventListener('click', () => this.callbacks.onPlayPause());
    elements.stepBack.addEventListener('click', () => this.callbacks.onStepBack());
    elements.stepForward.addEventListener('click', () => this.callbacks.onStepForward());
    elements.reset.addEventListener('click', () => this.callbacks.onReset());
    elements.enterVr.addEventListener('click', () => this.callbacks.onEnterVr());
    elements.scenarioSelect.addEventListener('change', () => {
      this.callbacks.onScenario(elements.scenarioSelect.value);
    });
    elements.replaySlow.addEventListener('click', () => this.callbacks.onReplaySlow());
    elements.showAvoid.addEventListener('click', () => this.callbacks.onShowAvoid());
    elements.tryAgain.addEventListener('click', () => this.callbacks.onTryAgain());

    elements.modeSandbox.addEventListener('click', () => this.callbacks.onMode('sandbox'));
    elements.modeMap.addEventListener('click', () => this.callbacks.onMode('map'));

    elements.mapPlay.addEventListener('click', () => this.callbacks.onMapPlayPause());
    elements.mapFollow.addEventListener('click', () => this.callbacks.onMapFollow());
    elements.mapResetView.addEventListener('click', () => this.callbacks.onMapResetView());
    elements.mapDensity.addEventListener('input', () => {
      this.callbacks.onMapDensity(Number(elements.mapDensity.value));
    });
    for (const button of elements.mapSpeedButtons) {
      button.addEventListener('click', () => {
        this.callbacks.onMapSpeed(Number(button.dataset.mapSpeed));
      });
    }

    for (const button of elements.speedButtons) {
      button.addEventListener('click', () => {
        this.callbacks.onSpeed(Number(button.dataset.speed));
      });
    }

    elements.scrub.addEventListener('pointerdown', () => {
      this.isScrubbing = true;
      this.callbacks.onScrubStart();
    });
    elements.scrub.addEventListener('input', () => {
      this.callbacks.onSeek(Number(elements.scrub.value));
    });
    elements.scrub.addEventListener('change', () => {
      this.isScrubbing = false;
    });
    elements.scrub.addEventListener('pointerup', () => {
      this.isScrubbing = false;
    });

    window.addEventListener('keydown', (event) => {
      if (this.mode !== 'sandbox') {
        return;
      }
      const target = event.target;
      if (target instanceof Element && target.closest('input, button, select, textarea')) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        this.callbacks.onPlayPause();
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault();
        this.callbacks.onStepBack();
      } else if (event.code === 'ArrowRight') {
        event.preventDefault();
        this.callbacks.onStepForward();
      }
    });
  }

  setBehavior(behaviorId) {
    this.activeBehaviorId = behaviorId;
    for (const [id, button] of this.behaviorButtons) {
      const active = id === behaviorId;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }

    const behavior = this.scenario.behaviors.find((entry) => entry.id === behaviorId);
    this.elements.behaviorNote.textContent = behavior?.note ?? '';
  }

  setSpeed(rate) {
    for (const button of this.elements.speedButtons) {
      const active = Number(button.dataset.speed) === rate;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  setPlayback(playing) {
    this.elements.playSymbol.textContent = playing ? '❚❚' : '▶';
    this.elements.playLabel.textContent = playing ? 'Pause' : 'Play';
    this.elements.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  setTimeline({ frameIndex, frameCount, time, canStepBack, canStepForward }) {
    this.elements.scrub.max = String(Math.max(0, frameCount - 1));
    this.elements.scrub.value = String(frameIndex);
    this.elements.timeCurrent.textContent = formatTime(time);
    this.elements.timeTotal.textContent = formatTime(Math.max(0, frameCount - 1) / 60);
    this.elements.stepBack.disabled = !canStepBack;
    this.elements.stepForward.disabled = !canStepForward;
  }

  showCollision({ time, detail }) {
    this.elements.collisionTitle.textContent = `Conflict at ${formatTime(time)}.`;
    this.elements.collisionDetail.textContent = detail;
    this.elements.collisionScrim.hidden = false;
    this.elements.showAvoid.focus({ preventScroll: true });
  }

  hideCollision() {
    this.elements.collisionScrim.hidden = true;
  }

  showLesson(title, text) {
    this.elements.lessonTitle.textContent = title;
    this.elements.lessonText.textContent = text;
    this.elements.lesson.hidden = false;
  }

  hideLesson() {
    this.elements.lesson.hidden = true;
  }

  showLoading(text) {
    if (text) {
      this.elements.loadingText.textContent = text;
    }
    this.elements.loading.classList.remove('is-hidden');
  }

  hideLoading() {
    this.elements.loading.classList.add('is-hidden');
  }

  showError(message) {
    this.elements.loading.classList.add('is-hidden');
    this.elements.error.hidden = false;
    this.elements.errorMessage.textContent = message;
  }

  setPlayDisabled(disabled) {
    this.elements.play.disabled = disabled;
  }

  setVrSupported(supported) {
    this.vrSupported = supported;
    this.elements.enterVr.disabled = false;
    this.updateVrVisibility();
  }

  updateVrVisibility() {
    this.elements.enterVr.hidden = !this.vrSupported;
  }

  setMode(mode) {
    this.mode = mode;
    const { elements } = this;
    const isMap = mode === 'map';
    document.body.classList.toggle('is-map', isMap);

    elements.sandboxLegend.hidden = isMap;
    elements.captionCard.hidden = isMap;
    elements.sandboxPanel.hidden = isMap;
    elements.mapLegend.hidden = !isMap;
    elements.mapInfo.hidden = !isMap;
    elements.mapPanel.hidden = !isMap;
    this.updateVrVisibility();

    elements.modeSandbox.classList.toggle('is-active', !isMap);
    elements.modeMap.classList.toggle('is-active', isMap);
    elements.modeSandbox.setAttribute('aria-pressed', String(!isMap));
    elements.modeMap.setAttribute('aria-pressed', String(isMap));

    if (isMap) {
      this.hideLesson();
      this.hideCollision();
      elements.stage.textContent = 'Real map · OSM';
    } else if (this.scenario) {
      elements.title.textContent = this.scenario.title;
      elements.subtitle.textContent = this.scenario.subtitle;
      elements.stage.textContent = (this.scenarioCount ?? 1) > 1
        ? `Stage 3 · ${(this.scenarioIndex ?? 0) + 1}/${this.scenarioCount}`
        : 'Stage 3';
    }
  }

  setMapMeta({ name, place, attribution, stats }) {
    const { elements } = this;
    this.mapMeta = { name, place, attribution, stats };
    elements.title.textContent = name;
    elements.subtitle.textContent = place ? `${place} · real street graph` : 'Real street graph';
    elements.mapName.textContent = name;
    elements.mapBlurb.textContent = `${place || 'OpenStreetMap extract'} · ` +
      `${stats.roadEdges} street links and ${stats.buildings} buildings drawn from a one-time OSM extract. ` +
      'Traffic follows one-ways, signals and stop signs. Nothing is fetched at runtime.';
    elements.mapAttribution.textContent = attribution;
    elements.mapStatStreets.textContent = String(stats.roadEdges);
  }

  setMapStats({ cars, moving, averageSpeed }) {
    const { elements } = this;
    elements.mapStatCars.textContent = String(cars);
    elements.mapStatMoving.textContent = String(moving);
    elements.mapStatSpeed.textContent = String(Math.round(averageSpeed * 3.6));
  }

  setMapPlaying(playing) {
    const { elements } = this;
    elements.mapPlaySymbol.textContent = playing ? '❚❚' : '▶';
    elements.mapPlayLabel.textContent = playing ? 'Pause' : 'Play';
    elements.mapPlay.setAttribute('aria-label', playing ? 'Pause traffic' : 'Play traffic');
  }

  setMapRate(rate) {
    for (const button of this.elements.mapSpeedButtons) {
      const active = Number(button.dataset.mapSpeed) === rate;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  setMapDensity(value) {
    this.elements.mapDensity.value = String(value);
    this.elements.mapDensityValue.textContent = String(value);
  }

  setFollowing(carId) {
    const { elements } = this;
    const following = Boolean(carId);
    elements.mapFollow.textContent = following ? 'Stop following' : 'Ride along';
    elements.mapFollow.classList.toggle('is-active', following);
    elements.mapFootNote.textContent = following
      ? 'Following a car · press Escape or Stop following to return to the map view'
      : 'Drag to orbit · Right-drag or two-finger swipe to pan · Scroll to zoom · WASD / arrows to move the camera';
  }

  setVrBusy(busy) {
    this.elements.enterVr.disabled = busy;
    this.elements.enterVr.querySelector('span:last-child').textContent = busy
      ? 'Entering…'
      : 'Enter VR';
  }

  showVrToast(message, timeout = 6000) {
    const toast = this.elements.vrToast;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(this.vrToastTimer);
    this.vrToastTimer = setTimeout(() => {
      toast.hidden = true;
    }, timeout);
  }

  hideVrToast() {
    clearTimeout(this.vrToastTimer);
    this.elements.vrToast.hidden = true;
  }
}
