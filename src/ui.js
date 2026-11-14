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
      speedButtons: [...document.querySelectorAll('.speed-button')],
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
      error: document.querySelector('#error-screen'),
      errorMessage: document.querySelector('#error-message'),
      enterVr: document.querySelector('#enter-vr'),
      vrToast: document.querySelector('#vr-toast'),
    };

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
    this.elements.enterVr.hidden = !supported;
    this.elements.enterVr.disabled = false;
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
