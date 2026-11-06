import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { voiceTiers } from '../voice-models';

const models = (here: Parameters<typeof voiceTiers>[0]) =>
  voiceTiers(here).map((t) => `${t.model.includes('large') ? 'large' : 'small'} ${t.device}`);

describe('which voice model a browser reads with', () => {
  it('starts on the large model where it can run, with the rest behind it', () => {
    assert.deepEqual(models({ webgpu: true, f16: true, memoryGb: 8 }), [
      'large webgpu',
      'small webgpu',
      'small wasm',
    ]);
    assert.deepEqual(models({ webgpu: true, f16: true }), [
      'large webgpu',
      'small webgpu',
      'small wasm',
    ]);
  });

  it('leaves it out without 16-bit floats or the memory for it', () => {
    assert.deepEqual(models({ webgpu: true, f16: false, memoryGb: 8 }), [
      'small webgpu',
      'small wasm',
    ]);
    assert.deepEqual(models({ webgpu: true, f16: true, memoryGb: 4 }), [
      'small webgpu',
      'small wasm',
    ]);
  });

  it('falls back to WebAssembly without WebGPU', () => {
    assert.deepEqual(models({ webgpu: false, f16: false }), ['small wasm']);
  });

  it('asks the large model for English, as the voice tags are', () => {
    const [large] = voiceTiers({ webgpu: true, f16: true });
    assert.equal(large.options?.language, 'english');
    assert.equal(large.dtype.encoder_model, 'q4f16');
  });
});
