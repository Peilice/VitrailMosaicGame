import { pointInPolygon } from './geometry';
import { DEFAULT_SNAP_CONFIG, buildSlots, resolveDrop } from './snap';
import type { DropResult, Slot, SnapConfig } from './snap';
import { seededShuffle } from './tray';
import type { LevelData, PieceData, Point } from './types';

/** 一片玻璃目前在哪裡 */
export type PieceLocation =
  /** 在托盤裡 */
  | { kind: 'tray' }
  /** 放在主框上、還沒鑲嵌；pos 是玻璃片形心的世界座標 */
  | { kind: 'board'; pos: Point }
  /** 已鑲嵌，鎖死在自己的格子 */
  | { kind: 'set' };

/**
 * 盤面狀態：每片玻璃在托盤、主框或已鑲嵌，主框上的疊放順序，以及拖曳狀態。
 * 純邏輯，不依賴渲染；渲染層只負責把這個狀態畫出來。
 */
export class Board {
  readonly level: LevelData;
  readonly slots: readonly Slot[];

  private readonly pieces = new Map<string, PieceData>();
  private readonly locations = new Map<string, PieceLocation>();
  /** 全部玻璃片依種子決定的托盤順序 */
  private readonly trayOrder: readonly string[];
  /** 主框上的玻璃片，由下（最早）到上（最晚）的疊放順序 */
  private boardOrder: string[] = [];
  private setOrder: string[] = [];
  private drag: { id: string; from: PieceLocation } | null = null;
  private readonly snapConfig: SnapConfig;

  constructor(
    level: LevelData,
    traySeed: number,
    setIds: readonly string[] = [],
    snapConfig: SnapConfig = DEFAULT_SNAP_CONFIG,
  ) {
    this.level = level;
    this.snapConfig = snapConfig;
    this.slots = buildSlots(level.pieces, snapConfig);
    for (const piece of level.pieces) {
      this.pieces.set(piece.id, piece);
      this.locations.set(piece.id, { kind: 'tray' });
    }
    this.trayOrder = seededShuffle(
      level.pieces.map((p) => p.id),
      traySeed,
    );
    for (const id of setIds) {
      this.piece(id);
      if (this.locations.get(id)!.kind === 'set') continue;
      this.locations.set(id, { kind: 'set' });
      this.setOrder.push(id);
    }
  }

  private piece(id: string): PieceData {
    const piece = this.pieces.get(id);
    if (!piece) throw new Error(`找不到玻璃片「${id}」`);
    return piece;
  }

  locationOf(id: string): PieceLocation {
    this.piece(id);
    return this.locations.get(id)!;
  }

  /** 目前在托盤裡的玻璃片，依托盤順序（拖曳中的不算） */
  trayIds(): string[] {
    return this.trayOrder.filter(
      (id) => id !== this.drag?.id && this.locations.get(id)!.kind === 'tray',
    );
  }

  /** 主框上還沒鑲嵌的玻璃片，由下到上（拖曳中的不算） */
  boardIds(): readonly string[] {
    return this.boardOrder;
  }

  /** 已鑲嵌的玻璃片，依鑲嵌順序 */
  setIds(): readonly string[] {
    return this.setOrder;
  }

  get draggingId(): string | null {
    return this.drag?.id ?? null;
  }

  get setCount(): number {
    return this.setOrder.length;
  }

  isComplete(): boolean {
    return this.setOrder.length === this.pieces.size;
  }

  /**
   * 世界座標上最上面的、可以拿起的玻璃片（主框上未鑲嵌者）。
   * 已鑲嵌與拖曳中的不算，這樣按在上面會變成平移畫面。
   */
  hitTestBoard(world: Point): string | null {
    for (let i = this.boardOrder.length - 1; i >= 0; i--) {
      const id = this.boardOrder[i]!;
      const loc = this.locations.get(id)!;
      if (loc.kind !== 'board') continue;
      const piece = this.pieces.get(id)!;
      const local = {
        x: world.x - loc.pos.x + piece.centroid.x,
        y: world.y - loc.pos.y + piece.centroid.y,
      };
      if (pointInPolygon(local, piece.polygon)) return id;
    }
    return null;
  }

  /** 拿起一片玻璃。已鑲嵌或已有別片在拖曳中時丟出錯誤 */
  startDrag(id: string): void {
    this.piece(id);
    const from = this.locations.get(id)!;
    if (from.kind === 'set') throw new Error(`玻璃片「${id}」已鑲嵌，不能拿起`);
    if (this.drag) throw new Error('已經有玻璃片在拖曳中');
    this.drag = { id, from };
    this.boardOrder = this.boardOrder.filter((b) => b !== id);
  }

  /**
   * 放開拖曳中的玻璃片。`world` 是玻璃片形心的世界座標。
   * 依磁吸規則回傳 set / wrong / free，並更新位置（set 時鎖死在格子中心，
   * wrong 時放在彈開後的位置，free 時留在原地），放在主框的會疊到最上面。
   * 放回托盤用 `returnToTray`。
   */
  drop(id: string, world: Point): DropResult {
    this.requireDragging(id);
    const result = resolveDrop(
      id,
      world,
      this.slots,
      new Set(this.setOrder),
      this.snapConfig,
    );
    if (result.kind === 'set') {
      this.locations.set(id, { kind: 'set' });
      this.setOrder.push(id);
    } else {
      this.locations.set(id, { kind: 'board', pos: result.position });
      this.boardOrder.push(id);
    }
    this.drag = null;
    return result;
  }

  /** 把拖曳中的玻璃片放回托盤（放在托盤區域放開時） */
  returnToTray(id: string): void {
    this.requireDragging(id);
    this.locations.set(id, { kind: 'tray' });
    this.drag = null;
  }

  /** 中斷拖曳，玻璃片回到拿起之前的地方（在主框的會疊到最上面） */
  cancelDrag(): void {
    if (!this.drag) return;
    const { id, from } = this.drag;
    this.locations.set(id, from);
    if (from.kind === 'board') this.boardOrder.push(id);
    this.drag = null;
  }

  private requireDragging(id: string): void {
    this.piece(id);
    if (this.drag?.id !== id) throw new Error(`玻璃片「${id}」不在拖曳中`);
  }
}
