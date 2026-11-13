import { describe, expect, it } from 'vitest';
import { hexToNumber, hexToRgb, lighten } from './color';
import { hashSeed } from './hash';

describe('color', () => {
  it('hexToNumber / hexToRgb', () => {
    expect(hexToNumber('#ff8800')).toBe(0xff8800);
    expect(hexToNumber('#FF8800')).toBe(0xff8800);
    expect(hexToRgb('#ff0000')).toEqual([1, 0, 0]);
    const [r, g, b] = hexToRgb('#336699');
    expect(r).toBeCloseTo(0.2);
    expect(g).toBeCloseTo(0.4);
    expect(b).toBeCloseTo(0.6);
  });

  it('無效的顏色丟出錯誤', () => {
    expect(() => hexToNumber('red')).toThrow('無效');
    expect(() => hexToRgb('#fff')).toThrow('無效');
  });

  it('lighten：0 為原色、1 為白色、中間為混合，且超出範圍會被夾住', () => {
    expect(lighten('#336699', 0)).toBe(0x336699);
    expect(lighten('#336699', 1)).toBe(0xffffff);
    expect(lighten('#000000', 0.5)).toBe(0x808080);
    expect(lighten('#336699', -5)).toBe(0x336699);
    expect(lighten('#336699', 9)).toBe(0xffffff);
  });
});

describe('hashSeed', () => {
  it('結果在 [0, 1) 且是決定性的', () => {
    for (const id of ['a', 'wing-left', '', '玻璃片']) {
      const v = hashSeed(id);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(hashSeed(id)).toBe(v);
    }
  });

  it('不同的 id 得到不同的值', () => {
    const values = new Set(['a', 'b', 'c', 'd', 'e1', 'e2', 'f'].map(hashSeed));
    expect(values.size).toBe(7);
  });
});
