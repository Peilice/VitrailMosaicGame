import type { PieceData, Point } from './types';

/**
 * 磁吸判定設定。座標單位都是關卡世界座標，與縮放無關。
 * 規則見 docs/MVP-spec.md「放置判定」。
 */
export interface SnapConfig {
  /** 磁吸半徑 = 玻璃片尺寸 × 此倍率 */
  radiusRatio: number;
  /** 磁吸半徑的下限，避免很小的碎片幾乎吸不到（世界座標單位） */
  minRadius: number;
  /** 放錯時的彈開距離 = 該片玻璃尺寸 × 此倍率 */
  bounceRatio: number;
}

export const DEFAULT_SNAP_CONFIG: SnapConfig = {
  radiusRatio: 0.5,
  minRadius: 0,
  bounceRatio: 0.25,
};

/** 一個格子：每片玻璃只對應自己的唯一格子 */
export interface Slot {
  /** 與對應玻璃片相同的 id */
  id: string;
  /** 格子中心（等於玻璃片的 centroid） */
  center: Point;
  /** 玻璃片尺寸（外框較長的一邊） */
  size: number;
  /** 磁吸半徑 */
  radius: number;
}

/** 玻璃片尺寸：外框（bounding box）較長的一邊 */
export function pieceSize(polygon: readonly Point[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return Math.max(maxX - minX, maxY - minY);
}

export function buildSlots(
  pieces: readonly PieceData[],
  config: SnapConfig = DEFAULT_SNAP_CONFIG,
): Slot[] {
  return pieces.map((piece) => {
    const size = pieceSize(piece.polygon);
    return {
      id: piece.id,
      center: piece.centroid,
      size,
      radius: Math.max(size * config.radiusRatio, config.minRadius),
    };
  });
}

const distance = (a: Point, b: Point): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/**
 * 拖曳中的磁吸吸力：玻璃片中心進入自己格子的磁吸半徑後，
 * 畫面位置會被拉向格子中心，越近拉得越強，到達中心時完全吸附。
 * 半徑外原樣回傳，且在半徑邊界連續（吸力從 0 開始）。
 * `pos` 是玻璃片 centroid 目前的世界座標。
 */
export function magnetPull(pos: Point, slot: Slot): Point {
  const d = distance(pos, slot.center);
  if (d >= slot.radius) return pos;
  const t = 1 - d / slot.radius;
  const pull = t * t; // 遠處很弱，靠近時才明顯
  return {
    x: pos.x + (slot.center.x - pos.x) * pull,
    y: pos.y + (slot.center.y - pos.y) * pull,
  };
}

export type DropResult =
  /** 卡入自己的格子，位置是格子中心，之後鎖死 */
  | { kind: 'set'; position: Point }
  /** 落在另一個格子的磁吸半徑內：發出沉悶聲，輕微彈開到 position */
  | { kind: 'wrong'; position: Point; slotId: string }
  /** 沒有落在任何磁吸範圍：留在原地，沒有懲罰 */
  | { kind: 'free'; position: Point };

/**
 * 放開玻璃片時的判定。
 * - 自己格子的磁吸半徑內 → set（優先於 wrong，即使同時也在別的格子範圍內）
 * - 否則落在其他格子的磁吸半徑內 → wrong，若同時在多個範圍內取「離中心占半徑比例最小」者
 * - 否則 → free
 *
 * 其他格子不論是否已有玻璃都算（落在已鑲嵌的玻璃上也是放錯）。
 * 已鑲嵌的玻璃片不能再移動，重複呼叫會回傳同樣的 set，不會出錯。
 * 找不到 `pieceId` 對應的格子時丟出錯誤。
 */
export function resolveDrop(
  pieceId: string,
  pos: Point,
  slots: readonly Slot[],
  setIds: ReadonlySet<string>,
  config: SnapConfig = DEFAULT_SNAP_CONFIG,
): DropResult {
  const own = slots.find((s) => s.id === pieceId);
  if (!own) throw new Error(`找不到玻璃片「${pieceId}」的格子`);

  if (setIds.has(pieceId) || distance(pos, own.center) <= own.radius) {
    return { kind: 'set', position: own.center };
  }

  let wrong: Slot | null = null;
  let wrongRatio = Infinity;
  for (const slot of slots) {
    if (slot.id === pieceId) continue;
    const ratio = distance(pos, slot.center) / slot.radius;
    if (ratio <= 1 && ratio < wrongRatio) {
      wrong = slot;
      wrongRatio = ratio;
    }
  }
  if (wrong) {
    return {
      kind: 'wrong',
      slotId: wrong.id,
      position: bounceAway(pos, wrong.center, own.size * config.bounceRatio),
    };
  }

  return { kind: 'free', position: pos };
}

/** 從 from 沿著遠離 center 的方向移動 distance；剛好重合時任選一個固定方向 */
function bounceAway(pos: Point, center: Point, amount: number): Point {
  const dx = pos.x - center.x;
  const dy = pos.y - center.y;
  const len = Math.hypot(dx, dy);
  const ux = len === 0 ? 1 : dx / len;
  const uy = len === 0 ? 0 : dy / len;
  return { x: pos.x + ux * amount, y: pos.y + uy * amount };
}
