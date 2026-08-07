import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './extract.mjs';

test('pure block loads and exposes RLCore', () => {
  const core = loadCore();
  assert.equal(typeof core, 'object');
});

const DEFAULTS = () => ({
  version: 2, hiScore: 0, bestLevel: 1, totalRuns: 0, totalKills: 0,
  credits: 0, unlocked: ['vanguard'], selectedShip: 'vanguard', muted: false,
  bestScrapSpent: 0, apexFound: 0
});

test('a v1 save keeps its credits, ships and records', () => {
  const core = loadCore();
  const v1 = {
    version: 1, hiScore: 12400, bestLevel: 7, totalRuns: 31, totalKills: 900,
    credits: 4250, unlocked: ['vanguard', 'needle'], selectedShip: 'needle', muted: true
  };
  const { data, ok } = core.migrateSave(v1, DEFAULTS());
  assert.equal(ok, true);
  assert.equal(data.version, 2);
  assert.equal(data.credits, 4250);
  assert.equal(data.hiScore, 12400);
  assert.deepEqual(data.unlocked, ['vanguard', 'needle']);
  assert.equal(data.selectedShip, 'needle');
  assert.equal(data.muted, true);
  assert.equal(data.bestScrapSpent, 0);
  assert.equal(data.apexFound, 0);
});

test('a v2 save loads unchanged', () => {
  const core = loadCore();
  const v2 = { ...DEFAULTS(), credits: 99, apexFound: 3 };
  const { data, ok } = core.migrateSave(v2, DEFAULTS());
  assert.equal(ok, true);
  assert.equal(data.credits, 99);
  assert.equal(data.apexFound, 3);
});

test('an unknown version falls back to defaults', () => {
  const core = loadCore();
  const { data, ok } = core.migrateSave({ version: 99, credits: 500 }, DEFAULTS());
  assert.equal(ok, false);
  assert.equal(data.credits, 0);
});

test('a corrupt unlocked list is repaired without losing credits', () => {
  const core = loadCore();
  const { data } = core.migrateSave(
    { version: 1, credits: 800, unlocked: 'nonsense', selectedShip: 'ghost' },
    DEFAULTS()
  );
  assert.equal(data.credits, 800);
  assert.deepEqual(data.unlocked, ['vanguard']);
  assert.equal(data.selectedShip, 'vanguard');
});
