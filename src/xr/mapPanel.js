// Canvas panel for immersive real-map mode.
//
// Layout mirrors the sand-table panel: header, live information on the left,
// playback and table placement on the right, and a grab strip for moving the
// panel. The map controls are intentionally small: pause, speed, density,
// placement and exit.
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

const DENSITY_STEP = 16;

export class MapXrPanel {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.state = {
      playing: true,
      rate: 1,
      carCount: 64,
      stats: { cars: 0, moving: 0, averageSpeed: 0 },
      linkCount: 0,
      locked: false,
      scale: 1,
      tableWidth: 0,
      handTracking: false,
    };
    this.buttons = [];
    this.hoverId = null;
    this.headerBottom = 132;

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
    this.mesh.name = 'map-xr-control-panel';
    this.mesh.userData.xrPanel = this;
    this.mesh.renderOrder = 2;

    this.root = new THREE.Group();
    this.root.name = 'map-xr-control-panel-root';
    this.root.add(this.mesh);
    this.root.visible = false;

    this.draw();
  }

  setState(partial) {
    let changed = false;
    for (const [key, value] of Object.entries(partial)) {
      if (key === 'stats') {
        const previous = this.state.stats;
        const next = {
          cars: value?.cars ?? 0,
          moving: value?.moving ?? 0,
          averageSpeed: value?.averageSpeed ?? 0,
        };
        if (
          previous.cars !== next.cars ||
          previous.moving !== next.moving ||
          Math.round(previous.averageSpeed) !== Math.round(next.averageSpeed)
        ) {
          this.state.stats = next;
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

  getWorldPosition(target = new THREE.Vector3()) {
    return this.mesh.getWorldPosition(target);
  }

  getHeaderWorldPosition(target = new THREE.Vector3()) {
    target.set(0.31, PANEL_HEIGHT * 0.34, 0);
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
    this.mesh.updateWorldMatrix(true, false);
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

    if (y <= this.headerBottom && y >= 24) {
      return { type: 'panel-grip' };
    }

    return { type: 'none' };
  }

  triggerButton(id) {
    if (id === 'map-play') {
      this.callbacks.onPlayPause();
    } else if (id === 'map-speed-1') {
      this.callbacks.onSpeed(1);
    } else if (id === 'map-speed-0.5') {
      this.callbacks.onSpeed(0.5);
    } else if (id === 'map-speed-2') {
      this.callbacks.onSpeed(2);
    } else if (id === 'map-density-down') {
      this.callbacks.onDensity(-DENSITY_STEP);
    } else if (id === 'map-density-up') {
      this.callbacks.onDensity(DENSITY_STEP);
    } else if (id === 'map-lock') {
      this.callbacks.onToggleLock();
    } else if (id === 'map-reset-table') {
      this.callbacks.onResetTable();
    } else if (id === 'map-scale-down') {
      this.callbacks.onScale(0.88);
    } else if (id === 'map-scale-up') {
      this.callbacks.onScale(1.14);
    } else if (id === 'map-height-down') {
      this.callbacks.onNudgeHeight(-0.04);
    } else if (id === 'map-height-up') {
      this.callbacks.onNudgeHeight(0.04);
    } else if (id === 'map-rotate-left') {
      this.callbacks.onRotate(-Math.PI / 12);
    } else if (id === 'map-rotate-right') {
      this.callbacks.onRotate(Math.PI / 12);
    } else if (id === 'map-exit-vr') {
      this.callbacks.onExitVr();
    }
  }

  draw() {
    const { context, state } = this;
    const width = CANVAS_WIDTH;
    const height = CANVAS_HEIGHT;
    this.buttons = [];
    this.headerBottom = 132;

    context.clearRect(0, 0, width, height);

    context.save();
    roundRect(context, 24, 24, width - 48, height - 48, 30);
    context.fillStyle = COLORS.paper;
    context.fill();
    context.strokeStyle = 'rgba(45, 56, 57, 0.24)';
    context.lineWidth = 2;
    context.stroke();
    context.restore();

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
    context.fillText('ROAD SAND TABLE · REAL MAP · IMMERSIVE', 58, 61);

    context.fillStyle = COLORS.white;
    context.font = '600 36px Georgia, serif';
    context.fillText('Healdsburg Plaza', 58, 107);

    this.drawPill(530, 48, state.playing ? 'LIVE' : 'PAUSED', state.playing ? '#2e5f4a' : '#7b6549');

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

    // Left column: what this model is, plus live numbers.
    const leftX = 58;
    const leftWidth = 596;
    context.textAlign = 'left';
    context.fillStyle = COLORS.softInk;
    context.font = '750 15px system-ui, sans-serif';
    context.fillText('LIVE STREET MODEL', leftX, 176);

    context.fillStyle = COLORS.ink;
    context.font = '500 24px Georgia, serif';
    const blurb = fitText(
      context,
      'Real OpenStreetMap streets and buildings, captured once and served as a static file. No map service is contacted while you explore.',
      leftWidth,
      3,
    );
    blurb.forEach((line, index) => {
      context.fillText(line, leftX, 211 + index * 32);
    });

    const stats = [
      ['CARS', String(state.stats.cars)],
      ['MOVING', String(state.stats.moving)],
      ['AVG KM/H', (state.stats.averageSpeed * 3.6).toFixed(0)],
      ['STREET LINKS', String(state.linkCount)],
    ];
    const statWidth = 286;
    stats.forEach(([label, value], index) => {
      const x = leftX + (index % 2) * (statWidth + 24);
      const y = 330 + Math.floor(index / 2) * 98;
      context.fillStyle = COLORS.muted;
      context.font = '750 13px system-ui, sans-serif';
      context.fillText(label, x, y);
      context.fillStyle = COLORS.ink;
      context.font = '600 40px Georgia, serif';
      context.fillText(value, x, y + 42);
    });

    context.fillStyle = COLORS.softInk;
    context.font = '750 15px system-ui, sans-serif';
    context.fillText('WHAT YOU ARE SEEING', leftX, 565);
    context.fillStyle = COLORS.muted;
    context.font = '400 17px system-ui, sans-serif';
    context.fillText('Two-phase signals and approach-mapped stop signs.', leftX, 597);
    context.fillText('Cars follow the car ahead and reserve one junction at a time.', leftX, 625);
    context.fillText('Use the sticks to move the map; grip two corners to scale.', leftX, 653);

    context.fillStyle = COLORS.muted;
    context.font = '400 15px system-ui, sans-serif';
    context.fillText('© OpenStreetMap contributors · ODbL 1.0', leftX, 742);
    context.fillText(
      `${state.handTracking ? 'Hands tracked' : 'Controllers'} · table ${Math.round((state.tableWidth ?? 0) * 100)} cm wide`,
      leftX,
      771,
    );

    // Right column: playback, density and placement.
    const rightX = 710;
    context.fillStyle = COLORS.softInk;
    context.font = '750 15px system-ui, sans-serif';
    context.fillText('TRAFFIC', rightX, 176);

    this.drawButton(
      'map-play',
      rightX,
      194,
      300,
      70,
      state.playing ? '❚❚  Pause' : '▶  Play',
      { primary: true, fontSize: 20 },
    );

    const speedOptions = [
      ['map-speed-0.5', '0.5×', 0.5],
      ['map-speed-1', '1×', 1],
      ['map-speed-2', '2×', 2],
    ];
    speedOptions.forEach(([id, label, value], index) => {
      this.drawButton(id, rightX + 320 + index * 110, 194, 96, 70, label, {
        selected: state.rate === value,
        fontSize: 16,
      });
    });

    context.fillStyle = COLORS.softInk;
    context.font = '750 15px system-ui, sans-serif';
    context.fillText('TRAFFIC DENSITY', rightX, 310);

    this.drawButton('map-density-down', rightX, 328, 96, 64, '−', { fontSize: 26 });
    context.save();
    roundRect(context, rightX + 108, 328, 380, 64, 12);
    context.fillStyle = '#f6f2e6';
    context.fill();
    context.strokeStyle = 'rgba(45, 56, 57, 0.16)';
    context.lineWidth = 2;
    context.stroke();
    context.restore();
    context.fillStyle = COLORS.ink;
    context.font = '650 26px Georgia, serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(`${state.carCount} cars`, rightX + 298, 361);
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    this.drawButton('map-density-up', rightX + 500, 328, 96, 64, '+', { fontSize: 26 });

    context.fillStyle = COLORS.softInk;
    context.font = '750 15px system-ui, sans-serif';
    context.fillText('TABLE PLACEMENT', rightX, 444);

    const placementWidth = (636 - 30) / 4;
    this.drawButton('map-lock', rightX, 462, placementWidth, 58, state.locked ? 'Lock: ON' : 'Lock: OFF', {
      selected: state.locked,
      fontSize: 15,
    });
    this.drawButton('map-reset-table', rightX + (placementWidth + 10), 462, placementWidth, 58, 'Reset table', { fontSize: 15 });
    this.drawButton('map-scale-down', rightX + (placementWidth + 10) * 2, 462, placementWidth, 58, 'Scale −', { fontSize: 15 });
    this.drawButton('map-scale-up', rightX + (placementWidth + 10) * 3, 462, placementWidth, 58, 'Scale +', { fontSize: 15 });

    this.drawButton('map-height-down', rightX, 530, placementWidth, 58, 'Height −', { fontSize: 15 });
    this.drawButton('map-height-up', rightX + (placementWidth + 10), 530, placementWidth, 58, 'Height +', { fontSize: 15 });
    this.drawButton('map-rotate-left', rightX + (placementWidth + 10) * 2, 530, placementWidth, 58, 'Rotate L', { fontSize: 15 });
    this.drawButton('map-rotate-right', rightX + (placementWidth + 10) * 3, 530, placementWidth, 58, 'Rotate R', { fontSize: 15 });

    context.fillStyle = COLORS.muted;
    context.font = '400 16px system-ui, sans-serif';
    context.fillText('Grip a corner to move or twist. Two grips scale.', rightX, 624);
    context.fillText('Left stick moves · right stick height / rotate.', rightX, 651);
    context.fillText('Lean in to read the streets; the model is 1:350.', rightX, 678);

    this.drawButton('map-exit-vr', 1180, 730, 166, 58, 'Exit VR', { fontSize: 15 });

    this.texture.needsUpdate = true;
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
