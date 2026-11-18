// WebXR input for controllers and hand tracking.
//
// Controllers: trigger points/selects, squeeze grabs the table or panel.
// Hands: pinch is the single action. Whether it selects a button, scrubs,
// moves the panel or grabs the table is decided by what the pinch ray hits.
import * as THREE from 'three';

const HANDLE_HIT_RADIUS = 0.13;
const CONTROLLER_RAY_LENGTH = 1.1;
const HAND_JOINT_COUNT = 25;
const DEADZONE = 0.16;

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function applyDeadzone(value) {
  if (Math.abs(value) < DEADZONE) {
    return 0;
  }
  return Math.sign(value) * ((Math.abs(value) - DEADZONE) / (1 - DEADZONE));
}

function makeRayFromObject(object) {
  const origin = object.getWorldPosition(new THREE.Vector3());
  const quaternion = object.getWorldQuaternion(new THREE.Quaternion());
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).normalize();
  return new THREE.Ray(origin, direction);
}

function pointerYaw(quaternion) {
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
  return Math.atan2(-right.z, right.x);
}

function distanceSqToHandle(ray, center) {
  const distanceSq = ray.distanceSqToPoint(center);
  const along = center.clone().sub(ray.origin).dot(ray.direction);
  return along > 0 ? distanceSq : Infinity;
}

export class XrInput {
  constructor({ renderer, scene, world, placement, panel, callbacks }) {
    this.renderer = renderer;
    this.scene = scene;
    this.world = world;
    this.placement = placement;
    this.panel = panel;
    this.callbacks = callbacks;
    this.active = false;
    this.raycaster = new THREE.Raycaster();
    this.pointers = [];
    this.tableGrabs = new Map();
    this.panelDrag = null;
    this.twoHand = null;
    this.highlightedHandleId = null;
    this.lastHandTracking = false;
    this.scene.updateMatrixWorld(true);

    this.rayMaterial = new THREE.LineBasicMaterial({
      color: '#f4e4c1',
      transparent: true,
      opacity: 0.48,
      depthTest: false,
    });
    this.activeRayMaterial = new THREE.LineBasicMaterial({
      color: '#7fb1ff',
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    this.tableRayMaterial = new THREE.LineBasicMaterial({
      color: '#ffb066',
      transparent: true,
      opacity: 0.92,
      depthTest: false,
    });
    const cursorGeometry = new THREE.SphereGeometry(0.008, 8, 6);
    this.controllerCursorMaterial = new THREE.MeshBasicMaterial({
      color: '#f4e4c1',
      depthTest: false,
    });
    this.activeCursorMaterial = new THREE.MeshBasicMaterial({
      color: '#7fb1ff',
      depthTest: false,
    });

    for (let index = 0; index < 2; index += 1) {
      this.createPointer(index, cursorGeometry);
    }

    this.jointGeometry = new THREE.SphereGeometry(0.0085, 6, 4);
    this.jointMaterial = new THREE.MeshBasicMaterial({
      color: '#f2d8b4',
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    this.handCursorMaterial = new THREE.MeshBasicMaterial({
      color: '#ffb777',
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });

    for (const pointer of this.pointers) {
      pointer.jointMesh = new THREE.InstancedMesh(
        this.jointGeometry,
        this.jointMaterial,
        HAND_JOINT_COUNT,
      );
      pointer.jointMesh.frustumCulled = false;
      pointer.jointMesh.visible = false;
      this.scene.add(pointer.jointMesh);

      pointer.handCursor = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 8, 6),
        this.handCursorMaterial,
      );
      pointer.handCursor.visible = false;
      pointer.handCursor.renderOrder = 7;
      this.scene.add(pointer.handCursor);

      const handLineGeometry = new THREE.BufferGeometry();
      handLineGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
      );
      pointer.handLine = new THREE.Line(
        handLineGeometry,
        new THREE.LineBasicMaterial({
          color: '#ffc28a',
          transparent: true,
          opacity: 0.5,
          depthTest: false,
        }),
      );
      pointer.handLine.visible = false;
      pointer.handLine.frustumCulled = false;
      this.scene.add(pointer.handLine);
    }
  }

  /** Re-parent the shared XR controller groups into this input's scene. */
  attachToScene() {
    for (const pointer of this.pointers) {
      this.scene.add(pointer.rayGroup, pointer.gripGroup, pointer.handGroup);
    }
    this.scene.updateMatrixWorld(true);
  }

  /**
   * Point this input at a replacement map scene without rebuilding the
   * controller listeners. Used when the user loads a different OSM file.
   */
  rebind({ scene, world, placement, panel }) {
    this.setActive(false);
    this.scene = scene;
    this.world = world;
    this.placement = placement;
    this.panel = panel;
    for (const pointer of this.pointers) {
      scene.add(
        pointer.rayGroup,
        pointer.gripGroup,
        pointer.handGroup,
        pointer.jointMesh,
        pointer.handCursor,
        pointer.handLine,
      );
    }
    scene.updateMatrixWorld(true);
  }

  get tableBounds() {
    return this.world.tableBounds ?? {
      halfWidth: 1.84,
      halfDepth: 1.44,
      surfaceTolerance: 0.24,
    };
  }

  createPointer(index, cursorGeometry) {
    const rayGroup = this.renderer.xr.getController(index);
    const gripGroup = this.renderer.xr.getControllerGrip(index);
    const handGroup = this.renderer.xr.getHand(index);
    this.scene.add(rayGroup, gripGroup, handGroup);

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -CONTROLLER_RAY_LENGTH], 3),
    );
    const line = new THREE.Line(lineGeometry, this.rayMaterial);
    line.frustumCulled = false;
    line.renderOrder = 7;
    rayGroup.add(line);

    const cursor = new THREE.Mesh(cursorGeometry, this.controllerCursorMaterial);
    cursor.position.z = -CONTROLLER_RAY_LENGTH;
    cursor.renderOrder = 8;
    rayGroup.add(cursor);

    const pointer = {
      index,
      rayGroup,
      gripGroup,
      handGroup,
      line,
      cursor,
      isHand: false,
      kind: 'none',
      handedness: null,
      source: null,
      mode: null,
      hover: null,
      ray: new THREE.Ray(),
      grabPosition: new THREE.Vector3(),
      rotationYaw: 0,
      pinchPoint: new THREE.Vector3(),
      indexTip: new THREE.Vector3(),
      connected: false,
    };
    this.pointers.push(pointer);

    rayGroup.addEventListener('connected', (event) => {
      pointer.source = event.data;
      pointer.isHand = Boolean(event.data?.hand);
      pointer.kind = pointer.isHand ? 'hand' : 'controller';
      pointer.handedness = event.data?.handedness ?? null;
    });

    rayGroup.addEventListener('disconnected', () => {
      pointer.source = null;
      pointer.isHand = false;
      pointer.kind = 'none';
      pointer.handedness = null;
      pointer.connected = false;
      this.releasePointer(pointer);
      pointer.line.visible = false;
      pointer.cursor.visible = false;
    });

    rayGroup.addEventListener('selectstart', () => {
      if (!pointer.isHand && this.active) {
        this.startSelect(pointer);
      }
    });
    rayGroup.addEventListener('selectend', () => {
      if (!pointer.isHand) {
        this.endPointerAction(pointer);
      }
    });
    rayGroup.addEventListener('squeezestart', () => {
      if (!pointer.isHand && this.active) {
        this.startGrip(pointer);
      }
    });
    rayGroup.addEventListener('squeezeend', () => {
      if (!pointer.isHand) {
        this.endPointerAction(pointer);
      }
    });

    handGroup.addEventListener('pinchstart', () => {
      if (this.active) {
        this.startPinch(pointer);
      }
    });
    handGroup.addEventListener('pinchend', () => {
      this.endPointerAction(pointer);
    });
  }

  setActive(active) {
    this.active = active;
    if (!active) {
      this.cancelAll();
      for (const pointer of this.pointers) {
        pointer.line.visible = false;
        pointer.cursor.visible = false;
        pointer.handCursor.visible = false;
        pointer.handLine.visible = false;
        pointer.jointMesh.visible = false;
      }
      this.panel.setHover(null);
    }
  }

  cancelAll() {
    this.tableGrabs.clear();
    this.twoHand = null;
    this.panelDrag = null;
    for (const pointer of this.pointers) {
      pointer.mode = null;
      pointer.hover = null;
    }
    this.setHandleHighlight(null);
  }

  update(deltaSeconds, viewerPose) {
    if (!this.active) {
      return;
    }

    this.scene.updateMatrixWorld(true);
    let handTracking = false;

    for (const pointer of this.pointers) {
      pointer.connected = pointer.rayGroup.visible;
      if (!pointer.connected) {
        pointer.line.visible = false;
        pointer.cursor.visible = false;
        pointer.handCursor.visible = false;
        pointer.handLine.visible = false;
        pointer.jointMesh.visible = false;
        this.releasePointer(pointer);
        continue;
      }

      this.updatePointerPose(pointer);
      handTracking = handTracking || pointer.isHand;

      if (pointer.isHand) {
        this.updateHandVisual(pointer);
      } else {
        pointer.line.visible = true;
        pointer.cursor.visible = true;
        pointer.jointMesh.visible = false;
        pointer.handCursor.visible = false;
        pointer.handLine.visible = false;
      }

      if (pointer.mode === 'timeline') {
        this.updateTimelineDrag(pointer);
      } else if (pointer.mode === null) {
        pointer.hover = this.pickTarget(pointer);
        this.applyHover(pointer);
      }
    }

    if (this.tableGrabs.size > 0) {
      this.updateTableGrabs();
    }
    if (this.panelDrag) {
      this.updatePanelDrag();
    }

    this.updateThumbsticks(deltaSeconds, viewerPose);

    if (handTracking !== this.lastHandTracking) {
      this.lastHandTracking = handTracking;
      this.callbacks.onHandTracking?.(handTracking);
    }
  }

  updatePointerPose(pointer) {
    pointer.ray.copy(makeRayFromObject(pointer.rayGroup));

    if (pointer.isHand) {
      const hand = pointer.handGroup;
      const indexJoint = hand.joints?.['index-finger-tip'];
      const thumbJoint = hand.joints?.['thumb-tip'];
      if (indexJoint && thumbJoint) {
        indexJoint.getWorldPosition(pointer.indexTip);
        const thumb = thumbJoint.getWorldPosition(new THREE.Vector3());
        pointer.pinchPoint.copy(pointer.indexTip).add(thumb).multiplyScalar(0.5);
        pointer.grabPosition.copy(pointer.pinchPoint);
      } else {
        pointer.grabPosition.copy(pointer.ray.origin);
      }
      const quaternion = pointer.rayGroup.getWorldQuaternion(new THREE.Quaternion());
      pointer.rotationYaw = pointerYaw(quaternion);
    } else {
      pointer.gripGroup.getWorldPosition(pointer.grabPosition);
      const gripQuaternion = pointer.gripGroup.getWorldQuaternion(new THREE.Quaternion());
      pointer.rotationYaw = pointerYaw(gripQuaternion);
    }
  }

  updateHandVisual(pointer) {
    const hand = pointer.handGroup;
    const isVisible = hand.visible;
    pointer.jointMesh.visible = isVisible;
    pointer.handLine.visible = isVisible;
    pointer.line.visible = false;
    pointer.cursor.visible = false;

    if (!isVisible) {
      pointer.handCursor.visible = false;
      return;
    }

    const joints = Object.values(hand.joints ?? {});
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < HAND_JOINT_COUNT; index += 1) {
      const joint = joints[index];
      if (joint) {
        matrix.copy(joint.matrixWorld);
        pointer.jointMesh.setMatrixAt(index, matrix);
      } else {
        matrix.makeScale(0, 0, 0);
        pointer.jointMesh.setMatrixAt(index, matrix);
      }
    }
    pointer.jointMesh.instanceMatrix.needsUpdate = true;

    pointer.handCursor.position.copy(pointer.indexTip);
    pointer.handCursor.visible = true;

    const color = pointer.hover ? '#ffd4a8' : '#ffc28a';
    pointer.handLine.material.color.set(color);
    pointer.handLine.geometry.attributes.position.setXYZ(
      0,
      pointer.indexTip.x,
      pointer.indexTip.y,
      pointer.indexTip.z,
    );
    const reach = 0.38;
    pointer.handLine.geometry.attributes.position.setXYZ(
      1,
      pointer.indexTip.x + pointer.ray.direction.x * reach,
      pointer.indexTip.y + pointer.ray.direction.y * reach,
      pointer.indexTip.z + pointer.ray.direction.z * reach,
    );
    pointer.handLine.geometry.attributes.position.needsUpdate = true;
  }

  pickTarget(pointer) {
    const candidates = [];
    const panelTarget = this.pickPanel(pointer);
    if (panelTarget) {
      candidates.push(panelTarget);
    }

    if (!this.placement.locked) {
      const tableTarget = this.pickTable(pointer);
      if (tableTarget) {
        candidates.push(tableTarget);
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => a.distance - b.distance);

    // A hand touching the panel's edge should not be stolen by a table plane
    // several centimetres behind it.
    if (pointer.isHand) {
      const panel = candidates.find((entry) => entry.type === 'panel-grip' || entry.type === 'panel');
      if (panel && panel.distance < 0.9) {
        return panel;
      }
    }

    return candidates[0];
  }

  pickPanel(pointer) {
    if (!this.panel.root.visible) {
      return null;
    }

    this.panel.root.updateMatrixWorld(true);
    this.raycaster.set(pointer.ray.origin, pointer.ray.direction);
    this.raycaster.far = 5;
    const hits = this.raycaster.intersectObject(this.panel.mesh, false);
    if (hits.length === 0) {
      return null;
    }

    const hit = hits[0];
    if (!hit.uv) {
      return null;
    }

    const region = this.panel.hitTestUV(hit.uv.x, hit.uv.y);
    if (region.type === 'button') {
      return { type: 'button', id: region.id, distance: hit.distance };
    }
    if (region.type === 'timeline') {
      return {
        type: 'timeline',
        fraction: region.fraction,
        distance: hit.distance,
      };
    }
    if (region.type === 'panel-grip') {
      return { type: 'panel-grip', distance: hit.distance };
    }
    return { type: 'panel', distance: hit.distance };
  }

  pickTable(pointer) {
    let best = null;

    for (const handle of this.world.cornerHandles) {
      handle.object.updateMatrixWorld(true);
      const center = handle.object.localToWorld(handle.centerLocal.clone());
      const distanceSq = distanceSqToHandle(pointer.ray, center);
      if (distanceSq <= HANDLE_HIT_RADIUS * HANDLE_HIT_RADIUS) {
        const along = center.clone().sub(pointer.ray.origin).dot(pointer.ray.direction);
        if (!best || along < best.distance) {
          best = {
            type: 'handle',
            id: handle.id,
            handle,
            distance: along,
          };
        }
      }
    }

    const planeY = this.world.tableRoot.position.y;
    const bounds = this.tableBounds;
    if (Math.abs(pointer.ray.direction.y) > 0.0001) {
      const along = (planeY - pointer.ray.origin.y) / pointer.ray.direction.y;
      if (along > 0) {
        const point = pointer.ray.origin.clone().addScaledVector(pointer.ray.direction, along);
        const local = this.world.tableRoot.worldToLocal(point.clone());
        if (
          Math.abs(local.x) <= bounds.halfWidth &&
          Math.abs(local.z) <= bounds.halfDepth &&
          local.y > -bounds.surfaceTolerance &&
          local.y < bounds.surfaceTolerance
        ) {
          if (!best || along < best.distance) {
            best = {
              type: 'table',
              distance: along,
              point,
            };
          }
        }
      }
    }

    if (pointer.isHand) {
      const local = this.world.tableRoot.worldToLocal(pointer.pinchPoint.clone());
      const nearSurface = local.y > -bounds.surfaceTolerance && local.y < bounds.surfaceTolerance;
      if (
        nearSurface &&
        Math.abs(local.x) <= bounds.halfWidth &&
        Math.abs(local.z) <= bounds.halfDepth
      ) {
        const directDistance = pointer.pinchPoint.distanceTo(pointer.ray.origin);
        if (!best || directDistance < best.distance) {
          best = {
            type: 'table',
            distance: directDistance,
            point: pointer.pinchPoint.clone(),
          };
        }
      }
    }

    return best;
  }

  applyHover(pointer) {
    const target = pointer.hover;
    const buttonId = target?.type === 'button' ? target.id : null;
    this.panel.setHover(buttonId);

    if (target?.type === 'handle') {
      this.setHandleHighlight(target.id);
      pointer.line.material = this.tableRayMaterial;
      pointer.cursor.material = this.activeCursorMaterial;
    } else if (target?.type === 'table') {
      this.setHandleHighlight('all-soft');
      pointer.line.material = this.tableRayMaterial;
      pointer.cursor.material = this.activeCursorMaterial;
    } else if (target) {
      this.setHandleHighlight(null);
      pointer.line.material = this.activeRayMaterial;
      pointer.cursor.material = this.activeCursorMaterial;
    } else {
      this.setHandleHighlight(null);
      pointer.line.material = this.rayMaterial;
      pointer.cursor.material = this.controllerCursorMaterial;
    }
  }

  setHandleHighlight(id) {
    if (this.highlightedHandleId === id) {
      return;
    }
    this.highlightedHandleId = id;

    for (const handle of this.world.cornerHandles) {
      const active = id === handle.id || id === 'all' || id === 'all-soft';
      if (!active) {
        handle.material.emissive.set('#000000');
        continue;
      }
      const strong = id === handle.id || id === 'all';
      handle.material.emissive.set('#e7772f');
      handle.material.emissiveIntensity = strong ? 0.65 : 0.24;
    }
  }

  startSelect(pointer) {
    if (pointer.mode !== null) {
      return;
    }
    const target = this.pickTarget(pointer);
    if (!target) {
      return;
    }

    if (target.type === 'button') {
      pointer.mode = 'button';
      pointer.hover = target;
      this.panel.triggerButton(target.id);
    } else if (target.type === 'timeline') {
      pointer.mode = 'timeline';
      pointer.hover = target;
      this.callbacks.onSeekFraction(target.fraction);
    }
  }

  startPinch(pointer) {
    if (pointer.mode !== null) {
      return;
    }
    this.updatePointerPose(pointer);
    const target = this.pickTarget(pointer);

    if (target?.type === 'button') {
      pointer.mode = 'button';
      pointer.hover = target;
      this.panel.triggerButton(target.id);
      return;
    }

    if (target?.type === 'timeline') {
      pointer.mode = 'timeline';
      pointer.hover = target;
      this.callbacks.onSeekFraction(target.fraction);
      return;
    }

    if (target?.type === 'panel-grip' || target?.type === 'panel') {
      this.startPanelDrag(pointer);
      return;
    }

    if (target?.type === 'handle' || target?.type === 'table') {
      this.startTableGrab(pointer);
    }
  }

  startGrip(pointer) {
    if (pointer.mode !== null) {
      return;
    }
    const target = this.pickTarget(pointer);

    if (target && (target.type === 'panel' || target.type === 'panel-grip' ||
        target.type === 'button' || target.type === 'timeline')) {
      this.startPanelDrag(pointer);
      return;
    }

    if (target && (target.type === 'handle' || target.type === 'table')) {
      this.startTableGrab(pointer);
    }
  }

  startTableGrab(pointer) {
    if (this.placement.locked || pointer.mode !== null) {
      return;
    }

    pointer.mode = 'table';
    pointer.hover = null;
    this.tableGrabs.set(pointer.index, {
      pointer,
      startPointer: pointer.grabPosition.clone(),
      startYaw: this.world.tableRoot.rotation.y,
      startPosition: this.world.tableRoot.position.clone(),
      startScale: this.world.tableRoot.scale.x,
      startPointerYaw: pointer.rotationYaw,
    });

    if (this.tableGrabs.size === 2) {
      this.beginTwoHandTransform();
    }
    this.setHandleHighlight('all');
    this.panel.setHover(null);
  }

  beginTwoHandTransform() {
    const grabs = [...this.tableGrabs.values()];
    if (grabs.length !== 2) {
      return;
    }

    const [a, b] = grabs.map((grab) => grab.pointer.grabPosition);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    this.twoHand = {
      startDistance: Math.max(0.05, Math.hypot(dx, dz)),
      startAngle: Math.atan2(dx, dz),
      startMidpoint: new THREE.Vector3(
        (a.x + b.x) / 2,
        (a.y + b.y) / 2,
        (a.z + b.z) / 2,
      ),
      startPosition: this.world.tableRoot.position.clone(),
      startYaw: this.world.tableRoot.rotation.y,
      startScale: this.world.tableRoot.scale.x,
    };
  }

  updateTableGrabs() {
    if (this.placement.locked) {
      this.cancelAll();
      return;
    }

    const grabs = [...this.tableGrabs.values()];

    if (grabs.length === 1) {
      this.twoHand = null;
      const grab = grabs[0];
      const pointer = grab.pointer;
      const delta = pointer.grabPosition.clone().sub(grab.startPointer);

      this.world.tableRoot.position.copy(grab.startPosition).add(delta);
      this.world.tableRoot.position.y = clamp(
        this.world.tableRoot.position.y,
        this.placement.minHeight,
        this.placement.maxHeight,
      );
      this.world.tableRoot.rotation.y = normalizeAngle(
        grab.startYaw + normalizeAngle(pointer.rotationYaw - grab.startPointerYaw),
      );
      return;
    }

    if (grabs.length >= 2) {
      if (!this.twoHand) {
        this.beginTwoHandTransform();
      }
      const a = grabs[0].pointer.grabPosition;
      const b = grabs[1].pointer.grabPosition;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const distance = Math.max(0.05, Math.hypot(dx, dz));
      const angle = Math.atan2(dx, dz);
      const midpoint = new THREE.Vector3(
        (a.x + b.x) / 2,
        (a.y + b.y) / 2,
        (a.z + b.z) / 2,
      );

      const scale = clamp(
        this.twoHand.startScale * (distance / this.twoHand.startDistance),
        this.placement.minScale,
        this.placement.maxScale,
      );
      this.world.tableRoot.scale.setScalar(scale);
      this.world.tableRoot.rotation.y = normalizeAngle(
        this.twoHand.startYaw + normalizeAngle(angle - this.twoHand.startAngle),
      );
      this.world.tableRoot.position
        .copy(this.twoHand.startPosition)
        .add(midpoint.clone().sub(this.twoHand.startMidpoint));
      this.world.tableRoot.position.y = clamp(
        this.world.tableRoot.position.y,
        this.placement.minHeight,
        this.placement.maxHeight,
      );
    }
  }

  startPanelDrag(pointer) {
    if (pointer.mode !== null) {
      return;
    }
    pointer.mode = 'panel';
    pointer.hover = null;
    this.panel.setHover(null);
    this.panelDrag = {
      pointer,
      startPointer: pointer.grabPosition.clone(),
      startPosition: this.panel.root.position.clone(),
    };
  }

  updatePanelDrag() {
    const drag = this.panelDrag;
    if (!drag || drag.pointer.mode !== 'panel') {
      this.panelDrag = null;
      return;
    }
    const delta = drag.pointer.grabPosition.clone().sub(drag.startPointer);
    this.panel.root.position.copy(drag.startPosition).add(delta);
  }

  updateTimelineDrag(pointer) {
    const target = this.pickPanel(pointer);
    if (target?.type === 'timeline') {
      this.callbacks.onSeekFraction(target.fraction);
    }
  }

  endPointerAction(pointer) {
    if (pointer.mode === 'table') {
      this.tableGrabs.delete(pointer.index);
      this.twoHand = null;

      if (this.tableGrabs.size === 1) {
        const remaining = [...this.tableGrabs.values()][0];
        remaining.startPointer = remaining.pointer.grabPosition.clone();
        remaining.startYaw = this.world.tableRoot.rotation.y;
        remaining.startPosition = this.world.tableRoot.position.clone();
        remaining.startScale = this.world.tableRoot.scale.x;
        remaining.startPointerYaw = remaining.pointer.rotationYaw;
      } else if (this.tableGrabs.size === 0) {
        this.setHandleHighlight(null);
      }
    }

    if (pointer.mode === 'panel') {
      this.panelDrag = null;
    }

    pointer.mode = null;
    pointer.hover = null;
  }

  releasePointer(pointer) {
    if (pointer.mode === 'table') {
      this.tableGrabs.delete(pointer.index);
      this.twoHand = null;
    }
    if (pointer.mode === 'panel') {
      this.panelDrag = null;
    }
    pointer.mode = null;
    pointer.hover = null;
  }

  updateThumbsticks(deltaSeconds, viewerPose) {
    const session = this.renderer.xr.getSession();
    if (!session || this.tableGrabs.size > 0 || this.panelDrag) {
      return;
    }

    const vectors = { left: null, right: null };
    for (const source of session.inputSources) {
      if (!source.gamepad || source.hand) {
        continue;
      }
      const axes = source.gamepad.axes;
      if (axes.length < 2) {
        continue;
      }
      const useStandardStick = axes.length >= 4;
      const x = applyDeadzone(useStandardStick ? axes[2] : axes[0]);
      const y = applyDeadzone(useStandardStick ? axes[3] : axes[1]);
      if (x === 0 && y === 0) {
        continue;
      }
      const hand = source.handedness === 'left' || source.handedness === 'right'
        ? source.handedness
        : null;
      if (hand) {
        vectors[hand] = { x, y };
      }
    }

    if (viewerPose) {
      this.placement.setViewerPose(viewerPose);
    }
    this.placement.applyThumbsticks(vectors.left, vectors.right, deltaSeconds, viewerPose);
  }

  getDebugState() {
    return {
      pointers: this.pointers.map((pointer) => ({
        index: pointer.index,
        kind: pointer.kind,
        handedness: pointer.handedness,
        connected: pointer.connected,
        mode: pointer.mode,
        hover: pointer.hover
          ? { type: pointer.hover.type, id: pointer.hover.id ?? null }
          : null,
      })),
      tableGrabs: this.tableGrabs.size,
      panelDrag: Boolean(this.panelDrag),
    };
  }
}
