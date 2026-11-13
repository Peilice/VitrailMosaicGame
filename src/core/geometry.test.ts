import { describe, expect, it } from 'vitest';
import { pointInPolygon } from './geometry';

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  // 凹多邊形（L 形）
  const ell = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 10 },
    { x: 0, y: 10 },
  ];

  it('凸多邊形內外判定', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 11, y: 5 }, square)).toBe(false);
  });

  it('凹多邊形的缺口視為外部', () => {
    expect(pointInPolygon({ x: 2, y: 8 }, ell)).toBe(true);
    expect(pointInPolygon({ x: 8, y: 8 }, ell)).toBe(false);
  });
});
