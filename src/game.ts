import type { Application } from 'pixi.js';
import { Board } from './core/board';
import {
  fitCamera,
  panBy,
  resizeCamera,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from './core/camera';
import type { Camera, CameraSetup } from './core/camera';
import { smoothTowards } from './core/ease';
import { polygonBounds } from './core/geometry';
import { computeLayout, regionAt } from './core/layout';
import type { Layout } from './core/layout';
import { loadLevel } from './core/level';
import { SaveStore, createSave, markSet } from './core/save';
import type { SaveData } from './core/save';
import { magnetPull } from './core/snap';
import type { Slot } from './core/snap';
import {
  cellRect,
  clampScroll,
  createTrayLayout,
  trayHit,
  trayPieceScale,
} from './core/tray';
import type { TrayLayout } from './core/tray';
import type { LevelData, Point } from './core/types';
import { GestureController } from './input/gesture';
import type { GestureContext, GestureHandlers } from './input/gesture';
import { SoundPlayer } from './audio/sound-player';
import { GameScene } from './render/scene';

/** 卡入與彈開動畫的時間（秒） */
const SETTLE_SECONDS = 0.12;
/** 玻璃片從托盤拖出時，縮放逼近盤面比例的速度（每秒） */
const DRAG_SCALE_RATE = 24;
/** 從托盤拉出的玻璃滑到手指正下方的速度（每秒） */
const DRAG_CENTER_RATE = 16;

interface DragState {
  id: string;
  /** 指標目前的螢幕位置 */
  pointer: Point;
  /** 抓取點相對於玻璃片形心，單位是玻璃片自己的座標（與縮放無關） */
  offset: Point;
  /** 目前顯示的縮放（螢幕像素 / 世界單位） */
  scale: number;
  /**
   * 從托盤拉出時為 true：玻璃一邊放大一邊滑到手指正下方（偏移逐漸歸零）。
   * 從主框拿起時為 false：保留抓取點，玻璃不會跳動。
   */
  centering: boolean;
}

/**
 * 把手勢、盤面狀態、渲染、音效與存檔接在一起。
 * 規則都在 `src/core`，這裡只負責「事件進來 → 更新狀態 → 更新畫面」。
 */
export class Game {
  readonly controller: GestureController;
  readonly level: LevelData;
  readonly board: Board;

  private readonly app: Application;
  private readonly levelId: string;
  private readonly sounds: SoundPlayer;
  private readonly store: SaveStore;
  private readonly scene: GameScene;
  private readonly slotById = new Map<string, Slot>();
  private readonly pieceIds: string[];
  /** 每片玻璃「外框中心 − 形心」（世界單位）。托盤要讓外框而不是形心對齊格子中心 */
  private readonly boundsOffset = new Map<string, Point>();

  private save: SaveData;
  private layout: Layout;
  private trayLayout: TrayLayout;
  private camera: Camera;
  private scroll = 0;
  private drag: DragState | null = null;

  static async create(
    app: Application,
    levelUrl: string,
    levelId: string,
    sounds: SoundPlayer,
    store: SaveStore = new SaveStore(),
  ): Promise<Game> {
    const level = await loadLevel(levelUrl);
    return new Game(app, level, levelId, sounds, store);
  }

  constructor(
    app: Application,
    level: LevelData,
    levelId: string,
    sounds: SoundPlayer,
    store: SaveStore,
  ) {
    this.app = app;
    this.level = level;
    this.levelId = levelId;
    this.sounds = sounds;
    this.store = store;
    this.pieceIds = level.pieces.map((p) => p.id);

    this.save = store.load(levelId, this.pieceIds) ?? createSave();
    this.board = new Board(level, this.save.traySeed, this.save.setIds);
    for (const slot of this.board.slots) this.slotById.set(slot.id, slot);
    for (const piece of level.pieces) {
      const b = polygonBounds(piece.polygon);
      this.boundsOffset.set(piece.id, {
        x: (b.minX + b.maxX) / 2 - piece.centroid.x,
        y: (b.minY + b.maxY) / 2 - piece.centroid.y,
      });
    }

    this.scene = new GameScene(app.stage, level);
    this.layout = computeLayout(app.screen);
    this.camera = fitCamera(this.cameraSetup());
    this.trayLayout = this.buildTrayLayout();
    this.scene.setCamera(this.camera);
    this.scene.setTrayRect(this.layout.tray);

    // 還原存檔：已鑲嵌的玻璃直接放在格子裡並發光，其餘留在托盤
    for (const id of this.board.setIds()) {
      const view = this.scene.view(id);
      const slot = this.slotById.get(id)!;
      this.scene.place(id, 'set');
      view.position.set(slot.center.x, slot.center.y);
      view.scale.set(1);
      view.setLit(1, true);
    }
    this.relayoutTray();

    app.renderer.on('resize', () => this.resize());
    this.controller = new GestureController(
      this.gestureContext(),
      this.handlers(),
    );
  }

  /** 每幀呼叫，`dt` 是秒 */
  update(dt: number): void {
    this.scene.update(dt);
    if (this.drag) {
      const d = this.drag;
      d.scale = smoothTowards(d.scale, this.camera.zoom, dt, DRAG_SCALE_RATE);
      if (d.centering) {
        d.offset.x = smoothTowards(d.offset.x, 0, dt, DRAG_CENTER_RATE);
        d.offset.y = smoothTowards(d.offset.y, 0, dt, DRAG_CENTER_RATE);
      }
      this.applyDrag();
    }
  }

  get complete(): boolean {
    return this.board.isComplete();
  }

  // ---------------------------------------------------------------- 版面與相機

  private cameraSetup(): CameraSetup {
    return {
      content: { width: this.level.width, height: this.level.height },
      viewport: this.layout.board,
    };
  }

  private buildTrayLayout(): TrayLayout {
    return createTrayLayout(
      this.board.trayIds(),
      this.layout.tray,
      this.layout.orientation,
    );
  }

  private resize(): void {
    const oldViewport = this.layout.board;
    this.layout = computeLayout(this.app.screen);
    this.camera = resizeCamera(this.camera, oldViewport, this.cameraSetup());
    this.scene.setCamera(this.camera);
    this.scene.setTrayRect(this.layout.tray);
    this.relayoutTray();
  }

  private applyCamera(): void {
    this.scene.setCamera(this.camera);
    this.relayoutTray(); // 托盤裡玻璃的縮放上限跟著相機縮放
  }

  /**
   * 依目前的托盤內容、捲動量與相機縮放，重新擺放托盤裡的玻璃。
   * `skip` 指定的玻璃片不動（它正在用動畫飛向自己的格子）。
   */
  private relayoutTray(skip?: string): void {
    this.trayLayout = this.buildTrayLayout();
    this.scroll = clampScroll(this.trayLayout, this.scroll);
    const tray = this.layout.tray;
    this.trayLayout.ids.forEach((id, index) => {
      if (id === skip) return;
      const view = this.scene.view(id);
      const r = cellRect(this.trayLayout, index, this.scroll);
      // 不在托盤可見範圍內的就不畫，省下大量玻璃片的 draw call
      view.visible =
        r.x < tray.x + tray.width &&
        r.x + r.width > tray.x &&
        r.y < tray.y + tray.height &&
        r.y + r.height > tray.y;
      if (this.scene.isTweening(id)) return;
      const t = this.trayTarget(id, index);
      view.position.set(t.x, t.y);
      view.scale.set(t.scale);
    });
  }

  private trayTarget(
    id: string,
    index: number,
  ): { x: number; y: number; scale: number } {
    const r = cellRect(this.trayLayout, index, this.scroll);
    const scale = trayPieceScale(
      this.slotById.get(id)!.size,
      this.trayLayout,
      this.camera.zoom,
    );
    // 玻璃的原點是形心，但形狀歪的玻璃形心不在外框中央；
    // 位移補償讓外框中心對齊格子中心，才不會偏出格子或蓋到鄰居
    const o = this.boundsOffset.get(id)!;
    return {
      x: r.x + r.width / 2 - o.x * scale,
      y: r.y + r.height / 2 - o.y * scale,
      scale,
    };
  }

  // ---------------------------------------------------------------- 手勢

  private gestureContext(): GestureContext {
    return {
      regionAt: (p) => regionAt(this.layout, p),
      hitTest: (p) => {
        const region = regionAt(this.layout, p);
        if (region === 'tray') return trayHit(this.trayLayout, this.scroll, p);
        if (region === 'board') {
          return this.board.hitTestBoard(screenToWorld(this.camera, p));
        }
        return null;
      },
      trayAxis: () => (this.layout.orientation === 'landscape' ? 'y' : 'x'),
    };
  }

  private handlers(): GestureHandlers {
    return {
      onPieceDragStart: (id, screen, fromTray) =>
        this.startDrag(id, screen, fromTray),
      onPieceDrag: (_id, screen) => {
        if (!this.drag) return;
        this.drag.pointer = screen;
        this.applyDrag();
      },
      onPieceDrop: (id, screen) => this.drop(id, screen),
      onPieceDragCancel: (id) => this.cancelDrag(id),
      onPan: (dx, dy) => {
        this.camera = panBy(this.camera, dx, dy, this.cameraSetup());
        this.scene.setCamera(this.camera);
      },
      onZoom: (factor, anchor) => {
        this.camera = zoomAt(this.camera, factor, anchor, this.cameraSetup());
        this.applyCamera();
      },
      onTrayScroll: (delta) => {
        this.scroll = clampScroll(this.trayLayout, this.scroll + delta);
        this.relayoutTray();
      },
    };
  }

  // ---------------------------------------------------------------- 拖曳

  private startDrag(id: string, pointer: Point, fromTray: boolean): void {
    const view = this.scene.view(id);
    // 先記下拿起前的螢幕位置與縮放，再換圖層
    let center: Point;
    let scale: number;
    if (fromTray) {
      center = { x: view.x, y: view.y };
      scale = view.scale.x;
    } else {
      const loc = this.board.locationOf(id);
      if (loc.kind !== 'board') throw new Error(`玻璃片「${id}」不在主框上`);
      center = worldToScreen(this.camera, loc.pos);
      scale = this.camera.zoom;
    }

    this.board.startDrag(id);
    this.scene.cancelTween(id);
    this.scene.place(id, 'drag');
    view.visible = true;
    view.position.set(center.x, center.y);
    view.scale.set(scale);
    this.drag = {
      id,
      pointer,
      offset: {
        x: (pointer.x - center.x) / scale,
        y: (pointer.y - center.y) / scale,
      },
      scale,
      centering: fromTray,
    };
    this.sounds.play('pickup');
    if (fromTray) this.relayoutTray(); // 托盤補上空出來的格子
  }

  /** 指標位置扣掉抓取偏移 = 玻璃片形心的螢幕位置（未經磁吸） */
  private dragCenter(d: DragState): Point {
    return {
      x: d.pointer.x - d.offset.x * d.scale,
      y: d.pointer.y - d.offset.y * d.scale,
    };
  }

  /** 拖曳中把玻璃片擺到指標下，靠近自己的格子時顯示被磁吸拉過去的位置 */
  private applyDrag(): void {
    const d = this.drag;
    if (!d) return;
    const view = this.scene.view(d.id);
    const raw = this.dragCenter(d);
    const pulled = magnetPull(
      screenToWorld(this.camera, raw),
      this.slotById.get(d.id)!,
    );
    const shown = worldToScreen(this.camera, pulled);
    view.position.set(shown.x, shown.y);
    view.scale.set(d.scale);
  }

  private drop(id: string, pointer: Point): void {
    const d = this.drag;
    if (!d || d.id !== id) return;
    d.pointer = pointer;
    this.drag = null;
    const view = this.scene.view(id);

    if (regionAt(this.layout, pointer) === 'tray') {
      this.board.returnToTray(id);
      this.scene.place(id, 'tray');
      this.relayoutTray(id);
      const index = this.trayLayout.ids.indexOf(id);
      this.scene.tween(id, this.trayTarget(id, index), SETTLE_SECONDS);
      return;
    }

    // 判定用的是手指決定的位置，不是被磁吸拉過去的顯示位置
    const world = screenToWorld(this.camera, this.dragCenter(d));
    const result = this.board.drop(id, world);

    this.scene.place(id, result.kind === 'set' ? 'set' : 'loose');
    view.position.set(world.x, world.y);
    view.scale.set(1);

    if (result.kind === 'set') {
      view.setLit(1);
      this.scene.tween(
        id,
        { x: result.position.x, y: result.position.y, scale: 1 },
        SETTLE_SECONDS,
      );
      this.sounds.play('set');
      this.save = markSet(this.save, id, this.pieceIds);
      this.store.save(this.levelId, this.save);
    } else if (result.kind === 'wrong') {
      this.scene.tween(
        id,
        { x: result.position.x, y: result.position.y, scale: 1 },
        SETTLE_SECONDS,
      );
      this.sounds.play('wrong');
    }
  }

  private cancelDrag(id: string): void {
    const d = this.drag;
    if (!d || d.id !== id) return;
    this.drag = null;
    this.board.cancelDrag();
    const view = this.scene.view(id);
    const loc = this.board.locationOf(id);
    if (loc.kind === 'board') {
      this.scene.place(id, 'loose');
      view.position.set(loc.pos.x, loc.pos.y);
      view.scale.set(1);
    } else {
      this.scene.place(id, 'tray');
      this.relayoutTray(id);
      const index = this.trayLayout.ids.indexOf(id);
      this.scene.tween(id, this.trayTarget(id, index), SETTLE_SECONDS);
    }
  }
}
