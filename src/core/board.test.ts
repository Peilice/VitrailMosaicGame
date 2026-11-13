import { describe, expect, it } from 'vitest';
import { Board } from './board';
import { seededShuffle } from './tray';
import type { LevelData, PieceData } from './types';

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

// 三片 40×40 的方形，格子中心 a=(50,50) b=(150,50) c=(250,50)，磁吸半徑各 20
const level: LevelData = {
  version: 1,
  width: 300,
  height: 100,
  pieces: [
    square('a', 50, 50, 40),
    square('b', 150, 50, 40),
    square('c', 250, 50, 40),
  ],
};
const IDS = ['a', 'b', 'c'];
const SEED = 7;

describe('Board：初始狀態', () => {
  it('全部在托盤，順序由種子決定', () => {
    const board = new Board(level, SEED);
    expect(board.trayIds()).toEqual(seededShuffle(IDS, SEED));
    expect(board.boardIds()).toEqual([]);
    expect(board.setIds()).toEqual([]);
    expect(board.isComplete()).toBe(false);
    expect(board.draggingId).toBeNull();
  });

  it('相同種子得到相同的托盤順序', () => {
    expect(new Board(level, 99).trayIds()).toEqual(
      new Board(level, 99).trayIds(),
    );
  });

  it('還原存檔：已鑲嵌的玻璃不在托盤，順序保持不變', () => {
    const fresh = new Board(level, SEED).trayIds();
    const board = new Board(level, SEED, ['b']);
    expect(board.setIds()).toEqual(['b']);
    expect(board.locationOf('b')).toEqual({ kind: 'set' });
    expect(board.trayIds()).toEqual(fresh.filter((id) => id !== 'b'));
    expect(board.setCount).toBe(1);
  });

  it('全部還原後視為完成', () => {
    expect(new Board(level, SEED, IDS).isComplete()).toBe(true);
  });

  it('存檔含有不存在的 id 時丟出錯誤', () => {
    expect(() => new Board(level, SEED, ['zzz'])).toThrow('zzz');
  });

  it('存檔中重複的 id 只算一次', () => {
    expect(new Board(level, SEED, ['a', 'a']).setIds()).toEqual(['a']);
  });

  it('查詢不存在的玻璃片丟出錯誤', () => {
    expect(() => new Board(level, SEED).locationOf('zzz')).toThrow('zzz');
  });
});

describe('Board：拖曳與放開', () => {
  it('拿起後，玻璃從托盤清單消失，draggingId 指向它', () => {
    const board = new Board(level, SEED);
    board.startDrag('a');
    expect(board.draggingId).toBe('a');
    expect(board.trayIds()).not.toContain('a');
    expect(board.trayIds()).toHaveLength(2);
  });

  it('放在自己的格子內：鑲嵌，位置是格子中心，之後鎖死', () => {
    const board = new Board(level, SEED);
    board.startDrag('a');
    const result = board.drop('a', { x: 55, y: 48 });
    expect(result).toEqual({ kind: 'set', position: { x: 50, y: 50 } });
    expect(board.locationOf('a')).toEqual({ kind: 'set' });
    expect(board.setIds()).toEqual(['a']);
    expect(board.draggingId).toBeNull();
    expect(() => board.startDrag('a')).toThrow('已鑲嵌');
  });

  it('放在空白處：留在主框原地，沒有懲罰', () => {
    const board = new Board(level, SEED);
    board.startDrag('a');
    const result = board.drop('a', { x: 100, y: 90 });
    expect(result).toEqual({ kind: 'free', position: { x: 100, y: 90 } });
    expect(board.locationOf('a')).toEqual({
      kind: 'board',
      pos: { x: 100, y: 90 },
    });
    expect(board.boardIds()).toEqual(['a']);
  });

  it('放在別人的格子內：放錯，彈開後留在主框', () => {
    const board = new Board(level, SEED);
    board.startDrag('a');
    const result = board.drop('a', { x: 160, y: 50 });
    expect(result.kind).toBe('wrong');
    const loc = board.locationOf('a');
    expect(loc.kind).toBe('board');
    if (loc.kind === 'board' && result.kind === 'wrong') {
      expect(loc.pos).toEqual(result.position);
      // 彈開 = 40 × 0.25 = 10，往遠離 b 中心（150）的方向
      expect(loc.pos.x).toBeCloseTo(170);
    }
  });

  it('拖曳中再拿起另一片會丟出錯誤', () => {
    const board = new Board(level, SEED);
    board.startDrag('a');
    expect(() => board.startDrag('b')).toThrow('拖曳中');
  });

  it('沒有拖曳時放開、或放開的不是拖曳中的那片，丟出錯誤', () => {
    const board = new Board(level, SEED);
    expect(() => board.drop('a', { x: 0, y: 0 })).toThrow('不在拖曳中');
    board.startDrag('a');
    expect(() => board.drop('b', { x: 0, y: 0 })).toThrow('不在拖曳中');
    expect(() => board.returnToTray('b')).toThrow('不在拖曳中');
  });

  it('放回托盤：回到原本的托盤順序', () => {
    const board = new Board(level, SEED);
    const order = board.trayIds();
    board.startDrag(order[1]!);
    board.returnToTray(order[1]!);
    expect(board.trayIds()).toEqual(order);
    expect(board.draggingId).toBeNull();
  });

  it('從主框拿起再放回托盤', () => {
    const board = new Board(level, SEED);
    board.startDrag('a');
    board.drop('a', { x: 100, y: 90 });
    board.startDrag('a');
    expect(board.boardIds()).toEqual([]);
    board.returnToTray('a');
    expect(board.locationOf('a')).toEqual({ kind: 'tray' });
    expect(board.trayIds()).toContain('a');
  });

  it('全部鑲嵌後完成', () => {
    const board = new Board(level, SEED);
    for (const piece of level.pieces) {
      board.startDrag(piece.id);
      board.drop(piece.id, piece.centroid);
    }
    expect(board.isComplete()).toBe(true);
    expect(board.setIds()).toEqual(['a', 'b', 'c']);
  });
});

describe('Board：cancelDrag', () => {
  it('從托盤拿起後取消：回到托盤', () => {
    const board = new Board(level, SEED);
    const order = board.trayIds();
    board.startDrag('a');
    board.cancelDrag();
    expect(board.trayIds()).toEqual(order);
    expect(board.draggingId).toBeNull();
  });

  it('從主框拿起後取消：回到原位', () => {
    const board = new Board(level, SEED);
    board.startDrag('a');
    board.drop('a', { x: 100, y: 90 });
    board.startDrag('a');
    board.cancelDrag();
    expect(board.locationOf('a')).toEqual({
      kind: 'board',
      pos: { x: 100, y: 90 },
    });
    expect(board.boardIds()).toEqual(['a']);
  });

  it('沒有拖曳時取消不會出錯', () => {
    expect(() => new Board(level, SEED).cancelDrag()).not.toThrow();
  });
});

describe('Board：hitTestBoard', () => {
  /** 把 a、b 放到主框空白處，兩者重疊 */
  function overlapped(): Board {
    const board = new Board(level, SEED);
    board.startDrag('a');
    board.drop('a', { x: 100, y: 90 }); // 覆蓋 x 80~120、y 70~110
    board.startDrag('b');
    board.drop('b', { x: 110, y: 90 }); // 覆蓋 x 90~130、y 70~110，疊在 a 上面
    return board;
  }

  it('命中時回傳玻璃 id，位置要考慮玻璃目前的位置而不是格子', () => {
    const board = overlapped();
    expect(board.hitTestBoard({ x: 85, y: 90 })).toBe('a');
    expect(board.hitTestBoard({ x: 125, y: 90 })).toBe('b');
    // 格子原本的位置（a 的格子在 50,50）現在是空的
    expect(board.hitTestBoard({ x: 50, y: 50 })).toBeNull();
  });

  it('重疊時回傳最上面的（最晚放下的）', () => {
    expect(overlapped().hitTestBoard({ x: 100, y: 90 })).toBe('b');
  });

  it('拿起後再放下的玻璃會疊到最上面', () => {
    const board = overlapped();
    board.startDrag('a');
    board.drop('a', { x: 100, y: 90 });
    expect(board.boardIds()).toEqual(['b', 'a']);
    expect(board.hitTestBoard({ x: 105, y: 90 })).toBe('a');
  });

  it('拖曳中、已鑲嵌、在托盤的玻璃都不會被命中', () => {
    const board = new Board(level, SEED, ['c']);
    expect(board.hitTestBoard({ x: 250, y: 50 })).toBeNull(); // 已鑲嵌
    expect(board.hitTestBoard({ x: 50, y: 50 })).toBeNull(); // 在托盤
    board.startDrag('a');
    board.drop('a', { x: 100, y: 90 });
    board.startDrag('a');
    expect(board.hitTestBoard({ x: 100, y: 90 })).toBeNull(); // 拖曳中
  });

  it('凹多邊形的缺口不會命中', () => {
    const ell: PieceData = {
      id: 'ell',
      color: '#00ff00',
      texture: 'ripple',
      centroid: { x: 3.7, y: 3.7 },
      polygon: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 4 },
        { x: 4, y: 4 },
        { x: 4, y: 10 },
        { x: 0, y: 10 },
      ],
    };
    const board = new Board({ ...level, pieces: [ell, ...level.pieces] }, SEED);
    board.startDrag('ell');
    board.drop('ell', { x: 200, y: 200 });
    // 玻璃形心在 (200,200)，缺口在其右下
    expect(board.hitTestBoard({ x: 200 + 6, y: 200 + 6 })).toBeNull();
    expect(board.hitTestBoard({ x: 200, y: 200 })).toBe('ell');
  });
});
