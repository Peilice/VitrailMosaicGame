import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAMERA_CONFIG,
  clampCamera,
  fitCamera,
  fitZoom,
  panBy,
  resizeCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
  zoomLimits,
} from './camera';
import type { CameraSetup } from './camera';

// 關卡 400×300，視窗 800×600（含 (0,0) 起點）。邊距 5% → 可用 720×540，縮放 min(1.8, 1.8)=1.8
const setup: CameraSetup = {
  content: { width: 400, height: 300 },
  viewport: { x: 0, y: 0, width: 800, height: 600 },
};

describe('fitCamera / fitZoom', () => {
  it('同樣長寬比：放大到填滿並保留邊距，且置中', () => {
    const cam = fitCamera(setup);
    expect(cam.zoom).toBeCloseTo(1.8);
    expect(cam.x).toBeCloseTo(40);
    expect(cam.y).toBeCloseTo(30);
  });

  it('視窗比關卡寬時，以高度為準，水平置中', () => {
    const wide: CameraSetup = {
      ...setup,
      viewport: { x: 0, y: 0, width: 2000, height: 600 },
    };
    const cam = fitCamera(wide);
    expect(cam.zoom).toBeCloseTo(1.8);
    expect(cam.x).toBeCloseTo((2000 - 400 * 1.8) / 2);
  });

  it('視窗比關卡窄時（直向手機），以寬度為準，垂直置中', () => {
    const tall: CameraSetup = {
      ...setup,
      viewport: { x: 0, y: 0, width: 360, height: 1000 },
    };
    const cam = fitCamera(tall);
    expect(cam.zoom).toBeCloseTo((360 * 0.9) / 400);
    expect(cam.y).toBeCloseTo((1000 - 300 * cam.zoom) / 2);
  });

  it('視窗不在畫布原點時（例如托盤佔掉一側），置中在視窗矩形內', () => {
    const offset: CameraSetup = {
      ...setup,
      viewport: { x: 200, y: 100, width: 800, height: 600 },
    };
    const cam = fitCamera(offset);
    expect(cam.x).toBeCloseTo(240);
    expect(cam.y).toBeCloseTo(130);
  });

  it('整個關卡的中心落在視窗中心', () => {
    const cam = fitCamera(setup);
    const c = worldToScreen(cam, { x: 200, y: 150 });
    expect(c.x).toBeCloseTo(400);
    expect(c.y).toBeCloseTo(300);
  });

  it('尺寸為 0 或負數時丟出錯誤', () => {
    expect(() =>
      fitZoom({ ...setup, content: { width: 0, height: 300 } }),
    ).toThrow('關卡');
    expect(() =>
      fitZoom({ ...setup, viewport: { x: 0, y: 0, width: 800, height: 0 } }),
    ).toThrow('視窗');
  });
});

describe('座標轉換', () => {
  it('worldToScreen 與 screenToWorld 互為反函數', () => {
    const cam = { zoom: 2.5, x: -30, y: 70 };
    const w = { x: 123.4, y: -56.7 };
    const back = screenToWorld(cam, worldToScreen(cam, w));
    expect(back.x).toBeCloseTo(w.x);
    expect(back.y).toBeCloseTo(w.y);
  });

  it('依公式 screen = world × zoom + offset', () => {
    expect(worldToScreen({ zoom: 2, x: 10, y: 20 }, { x: 5, y: 5 })).toEqual({
      x: 20,
      y: 30,
    });
    expect(screenToWorld({ zoom: 2, x: 10, y: 20 }, { x: 20, y: 30 })).toEqual({
      x: 5,
      y: 5,
    });
  });
});

describe('panBy', () => {
  it('在範圍內直接平移', () => {
    const cam = fitCamera(setup);
    const moved = panBy(cam, 15, -10, setup);
    expect(moved.x).toBeCloseTo(cam.x + 15);
    expect(moved.y).toBeCloseTo(cam.y - 10);
    expect(moved.zoom).toBe(cam.zoom);
  });

  it('不會把整張關卡拖出視窗：至少留下視窗寬（高）的 25%', () => {
    const cam = fitCamera(setup);
    const right = panBy(cam, 100000, 0, setup);
    // 關卡左緣最多只能到「視窗右緣 − 25% 視窗寬」
    expect(right.x).toBeCloseTo(800 - 0.25 * 800);
    const left = panBy(cam, -100000, 0, setup);
    // 關卡右緣至少要在「視窗左緣 + 25% 視窗寬」
    expect(left.x + 400 * cam.zoom).toBeCloseTo(0.25 * 800);
    const down = panBy(cam, 0, 100000, setup);
    expect(down.y).toBeCloseTo(600 - 0.25 * 600);
    const up = panBy(cam, 0, -100000, setup);
    expect(up.y + 300 * cam.zoom).toBeCloseTo(0.25 * 600);
  });

  it('不修改傳入的 camera', () => {
    const cam = fitCamera(setup);
    const copy = { ...cam };
    panBy(cam, 50, 50, setup);
    expect(cam).toEqual(copy);
  });
});

describe('zoomAt', () => {
  it('縮放中心底下的世界座標點保持不動', () => {
    const cam = fitCamera(setup);
    const anchor = { x: 300, y: 200 };
    const before = screenToWorld(cam, anchor);
    const zoomed = zoomAt(cam, 1.5, anchor, setup);
    const after = screenToWorld(zoomed, anchor);
    expect(zoomed.zoom).toBeCloseTo(cam.zoom * 1.5);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('放大再縮小同樣倍率可回到原狀', () => {
    const cam = fitCamera(setup);
    const anchor = { x: 500, y: 250 };
    const back = zoomAt(zoomAt(cam, 2, anchor, setup), 0.5, anchor, setup);
    expect(back.zoom).toBeCloseTo(cam.zoom);
    expect(back.x).toBeCloseTo(cam.x);
    expect(back.y).toBeCloseTo(cam.y);
  });

  it('縮放被限制在最小與最大之間', () => {
    const cam = fitCamera(setup);
    const { min, max } = zoomLimits(setup);
    expect(min).toBeCloseTo(cam.zoom * DEFAULT_CAMERA_CONFIG.minZoomRatio);
    expect(max).toBeCloseTo(cam.zoom * DEFAULT_CAMERA_CONFIG.maxZoomRatio);
    const anchor = { x: 400, y: 300 };
    expect(zoomAt(cam, 1000, anchor, setup).zoom).toBeCloseTo(max);
    expect(zoomAt(cam, 0.0001, anchor, setup).zoom).toBeCloseTo(min);
  });

  it('到達上限後再放大：位置也不會漂移', () => {
    const cam = fitCamera(setup);
    const anchor = { x: 123, y: 456 };
    const atMax = zoomAt(cam, 1000, anchor, setup);
    const again = zoomAt(atMax, 1.5, anchor, setup);
    expect(again).toEqual(atMax);
  });

  it('放大後的平移範圍同樣受限', () => {
    const cam = zoomAt(fitCamera(setup), 4, { x: 400, y: 300 }, setup);
    const far = panBy(cam, 1e6, 1e6, setup);
    expect(far.x).toBeCloseTo(800 - 0.25 * 800);
    expect(far.y).toBeCloseTo(600 - 0.25 * 600);
  });
});

describe('clampCamera', () => {
  it('合法的相機原樣回傳', () => {
    const cam = fitCamera(setup);
    const clamped = clampCamera(cam, setup);
    expect(clamped.zoom).toBeCloseTo(cam.zoom);
    expect(clamped.x).toBeCloseTo(cam.x);
    expect(clamped.y).toBeCloseTo(cam.y);
  });

  it('縮放與位置同時超出時都被拉回', () => {
    const clamped = clampCamera({ zoom: 1000, x: -1e9, y: 1e9 }, setup);
    expect(clamped.zoom).toBeCloseTo(zoomLimits(setup).max);
    expect(Number.isFinite(clamped.x)).toBe(true);
    expect(clamped.x).toBeGreaterThan(-1e6);
  });
});

describe('resizeCamera', () => {
  it('剛好放進視窗的相機，換視窗後仍然剛好放進視窗', () => {
    const next: CameraSetup = {
      ...setup,
      viewport: { x: 0, y: 0, width: 360, height: 640 },
    };
    const cam = resizeCamera(fitCamera(setup), setup.viewport, next);
    const expected = fitCamera(next);
    expect(cam.zoom).toBeCloseTo(expected.zoom);
    expect(cam.x).toBeCloseTo(expected.x);
    expect(cam.y).toBeCloseTo(expected.y);
  });

  it('保持視窗中心看到的世界點，並維持相對縮放比例', () => {
    // 先放大 3 倍、看著世界座標 (100, 80) 附近
    let cam = fitCamera(setup);
    cam = zoomAt(cam, 3, worldToScreen(cam, { x: 100, y: 80 }), setup);
    cam = panBy(
      cam,
      400 - worldToScreen(cam, { x: 100, y: 80 }).x,
      300 - worldToScreen(cam, { x: 100, y: 80 }).y,
      setup,
    );
    const center = screenToWorld(cam, { x: 400, y: 300 });
    const rel = cam.zoom / fitZoom(setup);

    const next: CameraSetup = {
      ...setup,
      viewport: { x: 0, y: 0, width: 1200, height: 500 },
    };
    const resized = resizeCamera(cam, setup.viewport, next);

    expect(resized.zoom / fitZoom(next)).toBeCloseTo(rel);
    const centerAfter = screenToWorld(resized, { x: 600, y: 250 });
    expect(centerAfter.x).toBeCloseTo(center.x);
    expect(centerAfter.y).toBeCloseTo(center.y);
  });

  it('視窗沒變時不改變相機', () => {
    const cam = zoomAt(fitCamera(setup), 2, { x: 400, y: 300 }, setup);
    const same = resizeCamera(cam, setup.viewport, setup);
    expect(same.zoom).toBeCloseTo(cam.zoom);
    expect(same.x).toBeCloseTo(cam.x);
    expect(same.y).toBeCloseTo(cam.y);
  });
});

describe('自訂設定', () => {
  it('可調整縮放範圍與邊距', () => {
    const custom: CameraSetup = {
      ...setup,
      config: {
        minZoomRatio: 1,
        maxZoomRatio: 2,
        minVisibleRatio: 0.5,
        fitMargin: 0,
      },
    };
    expect(fitZoom(custom)).toBeCloseTo(2);
    const { min, max } = zoomLimits(custom);
    expect(min).toBeCloseTo(2);
    expect(max).toBeCloseTo(4);
  });
});
