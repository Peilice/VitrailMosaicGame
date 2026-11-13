import { describe, expect, it } from 'vitest';
import { polygonArea } from './geometry';
import { triangulate, trianglesArea } from './triangulate';
import type { Point } from './types';

const check = (polygon: Point[], triangles: number): void => {
  const indices = triangulate(polygon);
  expect(indices).toHaveLength(triangles * 3);
  expect(indices.every((i) => i >= 0 && i < polygon.length)).toBe(true);
  expect(trianglesArea(polygon, indices)).toBeCloseTo(
    Math.abs(polygonArea(polygon)),
  );
};

describe('triangulate', () => {
  it('三角形：1 個三角形', () => {
    check(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 8 },
      ],
      1,
    );
  });

  it('方形：2 個三角形，面積相同', () => {
    check(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      2,
    );
  });

  it('凹多邊形（L 形）：4 個三角形，面積總和等於多邊形面積', () => {
    check(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 4 },
        { x: 4, y: 4 },
        { x: 4, y: 10 },
        { x: 0, y: 10 },
      ],
      4,
    );
  });

  it('很尖的銳角', () => {
    check(
      [
        { x: 0, y: 0 },
        { x: 100, y: 1 },
        { x: 0, y: 2 },
      ],
      1,
    );
  });

  it('逆時針與順時針的繞向都能處理', () => {
    const cw = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    check(cw, 2);
    check([...cw].reverse(), 2);
  });

  it('凹的星形：三角形數 = 頂點數 - 2，且面積完整', () => {
    const star: Point[] = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 50 : 20;
      const a = (i / 10) * Math.PI * 2;
      star.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    check(star, 8);
  });

  it('圓弧攤平後的多邊形（頂點很多）面積完整', () => {
    const circle: Point[] = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      circle.push({ x: Math.cos(a) * 30, y: Math.sin(a) * 30 });
    }
    check(circle, 62);
  });
});
