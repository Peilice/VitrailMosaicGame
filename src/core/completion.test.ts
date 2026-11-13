import { describe, expect, it } from 'vitest';
import {
  COMPLETION_SECONDS,
  FINAL_BOOST,
  FINAL_FRAME,
  FINAL_REFLECTION,
  completionFrame,
} from './completion';

describe('completionFrame', () => {
  it('一開始什麼都沒有：不亮、沒有光帶、沒有倒影、還沒結束', () => {
    const f = completionFrame(0);
    expect(f.boost).toBe(0);
    expect(f.sweep).toBeNull();
    expect(f.reflection).toBe(0);
    expect(f.done).toBe(false);
  });

  it('0.5 秒時閃亮到最大，之後回落', () => {
    expect(completionFrame(0.5).boost).toBeCloseTo(1);
    expect(completionFrame(1.5).boost).toBeLessThan(1);
    expect(completionFrame(1.5).boost).toBeGreaterThan(FINAL_BOOST);
  });

  it('亮度全程都在 [0, 1]，回落階段單調遞減，最終停在 FINAL_BOOST', () => {
    let prev = Infinity;
    for (let t = 0.5; t <= COMPLETION_SECONDS; t += 0.05) {
      const b = completionFrame(t).boost;
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(prev + 1e-12);
      prev = b;
    }
    expect(completionFrame(COMPLETION_SECONDS).boost).toBeCloseTo(FINAL_BOOST);
  });

  it('光帶只在 0.15 到 2.0 秒之間出現，進度由 0 單調增加到 1', () => {
    expect(completionFrame(0.1).sweep).toBeNull();
    expect(completionFrame(2.05).sweep).toBeNull();
    expect(completionFrame(0.15).sweep).toBeCloseTo(0);
    expect(completionFrame(2.0).sweep).toBeCloseTo(1);
    let prev = -1;
    for (let t = 0.15; t <= 2.0; t += 0.05) {
      const s = completionFrame(t).sweep!;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('光帶從 10% 走到 90% 要超過 1 秒，不會一閃而過', () => {
    let start = 0;
    let end = 0;
    for (let t = 0.15; t <= 2.0; t += 0.01) {
      const s = completionFrame(t).sweep!;
      if (start === 0 && s >= 0.1) start = t;
      if (end === 0 && s >= 0.9) end = t;
    }
    expect(end - start).toBeGreaterThan(1.0);
  });

  it('倒影由 0 逐漸浮現到 FINAL_REFLECTION 並保持', () => {
    expect(completionFrame(0.4).reflection).toBe(0);
    expect(completionFrame(1.0).reflection).toBeGreaterThan(0);
    expect(completionFrame(1.0).reflection).toBeLessThan(FINAL_REFLECTION);
    expect(completionFrame(1.8).reflection).toBeCloseTo(FINAL_REFLECTION);
    expect(completionFrame(3).reflection).toBeCloseTo(FINAL_REFLECTION);
  });

  it('時間在 3.6 秒時結束，之後維持最終畫面', () => {
    expect(completionFrame(3.59).done).toBe(false);
    expect(completionFrame(COMPLETION_SECONDS).done).toBe(true);
    const late = completionFrame(99);
    expect(late.boost).toBeCloseTo(FINAL_BOOST);
    expect(late.reflection).toBeCloseTo(FINAL_REFLECTION);
    expect(late.sweep).toBeNull();
  });

  it('負的時間視同 0', () => {
    expect(completionFrame(-5)).toEqual(completionFrame(0));
  });

  it('FINAL_FRAME 與動畫結束時一致', () => {
    const end = completionFrame(COMPLETION_SECONDS);
    expect(FINAL_FRAME.boost).toBeCloseTo(end.boost);
    expect(FINAL_FRAME.reflection).toBeCloseTo(end.reflection);
    expect(FINAL_FRAME.sweep).toBe(end.sweep);
    expect(FINAL_FRAME.done).toBe(true);
  });

  it('動畫長度在規格的 3 到 4 秒內', () => {
    expect(COMPLETION_SECONDS).toBeGreaterThanOrEqual(3);
    expect(COMPLETION_SECONDS).toBeLessThanOrEqual(4);
  });
});
