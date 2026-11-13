import { Container, Graphics } from 'pixi.js';
import type { Camera } from '../core/camera';
import { easeOutCubic } from '../core/ease';
import type { LevelData, Rect } from '../core/types';
import { createCame, createSlotFills, defaultCameWidth } from './came';
import { PieceView } from './piece-view';

/** 玻璃片所在的圖層 */
export type Layer =
  /** 托盤（螢幕座標，會被裁切到托盤矩形） */
  | 'tray'
  /** 主框上還沒鑲嵌的玻璃（世界座標，蓋在鉛條上面） */
  | 'loose'
  /** 已鑲嵌的玻璃（世界座標，鉛條蓋在它上面） */
  | 'set'
  /** 拖曳中（螢幕座標，在最上層） */
  | 'drag';

export interface TweenTarget {
  x: number;
  y: number;
  scale: number;
}

interface Tween {
  view: PieceView;
  from: TweenTarget;
  to: TweenTarget;
  elapsed: number;
  duration: number;
  onDone?: () => void;
}

/** 紋理的基準：整張關卡較長邊的範圍對應到這麼多 uv 單位 */
const TEXTURE_UNITS_ACROSS_LEVEL = 8;

const TRAY_PANEL_COLOR = 0x0e0e14;
const TRAY_BORDER_COLOR = 0x2a2a38;

/**
 * 場景圖：把盤面畫出來，不含任何遊戲規則。
 *
 * 圖層由下到上：
 * - world（套用相機）：空格底色 → 已鑲嵌的玻璃 → 鉛條 → 主框上未鑲嵌的玻璃
 * - 托盤（螢幕座標）：底板 + 被裁切的玻璃片
 * - 拖曳層（螢幕座標）
 */
export class GameScene {
  readonly world = new Container();
  readonly views = new Map<string, PieceView>();
  /** 鉛條寬度（世界座標單位） */
  readonly cameWidth: number;

  private readonly layers: Record<Layer, Container>;
  private readonly trayPanel = new Graphics();
  private readonly trayMask = new Graphics();
  private tweens: Tween[] = [];

  constructor(stage: Container, level: LevelData) {
    this.cameWidth = defaultCameWidth(level);
    const texScale =
      TEXTURE_UNITS_ACROSS_LEVEL / Math.max(level.width, level.height);

    this.layers = {
      tray: new Container(),
      loose: new Container(),
      set: new Container(),
      drag: new Container(),
    };

    this.world.addChild(
      createSlotFills(level),
      this.layers.set,
      createCame(level, this.cameWidth),
      this.layers.loose,
    );

    const trayRoot = new Container();
    trayRoot.addChild(this.trayPanel, this.layers.tray, this.trayMask);
    this.layers.tray.mask = this.trayMask;

    // 輸入由自己的手勢層處理，不需要 Pixi 的事件系統逐一檢查場景
    stage.eventMode = 'none';
    stage.addChild(this.world, trayRoot, this.layers.drag);

    for (const piece of level.pieces) {
      const view = new PieceView(piece, {
        texScale,
        glowWidth: this.cameWidth,
      });
      this.views.set(piece.id, view);
      this.layers.tray.addChild(view);
    }
  }

  view(id: string): PieceView {
    const view = this.views.get(id);
    if (!view) throw new Error(`找不到玻璃片「${id}」的畫面`);
    return view;
  }

  setCamera(camera: Camera): void {
    this.world.scale.set(camera.zoom);
    this.world.position.set(camera.x, camera.y);
  }

  /** 更新托盤底板與裁切範圍 */
  setTrayRect(rect: Rect): void {
    this.trayPanel
      .clear()
      .rect(rect.x, rect.y, rect.width, rect.height)
      .fill(TRAY_PANEL_COLOR)
      .rect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1)
      .stroke({ width: 1, color: TRAY_BORDER_COLOR });
    this.trayMask
      .clear()
      .rect(rect.x, rect.y, rect.width, rect.height)
      .fill(0xffffff);
  }

  /** 把玻璃片放到指定圖層（疊在該圖層最上面）。位置與縮放由呼叫端設定 */
  place(id: string, layer: Layer): void {
    this.layers[layer].addChild(this.view(id));
  }

  /** 讓玻璃片在 `duration` 秒內移動並縮放到目標；新的動畫會取代舊的 */
  tween(
    id: string,
    to: TweenTarget,
    duration: number,
    onDone?: () => void,
  ): void {
    this.cancelTween(id);
    const view = this.view(id);
    this.tweens.push({
      view,
      from: { x: view.x, y: view.y, scale: view.scale.x },
      to,
      elapsed: 0,
      duration,
      onDone,
    });
  }

  cancelTween(id: string): void {
    this.tweens = this.tweens.filter((t) => t.view.pieceId !== id);
  }

  isTweening(id: string): boolean {
    return this.tweens.some((t) => t.view.pieceId === id);
  }

  /** 每幀呼叫，`dt` 是秒 */
  update(dt: number): void {
    if (this.tweens.length > 0) {
      const finished: Tween[] = [];
      for (const t of this.tweens) {
        t.elapsed += dt;
        const k = t.duration <= 0 ? 1 : easeOutCubic(t.elapsed / t.duration);
        t.view.position.set(
          t.from.x + (t.to.x - t.from.x) * k,
          t.from.y + (t.to.y - t.from.y) * k,
        );
        t.view.scale.set(t.from.scale + (t.to.scale - t.from.scale) * k);
        if (t.elapsed >= t.duration) finished.push(t);
      }
      if (finished.length > 0) {
        this.tweens = this.tweens.filter((t) => !finished.includes(t));
        for (const t of finished) t.onDone?.();
      }
    }
    for (const view of this.views.values()) view.update(dt);
  }
}
