import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT_CONFIG,
  computeLayout,
  orientationFor,
  regionAt,
} from './layout';

describe('orientationFor', () => {
  it('寬大於高為橫向，反之直向，正方形視為橫向', () => {
    expect(orientationFor({ width: 1280, height: 720 })).toBe('landscape');
    expect(orientationFor({ width: 360, height: 640 })).toBe('portrait');
    expect(orientationFor({ width: 500, height: 500 })).toBe('landscape');
  });
});

describe('computeLayout', () => {
  it('橫向：托盤在右側，主框約佔 70% 寬', () => {
    const l = computeLayout({ width: 1280, height: 720 });
    expect(l.orientation).toBe('landscape');
    expect(l.board).toEqual({ x: 0, y: 0, width: 896, height: 720 });
    expect(l.tray.x).toBeCloseTo(896);
    expect(l.tray.width).toBeCloseTo(384);
    expect(l.tray.height).toBe(720);
  });

  it('直向：托盤在底部，主框約佔 70% 高', () => {
    const l = computeLayout({ width: 360, height: 640 });
    expect(l.orientation).toBe('portrait');
    expect(l.board).toEqual({ x: 0, y: 0, width: 360, height: 448 });
    expect(l.tray.y).toBeCloseTo(448);
    expect(l.tray.height).toBeCloseTo(192);
    expect(l.tray.width).toBe(360);
  });

  it.each([
    { width: 1280, height: 720 },
    { width: 360, height: 640 },
    { width: 800, height: 800 },
    { width: 300, height: 200 },
  ])('主框與托盤剛好鋪滿畫面，不重疊、無縫隙 %o', (screen) => {
    const l = computeLayout(screen);
    expect(
      l.board.width * l.board.height + l.tray.width * l.tray.height,
    ).toBeCloseTo(screen.width * screen.height);
    if (l.orientation === 'landscape') {
      expect(l.board.x + l.board.width).toBeCloseTo(l.tray.x);
    } else {
      expect(l.board.y + l.board.height).toBeCloseTo(l.tray.y);
    }
  });

  it('托盤厚度有下限：小螢幕不會讓托盤太窄', () => {
    // 橫向 400 寬：30% = 120，剛好；300 寬：30% = 90 → 提高到 120
    const l = computeLayout({ width: 300, height: 200 });
    expect(l.tray.width).toBeCloseTo(DEFAULT_LAYOUT_CONFIG.minTray);
    expect(l.board.width).toBeCloseTo(180);
  });

  it('托盤厚度有上限：極小的螢幕下托盤最多佔一半', () => {
    const l = computeLayout({ width: 160, height: 100 });
    expect(l.tray.width).toBeCloseTo(80);
    expect(l.board.width).toBeCloseTo(80);
  });

  it('可自訂比例', () => {
    const l = computeLayout(
      { width: 1000, height: 500 },
      { boardRatio: 0.8, minTray: 0, maxTrayRatio: 0.5 },
    );
    expect(l.board.width).toBeCloseTo(800);
  });

  it('尺寸為 0 時丟出錯誤', () => {
    expect(() => computeLayout({ width: 0, height: 600 })).toThrow('畫面尺寸');
  });
});

describe('regionAt', () => {
  const l = computeLayout({ width: 1000, height: 500 }); // 主框 700 寬，托盤 300 寬

  it('判斷座標屬於主框、托盤或畫面外', () => {
    expect(regionAt(l, { x: 100, y: 100 })).toBe('board');
    expect(regionAt(l, { x: 900, y: 100 })).toBe('tray');
    expect(regionAt(l, { x: -1, y: 100 })).toBeNull();
    expect(regionAt(l, { x: 1000, y: 100 })).toBeNull();
    expect(regionAt(l, { x: 100, y: 500 })).toBeNull();
  });

  it('交界線上的點只屬於托盤（矩形左閉右開）', () => {
    expect(regionAt(l, { x: 700, y: 10 })).toBe('tray');
    expect(regionAt(l, { x: 699.9, y: 10 })).toBe('board');
  });
});
