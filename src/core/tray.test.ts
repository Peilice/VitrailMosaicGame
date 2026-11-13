import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRAY_CONFIG,
  cellRect,
  clampScroll,
  createTrayLayout,
  seededShuffle,
  trayHit,
  trayPieceScale,
} from './tray';

describe('seededShuffle', () => {
  const items = Array.from({ length: 20 }, (_, i) => `p${i}`);

  it('同一個種子得到同樣的順序（存檔重新載入後順序不變）', () => {
    expect(seededShuffle(items, 12345)).toEqual(seededShuffle(items, 12345));
  });

  it('不同種子得到不同順序', () => {
    expect(seededShuffle(items, 1)).not.toEqual(seededShuffle(items, 2));
  });

  it('結果是原陣列的排列：不多不少，且不修改原陣列', () => {
    const copy = [...items];
    const shuffled = seededShuffle(items, 7);
    expect(items).toEqual(copy);
    expect([...shuffled].sort()).toEqual([...items].sort());
    expect(shuffled).not.toEqual(items);
  });

  it('空陣列與單一元素', () => {
    expect(seededShuffle([], 1)).toEqual([]);
    expect(seededShuffle(['a'], 1)).toEqual(['a']);
  });

  it('能處理 0、負數與很大的種子', () => {
    for (const seed of [0, -5, 2 ** 31, 2 ** 40]) {
      expect(seededShuffle(items, seed)).toHaveLength(items.length);
    }
  });

  it('每個元素在每個位置出現的次數大致平均', () => {
    const counts = new Array<number>(4).fill(0);
    const trials = 4000;
    for (let seed = 0; seed < trials; seed++) {
      counts[seededShuffle(['a', 'b', 'c', 'd'], seed).indexOf('a')]!++;
    }
    for (const n of counts)
      expect(Math.abs(n - trials / 4)).toBeLessThan(trials * 0.05);
  });
});

const ids = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `p${i}`);

describe('createTrayLayout', () => {
  it('橫向（托盤在右側）：多個 lane 並排，格子填滿橫切面', () => {
    // 寬 300 → 3 個 lane，格子 100；10 片 → 4 列 → 內容高 400
    const rect = { x: 900, y: 0, width: 300, height: 360 };
    const l = createTrayLayout(ids(10), rect, 'landscape');
    expect(l.lanes).toBe(3);
    expect(l.cell).toBeCloseTo(100);
    expect(l.contentLength).toBeCloseTo(400);
    expect(l.scrollMax).toBeCloseTo(40);
  });

  it('直向（托盤在底部）：窄的托盤只有 1 個 lane', () => {
    const rect = { x: 0, y: 448, width: 360, height: 192 };
    const l = createTrayLayout(ids(10), rect, 'portrait');
    expect(l.lanes).toBe(2); // 192 / 96 = 2
    expect(l.cell).toBeCloseTo(96);
    expect(l.contentLength).toBeCloseTo(5 * 96);
    expect(l.scrollMax).toBeCloseTo(5 * 96 - 360);
  });

  it('托盤比期望的格子還窄時，至少 1 個 lane 並以托盤厚度當格子邊長', () => {
    const l = createTrayLayout(
      ids(3),
      { x: 0, y: 0, width: 360, height: 70 },
      'portrait',
    );
    expect(l.lanes).toBe(1);
    expect(l.cell).toBeCloseTo(70);
  });

  it('內容比托盤短時不能捲動；沒有玻璃片時內容長度為 0', () => {
    const rect = { x: 0, y: 0, width: 300, height: 1000 };
    expect(createTrayLayout(ids(3), rect, 'landscape').scrollMax).toBe(0);
    const empty = createTrayLayout([], rect, 'landscape');
    expect(empty.contentLength).toBe(0);
    expect(empty.scrollMax).toBe(0);
  });

  it('尺寸為 0 時丟出錯誤', () => {
    expect(() =>
      createTrayLayout(
        ids(1),
        { x: 0, y: 0, width: 0, height: 100 },
        'landscape',
      ),
    ).toThrow('托盤尺寸');
  });
});

describe('clampScroll', () => {
  const l = createTrayLayout(
    ids(10),
    { x: 0, y: 0, width: 300, height: 360 },
    'landscape',
  );

  it('限制在 0 到 scrollMax', () => {
    expect(clampScroll(l, -50)).toBe(0);
    expect(clampScroll(l, 20)).toBe(20);
    expect(clampScroll(l, 9999)).toBeCloseTo(l.scrollMax);
  });
});

describe('cellRect', () => {
  it('橫向：由左到右填滿一列，再往下一列，捲動讓格子上移', () => {
    const l = createTrayLayout(
      ids(10),
      { x: 900, y: 50, width: 300, height: 360 },
      'landscape',
    );
    expect(cellRect(l, 0, 0)).toEqual({
      x: 900,
      y: 50,
      width: 100,
      height: 100,
    });
    expect(cellRect(l, 2, 0)).toEqual({
      x: 1100,
      y: 50,
      width: 100,
      height: 100,
    });
    expect(cellRect(l, 3, 0)).toEqual({
      x: 900,
      y: 150,
      width: 100,
      height: 100,
    });
    expect(cellRect(l, 3, 30)).toEqual({
      x: 900,
      y: 120,
      width: 100,
      height: 100,
    });
  });

  it('直向：由上到下填滿一行，再往右一行，捲動讓格子左移', () => {
    const l = createTrayLayout(
      ids(10),
      { x: 0, y: 448, width: 360, height: 192 },
      'portrait',
    );
    expect(cellRect(l, 0, 0)).toEqual({ x: 0, y: 448, width: 96, height: 96 });
    expect(cellRect(l, 1, 0)).toEqual({ x: 0, y: 544, width: 96, height: 96 });
    expect(cellRect(l, 2, 0)).toEqual({ x: 96, y: 448, width: 96, height: 96 });
    expect(cellRect(l, 2, 40)).toEqual({
      x: 56,
      y: 448,
      width: 96,
      height: 96,
    });
  });
});

describe('trayHit', () => {
  const rect = { x: 900, y: 0, width: 300, height: 360 };
  const l = createTrayLayout(ids(10), rect, 'landscape');

  it('點在格子內回傳該片 id，與 cellRect 一致', () => {
    for (let i = 0; i < 10; i++) {
      const r = cellRect(l, i, 0);
      const center = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      if (center.y < rect.height) expect(trayHit(l, 0, center)).toBe(`p${i}`);
    }
  });

  it('套用捲動量', () => {
    // 捲動 40：第 3 片（第二列第一格）的格子從 y=100 上移到 y=60
    expect(trayHit(l, 40, { x: 950, y: 70 })).toBe('p3');
    expect(trayHit(l, 0, { x: 950, y: 70 })).toBe('p0');
  });

  it('托盤外、超過最後一片的空格、捲過頭的上方都回傳 null', () => {
    expect(trayHit(l, 0, { x: 100, y: 100 })).toBeNull();
    const few = createTrayLayout(ids(2), rect, 'landscape');
    expect(trayHit(few, 0, { x: 1150, y: 50 })).toBeNull(); // 第 3 個空格
    expect(trayHit(few, 0, { x: 950, y: 250 })).toBeNull(); // 第二列沒有東西
  });

  it('托盤最右邊緣的點歸最後一個 lane，不會溢出', () => {
    expect(trayHit(l, 0, { x: 1199.99, y: 10 })).toBe('p2');
  });

  it('直向托盤', () => {
    const p = createTrayLayout(
      ids(10),
      { x: 0, y: 448, width: 360, height: 192 },
      'portrait',
    );
    expect(trayHit(p, 0, { x: 10, y: 460 })).toBe('p0');
    expect(trayHit(p, 0, { x: 10, y: 600 })).toBe('p1');
    expect(trayHit(p, 0, { x: 110, y: 460 })).toBe('p2');
    expect(trayHit(p, 96, { x: 10, y: 460 })).toBe('p2');
  });
});

describe('trayPieceScale', () => {
  const l = createTrayLayout(
    ids(4),
    { x: 0, y: 0, width: 300, height: 400 },
    'landscape',
  );
  // 格子 100，留白 8 → 可用 84

  it('大玻璃片縮小到放得進格子', () => {
    expect(trayPieceScale(420, l, 10)).toBeCloseTo(84 / 420);
  });

  it('小玻璃片不會被放大到超過 maxScale', () => {
    expect(trayPieceScale(10, l, 2)).toBe(2);
  });

  it('留白可自訂', () => {
    expect(
      trayPieceScale(100, l, 10, { ...DEFAULT_TRAY_CONFIG, cellPadding: 0 }),
    ).toBeCloseTo(1);
  });
});
