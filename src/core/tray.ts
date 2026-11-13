import { pointInRect } from './layout';
import type { Orientation } from './layout';
import type { Point, Rect } from './types';

/** 以種子產生 [0, 1) 亂數的函式（mulberry32），同一個種子永遠得到同一串數字 */
function seededRandom(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 以種子洗牌（Fisher-Yates），回傳新陣列，不修改原陣列。
 * 托盤順序用它決定：存檔只要記種子，重新整理後順序就不變。
 */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];
  const random = seededRandom(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

export interface TrayConfig {
  /** 期望的格子邊長（像素），實際邊長會調整到剛好填滿托盤的橫切面 */
  cellSize: number;
  /** 玻璃片與格子邊緣的留白（像素） */
  cellPadding: number;
}

export const DEFAULT_TRAY_CONFIG: TrayConfig = {
  cellSize: 96,
  cellPadding: 8,
};

/**
 * 托盤版面。玻璃片依序排進正方形格子：
 * - 橫向版面（托盤在右側）：格子由左到右填滿一列，再往下一列，垂直捲動
 * - 直向版面（托盤在底部）：格子由上到下填滿一行，再往右一行，水平捲動
 * 「lane」是垂直於捲動方向的並排數量。
 */
export interface TrayLayout {
  orientation: Orientation;
  rect: Rect;
  /** 目前在托盤內的玻璃片 id，依顯示順序 */
  ids: readonly string[];
  /** 垂直於捲動方向並排的格子數 */
  lanes: number;
  /** 格子邊長（像素） */
  cell: number;
  /** 沿捲動方向的內容總長 */
  contentLength: number;
  /** 最大捲動量（內容比托盤短時為 0） */
  scrollMax: number;
}

export function createTrayLayout(
  ids: readonly string[],
  rect: Rect,
  orientation: Orientation,
  config: TrayConfig = DEFAULT_TRAY_CONFIG,
): TrayLayout {
  const cross = orientation === 'landscape' ? rect.width : rect.height;
  const main = orientation === 'landscape' ? rect.height : rect.width;
  if (!(cross > 0 && main > 0)) throw new Error('托盤尺寸必須大於 0');

  const lanes = Math.max(1, Math.floor(cross / config.cellSize));
  const cell = cross / lanes;
  const contentLength = Math.ceil(ids.length / lanes) * cell;
  return {
    orientation,
    rect,
    ids,
    lanes,
    cell,
    contentLength,
    scrollMax: Math.max(0, contentLength - main),
  };
}

export function clampScroll(layout: TrayLayout, scroll: number): number {
  return Math.min(Math.max(scroll, 0), layout.scrollMax);
}

/** 第 index 個玻璃片的格子在螢幕上的矩形（已套用捲動量） */
export function cellRect(
  layout: TrayLayout,
  index: number,
  scroll: number,
): Rect {
  const lane = index % layout.lanes;
  const step = Math.floor(index / layout.lanes);
  const along = step * layout.cell - scroll;
  const across = lane * layout.cell;
  const { rect, cell } = layout;
  return layout.orientation === 'landscape'
    ? { x: rect.x + across, y: rect.y + along, width: cell, height: cell }
    : { x: rect.x + along, y: rect.y + across, width: cell, height: cell };
}

/** 螢幕座標落在哪片玻璃的格子上；沒有（空白處或托盤外）回傳 null */
export function trayHit(
  layout: TrayLayout,
  scroll: number,
  p: Point,
): string | null {
  if (!pointInRect(layout.rect, p)) return null;
  const landscape = layout.orientation === 'landscape';
  const across =
    (landscape ? p.x - layout.rect.x : p.y - layout.rect.y) / layout.cell;
  const along =
    ((landscape ? p.y - layout.rect.y : p.x - layout.rect.x) + scroll) /
    layout.cell;
  const lane = Math.min(Math.floor(across), layout.lanes - 1);
  const step = Math.floor(along);
  if (step < 0) return null;
  return layout.ids[step * layout.lanes + lane] ?? null;
}

/**
 * 玻璃片在托盤中的縮放（螢幕像素 / 世界單位）：縮小到放得進格子（扣掉留白），
 * 但不超過 `maxScale`（通常是目前相機的縮放，這樣托盤裡的玻璃片不會比放在主框裡還大）。
 * 從托盤拖出時，再把縮放過渡到相機的縮放，就是「放大到與格子相同的比例」。
 */
export function trayPieceScale(
  pieceSize: number,
  layout: TrayLayout,
  maxScale: number,
  config: TrayConfig = DEFAULT_TRAY_CONFIG,
): number {
  const inner = Math.max(layout.cell - 2 * config.cellPadding, 1);
  return Math.min(inner / pieceSize, maxScale);
}
