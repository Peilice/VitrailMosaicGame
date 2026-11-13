import earcut from 'earcut';
import type { Point } from './types';

/**
 * 把簡單多邊形（凸、凹皆可）切成三角形，回傳三角形清單的頂點索引（每三個一組）。
 * 玻璃片的渲染用它建立 mesh。
 */
export function triangulate(polygon: readonly Point[]): number[] {
  const flat: number[] = [];
  for (const p of polygon) flat.push(p.x, p.y);
  return earcut(flat);
}

/** 三角形清單覆蓋的總面積，用來檢查三角化是否完整 */
export function trianglesArea(
  polygon: readonly Point[],
  indices: readonly number[],
): number {
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = polygon[indices[i]!]!;
    const b = polygon[indices[i + 1]!]!;
    const c = polygon[indices[i + 2]!]!;
    area += Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  }
  return area;
}
