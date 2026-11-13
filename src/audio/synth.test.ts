import { describe, expect, it } from 'vitest';
import { synthesize } from './synth';
import { SOUND_NAMES } from './sounds';

const RATE = 44100;
const peakOf = (data: Float32Array): number =>
  data.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('synthesize', () => {
  it.each(SOUND_NAMES)('%s：有聲音、沒有爆音、數值皆有限', (name) => {
    const data = synthesize(name, RATE);
    expect(data.length).toBeGreaterThan(0);
    expect(data.every(Number.isFinite)).toBe(true);
    const peak = peakOf(data);
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThanOrEqual(0.8);
  });

  it.each(SOUND_NAMES)('%s：結尾淡出到接近 0，不會在結尾爆音', (name) => {
    const data = synthesize(name, RATE);
    expect(Math.abs(data[data.length - 1]!)).toBeLessThan(1e-3);
  });

  it.each(SOUND_NAMES)('%s：結果是決定性的', (name) => {
    expect(synthesize(name, RATE)).toEqual(synthesize(name, RATE));
  });

  it('長度符合設計：拾起短、放錯中等、鑲嵌最長', () => {
    const seconds = (name: (typeof SOUND_NAMES)[number]): number =>
      synthesize(name, RATE).length / RATE;
    expect(seconds('pickup')).toBeCloseTo(0.12, 2);
    expect(seconds('wrong')).toBeCloseTo(0.25, 2);
    expect(seconds('set')).toBeCloseTo(0.7, 2);
  });

  it('取樣率不同時，時間長度相同、樣本數成比例', () => {
    const a = synthesize('set', 22050).length / 22050;
    const b = synthesize('set', 48000).length / 48000;
    expect(a).toBeCloseTo(b, 3);
  });

  it('放錯是低頻、鑲嵌是高頻：用過零率粗略比較', () => {
    const crossings = (d: Float32Array): number => {
      let n = 0;
      for (let i = 1; i < d.length; i++) {
        if (d[i - 1]! < 0 !== d[i]! < 0) n++;
      }
      return n / (d.length / RATE); // 每秒過零次數
    };
    expect(crossings(synthesize('wrong', RATE))).toBeLessThan(
      crossings(synthesize('set', RATE)) / 5,
    );
  });
});
