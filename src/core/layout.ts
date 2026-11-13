import type { Point, Rect, Size } from './types';

/**
 * 版面：把畫布切成「主拼圖框」與「托盤」兩個區域。
 * 規則見 docs/MVP-spec.md「版面」：
 * - 橫向或寬螢幕：托盤在右側，主框約佔 70% 寬
 * - 直向螢幕：托盤在底部，主框約佔 70% 高
 * - 依螢幕長寬比自動切換
 */
export type Orientation = 'landscape' | 'portrait';

export interface LayoutConfig {
  /** 主框佔畫面（沿托盤方向）的比例 */
  boardRatio: number;
  /** 托盤厚度的下限（像素），避免小螢幕上托盤太窄、玻璃片看不清楚 */
  minTray: number;
  /** 托盤厚度的上限，佔畫面（沿托盤方向）的比例，避免托盤吃掉主框 */
  maxTrayRatio: number;
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  boardRatio: 0.7,
  minTray: 120,
  maxTrayRatio: 0.5,
};

export interface Layout {
  orientation: Orientation;
  /** 主拼圖框在螢幕上的矩形，可直接當作相機的 viewport */
  board: Rect;
  tray: Rect;
}

/** 寬大於等於高為橫向（含正方形），否則為直向 */
export function orientationFor(screen: Size): Orientation {
  return screen.width >= screen.height ? 'landscape' : 'portrait';
}

export function computeLayout(
  screen: Size,
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
): Layout {
  if (!(screen.width > 0 && screen.height > 0)) {
    throw new Error('畫面尺寸必須大於 0');
  }
  const orientation = orientationFor(screen);
  const total = orientation === 'landscape' ? screen.width : screen.height;
  // 先依比例算托盤厚度，再套用上下限；上限優先（螢幕極小時也要留空間給主框）
  const tray = Math.min(
    Math.max(total * (1 - config.boardRatio), config.minTray),
    total * config.maxTrayRatio,
  );
  const board = total - tray;

  if (orientation === 'landscape') {
    return {
      orientation,
      board: { x: 0, y: 0, width: board, height: screen.height },
      tray: { x: board, y: 0, width: tray, height: screen.height },
    };
  }
  return {
    orientation,
    board: { x: 0, y: 0, width: screen.width, height: board },
    tray: { x: 0, y: board, width: screen.width, height: tray },
  };
}

export function pointInRect(rect: Rect, p: Point): boolean {
  return (
    p.x >= rect.x &&
    p.x < rect.x + rect.width &&
    p.y >= rect.y &&
    p.y < rect.y + rect.height
  );
}

/** 螢幕座標落在哪個區域；超出畫面回傳 null */
export function regionAt(layout: Layout, p: Point): 'board' | 'tray' | null {
  if (pointInRect(layout.board, p)) return 'board';
  if (pointInRect(layout.tray, p)) return 'tray';
  return null;
}
