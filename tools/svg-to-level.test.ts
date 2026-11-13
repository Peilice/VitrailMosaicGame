import { describe, expect, it } from 'vitest';
import { polygonArea } from '../src/core/geometry.ts';
import { flattenPath } from './svg-path.ts';
import { convertSvg, parseColor } from './svg-to-level.ts';
import { applyMatrix, parseTransform } from './svg-transform.ts';

const wrap = (body: string, attrs = 'viewBox="0 0 100 100"'): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

describe('flattenPath', () => {
  it('絕對與相對指令得到相同結果', () => {
    const abs = flattenPath('M10 10 L20 10 L20 20 L10 20 Z', 0.1);
    const rel = flattenPath('m10 10 l10 0 l0 10 l-10 0 z', 0.1);
    expect(rel).toEqual(abs);
    expect(abs[0]!.closed).toBe(true);
  });

  it('H、V 與 M 之後的隱含 L', () => {
    const [sp] = flattenPath('M0 0 10 0 V10 H0 Z', 0.1);
    expect(sp!.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
  });

  it('三次貝茲曲線攤平後端點正確、頂點數隨誤差變多', () => {
    const d = 'M0 0 C0 50 100 50 100 0';
    const coarse = flattenPath(d, 5)[0]!.points;
    const fine = flattenPath(d, 0.05)[0]!.points;
    expect(fine.length).toBeGreaterThan(coarse.length);
    expect(fine[fine.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it('弧線：兩段半圓拼成的圓，面積接近 πr²', () => {
    const [sp] = flattenPath(
      'M0 50 A50 50 0 1 1 100 50 A50 50 0 1 1 0 50 Z',
      0.05,
    );
    const area = Math.abs(polygonArea(sp!.points));
    expect(area).toBeGreaterThan(Math.PI * 2500 * 0.99);
    expect(area).toBeLessThanOrEqual(Math.PI * 2500);
  });

  it('弧線旗標可與後面的數字相連', () => {
    const [sp] = flattenPath('M0 0 a10 10 0 011 10Z', 0.1);
    expect(sp!.points[sp!.points.length - 1]).toEqual({ x: 1, y: 10 });
  });

  it('平滑曲線 S 會反射上一個控制點', () => {
    const viaS = flattenPath('M0 0 C0 10 10 10 10 0 S20 -10 20 0', 0.01)[0]!
      .points;
    const viaC = flattenPath(
      'M0 0 C0 10 10 10 10 0 C10 -10 20 -10 20 0',
      0.01,
    )[0]!.points;
    expect(viaS).toEqual(viaC);
  });

  it('Z 之後沒有 M 時，新子路徑從起點開始', () => {
    const sps = flattenPath('M0 0 L10 0 L10 10 Z L5 5', 0.1);
    expect(sps).toHaveLength(2);
    expect(sps[1]!.points[0]).toEqual({ x: 0, y: 0 });
  });

  it('錯誤輸入會丟出明確的錯誤', () => {
    expect(() => flattenPath('L10 10', 0.1)).toThrow('M');
    expect(() => flattenPath('M0 0 X5 5', 0.1)).toThrow('不支援');
    expect(() => flattenPath('M0 0 L10', 0.1)).toThrow('需要數字');
  });
});

describe('parseTransform', () => {
  it('translate、scale、rotate 依序組合', () => {
    const m = parseTransform('translate(10 20) scale(2)');
    expect(applyMatrix(m, { x: 1, y: 1 })).toEqual({ x: 12, y: 22 });
    const r = parseTransform('rotate(90)');
    const p = applyMatrix(r, { x: 1, y: 0 });
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
  });

  it('不支援的 transform 會丟出錯誤', () => {
    expect(() => parseTransform('bogus(1)')).toThrow('不支援');
  });
});

describe('parseColor', () => {
  it('支援 #rgb、#rrggbb、rgb()', () => {
    expect(parseColor('#F0a')).toBe('#ff00aa');
    expect(parseColor('#AABBCC')).toBe('#aabbcc');
    expect(parseColor('rgb(255, 0, 128)')).toBe('#ff0080');
    expect(parseColor('rgb(100%, 0%, 0%)')).toBe('#ff0000');
  });

  it('不支援的顏色寫法會丟出錯誤', () => {
    expect(() => parseColor('red')).toThrow('無法解析');
  });
});

describe('convertSvg', () => {
  const square = (id: string, extra = ''): string =>
    `<path id="${id}" d="M0 0 H50 V50 H0 Z" fill="#ff0000" ${extra}/>`;

  it('輸出尺寸、顏色、紋理、形心，繞向統一', () => {
    const level = convertSvg(wrap(square('a', 'data-texture="bubble"')));
    expect(level.version).toBe(1);
    expect(level.width).toBe(100);
    expect(level.height).toBe(100);
    const piece = level.pieces[0]!;
    expect(piece.id).toBe('a');
    expect(piece.color).toBe('#ff0000');
    expect(piece.texture).toBe('bubble');
    expect(piece.centroid).toEqual({ x: 25, y: 25 });
    expect(polygonArea(piece.polygon)).toBeGreaterThan(0);
  });

  it('逆時針的 path 也會被轉成相同繞向', () => {
    const cw = convertSvg(wrap(square('a'))).pieces[0]!;
    const ccw = convertSvg(
      wrap('<path id="a" d="M0 0 V50 H50 V0 Z" fill="#ff0000"/>'),
    ).pieces[0]!;
    expect(polygonArea(ccw.polygon)).toBeCloseTo(polygonArea(cw.polygon));
  });

  it('未指定 data-texture 時用 ripple', () => {
    expect(convertSvg(wrap(square('a'))).pieces[0]!.texture).toBe('ripple');
  });

  it('fill 可來自 style 與祖先 <g>', () => {
    const level = convertSvg(
      wrap(
        '<g fill="#00ff00"><path id="a" d="M0 0 H10 V10 Z"/><path id="b" style="fill:#0000ff" d="M0 0 H10 V10 Z"/></g>',
      ),
    );
    expect(level.pieces.map((p) => p.color)).toEqual(['#00ff00', '#0000ff']);
  });

  it('祖先 <g> 的 transform 會套用到座標', () => {
    const level = convertSvg(
      wrap(`<g transform="translate(10 20)">${square('a')}</g>`),
    );
    expect(level.pieces[0]!.centroid).toEqual({ x: 35, y: 45 });
  });

  it('viewBox 起點不是 0,0 時，座標會平移到以 0,0 為原點', () => {
    const level = convertSvg(wrap(square('a'), 'viewBox="-10 -10 200 100"'));
    expect(level.width).toBe(200);
    expect(level.height).toBe(100);
    expect(level.pieces[0]!.centroid).toEqual({ x: 35, y: 35 });
  });

  it('沒有 viewBox 時使用 width / height', () => {
    const level = convertSvg(wrap(square('a'), 'width="300px" height="150"'));
    expect([level.width, level.height]).toEqual([300, 150]);
  });

  it('<defs> 內的 path 不算玻璃片', () => {
    const level = convertSvg(
      wrap(
        `<defs><clipPath id="c"><path id="clip" d="M0 0 H5 V5 Z"/></clipPath></defs>${square('a')}`,
      ),
    );
    expect(level.pieces.map((p) => p.id)).toEqual(['a']);
  });

  it('曲線輪廓會攤平成折線，並保持在誤差內', () => {
    const level = convertSvg(
      wrap(
        '<path id="c" fill="#123456" d="M0 50 A50 50 0 1 1 100 50 A50 50 0 1 1 0 50 Z"/>',
      ),
      { tolerance: 0.1 },
    );
    const poly = level.pieces[0]!.polygon;
    expect(poly.length).toBeGreaterThan(20);
    for (const p of poly) {
      expect(Math.abs(Math.hypot(p.x - 50, p.y - 50) - 50)).toBeLessThan(0.1);
    }
  });

  it.each([
    ['缺少 id', wrap('<path d="M0 0 H10 V10 Z" fill="#fff"/>'), '缺少 id'],
    ['缺少 fill', wrap('<path id="a" d="M0 0 H10 V10 Z"/>'), '沒有 fill'],
    [
      'fill 為 none',
      wrap('<path id="a" d="M0 0 H10 V10 Z" fill="none"/>'),
      'none',
    ],
    ['無效紋理', wrap(square('a', 'data-texture="wood"')), '無效'],
    ['id 重複', wrap(square('a') + square('a')), '重複'],
    [
      '多個子路徑',
      wrap('<path id="a" fill="#fff" d="M0 0 H10 V10 Z M20 20 H30 V30 Z"/>'),
      '子路徑',
    ],
    [
      '輪廓自我相交',
      wrap('<path id="a" fill="#fff" d="M0 0 L10 10 L10 0 L0 10 Z"/>'),
      '自我相交',
    ],
    [
      '面積為 0',
      wrap('<path id="a" fill="#fff" d="M0 0 L10 0 L20 0 Z"/>'),
      '面積為 0',
    ],
    ['沒有 path', wrap(''), '沒有任何可用'],
    ['根元素不是 svg', '<html></html>', '不是 <svg>'],
    ['沒有尺寸', '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'viewBox'],
  ])('%s 會丟出錯誤', (_name, svg, message) => {
    expect(() => convertSvg(svg)).toThrow(message);
  });

  it('錯誤訊息包含玻璃片 id', () => {
    expect(() =>
      convertSvg(wrap(square('wing-left', 'data-texture="wood"'))),
    ).toThrow('wing-left');
  });
});
