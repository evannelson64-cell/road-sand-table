// Owns the table's room-scale transform. Desktop keeps the original world
// transform; VR scales the miniature table to about 1.06 m wide and positions
// its top at desk height in front of the user.

export const VR_TABLE_SCALE = 0.28;
export const VR_TABLE_HEIGHT = 0.85;
export const VR_FORWARD_DISTANCE = 1.02;
export const MIN_TABLE_SCALE = 0.16;
export const MAX_TABLE_SCALE = 0.48;
export const MIN_TABLE_HEIGHT = 0.32;
export const MAX_TABLE_HEIGHT = 1.45;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export class TablePlacement {
  constructor(tableRoot) {
    this.root = tableRoot;
    this.locked = false;
    this.lastViewer = null;
    this.home = null;
    // Desktop keeps the original scale until the first immersive placement.
    this.root.scale.setScalar(1);
  }

  setViewerPose(viewerPose) {
    if (viewerPose) {
      this.lastViewer = viewerPose;
    }
  }

  /** Place the table about 1.0 m in front of the viewer, at a comfortable height. */
  placeInFront(viewerPose = this.lastViewer) {
    if (!viewerPose) {
      return null;
    }

    this.lastViewer = viewerPose;
    const forward = viewerPose.forward;
    const horizontalLength = Math.hypot(forward.x, forward.z);
    const safeForward = horizontalLength > 0.001
      ? { x: forward.x / horizontalLength, z: forward.z / horizontalLength }
      : { x: 0, z: -1 };
    const yaw = Math.atan2(safeForward.x, safeForward.z);

    this.root.scale.setScalar(VR_TABLE_SCALE);
    this.root.position.set(
      viewerPose.position.x + safeForward.x * VR_FORWARD_DISTANCE,
      VR_TABLE_HEIGHT,
      viewerPose.position.z + safeForward.z * VR_FORWARD_DISTANCE,
    );
    this.root.rotation.set(0, yaw, 0);
    this.locked = false;

    this.home = {
      position: this.root.position.clone(),
      yaw,
      scale: VR_TABLE_SCALE,
    };

    return this.getState();
  }

  exitDesktop() {
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.root.scale.setScalar(1);
    this.locked = false;
    this.home = null;
  }

  setLocked(locked) {
    this.locked = Boolean(locked);
  }

  toggleLocked() {
    this.locked = !this.locked;
    return this.locked;
  }

  canMove() {
    return !this.locked;
  }

  setScale(scale) {
    this.root.scale.setScalar(clamp(scale, MIN_TABLE_SCALE, MAX_TABLE_SCALE));
  }

  scaleBy(factor) {
    if (!this.canMove()) {
      return;
    }
    this.setScale(this.root.scale.x * factor);
  }

  setHeight(height) {
    this.root.position.y = clamp(height, MIN_TABLE_HEIGHT, MAX_TABLE_HEIGHT);
  }

  nudgeHeight(delta) {
    if (!this.canMove()) {
      return;
    }
    this.setHeight(this.root.position.y + delta);
  }

  rotateBy(delta) {
    if (!this.canMove()) {
      return;
    }
    this.root.rotation.y = normalizeAngle(this.root.rotation.y + delta);
  }

  /** Move horizontally in the viewer's current forward/right basis. */
  moveRelativeToViewer(strafe, forwardAmount, viewerPose = this.lastViewer) {
    if (!this.canMove() || !viewerPose) {
      return;
    }

    const forward = viewerPose.forward;
    const length = Math.hypot(forward.x, forward.z);
    if (length < 0.001) {
      return;
    }

    const fx = forward.x / length;
    const fz = forward.z / length;
    const rx = -fz;
    const rz = fx;

    this.root.position.x += rx * strafe + fx * forwardAmount;
    this.root.position.z += rz * strafe + fz * forwardAmount;
  }

  applyThumbsticks(left, right, deltaSeconds, viewerPose) {
    if (!this.canMove()) {
      return;
    }

    this.lastViewer = viewerPose ?? this.lastViewer;
    const moveSpeed = 0.75; // metres per second at full stick deflection

    if (left) {
      this.moveRelativeToViewer(
        left.x * moveSpeed * deltaSeconds,
        -left.y * moveSpeed * deltaSeconds,
        this.lastViewer,
      );
    }

    if (right) {
      this.nudgeHeight(-right.y * 0.45 * deltaSeconds);
      this.rotateBy(-right.x * 1.6 * deltaSeconds);
    }
  }

  getState() {
    return {
      position: {
        x: this.root.position.x,
        y: this.root.position.y,
        z: this.root.position.z,
      },
      yaw: this.root.rotation.y,
      scale: this.root.scale.x,
      locked: this.locked,
      home: this.home
        ? {
            position: {
              x: this.home.position.x,
              y: this.home.position.y,
              z: this.home.position.z,
            },
            yaw: this.home.yaw,
            scale: this.home.scale,
          }
        : null,
    };
  }
}
