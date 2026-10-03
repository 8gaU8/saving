import { test, expect } from 'vitest';
import { QR_RE, QR_CHUNK, toCompact, fromCompact, encodePayload, decodePayload, makeChunks, toB64u } from '../../src/core/qrCodec.js';
import { normalizeState } from '../../src/core/schema.js';
import { dayNum } from '../../src/core/dates.js';
import sample from '../fixtures/sample-state.json';
import chunks from '../fixtures/sample-qr-chunks.json';
import expected from '../fixtures/sample-qr-expected.json';

const payloadOf = (list) => list.map((c) => QR_RE.exec(c)[4]).join('');
const strip = (s) => ({
  goal: s.goal,
  shifts: s.shifts.map(({ date, minutes, wage, earned }) => ({ date, minutes, wage, earned })),
  adjustments: s.adjustments.map(({ date, delta }) => ({ date, delta })),
});
const byDateAt = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

test('旧版の QR（sample-qr-chunks.json）を復号すると sample-qr-expected.json になる', async () => {
  expect(chunks.every((c) => QR_RE.test(c))).toBe(true);
  const s = normalizeState(await decodePayload(payloadOf(chunks)));
  expect(strip(s)).toEqual(strip(expected));
});

test('書き出し → 分割 → 復号で id/at 以外が一致し、順序が保たれる', async () => {
  const list = makeChunks(await encodePayload(sample));
  expect(list[0]).toMatch(/^SP1\.[0-9a-z]{6}\.1\.\d+\./);
  const s = normalizeState(await decodePayload(payloadOf(list)));
  const orig = { ...sample, shifts: [...sample.shifts].sort(byDateAt), adjustments: [...sample.adjustments].sort(byDateAt) };
  expect(strip(s)).toEqual(strip(orig));
  expect(s.shifts.map((x) => x.at)).toEqual([...s.shifts.map((x) => x.at)].sort());
  expect(s.adjustments[0].at > s.shifts.at(-1).at).toBe(true);
});

test('非圧縮 (j) 形式も読める', async () => {
  const p = 'j' + toB64u(new TextEncoder().encode(JSON.stringify(toCompact(sample))));
  expect(strip(await decodePayload(p)).goal).toEqual(sample.goal);
});

test('コンパクト形式: 日付は差分、earned は導出と違うときだけ', () => {
  const s = structuredClone(sample);
  s.shifts[0].earned += 7;
  const c = toCompact(s);
  expect(c.v).toBe(1);
  expect(c.g).toEqual([50000, 300000, dayNum(2027, 3, 31), 1200, 31, 25, Date.UTC(2026, 7, 1) / 1000]);
  expect(c.s[0]).toEqual([dayNum(2026, 8, 20), 360, 1100, 6607]);
  expect(c.s[1]).toEqual([21, 300, 1100]);
  expect(fromCompact(c).shifts[0].earned).toBe(6607);
});

test('分割: 380文字ごと', () => {
  const list = makeChunks('z' + 'A'.repeat(QR_CHUNK * 2));
  expect(list).toHaveLength(3);
  expect(list.map((c) => c.split('.').slice(2, 4).join('/'))).toEqual(['1/3', '2/3', '3/3']);
  expect(new Set(list.map((c) => c.split('.')[1])).size).toBe(1);
});

test.each([
  ['xAAAA', 'QRのデータ形式が正しくありません。'],
  ['zAAAAAAAA', 'QRのデータを展開できませんでした。'],
  ['j' + toB64u(new TextEncoder().encode('not json')), 'QRのデータを読み取れませんでした。'],
  ['j' + toB64u(new TextEncoder().encode('{"v":2}')), 'QRのデータが正しくありません。'],
])('decodePayload(%s) のエラー', async (p, msg) => {
  await expect(decodePayload(p)).rejects.toThrow(new Error(msg));
});
