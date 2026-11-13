import type { Point, Rect, Size } from './types';

/**
 * 相機：世界座標（關卡座標）與螢幕座標（相對於畫布左上角的像素）的轉換。
 * 轉換式：screen = world × zoom + (x, y)
 *
 * 所有函式都是純函式，回傳新的 Camera，不修改傳入的物件。
 */
export interface Camera {
  zoom: number;
  /** 世界座標 (0,0) 在螢幕上的位置 */
  x: number;
  y: number;
}

export interface CameraConfig {
  /** 最小縮放 = 「剛好放進視窗」的縮放 × 此倍率 */
  minZoomRatio: number;
  /** 最大縮放 = 「剛好放進視窗」的縮放 × 此倍率 */
  maxZoomRatio: number;
  /** 平移時，關卡至少要有這個比例的視窗寬（高）留在視窗內，避免整張關卡被拖出畫面 */
  minVisibleRatio: number;
  /** 「剛好放進視窗」時四周保留的邊距，佔視窗尺寸的比例 */
  fitMargin: number;
}

export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  minZoomRatio: 0.5,
  maxZoomRatio: 8,
  minVisibleRatio: 0.25,
  fitMargin: 0.05,
};

/**
 * 相機的作用範圍。
 * - `content`：關卡的世界座標尺寸（`LevelData` 的 width / height）
 * - `viewport`：主拼圖框在螢幕上的矩形（版面切換時會改變，不一定等於整個畫布）
 */
export interface CameraSetup {
  content: Size;
  viewport: Rect;
  config?: CameraConfig;
}

function validate({ content, viewport }: CameraSetup): void {
  if (!(content.width > 0 && content.height > 0)) {
    throw new Error('關卡尺寸必須大於 0');
  }
  if (!(viewport.width > 0 && viewport.height > 0)) {
    throw new Error('視窗尺寸必須大於 0');
  }
}

/** 剛好把整個關卡放進視窗（含邊距）的縮放倍率 */
export function fitZoom(setup: CameraSetup): number {
  validate(setup);
  const { content, viewport } = setup;
  const margin = (setup.config ?? DEFAULT_CAMERA_CONFIG).fitMargin;
  const usable = 1 - 2 * margin;
  return Math.min(
    (viewport.width * usable) / content.width,
    (viewport.height * usable) / content.height,
  );
}

/** 縮放範圍 */
export function zoomLimits(setup: CameraSetup): { min: number; max: number } {
  const config = setup.config ?? DEFAULT_CAMERA_CONFIG;
  const fit = fitZoom(setup);
  return { min: fit * config.minZoomRatio, max: fit * config.maxZoomRatio };
}

/** 把整個關卡放進視窗並置中 */
export function fitCamera(setup: CameraSetup): Camera {
  const zoom = fitZoom(setup);
  const { content, viewport } = setup;
  return {
    zoom,
    x: viewport.x + (viewport.width - content.width * zoom) / 2,
    y: viewport.y + (viewport.height - content.height * zoom) / 2,
  };
}

export function screenToWorld(camera: Camera, screen: Point): Point {
  return {
    x: (screen.x - camera.x) / camera.zoom,
    y: (screen.y - camera.y) / camera.zoom,
  };
}

export function worldToScreen(camera: Camera, world: Point): Point {
  return {
    x: world.x * camera.zoom + camera.x,
    y: world.y * camera.zoom + camera.y,
  };
}

/** 單軸：讓關卡至少有 need 的長度留在視窗內時，偏移量的合法範圍 */
function clampAxis(
  offset: number,
  viewStart: number,
  viewLength: number,
  contentLength: number,
  ratio: number,
): number {
  const need = Math.min(viewLength * ratio, contentLength);
  const lo = viewStart + need - contentLength;
  const hi = viewStart + viewLength - need;
  return Math.min(Math.max(offset, lo), hi);
}

/** 限制縮放範圍與平移範圍，不讓整張關卡離開視窗 */
export function clampCamera(camera: Camera, setup: CameraSetup): Camera {
  const config = setup.config ?? DEFAULT_CAMERA_CONFIG;
  const { min, max } = zoomLimits(setup);
  const zoom = Math.min(Math.max(camera.zoom, min), max);
  const { content, viewport } = setup;
  return {
    zoom,
    x: clampAxis(
      camera.x,
      viewport.x,
      viewport.width,
      content.width * zoom,
      config.minVisibleRatio,
    ),
    y: clampAxis(
      camera.y,
      viewport.y,
      viewport.height,
      content.height * zoom,
      config.minVisibleRatio,
    ),
  };
}

/** 平移 dx、dy 個螢幕像素 */
export function panBy(
  camera: Camera,
  dx: number,
  dy: number,
  setup: CameraSetup,
): Camera {
  return clampCamera({ ...camera, x: camera.x + dx, y: camera.y + dy }, setup);
}

/**
 * 以螢幕座標 `anchor` 為中心縮放：anchor 底下的世界座標點在縮放前後
 * 會停在螢幕上同一個位置（受縮放範圍與平移範圍限制時除外）。
 */
export function zoomAt(
  camera: Camera,
  factor: number,
  anchor: Point,
  setup: CameraSetup,
): Camera {
  const { min, max } = zoomLimits(setup);
  const zoom = Math.min(Math.max(camera.zoom * factor, min), max);
  const actual = zoom / camera.zoom;
  return clampCamera(
    {
      zoom,
      x: anchor.x - (anchor.x - camera.x) * actual,
      y: anchor.y - (anchor.y - camera.y) * actual,
    },
    setup,
  );
}

/**
 * 視窗改變（旋轉裝置、改變視窗大小、切換橫直向版面）時調整相機：
 * 保持「視窗中心看到的世界座標點」不變，並維持相對於「剛好放進視窗」的縮放比例。
 * `content` 與 `config` 取自新的 setup。
 */
export function resizeCamera(
  camera: Camera,
  oldViewport: Rect,
  next: CameraSetup,
): Camera {
  const oldSetup: CameraSetup = { ...next, viewport: oldViewport };
  const relative = camera.zoom / fitZoom(oldSetup);
  const zoom = relative * fitZoom(next);

  const oldCenter = {
    x: oldViewport.x + oldViewport.width / 2,
    y: oldViewport.y + oldViewport.height / 2,
  };
  const world = screenToWorld(camera, oldCenter);
  const { viewport } = next;
  return clampCamera(
    {
      zoom,
      x: viewport.x + viewport.width / 2 - world.x * zoom,
      y: viewport.y + viewport.height / 2 - world.y * zoom,
    },
    next,
  );
}
