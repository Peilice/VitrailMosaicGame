import { describe, expect, it } from 'vitest';
import { FrameMonitor } from './perf';

/** 連續丟入 n 幀，回傳所有非 null 的結果 */
function feed(m: FrameMonitor, n: number, ms: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const v = m.push(ms);
    if (v) out.push(v);
  }
  return out;
}

const SMALL = { warmupFrames: 5, windowFrames: 10 };

describe('FrameMonitor', () => {
  it('預設是關閉的，暖機期與資料不足時不會做任何判斷', () => {
    const m = new FrameMonitor(SMALL);
    expect(m.isEnabled).toBe(false);
    expect(feed(m, 5 + 9, 16)).toEqual([]);
    expect(m.isEnabled).toBe(false);
  });

  it('幀率足夠（約 60fps）：累積一個視窗後開啟', () => {
    const m = new FrameMonitor(SMALL);
    expect(feed(m, 5 + 10, 16.7)).toEqual(['enable']);
    expect(m.isEnabled).toBe(true);
  });

  it('幀率不夠（約 40fps）：維持關閉，且一直不會開', () => {
    const m = new FrameMonitor(SMALL);
    expect(feed(m, 100, 25)).toEqual([]);
    expect(m.isEnabled).toBe(false);
  });

  it('開啟後明顯變慢：關閉，而且之後不再開啟', () => {
    const m = new FrameMonitor(SMALL);
    feed(m, 5 + 10, 16);
    expect(feed(m, 10, 40)).toEqual(['disable']);
    expect(m.isEnabled).toBe(false);
    expect(feed(m, 100, 10)).toEqual([]);
    expect(m.isEnabled).toBe(false);
  });

  it('開啟後稍微變慢但沒到關閉門檻：維持開啟', () => {
    const m = new FrameMonitor(SMALL);
    feed(m, 5 + 10, 16);
    expect(feed(m, 50, 22)).toEqual([]);
    expect(m.isEnabled).toBe(true);
  });

  it('用中位數評估：視窗內偶爾幾次卡頓不影響結果', () => {
    const m = new FrameMonitor(SMALL);
    feed(m, 5, 16); // 暖機
    feed(m, 7, 16);
    m.push(120);
    m.push(150);
    expect(m.push(16)).toBe('enable');
  });

  it('單幀超過 250 毫秒（切分頁、系統卡住）不計入', () => {
    const m = new FrameMonitor(SMALL);
    feed(m, 5, 16);
    feed(m, 9, 16);
    // 一次超長的幀不應該算進視窗，視窗還差 1 幀
    expect(m.push(5000)).toBeNull();
    expect(m.isEnabled).toBe(false);
    expect(m.push(16)).toBe('enable');
  });

  it('無效的數值（0、負數、NaN）被忽略', () => {
    const m = new FrameMonitor(SMALL);
    expect(m.push(0)).toBeNull();
    expect(m.push(-3)).toBeNull();
    expect(m.push(NaN)).toBeNull();
    expect(feed(m, 5 + 10, 16)).toEqual(['enable']);
  });

  it('門檻可自訂', () => {
    const strict = new FrameMonitor({ ...SMALL, enableBelowMs: 10 });
    expect(feed(strict, 50, 16)).toEqual([]);
    const loose = new FrameMonitor({ ...SMALL, enableBelowMs: 40 });
    expect(feed(loose, 15, 30)).toEqual(['enable']);
  });

  it('預設值：暖機 30 幀加一個 90 幀的視窗後才判斷', () => {
    const m = new FrameMonitor();
    expect(feed(m, 30 + 89, 16)).toEqual([]);
    expect(m.push(16)).toBe('enable');
  });
});
