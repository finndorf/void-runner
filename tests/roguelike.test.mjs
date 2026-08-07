import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './extract.mjs';

test('pure block loads and exposes RLCore', () => {
  const core = loadCore();
  assert.equal(typeof core, 'object');
});
