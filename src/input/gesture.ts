import type { Point } from '../core/types';

/**
 * 手勢狀態機。不依賴 DOM，輸入是「指標按下 / 移動 / 放開」的純資料，
 * 座標一律是螢幕座標（相對於畫布左上角）。DOM 事件的轉接見 `bind.ts`。
 *
 * 規則見 docs/MVP-spec.md「手勢」：
 * - 主框：單指（或滑鼠左鍵）按在玻璃片上拖曳該玻璃片；按在空白處平移畫面；
 *   雙指縮放加平移；滑鼠滾輪縮放
 * - 托盤：空白處沿捲動方向滑動是捲動托盤；按在玻璃片上，沿捲動方向滑是捲動托盤，
 *   垂直於捲動方向滑才是把玻璃拉出來；滾輪是捲動托盤
 */
export interface GestureHandlers {
  /**
   * 開始拖曳玻璃片（可在這裡播放拾起音效）。`screen` 是指標目前的螢幕位置。
   * 主框的玻璃片在按下時立即開始；托盤的玻璃片要等到手指垂直於捲動方向移動
   * 超過門檻才開始，此時 `fromTray` 為 true。
   */
  onPieceDragStart(pieceId: string, screen: Point, fromTray: boolean): void;
  /** 拖曳中，`screen` 是指標目前的螢幕位置 */
  onPieceDrag(pieceId: string, screen: Point): void;
  /** 放開玻璃片 */
  onPieceDrop(pieceId: string, screen: Point): void;
  /** 拖曳被中斷（pointercancel、視窗失焦等），玻璃片應留在原地或回到拖曳前 */
  onPieceDragCancel(pieceId: string): void;
  /** 畫面平移，單位是螢幕像素 */
  onPan(dx: number, dy: number): void;
  /**
   * 畫面縮放：以 `anchor`（螢幕座標）為中心，把目前的縮放乘上 `factor`。
   * 雙指時會先以「上一刻的雙指中點」縮放，再用 onPan 補上中點的位移，
   * 因此只要依序套用，兩指原本按住的世界座標點會一直跟著手指走。
   */
  onZoom(factor: number, anchor: Point): void;
  /**
   * 托盤捲動：`delta` 是要「加到捲動量上」的像素值（呼叫端再用 `clampScroll` 限制範圍）。
   * 手指往捲動方向的反向拖，內容跟著手指走，所以 delta 為手指位移的負值；
   * 滾輪則直接使用滾輪的 delta。
   */
  onTrayScroll(delta: number): void;
}

/** 托盤的捲動軸：橫向版面（托盤在右側）是 'y'，直向版面（托盤在底部）是 'x' */
export type TrayAxis = 'x' | 'y';

/**
 * 手勢需要知道的版面資訊。版面會隨視窗大小改變，所以都用函式，每次按下時才查詢。
 */
export interface GestureContext {
  /** 螢幕座標落在哪個區域（可直接用 `regionAt(layout, p)`）*/
  regionAt(screen: Point): 'board' | 'tray' | null;
  /**
   * 找出螢幕座標上的玻璃片 id，沒有則回傳 null。主框與托盤都由這個函式負責，
   * 控制器會依 `regionAt` 判斷意義。已鑲嵌（鎖死）的玻璃片請回傳 null，
   * 這樣按在上面會變成平移畫面。
   */
  hitTest(screen: Point): string | null;
  /** 托盤目前的捲動軸 */
  trayAxis(): TrayAxis;
}

export interface GestureOptions {
  /** 按在托盤玻璃片上時，手指移動超過這個距離（像素）才判斷是捲動還是拉出玻璃 */
  traySlop?: number;
}

export const DEFAULT_TRAY_SLOP = 8;

interface Tracked {
  id: number;
  pos: Point;
}

type State =
  | { kind: 'idle' }
  | { kind: 'piece'; pointerId: number; pieceId: string }
  | { kind: 'pan'; pointer: Tracked }
  | { kind: 'pinch'; a: Tracked; b: Tracked }
  /** 按在托盤的玻璃片上，還沒移動夠遠，不確定是捲動還是拉出 */
  | { kind: 'trayPending'; pointer: Tracked; origin: Point; pieceId: string }
  | { kind: 'trayScroll'; pointer: Tracked };

const EPSILON = 1e-9;

const distance = (a: Point, b: Point): number =>
  Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

/** 一般滑鼠滾輪的縮放靈敏度（每像素 deltaY） */
export const WHEEL_SENSITIVITY = 0.0015;
/** 觸控板雙指縮放（瀏覽器以 ctrlKey + wheel 回報）的 deltaY 很小，靈敏度要高很多 */
export const PINCH_WHEEL_SENSITIVITY = 0.01;

/** 滾輪 deltaY（像素）換算成縮放倍率：向上滾（deltaY < 0）放大，向下滾縮小，且正反互為倒數 */
export function wheelZoomFactor(deltaY: number, ctrlKey = false): number {
  const sensitivity = ctrlKey ? PINCH_WHEEL_SENSITIVITY : WHEEL_SENSITIVITY;
  return Math.exp(-deltaY * sensitivity);
}

export class GestureController {
  private state: State = { kind: 'idle' };
  private readonly context: GestureContext;
  private readonly handlers: GestureHandlers;
  private readonly traySlop: number;

  constructor(
    context: GestureContext,
    handlers: GestureHandlers,
    options: GestureOptions = {},
  ) {
    this.context = context;
    this.handlers = handlers;
    this.traySlop = options.traySlop ?? DEFAULT_TRAY_SLOP;
  }

  /** 沿捲動軸的分量與垂直分量 */
  private split(dx: number, dy: number): { along: number; cross: number } {
    return this.context.trayAxis() === 'y'
      ? { along: dy, cross: dx }
      : { along: dx, cross: dy };
  }

  pointerDown(id: number, pos: Point): void {
    const s = this.state;
    switch (s.kind) {
      case 'idle': {
        const pieceId = this.context.hitTest(pos);
        if (this.context.regionAt(pos) === 'tray') {
          this.state =
            pieceId === null
              ? { kind: 'trayScroll', pointer: { id, pos } }
              : {
                  kind: 'trayPending',
                  pointer: { id, pos },
                  origin: pos,
                  pieceId,
                };
        } else if (pieceId !== null) {
          this.state = { kind: 'piece', pointerId: id, pieceId };
          this.handlers.onPieceDragStart(pieceId, pos, false);
        } else {
          this.state = { kind: 'pan', pointer: { id, pos } };
        }
        return;
      }
      case 'pan':
        if (s.pointer.id === id) return;
        // 第二根手指落下（不論是否按在玻璃片上）：改為雙指縮放
        this.state = { kind: 'pinch', a: s.pointer, b: { id, pos } };
        return;
      case 'piece':
      case 'pinch':
      case 'trayPending':
      case 'trayScroll':
        // 進行中的手勢多出來的手指：忽略，避免誤觸
        return;
    }
  }

  pointerMove(id: number, pos: Point): void {
    const s = this.state;
    switch (s.kind) {
      case 'piece':
        if (s.pointerId === id) this.handlers.onPieceDrag(s.pieceId, pos);
        return;
      case 'pan': {
        if (s.pointer.id !== id) return;
        const dx = pos.x - s.pointer.pos.x;
        const dy = pos.y - s.pointer.pos.y;
        s.pointer.pos = pos;
        if (dx !== 0 || dy !== 0) this.handlers.onPan(dx, dy);
        return;
      }
      case 'pinch': {
        const moved = s.a.id === id ? s.a : s.b.id === id ? s.b : null;
        if (!moved) return;
        const prevMid = midpoint(s.a.pos, s.b.pos);
        const prevDist = distance(s.a.pos, s.b.pos);
        moved.pos = pos;
        const mid = midpoint(s.a.pos, s.b.pos);
        const dist = distance(s.a.pos, s.b.pos);

        // 兩指幾乎重合時距離不穩定，略過縮放只做平移
        if (prevDist > EPSILON) {
          const factor = dist / prevDist;
          if (Math.abs(factor - 1) > EPSILON)
            this.handlers.onZoom(factor, prevMid);
        }
        const dx = mid.x - prevMid.x;
        const dy = mid.y - prevMid.y;
        if (dx !== 0 || dy !== 0) this.handlers.onPan(dx, dy);
        return;
      }
      case 'trayPending': {
        if (s.pointer.id !== id) return;
        const dx = pos.x - s.origin.x;
        const dy = pos.y - s.origin.y;
        if (Math.hypot(dx, dy) < this.traySlop) return;
        const { along, cross } = this.split(dx, dy);
        if (Math.abs(cross) > Math.abs(along)) {
          // 垂直於捲動方向：把玻璃拉出托盤（剛好 45 度時偏向捲動）
          this.state = { kind: 'piece', pointerId: id, pieceId: s.pieceId };
          this.handlers.onPieceDragStart(s.pieceId, pos, true);
        } else {
          // 沿捲動方向：捲動托盤，位移從按下的位置算起，內容不會在判定瞬間跳一下
          this.state = { kind: 'trayScroll', pointer: { id, pos } };
          this.handlers.onTrayScroll(-along);
        }
        return;
      }
      case 'trayScroll': {
        if (s.pointer.id !== id) return;
        const { along } = this.split(
          pos.x - s.pointer.pos.x,
          pos.y - s.pointer.pos.y,
        );
        s.pointer.pos = pos;
        if (along !== 0) this.handlers.onTrayScroll(-along);
        return;
      }
      case 'idle':
        return;
    }
  }

  pointerUp(id: number, pos: Point): void {
    const s = this.state;
    switch (s.kind) {
      case 'piece':
        if (s.pointerId !== id) return;
        this.state = { kind: 'idle' };
        this.handlers.onPieceDrop(s.pieceId, pos);
        return;
      case 'pan':
      case 'trayPending':
      case 'trayScroll':
        // 托盤上的「點一下」（還沒決定就放開）不做任何事
        if (s.pointer.id === id) this.state = { kind: 'idle' };
        return;
      case 'pinch': {
        const remaining = s.a.id === id ? s.b : s.b.id === id ? s.a : null;
        if (!remaining) return;
        // 剩下的那根手指接著平移；位置沿用它自己的最後位置，所以不會跳動
        this.state = { kind: 'pan', pointer: remaining };
        return;
      }
      case 'idle':
        return;
    }
  }

  /** 瀏覽器取消了指標（來電、系統手勢等）。拖曳中的玻璃會收到 onPieceDragCancel */
  pointerCancel(id: number): void {
    const s = this.state;
    switch (s.kind) {
      case 'piece':
        if (s.pointerId === id) this.cancel();
        return;
      case 'pan':
      case 'trayPending':
      case 'trayScroll':
        if (s.pointer.id === id) this.state = { kind: 'idle' };
        return;
      case 'pinch':
        this.pointerUp(id, { x: 0, y: 0 });
        return;
      case 'idle':
        return;
    }
  }

  /** 中斷目前所有手勢（例如視窗失焦、頁面隱藏） */
  cancel(): void {
    const s = this.state;
    this.state = { kind: 'idle' };
    if (s.kind === 'piece') this.handlers.onPieceDragCancel(s.pieceId);
  }

  /**
   * 滑鼠滾輪。在托盤上是捲動托盤，在主框是縮放。
   * `deltaX`、`deltaY` 需先換算成像素（見 `bind.ts`）。
   */
  wheel(pos: Point, deltaY: number, ctrlKey = false, deltaX = 0): void {
    if (this.context.regionAt(pos) === 'tray') {
      // 垂直托盤用 deltaY；水平托盤優先用 deltaX（橫向捲動的觸控板），沒有時用 deltaY（一般滾輪）
      const delta =
        this.context.trayAxis() === 'y'
          ? deltaY
          : deltaX !== 0
            ? deltaX
            : deltaY;
      if (delta !== 0) this.handlers.onTrayScroll(delta);
      return;
    }
    const factor = wheelZoomFactor(deltaY, ctrlKey);
    if (Math.abs(factor - 1) > EPSILON) this.handlers.onZoom(factor, pos);
  }
}
