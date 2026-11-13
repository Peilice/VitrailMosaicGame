import { describe, expect, it } from 'vitest';
import {
  clamp01,
  easeInOutCubic,
  easeOutCubic,
  lerp,
  smoothTowards,
} from './ease';

describe('ease', () => {
  it('clamp01 與 lerp', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(9)).toBe(1);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });

  it.each([easeOutCubic, easeInOutCubic])(
    '端點為 0 與 1、超出範圍會被夾住、單調遞增',
    (f) => {
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
      expect(f(-3)).toBe(0);
      expect(f(7)).toBe(1);
      let prev = -1;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const v = f(t);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    },
  );

  it('easeOutCubic 前半段就走完大半', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.8);
  });

  it('easeInOutCubic 在中點恰為 0.5', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
  });
});

describe('smoothTowards', () => {
  it('逐步逼近目標但不越過', () => {
    let v = 0;
    for (let i = 0; i < 100; i++) {
      const next = smoothTowards(v, 1, 1 / 60, 8);
      expect(next).toBeGreaterThan(v);
      expect(next).toBeLessThanOrEqual(1);
      v = next;
    }
    expect(v).toBeGreaterThan(0.99);
  });

  it('與幀率無關：同樣經過 1 秒，分 60 幀或 30 幀結果相同', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = smoothTowards(a, 1, 1 / 60, 5);
    let b = 0;
    for (let i = 0; i < 30; i++) b = smoothTowards(b, 1, 1 / 30, 5);
    expect(a).toBeCloseTo(b, 10);
  });

  it('dt 為 0 不變；已在目標上不變；可往下逼近', () => {
    expect(smoothTowards(0.3, 1, 0, 5)).toBe(0.3);
    expect(smoothTowards(1, 1, 1, 5)).toBe(1);
    expect(smoothTowards(1, 0, 0.1, 5)).toBeLessThan(1);
  });
});
