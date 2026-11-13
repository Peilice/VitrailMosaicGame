import type { Point } from '../core/types';

/**
 * 手勢狀態機。不依賴 DOM，輸入是「指標按下 / 移動 / 放開」的純資料，
 * 座標一律是螢幕座標（相對於畫布左上角）。DOM 事件的轉接見 `bind.ts`。
 *
 * 規則見 docs/MVP-spec.md「手勢」：
 * - 單指（或滑鼠左鍵）按在玻璃片上：拖曳該玻璃片
 * - 單指按在空白處：平移畫面
 * - 雙指：縮放加平移
 * - 滑鼠滾輪：縮放
 */
export interface GestureHandlers {
  /** 按下玻璃片，開始拖曳（可在這裡播放拾起音效） */
  onPieceDragStart(pieceId: string, screen: Point): void;
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
}

/**
 * 找出螢幕座標上的玻璃片 id，沒有則回傳 null。
 * 已鑲嵌（鎖死）的玻璃片請回傳 null，這樣按在上面會變成平移畫面。
 */
export type HitTest = (screen: Point) => string | null;

interface Tracked {
  id: number;
  pos: Point;
}

type State =
  | { kind: 'idle' }
  | { kind: 'piece'; pointerId: number; pieceId: string }
  | { kind: 'pan'; pointer: Tracked }
  | { kind: 'pinch'; a: Tracked; b: Tracked };

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
  private readonly hitTest: HitTest;
  private readonly handlers: GestureHandlers;

  constructor(hitTest: HitTest, handlers: GestureHandlers) {
    this.hitTest = hitTest;
    this.handlers = handlers;
  }

  pointerDown(id: number, pos: Point): void {
    const s = this.state;
    switch (s.kind) {
      case 'idle': {
        const pieceId = this.hitTest(pos);
        if (pieceId !== null) {
          this.state = { kind: 'piece', pointerId: id, pieceId };
          this.handlers.onPieceDragStart(pieceId, pos);
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
        // 拖曳玻璃片時多出來的手指、或已有兩指時的第三指：忽略，避免誤觸
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

  /** 瀏覽器取消了指標（來電、系統手勢等）。拖曳中的玻璃片會收到 onPieceDragCancel */
  pointerCancel(id: number): void {
    const s = this.state;
    switch (s.kind) {
      case 'piece':
        if (s.pointerId === id) this.cancel();
        return;
      case 'pan':
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

  /** 滑鼠滾輪縮放。`deltaY` 需先換算成像素（見 `bind.ts`） */
  wheel(pos: Point, deltaY: number, ctrlKey = false): void {
    const factor = wheelZoomFactor(deltaY, ctrlKey);
    if (Math.abs(factor - 1) > EPSILON) this.handlers.onZoom(factor, pos);
  }
}
