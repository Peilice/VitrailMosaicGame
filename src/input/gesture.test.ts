import { describe, expect, it } from 'vitest';
import type { Point } from '../core/types';
import {
  GestureController,
  PINCH_WHEEL_SENSITIVITY,
  WHEEL_SENSITIVITY,
  wheelZoomFactor,
} from './gesture';

type Event =
  | ['dragStart', string, Point]
  | ['drag', string, Point]
  | ['drop', string, Point]
  | ['cancel', string]
  | ['pan', number, number]
  | ['zoom', number, Point];

/** 建立控制器；螢幕上 x < 100 的區域有一片玻璃 "p"，其餘是空白 */
function setup(locked = false): {
  c: GestureController;
  log: Event[];
  hits: Point[];
} {
  const log: Event[] = [];
  const hits: Point[] = [];
  const c = new GestureController(
    (p) => {
      hits.push(p);
      return !locked && p.x < 100 ? 'p' : null;
    },
    {
      onPieceDragStart: (id, s) => log.push(['dragStart', id, s]),
      onPieceDrag: (id, s) => log.push(['drag', id, s]),
      onPieceDrop: (id, s) => log.push(['drop', id, s]),
      onPieceDragCancel: (id) => log.push(['cancel', id]),
      onPan: (dx, dy) => log.push(['pan', dx, dy]),
      onZoom: (f, a) => log.push(['zoom', f, a]),
    },
  );
  return { c, log, hits };
}

const at = (x: number, y: number): Point => ({ x, y });

describe('單指：平移與拖曳玻璃', () => {
  it('按在空白處拖動：平移，放開後不產生事件', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(200, 200));
    c.pointerMove(1, at(210, 195));
    c.pointerMove(1, at(215, 195));
    c.pointerUp(1, at(215, 195));
    expect(log).toEqual([
      ['pan', 10, -5],
      ['pan', 5, 0],
    ]);
  });

  it('按在玻璃片上：立即開始拖曳，移動與放開都帶玻璃 id 與位置', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(50, 50));
    c.pointerMove(1, at(60, 70));
    c.pointerUp(1, at(65, 75));
    expect(log).toEqual([
      ['dragStart', 'p', at(50, 50)],
      ['drag', 'p', at(60, 70)],
      ['drop', 'p', at(65, 75)],
    ]);
  });

  it('不移動的點一下：開始與放開成對出現', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(50, 50));
    c.pointerUp(1, at(50, 50));
    expect(log.map((e) => e[0])).toEqual(['dragStart', 'drop']);
  });

  it('已鑲嵌（hitTest 回傳 null）的玻璃按下去是平移畫面', () => {
    const { c, log } = setup(true);
    c.pointerDown(1, at(50, 50));
    c.pointerMove(1, at(55, 50));
    expect(log).toEqual([['pan', 5, 0]]);
  });

  it('只有按下的當下做命中測試，移動中不會重測', () => {
    const { c, hits } = setup();
    c.pointerDown(1, at(200, 200));
    c.pointerMove(1, at(50, 50)); // 拖進玻璃片上方也不會變成拖曳玻璃
    c.pointerMove(1, at(40, 40));
    expect(hits).toHaveLength(1);
  });

  it('沒有按下就移動或放開：忽略', () => {
    const { c, log } = setup();
    c.pointerMove(1, at(10, 10));
    c.pointerUp(1, at(10, 10));
    expect(log).toEqual([]);
  });

  it('同一個指標重複按下：忽略', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(200, 200));
    c.pointerDown(1, at(300, 300));
    c.pointerMove(1, at(210, 200));
    expect(log).toEqual([['pan', 10, 0]]);
  });

  it('放開後可以重新開始新的手勢', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(200, 200));
    c.pointerUp(1, at(200, 200));
    c.pointerDown(2, at(50, 50));
    expect(log).toEqual([['dragStart', 'p', at(50, 50)]]);
  });
});

describe('拖曳玻璃時的其他指標', () => {
  it('第二根手指不會中斷拖曳，它的移動與放開都被忽略', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(50, 50));
    c.pointerDown(2, at(300, 300));
    c.pointerMove(2, at(310, 310));
    c.pointerUp(2, at(310, 310));
    c.pointerMove(1, at(60, 60));
    c.pointerUp(1, at(60, 60));
    expect(log).toEqual([
      ['dragStart', 'p', at(50, 50)],
      ['drag', 'p', at(60, 60)],
      ['drop', 'p', at(60, 60)],
    ]);
  });

  it('pointercancel：拖曳中的玻璃收到 cancel，之後不再有事件', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(50, 50));
    c.pointerCancel(1);
    c.pointerMove(1, at(60, 60));
    c.pointerUp(1, at(60, 60));
    expect(log).toEqual([
      ['dragStart', 'p', at(50, 50)],
      ['cancel', 'p'],
    ]);
  });

  it('cancel() 中斷拖曳；沒有手勢時呼叫不會有事件', () => {
    const { c, log } = setup();
    c.cancel();
    expect(log).toEqual([]);
    c.pointerDown(1, at(50, 50));
    c.cancel();
    expect(log[log.length - 1]).toEqual(['cancel', 'p']);
  });
});

describe('雙指：縮放加平移', () => {
  it('兩指拉開：以上一刻的中點為中心放大', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(200, 200));
    c.pointerDown(2, at(300, 200));
    // 對稱拉開：距離 100 → 200，中點不變
    c.pointerMove(1, at(150, 200));
    c.pointerMove(2, at(350, 200));
    // 第一次移動只動了一指：距離 150、中點 (225,200)
    // 第二次：距離 200、中點 (250,200)
    expect(log).toEqual([
      ['zoom', 1.5, at(250, 200)],
      ['pan', -25, 0],
      ['zoom', 200 / 150, at(225, 200)],
      ['pan', 25, 0],
    ]);
  });

  it('兩指同向移動：只平移，不縮放', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(200, 200));
    c.pointerDown(2, at(300, 200));
    c.pointerMove(1, at(200, 210));
    c.pointerMove(2, at(300, 210));
    const zooms = log.filter((e) => e[0] === 'zoom');
    // 第一次只動一指會讓距離些微改變；第二次回到同樣距離，應為縮放與位移的組合，
    // 最終兩指都往下 10：累計平移 y = 10
    const panY = log
      .filter((e): e is ['pan', number, number] => e[0] === 'pan')
      .reduce((sum, e) => sum + e[2], 0);
    expect(panY).toBeCloseTo(10);
    // 累計縮放倍率回到 1
    const total = zooms.reduce(
      (p, e) => p * (e as ['zoom', number, Point])[1],
      1,
    );
    expect(total).toBeCloseTo(1);
  });

  it('第二根手指按在玻璃片上也是縮放，不會拖曳玻璃', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(200, 200));
    c.pointerDown(2, at(50, 50));
    c.pointerMove(2, at(40, 50));
    expect(log.some((e) => e[0] === 'dragStart' || e[0] === 'drag')).toBe(
      false,
    );
    expect(log.some((e) => e[0] === 'zoom')).toBe(true);
  });

  it('第三根手指被忽略', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(200, 200));
    c.pointerDown(2, at(300, 200));
    c.pointerDown(3, at(250, 250));
    c.pointerMove(3, at(260, 260));
    expect(log).toEqual([]);
  });

  it('放開一指後，剩下的手指接著平移且位置不跳動', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(200, 200));
    c.pointerDown(2, at(300, 200));
    c.pointerMove(2, at(320, 200)); // 剩下的手指 2 停在 (320,200)
    log.length = 0;
    c.pointerUp(1, at(200, 200));
    c.pointerMove(2, at(325, 203));
    expect(log).toEqual([['pan', 5, 3]]);
  });

  it('兩指幾乎重合時略過縮放，不產生 NaN 或 Infinity', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(200, 200));
    c.pointerDown(2, at(200, 200));
    c.pointerMove(2, at(210, 200));
    for (const e of log) {
      if (e[0] === 'zoom') expect(Number.isFinite(e[1])).toBe(true);
    }
    expect(log.some((e) => e[0] === 'pan')).toBe(true);
  });

  it('雙指中 pointercancel 其中一指：剩下的一指改為平移', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(200, 200));
    c.pointerDown(2, at(300, 200));
    c.pointerCancel(1);
    c.pointerMove(2, at(310, 200));
    expect(log).toEqual([['pan', 10, 0]]);
  });
});

describe('滾輪', () => {
  it('向上滾放大、向下滾縮小，正反互為倒數', () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(-100) * wheelZoomFactor(100)).toBeCloseTo(1);
    expect(wheelZoomFactor(-100)).toBeCloseTo(
      Math.exp(100 * WHEEL_SENSITIVITY),
    );
  });

  it('觸控板雙指縮放（ctrlKey）靈敏度更高', () => {
    expect(wheelZoomFactor(-5, true)).toBeCloseTo(
      Math.exp(5 * PINCH_WHEEL_SENSITIVITY),
    );
    expect(wheelZoomFactor(-5, true)).toBeGreaterThan(
      wheelZoomFactor(-5, false),
    );
  });

  it('以游標位置為縮放中心', () => {
    const { c, log } = setup();
    c.wheel(at(120, 80), -100);
    expect(log).toHaveLength(1);
    expect(log[0]![0]).toBe('zoom');
    expect(log[0]![2]).toEqual(at(120, 80));
  });

  it('deltaY 為 0 不產生事件', () => {
    const { c, log } = setup();
    c.wheel(at(0, 0), 0);
    expect(log).toEqual([]);
  });
});
