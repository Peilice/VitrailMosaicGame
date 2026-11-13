import { BlurFilter, Container, FillGradient, Graphics } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters/advanced-bloom';
import type { Camera } from '../core/camera';
import { FINAL_FRAME, completionFrame } from '../core/completion';
import type { CompletionFrame } from '../core/completion';
import { hexToNumber } from '../core/color';
import { easeOutCubic } from '../core/ease';
import type { LevelData, Rect, Size } from '../core/types';
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

/** 陽光的顏色（偏暖的白） */
const SUNLIGHT = 'rgba(255, 244, 214, ';

/**
 * 場景圖：把盤面畫出來，不含任何遊戲規則。
 *
 * 圖層由下到上：
 * - world（套用相機）：背景倒影 → 空格底色 → 已鑲嵌的玻璃 → 鉛條 → 主框上未鑲嵌的玻璃
 * - 光帶（螢幕座標，完成動畫用）
 * - 托盤（螢幕座標）：底板 + 被裁切的玻璃片
 * - 拖曳層（螢幕座標）
 */
export class GameScene {
  readonly world = new Container();
  readonly views = new Map<string, PieceView>();
  /** 鉛條寬度（世界座標單位） */
  readonly cameWidth: number;

  private readonly level: LevelData;
  private readonly layers: Record<Layer, Container>;
  private readonly sweepLayer = new Container();
  private readonly trayPanel = new Graphics();
  private readonly trayMask = new Graphics();
  private tweens: Tween[] = [];
  private screen: Size = { width: 1, height: 1 };

  private reflection: Container | null = null;
  private bloom: AdvancedBloomFilter | null = null;
  private completion: {
    time: number;
    sweep: Graphics;
    onDone?: () => void;
  } | null = null;

  constructor(stage: Container, level: LevelData) {
    this.level = level;
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
    stage.addChild(this.world, this.sweepLayer, trayRoot, this.layers.drag);

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

  /** 畫面（畫布）尺寸，完成動畫的光帶要用它決定大小與掃過的範圍 */
  setScreen(size: Size): void {
    this.screen = size;
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

  // ---------------------------------------------------------------- bloom

  /**
   * 開關全域 bloom（亮的地方向外暈開一圈光）。
   * 只套用在盤面（world），托盤與拖曳層不受影響。
   * 吃效能，所以預設關閉，由遊戲依幀率偵測決定要不要開。
   */
  setBloom(enabled: boolean): void {
    if (enabled) {
      this.bloom ??= new AdvancedBloomFilter({
        threshold: 0.7,
        bloomScale: 0.4,
        brightness: 1,
        blur: 5,
        quality: 4,
      });
      this.world.filters = [this.bloom];
    } else {
      this.world.filters = [];
    }
  }

  get bloomEnabled(): boolean {
    return (this.world.filters?.length ?? 0) > 0;
  }

  // ---------------------------------------------------------------- 完成動畫

  /**
   * 播放完成動畫：玻璃閃亮、陽光掃過、背景浮現彩色倒影，結束後停在最終畫面。
   * 時間軸見 `core/completion.ts`。結束時呼叫 `onDone`。
   */
  playCompletion(onDone?: () => void): void {
    if (this.completion) return;
    this.ensureReflection();
    const sweep = this.createSweep();
    this.sweepLayer.addChild(sweep);
    this.completion = { time: 0, sweep, onDone };
    this.applyCompletion(completionFrame(0), sweep);
  }

  /** 直接顯示完成後的最終畫面，不播動畫（讀取已完成的存檔、或使用者偏好減少動態時） */
  showCompleted(): void {
    this.ensureReflection();
    this.applyCompletion(FINAL_FRAME, null);
  }

  /** 背景的彩色倒影：把每片玻璃的輪廓以原色填滿，偏移、放大、傾斜、模糊，投在窗框後面 */
  private ensureReflection(): Container {
    if (this.reflection) return this.reflection;
    const { width, height, pieces } = this.level;
    const container = new Container();
    for (const piece of pieces) {
      container.addChild(
        new Graphics()
          .poly(
            piece.polygon.flatMap((p) => [p.x, p.y]),
            true,
          )
          .fill(hexToNumber(piece.color)),
      );
    }
    // 陽光斜斜地穿過窗戶，倒影落在右下方，比窗戶本身稍大且被拉斜
    container.pivot.set(width / 2, height / 2);
    container.position.set(
      width / 2 + width * 0.06,
      height / 2 + height * 0.26,
    );
    container.scale.set(1.22);
    container.skew.set(-0.22, 0);
    container.filters = [
      new BlurFilter({ strength: 14, quality: 3, blendMode: 'add' }),
    ];
    container.alpha = 0;
    container.visible = false;
    this.world.addChildAt(container, 0);
    this.reflection = container;
    return container;
  }

  /** 一道由左向右掃過畫面的斜向光帶 */
  private createSweep(): Graphics {
    const w = Math.max(this.screen.width, this.screen.height) * 0.35;
    const h = (this.screen.width + this.screen.height) * 1.5;
    const gradient = new FillGradient({
      end: { x: 1, y: 0 },
      colorStops: [
        { offset: 0, color: `${SUNLIGHT}0)` },
        { offset: 0.5, color: `${SUNLIGHT}0.75)` },
        { offset: 1, color: `${SUNLIGHT}0)` },
      ],
    });
    const band = new Graphics().rect(-w / 2, -h / 2, w, h).fill(gradient);
    band.rotation = 0.35;
    band.blendMode = 'add';
    band.visible = false;
    return band;
  }

  private applyCompletion(
    frame: CompletionFrame,
    sweep: Graphics | null,
  ): void {
    for (const view of this.views.values()) view.setBoost(frame.boost);
    if (this.reflection) {
      this.reflection.alpha = frame.reflection;
      this.reflection.visible = frame.reflection > 0.001;
    }
    if (sweep) {
      sweep.visible = frame.sweep !== null;
      if (frame.sweep !== null) {
        const w = Math.max(this.screen.width, this.screen.height) * 0.35;
        const travel = this.screen.width + w * 2;
        sweep.position.set(-w + travel * frame.sweep, this.screen.height / 2);
      }
    }
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

    const c = this.completion;
    if (c) {
      c.time += dt;
      const frame = completionFrame(c.time);
      this.applyCompletion(frame, c.sweep);
      if (frame.done) {
        this.completion = null;
        c.sweep.destroy();
        c.onDone?.();
      }
    }
  }
}
