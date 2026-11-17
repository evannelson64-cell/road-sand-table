// A canvas-rendered, grabbable control panel that lives in the room with the
// table. The canvas is one draw call; button hit regions are plain rectangles.
import * as THREE from 'three';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  COLORS,
  PANEL_HEIGHT,
  PANEL_WIDTH,
  fitText,
  paintButton,
  roundRect,
} from './panelKit.js';

export { PANEL_HEIGHT, PANEL_WIDTH } from './panelKit.js';

function formatTime(seconds) {
  const total = Math.max(0, Math.round(seconds * 1000));
  const minutes = Math.floor(total / 60000);
  const secs = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export class XrControlPanel {
  constructor(scenario, callbacks) {
    this.scenario = scenario;
    this.callbacks = callbacks;
    this.state = {
      playing: true,
      rate: 1,
      behaviorId: scenario.behaviors[0].id,
      locked: false,
      collision: null,
      frameIndex: 0,
      frameCount: 1,
      time: 0,
      handTracking: false,
      notice: null,
      scenarioIndex: 0,
      scenarioCount: 1,
    };
    this.buttons = [];
    this.hoverId = null;
    this.lastDrawKey = '';
    this.activePointerId = null;

    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    this.context = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT),
      this.material,
    );
    this.mesh.name = 'xr-control-panel';
    this.mesh.userData.xrPanel = this;
    this.mesh.renderOrder = 2;

    this.root = new THREE.Group();
    this.root.name = 'xr-control-panel-root';
    this.root.add(this.mesh);
    this.root.visible = false;

    this.draw();
  }

  setScenario(scenario, index = 0, count = 1) {
    this.scenario = scenario;
    this.state.behaviorId = scenario.behaviors[0]?.id ?? null;
    this.state.scenarioIndex = index;
    this.state.scenarioCount = count;
    this.draw();
  }

  setState(partial) {
    let changed = false;
    for (const [key, value] of Object.entries(partial)) {
      if (key === 'collision') {
        const previous = this.state.collision;
        const next = value
          ? { carIds: value.carIds, time: value.time }
          : null;
        if (JSON.stringify(previous) !== JSON.stringify(next)) {
          this.state.collision = next;
          changed = true;
        }
      } else if (key === 'notice') {
        const previous = this.state.notice;
        const next = value
          ? { title: value.title, text: value.text }
          : null;
        if (JSON.stringify(previous) !== JSON.stringify(next)) {
          this.state.notice = next;
          changed = true;
        }
      } else if (this.state[key] !== value) {
        this.state[key] = value;
        changed = true;
      }
    }

    if (changed) {
      this.draw();
    }
  }

  setHover(buttonId) {
    if (this.hoverId === buttonId) {
      return;
    }
    this.hoverId = buttonId;
    this.draw();
  }

  setVisible(visible) {
    this.root.visible = visible;
  }

  setHome(position, yaw = 0) {
    this.root.position.copy(position);
    this.root.rotation.set(0, yaw, 0);
  }

  getWorldPosition(target = new THREE.Vector3()) {
    return this.mesh.getWorldPosition(target);
  }

  getHeaderWorldPosition(target = new THREE.Vector3()) {
    // Centre of the dashed grab strip near the top-right of the header.
    target.set(0.31, PANEL_HEIGHT * 0.34, 0);
    this.mesh.updateWorldMatrix(true, false);
    return this.mesh.localToWorld(target);
  }

  getTimelineWorldPosition(fraction = 0.5, target = new THREE.Vector3()) {
    if (!this.timeline) {
      return null;
    }
    const x = this.timeline.trackX + this.timeline.trackWidth * fraction;
    const y = this.timeline.y + this.timeline.h / 2;
    target.set(
      (x / CANVAS_WIDTH - 0.5) * PANEL_WIDTH,
      (0.5 - y / CANVAS_HEIGHT) * PANEL_HEIGHT,
      0,
    );
    this.mesh.updateWorldMatrix(true, false);
    return this.mesh.localToWorld(target);
  }

  getButtonWorldPosition(buttonId, target = new THREE.Vector3()) {
    const button = this.buttons.find((entry) => entry.id === buttonId);
    if (!button) {
      return null;
    }

    const u = (button.x + button.w / 2) / CANVAS_WIDTH;
    const v = 1 - (button.y + button.h / 2) / CANVAS_HEIGHT;
    target.set(
      (u - 0.5) * PANEL_WIDTH,
      (v - 0.5) * PANEL_HEIGHT,
      0,
    );
    return this.mesh.localToWorld(target);
  }

  hitTestUV(u, v) {
    const x = u * CANVAS_WIDTH;
    const y = (1 - v) * CANVAS_HEIGHT;

    for (const button of this.buttons) {
      if (
        button.enabled !== false &&
        x >= button.x &&
        x <= button.x + button.w &&
        y >= button.y &&
        y <= button.y + button.h
      ) {
        return { type: 'button', id: button.id };
      }
    }

    if (this.state.collision) {
      return { type: 'none' };
    }

    if (x >= this.timeline.x && x <= this.timeline.x + this.timeline.w &&
        y >= this.timeline.y && y <= this.timeline.y + this.timeline.h) {
      return {
        type: 'timeline',
        fraction: Math.max(0, Math.min(1, (x - this.timeline.trackX) / this.timeline.trackWidth)),
      };
    }

    if (y <= this.headerBottom && y >= 24) {
      return { type: 'panel-grip' };
    }

    return { type: 'none' };
  }

  triggerButton(id) {
    switch (id) {
      case 'play':
        this.callbacks.onPlayPause();
        break;
      case 'back':
        this.callbacks.onStepBack();
        break;
      case 'next':
        this.callbacks.onStepForward();
        break;
      case 'speed-1':
        this.callbacks.onSpeed(1);
        break;
      case 'speed-0.5':
        this.callbacks.onSpeed(0.5);
        break;
      case 'speed-0.25':
        this.callbacks.onSpeed(0.25);
        break;
      case 'lock':
        this.callbacks.onToggleLock();
        break;
      case 'reset-table':
        this.callbacks.onResetTable();
        break;
      case 'height-down':
        this.callbacks.onNudgeHeight(-0.04);
        break;
      case 'height-up':
        this.callbacks.onNudgeHeight(0.04);
        break;
      case 'rotate-left':
        this.callbacks.onRotate(-Math.PI / 12);
        break;
      case 'rotate-right':
        this.callbacks.onRotate(Math.PI / 12);
        break;
      case 'scale-down':
        this.callbacks.onScale(0.9);
        break;
      case 'scale-up':
        this.callbacks.onScale(1.1);
        break;
      case 'replay-slow':
        this.callbacks.onReplaySlow();
        break;
      case 'show-avoid':
        this.callbacks.onShowAvoid();
        break;
      case 'try-again':
        this.callbacks.onTryAgain();
        break;
      case 'exit-vr':
        this.callbacks.onExitVr();
        break;
      case 'scenario-prev':
        this.callbacks.onScenarioPrev();
        break;
      case 'scenario-next':
        this.callbacks.onScenarioNext();
        break;
      default:
        if (id.startsWith('behavior-')) {
          this.callbacks.onBehavior(id.slice('behavior-'.length));
        }
    }
  }

  draw() {
    const { context, state } = this;
    const width = CANVAS_WIDTH;
    const height = CANVAS_HEIGHT;
    this.buttons = [];
    this.headerBottom = 132;

    context.clearRect(0, 0, width, height);

    // Main paper card.
    context.save();
    roundRect(context, 24, 24, width - 48, height - 48, 30);
    context.fillStyle = COLORS.paper;
    context.fill();
    context.strokeStyle = 'rgba(45, 56, 57, 0.24)';
    context.lineWidth = 2;
    context.stroke();
    context.restore();

    // Header, also the drag handle for moving the panel.
    context.save();
    roundRect(context, 24, 24, width - 48, 108, 30);
    context.clip();
    context.fillStyle = COLORS.header;
    context.fillRect(24, 24, width - 48, 110);
    context.restore();

    context.fillStyle = '#d8e4e2';
    context.font = '700 18px system-ui, sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillText('ROAD SAND TABLE · IMMERSIVE', 58, 61);

    context.fillStyle = COLORS.white;
    context.font = '600 36px Georgia, serif';
    context.fillText(this.scenario.title, 58, 107);

    this.drawPill(456, 48, state.playing ? 'PLAYING' : 'PAUSED', state.playing ? '#2e5f4a' : '#7b6549');

    // Grip strip on the right side of the header.
    context.strokeStyle = 'rgba(251, 248, 239, 0.28)';
    context.setLineDash([8, 8]);
    roundRect(context, 1044, 39, 316, 78, 13);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = '#d8e4e2';
    context.font = '700 14px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText('GRIP HERE TO MOVE PANEL', 1202, 92);
    for (let i = 0; i < 6; i += 1) {
      context.beginPath();
      context.arc(1094 + i * 16, 63, 3.4, 0, Math.PI * 2);
      context.fillStyle = 'rgba(251, 248, 239, 0.7)';
      context.fill();
    }

    // Left column: rule, risk and behavior selection.
    const leftX = 58;
    const leftWidth = 596;
    context.textAlign = 'left';
    context.fillStyle = COLORS.softInk;
    context.font = '750 15px system-ui, sans-serif';
    context.fillText('RIGHT OF WAY', leftX, 174);

    context.fillStyle = COLORS.ink;
    context.font = '500 25px Georgia, serif';
    const ruleLines = fitText(context, this.scenario.caption.rule, leftWidth, 3);
    ruleLines.forEach((line, index) => {
      context.fillText(line, leftX, 211 + index * 32);
    });

    context.fillStyle = COLORS.orange;
    context.fillRect(leftX, 315, 4, 62);
    context.fillStyle = COLORS.softInk;
    context.font = '750 14px system-ui, sans-serif';
    context.fillText('MAIN RISK', leftX + 18, 331);
    context.fillStyle = COLORS.ink;
    context.font = '400 19px system-ui, sans-serif';
    const riskLines = fitText(context, this.scenario.caption.risk, leftWidth - 18, 2);
    riskLines.forEach((line, index) => {
      context.fillText(line, leftX + 18, 357 + index * 24);
    });

    context.fillStyle = COLORS.softInk;
    context.font = '750 15px system-ui, sans-serif';
    context.fillText('TRAFFIC BEHAVIOR', leftX, 425);

    const behaviors = this.scenario.behaviors;
    behaviors.slice(0, 2).forEach((behavior, index) => {
      const buttonWidth = 286;
      this.drawButton(
        `behavior-${behavior.id}`,
        leftX + index * (buttonWidth + 14),
        444,
        buttonWidth,
        74,
        behavior.label,
        {
          selected: state.behaviorId === behavior.id,
          fontSize: 17,
        },
      );
    });

    // Right column: playback.
    const rightX = 710;
    context.fillStyle = COLORS.softInk;
    context.font = '750 15px system-ui, sans-serif';
    context.fillText('TIME', rightX, 174);

    this.drawButton('back', rightX, 192, 156, 70, '◀ Back', { fontSize: 18 });
    this.drawButton(
      'play',
      rightX + 166,
      192,
      272,
      70,
      state.playing ? '❚❚  Pause' : '▶  Play',
      { primary: true, fontSize: 20, disabled: Boolean(state.collision) },
    );
    this.drawButton('next', rightX + 448, 192, 156, 70, 'Next ▶', { fontSize: 18 });

    const speedOptions = [
      ['speed-1', '1×'],
      ['speed-0.5', '0.5×'],
      ['speed-0.25', '0.25×'],
    ];
    speedOptions.forEach(([id, label], index) => {
      this.drawButton(id, rightX + index * 216, 274, 200, 54, label, {
        selected: state.rate === Number(id.replace('speed-', '')),
        fontSize: 16,
      });
    });

    this.drawTimeline(rightX, 342);

    // Placement controls.
    context.fillStyle = COLORS.softInk;
    context.font = '750 15px system-ui, sans-serif';
    context.fillText('TABLE PLACEMENT', rightX, 444);

    const placementWidth = (636 - 30) / 4;
    this.drawButton('lock', rightX, 462, placementWidth, 60, state.locked ? 'Lock: ON' : 'Lock: OFF', {
      selected: state.locked,
      fontSize: 15,
    });
    this.drawButton('reset-table', rightX + placementWidth + 10, 462, placementWidth, 60, 'Reset table', { fontSize: 15 });
    this.drawButton('scale-down', rightX + (placementWidth + 10) * 2, 462, placementWidth, 60, 'Scale −', { fontSize: 15 });
    this.drawButton('scale-up', rightX + (placementWidth + 10) * 3, 462, placementWidth, 60, 'Scale +', { fontSize: 15 });

    this.drawButton('height-down', rightX, 532, placementWidth, 60, 'Height −', { fontSize: 15 });
    this.drawButton('height-up', rightX + placementWidth + 10, 532, placementWidth, 60, 'Height +', { fontSize: 15 });
    this.drawButton('rotate-left', rightX + (placementWidth + 10) * 2, 532, placementWidth, 60, 'Rotate L', { fontSize: 15 });
    this.drawButton('rotate-right', rightX + (placementWidth + 10) * 3, 532, placementWidth, 60, 'Rotate R', { fontSize: 15 });

    context.fillStyle = COLORS.muted;
    context.font = '400 16px system-ui, sans-serif';
    context.fillText('Grip a corner to move or twist. Two grips scale.', rightX, 626);
    context.fillText('Left stick moves · right stick height / rotate.', rightX, 653);
    context.fillText(
      `Table scale ${Math.round(state.scale * 100)}% · ${state.handTracking ? 'hands tracked' : 'controllers'}`,
      rightX,
      680,
    );

    if (state.collision) {
      this.drawCollisionPanel();
    } else {
      if (state.notice) {
        context.save();
        roundRect(context, 58, 548, 596, 124, 14);
        context.fillStyle = '#e9f2e9';
        context.fill();
        context.strokeStyle = 'rgba(50, 99, 76, 0.28)';
        context.lineWidth = 2;
        context.stroke();
        context.restore();
        context.fillStyle = COLORS.green;
        context.font = '750 14px system-ui, sans-serif';
        context.fillText(state.notice.title.toUpperCase(), 78, 577);
        context.fillStyle = '#345443';
        context.font = '400 17px system-ui, sans-serif';
        const noticeLines = fitText(context, state.notice.text, 556, 3);
        noticeLines.forEach((line, index) => {
          context.fillText(line, 78, 605 + index * 23);
        });
      } else {
        context.fillStyle = COLORS.softInk;
        context.font = '750 15px system-ui, sans-serif';
        context.fillText('LOOK DOWN · GRAB THE FOUR CORNERS', 58, 586);
        context.fillStyle = COLORS.muted;
        context.font = '400 16px system-ui, sans-serif';
        context.fillText('One grip moves the table in any direction.', 58, 613);
        context.fillText('Twist your hand to rotate; use both grips to scale.', 58, 639);
        context.fillText('Repeat the safe choice after every conflict.', 58, 673);
      }

      this.drawButton('scenario-prev', 58, 730, 126, 58, '‹ Prev', { fontSize: 15 });
      this.drawButton('scenario-next', 194, 730, 126, 58, 'Next ›', { fontSize: 15 });
      context.fillStyle = COLORS.muted;
      context.font = '400 15px system-ui, sans-serif';
      context.fillText(
        `Scenario ${state.scenarioIndex + 1} of ${state.scenarioCount}`,
        334,
        765,
      );
      this.drawButton('exit-vr', 1180, 730, 166, 58, 'Exit VR', { fontSize: 15 });
    }

    this.texture.needsUpdate = true;
    this.lastDrawKey = JSON.stringify({
      playing: state.playing,
      rate: state.rate,
      behaviorId: state.behaviorId,
      locked: state.locked,
      collision: state.collision,
      frameIndex: state.frameIndex,
      frameCount: state.frameCount,
      handTracking: state.handTracking,
      notice: state.notice,
      scenarioIndex: state.scenarioIndex,
      scenarioCount: state.scenarioCount,
      hoverId: this.hoverId,
    });
  }

  drawTimeline(x, y) {
    const { context, state } = this;
    const buttonWidth = 636;
    const progress = state.frameCount > 1
      ? Math.max(0, Math.min(1, state.frameIndex / (state.frameCount - 1)))
      : 0;
    const trackX = x + 16;
    const trackWidth = buttonWidth - 32;
    const trackY = y + 10;

    context.fillStyle = COLORS.line;
    roundRect(context, trackX, trackY, trackWidth, 7, 4);
    context.fill();

    context.fillStyle = COLORS.blue;
    roundRect(context, trackX, trackY, Math.max(0, trackWidth * progress), 7, 4);
    context.fill();

    context.beginPath();
    context.arc(trackX + trackWidth * progress, trackY + 3.5, 11, 0, Math.PI * 2);
    context.fillStyle = COLORS.ink;
    context.fill();
    context.lineWidth = 4;
    context.strokeStyle = COLORS.white;
    context.stroke();

    context.fillStyle = COLORS.softInk;
    context.font = '600 15px "SFMono-Regular", Consolas, monospace';
    context.textAlign = 'left';
    context.fillText(formatTime(state.time), trackX, y + 46);
    context.textAlign = 'right';
    context.fillText(formatTime(Math.max(0, state.frameCount - 1) / 60), x + buttonWidth - 16, y + 46);
    context.textAlign = 'left';

    this.timeline = {
      x,
      y: y + 2,
      w: buttonWidth,
      h: 54,
      trackX,
      trackWidth,
    };
  }

  drawCollisionPanel() {
    const { context } = this;
    const x = 54;
    const y = 700;
    const width = 1292;
    const height = 146;

    context.save();
    roundRect(context, x, y, width, height, 18);
    context.fillStyle = COLORS.orangeSoft;
    context.fill();
    context.strokeStyle = 'rgba(231, 119, 47, 0.5)';
    context.lineWidth = 2;
    context.stroke();
    context.restore();

    context.fillStyle = '#a95824';
    context.font = '750 15px system-ui, sans-serif';
    context.fillText('CONFLICT PAUSED', x + 22, y + 30);
    context.fillStyle = COLORS.ink;
    context.font = '600 22px Georgia, serif';
    context.fillText('The orange ring marks first contact.', x + 22, y + 63);
    context.fillStyle = COLORS.softInk;
    context.font = '400 16px system-ui, sans-serif';
    context.fillText('Choose the slow replay or compare the safe behavior.', x + 22, y + 91);

    this.drawButton('replay-slow', x + 600, y + 47, 196, 68, 'Slow replay', { fontSize: 16 });
    this.drawButton('show-avoid', x + 806, y + 47, 206, 68, 'Show safe version', { fontSize: 16, primary: true });
    this.drawButton('try-again', x + 1022, y + 47, 172, 68, 'Try again', { fontSize: 16 });
    this.drawButton('exit-vr', x + 1206, y + 17, 64, 32, 'Exit', { fontSize: 12 });
  }

  drawPill(x, y, text, color) {
    const { context } = this;
    context.font = '750 14px system-ui, sans-serif';
    const width = context.measureText(text).width + 28;
    roundRect(context, x, y, width, 30, 15);
    context.fillStyle = color;
    context.fill();
    context.fillStyle = COLORS.white;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, x + width / 2, y + 16);
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
  }

  drawButton(id, x, y, width, height, label, options = {}) {
    this.buttons.push({
      id,
      x,
      y,
      w: width,
      h: height,
      enabled: options.disabled !== true,
    });
    paintButton(this.context, {
      x,
      y,
      width,
      height,
      label,
      hovered: this.hoverId === id,
      selected: Boolean(options.selected),
      primary: Boolean(options.primary),
      disabled: Boolean(options.disabled),
      fontSize: options.fontSize ?? 16,
    });
  }
}
