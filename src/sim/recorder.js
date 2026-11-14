// Exact per-frame replay storage. Frames are plain snapshots of simulation
// state, not rendered pixels, so seeking restores the same simulation inputs.

export class ReplayRecorder {
  constructor(limitFrames = 7200) {
    if (limitFrames < 2) {
      throw new Error('Replay history needs room for at least two frames.');
    }
    this.limitFrames = limitFrames;
    this.frames = [];
    this.index = -1;
  }

  reset(initialSnapshot) {
    this.frames = [structuredClone(initialSnapshot)];
    this.index = 0;
  }

  record(snapshot) {
    // If the user stepped back and then created a new frame, discard the old
    // future rather than mixing two histories.
    if (this.index < this.frames.length - 1) {
      this.frames.length = this.index + 1;
    }

    this.frames.push(structuredClone(snapshot));
    if (this.frames.length > this.limitFrames) {
      this.frames.shift();
    }
    this.index = this.frames.length - 1;
    return this.frames[this.index];
  }

  seek(index) {
    if (this.frames.length === 0) {
      return null;
    }
    this.index = Math.max(0, Math.min(this.frames.length - 1, Math.round(index)));
    return this.frames[this.index];
  }

  stepBack() {
    return this.seek(this.index - 1);
  }

  stepForward() {
    return this.seek(this.index + 1);
  }

  get currentFrame() {
    return this.index >= 0 ? this.frames[this.index] : null;
  }

  get frameCount() {
    return this.frames.length;
  }

  get hasFuture() {
    return this.index < this.frames.length - 1;
  }
}
