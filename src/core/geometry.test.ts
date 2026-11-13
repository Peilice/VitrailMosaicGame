import { describe, expect, it } from 'vitest';
import {
  isSimplePolygon,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polygonBounds,
} from './geometry';

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

describe('polygonArea / polygonCentroid', () => {
  const rect = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
    { x: 0, y: 10 },
  ];

  it('螢幕座標下順時針為正面積，反向為負', () => {
    expect(polygonArea(rect)).toBe(200);
    expect(polygonArea([...rect].reverse())).toBe(-200);
  });

  it('矩形形心在中心', () => {
    expect(polygonCentroid(rect)).toEqual({ x: 10, y: 5 });
  });

  it('L 形凹多邊形形心依面積加權', () => {
    const ell = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ];
    const c = polygonCentroid(ell);
    expect(c.x).toBeCloseTo(3.875, 5);
    expect(c.y).toBeCloseTo(3.875, 5);
  });
});

describe('isSimplePolygon', () => {
  it('一般多邊形為簡單，蝴蝶結形不是', () => {
    expect(
      isSimplePolygon([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 8 },
      ]),
    ).toBe(true);
    expect(
      isSimplePolygon([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ]),
    ).toBe(false);
  });
});

describe('polygonBounds', () => {
  it('回傳外框', () => {
    expect(
      polygonBounds([
        { x: 3, y: 9 },
        { x: -2, y: 4 },
        { x: 7, y: 1 },
      ]),
    ).toEqual({ minX: -2, minY: 1, maxX: 7, maxY: 9 });
  });
});
