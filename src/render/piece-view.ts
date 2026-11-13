import { Container, Graphics, Mesh, MeshGeometry } from 'pixi.js';
import type { Shader } from 'pixi.js';
import { lighten } from '../core/color';
import { smoothTowards } from '../core/ease';
import { hashSeed } from '../core/hash';
import { pieceSize } from '../core/snap';
import { triangulate } from '../core/triangulate';
import type { PieceData } from '../core/types';
import { createGlassShader, setGlassBoost, setGlassLit } from './glass-shader';

export interface PieceViewOptions {
  /** 紋理座標縮放：世界座標 × texScale = shader 用的 uv，所有玻璃片共用才能讓紋理疏密一致 */
  texScale: number;
  /** 內側柔光的基準寬度（世界座標單位），通常是鉛條寬度 */
  glowWidth: number;
}

/** 亮度逼近目標的速度（每秒）。約 0.4 秒內亮起 */
const LIT_RATE = 7;

/**
 * 一片玻璃的畫面。
 * 容器原點就是玻璃片的形心（頂點座標都是相對於形心），所以容器的位置
 * 直接就是 `Board` 與 `resolveDrop` 使用的形心座標。
 */
export class PieceView extends Container {
  readonly pieceId: string;
  /** 玻璃片尺寸（外框較長的一邊），世界座標單位 */
  readonly size: number;

  private readonly shader: Shader;
  private readonly glow: Graphics;
  private lit = 0;
  private litTarget = 0;
  private boost = 0;

  constructor(piece: PieceData, options: PieceViewOptions) {
    super();
    this.pieceId = piece.id;
    this.size = pieceSize(piece.polygon);

    const local = piece.polygon.map((p) => ({
      x: p.x - piece.centroid.x,
      y: p.y - piece.centroid.y,
    }));
    const positions = new Float32Array(local.length * 2);
    const uvs = new Float32Array(local.length * 2);
    let radius = 0;
    local.forEach((p, i) => {
      positions[i * 2] = p.x;
      positions[i * 2 + 1] = p.y;
      uvs[i * 2] = p.x * options.texScale;
      uvs[i * 2 + 1] = p.y * options.texScale;
      radius = Math.max(radius, Math.hypot(p.x, p.y));
    });

    this.shader = createGlassShader({
      color: piece.color,
      texture: piece.texture,
      seed: hashSeed(piece.id),
      radius: radius * options.texScale,
    });
    const geometry = new MeshGeometry({
      positions,
      uvs,
      indices: new Uint32Array(triangulate(local)),
    });
    this.addChild(new Mesh({ geometry, shader: this.shader }));

    // 鑲嵌後的內側柔光：沿著輪廓往內由淺到深疊三圈，用加法混合
    const flat = local.flatMap((p) => [p.x, p.y]);
    const color = lighten(piece.color, 0.55);
    this.glow = new Graphics();
    this.glow.blendMode = 'add';
    [
      { k: 3.2, alpha: 0.08 },
      { k: 2.0, alpha: 0.13 },
      { k: 1.0, alpha: 0.2 },
    ].forEach(({ k, alpha }) => {
      this.glow.poly(flat, true).stroke({
        width: options.glowWidth * k,
        color,
        alpha,
        alignment: 1, // 1 = 往輪廓內側
        join: 'round',
      });
    });
    this.glow.visible = false;
    this.addChild(this.glow);
  }

  /** 設定亮度目標（0 暗沉、1 發光）。`immediate` 為 true 時不做漸變 */
  setLit(target: number, immediate = false): void {
    this.litTarget = target;
    if (immediate) {
      this.lit = target;
      this.applyLit();
    }
  }

  /** 完成動畫的額外亮度 [0, 1]：玻璃整體閃亮，內側柔光也跟著變強 */
  setBoost(boost: number): void {
    if (boost === this.boost) return;
    this.boost = boost;
    setGlassBoost(this.shader, boost);
    this.applyLit();
  }

  get litValue(): number {
    return this.lit;
  }

  /** 每幀呼叫；亮度已經到位時什麼都不做，所以大量玻璃片也不會有額外負擔 */
  update(dt: number): void {
    if (this.lit === this.litTarget) return;
    this.lit = smoothTowards(this.lit, this.litTarget, dt, LIT_RATE);
    if (Math.abs(this.lit - this.litTarget) < 0.002) this.lit = this.litTarget;
    this.applyLit();
  }

  private applyLit(): void {
    setGlassLit(this.shader, this.lit);
    this.glow.alpha = Math.min(1, this.lit * (1 + this.boost * 1.2));
    this.glow.visible = this.lit > 0.01;
  }
}
