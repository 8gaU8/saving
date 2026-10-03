// fixtures/sample-rendered.golden.json との一致（時計 2026-10-03 12:00 固定）
import { test, expect } from 'vitest';
import { boot, txt } from '../helpers/boot.js';
import state from '../fixtures/sample-state.json';
import noPayCycle from '../fixtures/sample-state.no-paycycle.json';
import golden from '../fixtures/sample-rendered.golden.json';

const { clock, ...fields } = golden;

test('sample-state.json の画面テキストが golden と一致', async () => {
  const w = await boot(state);
  for (const [id, expected] of Object.entries(fields)) expect(txt(w, '#' + id), id).toBe(expected);
});

test('sample-state.no-paycycle.json は締め31・支払25として同じ画面になる', async () => {
  const w = await boot(noPayCycle);
  for (const [id, expected] of Object.entries(fields)) expect(txt(w, '#' + id), id).toBe(expected);
});
