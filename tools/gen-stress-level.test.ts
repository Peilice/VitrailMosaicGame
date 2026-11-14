import { describe, expect, it } from 'vitest';
import { isSimplePolygon, polygonArea } from '../src/core/geometry.ts';
import { parseLevel } from '../src/core/level.ts';
import { generateStressLevel } from './gen-stress-level.ts';

describe('generateStressLevel', () => {
  const level = generateStressLevel();

  it('產生 150 片，且通過關卡格式驗證', () => {
    expect(level.pieces).toHaveLength(150);
    expect(() => parseLevel(level)).not.toThrow();
  });

  it('每片都是簡單多邊形，面積總和等於整個窗框', () => {
    let total = 0;
    for (const p of level.pieces) {
      expect(isSimplePolygon(p.polygon)).toBe(true);
      const area = polygonArea(p.polygon);
      expect(area).toBeGreaterThan(0);
      total += area;
    }
    const frame = level.width * level.height;
    expect(Math.abs(total - frame) / frame).toBeLessThan(1e-4);
  });

  it('沒有過小的玻璃片', () => {
    const mean = (level.width * level.height) / level.pieces.length;
    for (const p of level.pieces) {
      expect(polygonArea(p.polygon)).toBeGreaterThan(mean * 0.1);
    }
  });

  it('相同種子產生相同結果，不同種子不同', () => {
    expect(generateStressLevel({ seed: 7 })).toEqual(
      generateStressLevel({ seed: 7 }),
    );
    expect(generateStressLevel({ seed: 7 })).not.toEqual(
      generateStressLevel({ seed: 8 }),
    );
  });
});
