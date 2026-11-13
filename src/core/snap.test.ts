import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SNAP_CONFIG,
  buildSlots,
  magnetPull,
  pieceSize,
  resolveDrop,
} from './snap';
import type { Slot } from './snap';
import type { PieceData } from './types';

/** 以 (cx, cy) 為中心、邊長 size 的方形玻璃片 */
function square(id: string, cx: number, cy: number, size: number): PieceData {
  const h = size / 2;
  return {
    id,
    color: '#ff0000',
    texture: 'ripple',
    centroid: { x: cx, y: cy },
    polygon: [
      { x: cx - h, y: cy - h },
      { x: cx + h, y: cy - h },
      { x: cx + h, y: cy + h },
      { x: cx - h, y: cy + h },
    ],
  };
}

describe('pieceSize / buildSlots', () => {
  it('尺寸取外框較長的一邊', () => {
    expect(
      pieceSize([
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 10 },
      ]),
    ).toBe(30);
  });

  it('磁吸半徑 = 尺寸 × 倍率，中心是形心', () => {
    const [slot] = buildSlots([square('a', 50, 60, 40)]);
    expect(slot).toEqual({
      id: 'a',
      center: { x: 50, y: 60 },
      size: 40,
      radius: 20,
    });
  });

  it('minRadius 讓很小的碎片仍有最小的吸附範圍', () => {
    const config = { ...DEFAULT_SNAP_CONFIG, minRadius: 12 };
    const [small, big] = buildSlots(
      [square('s', 0, 0, 10), square('b', 0, 0, 100)],
      config,
    );
    expect(small!.radius).toBe(12);
    expect(big!.radius).toBe(50);
  });
});

describe('magnetPull', () => {
  const slot: Slot = {
    id: 'a',
    center: { x: 100, y: 100 },
    size: 40,
    radius: 20,
  };

  it('半徑外與邊界上不受影響', () => {
    const outside = { x: 150, y: 100 };
    expect(magnetPull(outside, slot)).toEqual(outside);
    const edge = { x: 120, y: 100 };
    expect(magnetPull(edge, slot)).toEqual(edge);
  });

  it('在格子中心時完全吸附', () => {
    expect(magnetPull({ x: 100, y: 100 }, slot)).toEqual({ x: 100, y: 100 });
  });

  it('半徑內被拉向格子中心，且越近拉得越多', () => {
    const farPos = { x: 115, y: 100 };
    const nearPos = { x: 105, y: 100 };
    const far = magnetPull(farPos, slot);
    const near = magnetPull(nearPos, slot);
    // 方向朝向中心（x 變小），y 不變
    expect(far.x).toBeLessThan(farPos.x);
    expect(far.x).toBeGreaterThan(100);
    expect(far.y).toBe(100);
    // 拉走的比例：近處大於遠處
    const farRatio = (farPos.x - far.x) / (farPos.x - 100);
    const nearRatio = (nearPos.x - near.x) / (nearPos.x - 100);
    expect(nearRatio).toBeGreaterThan(farRatio);
  });

  it('拉過頭不會越過格子中心', () => {
    for (let d = 0.5; d < 20; d += 0.5) {
      const p = magnetPull({ x: 100 + d, y: 100 }, slot);
      expect(p.x).toBeGreaterThanOrEqual(100);
      expect(p.x).toBeLessThanOrEqual(100 + d);
    }
  });

  it('在半徑邊界附近連續（沒有跳動）', () => {
    const p = magnetPull({ x: 119.999, y: 100 }, slot);
    expect(Math.abs(p.x - 119.999)).toBeLessThan(0.001);
  });
});

describe('resolveDrop', () => {
  // a、b 兩格相距 100，半徑各 20（尺寸 40）
  const slots = buildSlots([square('a', 0, 0, 40), square('b', 100, 0, 40)]);
  const none = new Set<string>();

  it('在自己格子的半徑內：卡入並回傳格子中心', () => {
    expect(resolveDrop('a', { x: 12, y: 9 }, slots, none)).toEqual({
      kind: 'set',
      position: { x: 0, y: 0 },
    });
  });

  it('剛好落在半徑邊界上也算卡入', () => {
    expect(resolveDrop('a', { x: 20, y: 0 }, slots, none).kind).toBe('set');
  });

  it('不在任何磁吸範圍：留在原地，沒有懲罰', () => {
    expect(resolveDrop('a', { x: 50, y: 50 }, slots, none)).toEqual({
      kind: 'free',
      position: { x: 50, y: 50 },
    });
  });

  it('落在另一個格子的半徑內：wrong，並沿遠離該格中心的方向輕微彈開', () => {
    const result = resolveDrop('a', { x: 110, y: 0 }, slots, none);
    expect(result.kind).toBe('wrong');
    if (result.kind !== 'wrong') return;
    expect(result.slotId).toBe('b');
    // 彈開距離 = a 的尺寸 40 × 0.25 = 10，方向為 +x（遠離 b 的中心 x=100）
    expect(result.position.x).toBeCloseTo(120);
    expect(result.position.y).toBeCloseTo(0);
  });

  it('剛好落在其他格子中心時仍可彈開（方向固定，不產生 NaN）', () => {
    const result = resolveDrop('a', { x: 100, y: 0 }, slots, none);
    expect(result.kind).toBe('wrong');
    if (result.kind !== 'wrong') return;
    expect(Number.isFinite(result.position.x)).toBe(true);
    expect(Number.isFinite(result.position.y)).toBe(true);
  });

  it('同時在自己與別人的範圍內時，自己優先', () => {
    // 兩格重疊：a 在 0，b 在 10，半徑各 20
    const overlapped = buildSlots([
      square('a', 0, 0, 40),
      square('b', 10, 0, 40),
    ]);
    expect(resolveDrop('a', { x: 8, y: 0 }, overlapped, none).kind).toBe('set');
  });

  it('同時在多個別人的範圍內時，取離中心占半徑比例最小者', () => {
    const three = buildSlots([
      square('a', 0, 0, 20),
      square('big', 100, 0, 200), // 半徑 100
      square('small', 130, 0, 20), // 半徑 10
    ]);
    // 位置 (125,0)：離 big 25（比例 0.25），離 small 5（比例 0.5）→ big
    const r1 = resolveDrop('a', { x: 125, y: 0 }, three, none);
    expect(r1.kind === 'wrong' && r1.slotId).toBe('big');
    // 位置 (131,0)：離 big 31（0.31），離 small 1（0.1）→ small
    const r2 = resolveDrop('a', { x: 131, y: 0 }, three, none);
    expect(r2.kind === 'wrong' && r2.slotId).toBe('small');
  });

  it('落在已鑲嵌玻璃的格子上也算放錯', () => {
    const result = resolveDrop('a', { x: 105, y: 0 }, slots, new Set(['b']));
    expect(result.kind).toBe('wrong');
  });

  it('已鑲嵌的玻璃片重複判定時，回傳同樣的卡入結果', () => {
    expect(resolveDrop('a', { x: 500, y: 500 }, slots, new Set(['a']))).toEqual(
      {
        kind: 'set',
        position: { x: 0, y: 0 },
      },
    );
  });

  it('bounceRatio 可調整彈開距離', () => {
    const config = { ...DEFAULT_SNAP_CONFIG, bounceRatio: 1 };
    const result = resolveDrop('a', { x: 110, y: 0 }, slots, none, config);
    expect(result.kind === 'wrong' && result.position.x).toBeCloseTo(150);
  });

  it('找不到玻璃片時丟出錯誤', () => {
    expect(() => resolveDrop('zzz', { x: 0, y: 0 }, slots, none)).toThrow(
      'zzz',
    );
  });
});
