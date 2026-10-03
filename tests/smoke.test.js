// Phase 0 の足場確認。Phase 2 で core のテストに置き換える
import { test, expect } from 'vitest';
import state from './fixtures/sample-state.json';

test('fixtures が読める', () => {
  expect(state.app).toBe('savings-pace');
  expect(state.schemaVersion).toBe(1);
});
