import { describe, expect, it } from 'vitest';
import type { Point } from '../core/types';
import {
  DEFAULT_TRAY_SLOP,
  GestureController,
  PINCH_WHEEL_SENSITIVITY,
  WHEEL_SENSITIVITY,
  wheelZoomFactor,
} from './gesture';
import type { TrayAxis } from './gesture';

type Event =
  | ['dragStart', string, Point, boolean]
  | ['drag', string, Point]
  | ['drop', string, Point]
  | ['cancel', string]
  | ['pan', number, number]
  | ['zoom', number, Point]
  | ['trayScroll', number];

/**
 * 假的版面：x >= 800 是托盤，其餘是主框。
 * 主框中 x < 100 的地方有一片玻璃 "p"；托盤中 y < 100 的地方有一片玻璃 "t"。
 */
function setup(
  options: { locked?: boolean; axis?: TrayAxis; slop?: number } = {},
): { c: GestureController; log: Event[]; hits: Point[] } {
  const log: Event[] = [];
  const hits: Point[] = [];
  const axis = options.axis ?? 'y';
  const inTray = (p: Point): boolean => p.x >= 800;
  const c = new GestureController(
    {
      regionAt: (p) => (inTray(p) ? 'tray' : 'board'),
      hitTest: (p) => {
        hits.push(p);
        if (inTray(p)) return p.y < 100 ? 't' : null;
        return !options.locked && p.x < 100 ? 'p' : null;
      },
      trayAxis: () => axis,
    },
    {
      onPieceDragStart: (id, s, fromTray) =>
        log.push(['dragStart', id, s, fromTray]),
      onPieceDrag: (id, s) => log.push(['drag', id, s]),
      onPieceDrop: (id, s) => log.push(['drop', id, s]),
      onPieceDragCancel: (id) => log.push(['cancel', id]),
      onPan: (dx, dy) => log.push(['pan', dx, dy]),
      onZoom: (f, a) => log.push(['zoom', f, a]),
      onTrayScroll: (d) => log.push(['trayScroll', d]),
    },
    options.slop === undefined ? {} : { traySlop: options.slop },
  );
  return { c, log, hits };
}

const at = (x: number, y: number): Point => ({ x, y });

describe('主框：單指平移與拖曳玻璃', () => {
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

  it('按在玻璃片上：立即開始拖曳（fromTray 為 false），移動與放開都帶位置', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(50, 50));
    c.pointerMove(1, at(60, 70));
    c.pointerUp(1, at(65, 75));
    expect(log).toEqual([
      ['dragStart', 'p', at(50, 50), false],
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
    const { c, log } = setup({ locked: true });
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
    expect(log).toEqual([['dragStart', 'p', at(50, 50), false]]);
  });

  it('區域為 null（畫面外）時視同主框', () => {
    const log: Event[] = [];
    const c = new GestureController(
      { regionAt: () => null, hitTest: () => null, trayAxis: () => 'y' },
      {
        onPieceDragStart: () => {},
        onPieceDrag: () => {},
        onPieceDrop: () => {},
        onPieceDragCancel: () => {},
        onPan: (dx, dy) => log.push(['pan', dx, dy]),
        onZoom: () => {},
        onTrayScroll: (d) => log.push(['trayScroll', d]),
      },
    );
    c.pointerDown(1, at(0, 0));
    c.pointerMove(1, at(5, 5));
    expect(log).toEqual([['pan', 5, 5]]);
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
      ['dragStart', 'p', at(50, 50), false],
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
      ['dragStart', 'p', at(50, 50), false],
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

describe('主框：雙指縮放加平移', () => {
  it('兩指拉開：以上一刻的中點為中心放大', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(200, 200));
    c.pointerDown(2, at(300, 200));
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

  it('兩指同向移動：累計只平移，縮放倍率回到 1', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(200, 200));
    c.pointerDown(2, at(300, 200));
    c.pointerMove(1, at(200, 210));
    c.pointerMove(2, at(300, 210));
    const panY = log
      .filter((e): e is ['pan', number, number] => e[0] === 'pan')
      .reduce((sum, e) => sum + e[2], 0);
    expect(panY).toBeCloseTo(10);
    const total = log
      .filter((e): e is ['zoom', number, Point] => e[0] === 'zoom')
      .reduce((p, e) => p * e[1], 1);
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
    c.pointerMove(2, at(320, 200));
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

describe('托盤：垂直捲動（橫向版面）', () => {
  it('按在空白處：立刻捲動，只看沿軸（y）的位移，方向與手指相反', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(900, 300)); // 托盤空白處
    c.pointerMove(1, at(905, 290)); // 往上 10、往右 5
    c.pointerMove(1, at(950, 290)); // 只有水平移動：沿軸位移為 0，不產生事件
    c.pointerMove(1, at(950, 310)); // 往下 20
    c.pointerUp(1, at(950, 310));
    expect(log).toEqual([
      ['trayScroll', 10],
      ['trayScroll', -20],
    ]);
  });

  it('按在玻璃上、移動不到門檻：什麼都不發生，放開也沒有任何事件', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(900, 50));
    c.pointerMove(1, at(903, 54));
    c.pointerUp(1, at(903, 54));
    expect(log).toEqual([]);
  });

  it('按在玻璃上、沿捲動方向滑：變成捲動，位移從按下位置起算', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(900, 50));
    c.pointerMove(1, at(902, 70)); // 往下 20（超過門檻）
    c.pointerMove(1, at(902, 85)); // 再往下 15
    expect(log).toEqual([
      ['trayScroll', -20],
      ['trayScroll', -15],
    ]);
  });

  it('按在玻璃上、垂直於捲動方向滑：把玻璃拉出托盤（fromTray 為 true）', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(900, 50));
    c.pointerMove(1, at(880, 54)); // 往左 20、往下 4
    c.pointerMove(1, at(700, 60));
    c.pointerUp(1, at(600, 60));
    expect(log).toEqual([
      ['dragStart', 't', at(880, 54), true],
      ['drag', 't', at(700, 60)],
      ['drop', 't', at(600, 60)],
    ]);
  });

  it('一旦決定為捲動，之後往垂直方向移動也不會變成拉出玻璃', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(900, 50));
    c.pointerMove(1, at(900, 70));
    c.pointerMove(1, at(600, 70));
    expect(log.some((e) => e[0] === 'dragStart')).toBe(false);
  });

  it('一旦決定為拉出，之後沿軸移動仍是拖曳玻璃，不會捲動', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(900, 50));
    c.pointerMove(1, at(870, 50));
    c.pointerMove(1, at(870, 400));
    expect(log.filter((e) => e[0] === 'trayScroll')).toEqual([]);
    expect(log[log.length - 1]).toEqual(['drag', 't', at(870, 400)]);
  });

  it('剛好 45 度：偏向捲動', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(900, 50));
    c.pointerMove(1, at(920, 70));
    expect(log).toEqual([['trayScroll', -20]]);
  });

  it('門檻可自訂，預設為 8 像素', () => {
    expect(DEFAULT_TRAY_SLOP).toBe(8);
    const small = setup({ slop: 2 });
    small.c.pointerDown(1, at(900, 50));
    small.c.pointerMove(1, at(896, 50));
    expect(small.log[0]![0]).toBe('dragStart');

    const normal = setup();
    normal.c.pointerDown(1, at(900, 50));
    normal.c.pointerMove(1, at(896, 50));
    expect(normal.log).toEqual([]);
  });

  it('托盤手勢中多出來的手指被忽略', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(900, 300));
    c.pointerDown(2, at(300, 300)); // 即使落在主框也忽略
    c.pointerMove(2, at(310, 300));
    c.pointerUp(2, at(310, 300));
    c.pointerMove(1, at(900, 290));
    expect(log).toEqual([['trayScroll', 10]]);
  });

  it('pointercancel：還沒決定或捲動中直接結束；拉出中收到 cancel', () => {
    const a = setup();
    a.c.pointerDown(1, at(900, 50));
    a.c.pointerCancel(1);
    a.c.pointerMove(1, at(900, 90));
    expect(a.log).toEqual([]);

    const b = setup();
    b.c.pointerDown(1, at(900, 50));
    b.c.pointerMove(1, at(870, 50));
    b.c.pointerCancel(1);
    expect(b.log[b.log.length - 1]).toEqual(['cancel', 't']);
  });

  it('cancel() 在還沒決定時不會產生事件，之後可重新開始', () => {
    const { c, log } = setup();
    c.pointerDown(1, at(900, 50));
    c.cancel();
    c.pointerMove(1, at(900, 90));
    expect(log).toEqual([]);
    c.pointerDown(2, at(50, 50));
    expect(log).toEqual([['dragStart', 'p', at(50, 50), false]]);
  });
});

describe('托盤：水平捲動（直向版面）', () => {
  it('沿水平方向滑是捲動，垂直方向滑才是拉出玻璃', () => {
    const scroll = setup({ axis: 'x' });
    scroll.c.pointerDown(1, at(900, 50));
    scroll.c.pointerMove(1, at(880, 52)); // 往左 20
    expect(scroll.log).toEqual([['trayScroll', 20]]);

    const pull = setup({ axis: 'x' });
    pull.c.pointerDown(1, at(900, 50));
    pull.c.pointerMove(1, at(902, 80)); // 往下 30
    expect(pull.log).toEqual([['dragStart', 't', at(902, 80), true]]);
  });

  it('按在空白處：只看水平位移', () => {
    const { c, log } = setup({ axis: 'x' });
    c.pointerDown(1, at(900, 300));
    c.pointerMove(1, at(900, 330));
    c.pointerMove(1, at(890, 330));
    expect(log).toEqual([['trayScroll', 10]]);
  });
});

describe('滾輪', () => {
  it('主框：向上滾放大、向下滾縮小，正反互為倒數', () => {
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

  it('主框：以游標位置為縮放中心', () => {
    const { c, log } = setup();
    c.wheel(at(120, 80), -100);
    expect(log).toHaveLength(1);
    expect(log[0]![0]).toBe('zoom');
    expect(log[0]![2]).toEqual(at(120, 80));
  });

  it('主框：deltaY 為 0 不產生事件', () => {
    const { c, log } = setup();
    c.wheel(at(0, 0), 0);
    expect(log).toEqual([]);
  });

  it('托盤：捲動而不縮放，delta 直接當作捲動量', () => {
    const { c, log } = setup();
    c.wheel(at(900, 200), 120);
    c.wheel(at(900, 200), -40, true); // ctrl 也只捲動
    expect(log).toEqual([
      ['trayScroll', 120],
      ['trayScroll', -40],
    ]);
  });

  it('水平托盤：有 deltaX 用 deltaX，沒有時用 deltaY', () => {
    const { c, log } = setup({ axis: 'x' });
    c.wheel(at(900, 200), 100, false, 30);
    c.wheel(at(900, 200), 100);
    expect(log).toEqual([
      ['trayScroll', 30],
      ['trayScroll', 100],
    ]);
  });

  it('托盤：delta 為 0 不產生事件', () => {
    const { c, log } = setup();
    c.wheel(at(900, 200), 0);
    expect(log).toEqual([]);
  });
});
