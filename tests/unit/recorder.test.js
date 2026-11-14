import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplayRecorder } from '../../src/sim/recorder.js';

test('replay recorder restores exact frames and branches cleanly', () => {
  const recorder = new ReplayRecorder(100);
  recorder.reset({ frame: 0, value: 'start' });
  recorder.record({ frame: 1, value: 'one' });
  recorder.record({ frame: 2, value: 'two' });

  assert.equal(recorder.frameCount, 3);
  assert.deepEqual(recorder.stepBack(), { frame: 1, value: 'one' });
  assert.equal(recorder.index, 1);

  recorder.record({ frame: 2, value: 'new two' });
  assert.equal(recorder.frameCount, 3);
  assert.deepEqual(recorder.currentFrame, { frame: 2, value: 'new two' });
  assert.equal(recorder.hasFuture, false);
});

test('replay recorder enforces its frame limit', () => {
  const recorder = new ReplayRecorder(3);
  recorder.reset({ frame: 0 });
  recorder.record({ frame: 1 });
  recorder.record({ frame: 2 });
  recorder.record({ frame: 3 });

  assert.equal(recorder.frameCount, 3);
  assert.deepEqual(recorder.frames.map((frame) => frame.frame), [1, 2, 3]);
  assert.equal(recorder.index, 2);
});
