import { Graphics } from 'pixi.js';
import type { LevelData } from '../core/types';

const CAME_COLOR = 0x050406;
const EMPTY_SLOT_COLOR = 0x252533;

/** 預設鉛條寬度：關卡較長邊的 0.7% */
export function defaultCameWidth(level: LevelData): number {
  return Math.max(level.width, level.height) * 0.007;
}

/**
 * 鉛條：沿著每片玻璃的輪廓描邊，外加一圈比較粗的外框。
 * 一開始就畫好（底板是一張只有鉛條的空窗框），蓋在已鑲嵌的玻璃之上。
 * 接合處用圓角，避免銳角處刺出長長的尖角。
 */
export function createCame(level: LevelData, width: number): Graphics {
  const g = new Graphics();
  for (const piece of level.pieces) {
    g.poly(
      piece.polygon.flatMap((p) => [p.x, p.y]),
      true,
    ).stroke({ width, color: CAME_COLOR, join: 'round', cap: 'round' });
  }
  g.rect(0, 0, level.width, level.height).stroke({
    width: width * 1.8,
    color: CAME_COLOR,
    join: 'round',
  });
  return g;
}

/** 空格的底色：玻璃還沒鑲嵌時，窗框裡看到的暗色 */
export function createSlotFills(level: LevelData): Graphics {
  const g = new Graphics();
  for (const piece of level.pieces) {
    g.poly(
      piece.polygon.flatMap((p) => [p.x, p.y]),
      true,
    ).fill(EMPTY_SLOT_COLOR);
  }
  return g;
}
