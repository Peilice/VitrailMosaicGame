import type { Point } from './types';

/** 點在多邊形內（射線法），凸、凹多邊形皆可 */
export function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** 有號面積（鞋帶公式）。螢幕座標（y 向下）下，正值代表順時針 */
export function polygonArea(polygon: readonly Point[]): number {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!;
    const b = polygon[i]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** 面積加權的形心，凹多邊形也適用。面積為 0 時退回頂點平均 */
export function polygonCentroid(polygon: readonly Point[]): Point {
  const area = polygonArea(polygon);
  if (Math.abs(area) < 1e-12) {
    const n = polygon.length || 1;
    return {
      x: polygon.reduce((s, p) => s + p.x, 0) / n,
      y: polygon.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!;
    const b = polygon[i]!;
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

function orient(a: Point, b: Point, c: Point): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

/** 兩線段是否相交（含端點接觸與共線重疊） */
export function segmentsIntersect(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;
  return false;
}

/** 多邊形是否為簡單多邊形（邊與邊不相交，相鄰邊只在共用頂點接觸） */
export function isSimplePolygon(polygon: readonly Point[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      // 相鄰的邊（含首尾相接）只會在共用頂點接觸，跳過
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const c = polygon[j]!;
      const d = polygon[(j + 1) % n]!;
      if (segmentsIntersect(a, b, c, d)) return false;
    }
  }
  return true;
}

/** 多邊形的外框（bounding box） */
export function polygonBounds(polygon: readonly Point[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
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
  return { minX, minY, maxX, maxY };
}
