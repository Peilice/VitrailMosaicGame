import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { polygonArea, polygonCentroid } from '../src/core/geometry.ts';
import { GLASS_TEXTURES } from '../src/core/types.ts';
import type { LevelData, PieceData, Point } from '../src/core/types.ts';

export interface StressOptions {
  /** 玻璃片數，預設 150 */
  count?: number;
  width?: number;
  height?: number;
  /** 亂數種子，相同種子產生相同關卡 */
  seed?: number;
  /** Lloyd 鬆弛次數，讓玻璃大小較均勻，預設 2 */
  relax?: number;
}

/** 對比強烈的彩繪玻璃色盤 */
const PALETTE = [
  '#b8283a',
  '#e8a33d',
  '#2c5fa8',
  '#2e8b57',
  '#7b3fa0',
  '#e06c9f',
  '#1fa8b8',
  '#f2d03b',
  '#d9531e',
  '#3a3f9e',
  '#8fbf3a',
  '#c9c3b0',
] as const;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** mulberry32：小型可重現的亂數產生器 */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 以「靠近 seed 的一側」裁切多邊形（Sutherland–Hodgman，單一半平面） */
function clipHalfPlane(poly: Point[], seed: Point, other: Point): Point[] {
  const nx = other.x - seed.x;
  const ny = other.y - seed.y;
  const mx = (seed.x + other.x) / 2;
  const my = (seed.y + other.y) / 2;
  const side = (p: Point): number => (p.x - mx) * nx + (p.y - my) * ny;

  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const sa = side(a);
    const sb = side(b);
    if (sa <= 0) out.push(a);
    if (sa < 0 !== sb < 0 && sa !== sb) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

function voronoiCells(
  seeds: Point[],
  width: number,
  height: number,
): Point[][] {
  const box: Point[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  return seeds.map((s, i) => {
    // 由近到遠裁切，多邊形很快變小，後面的裁切幾乎免費
    const others = seeds
      .filter((_, j) => j !== i)
      .sort(
        (p, q) =>
          (p.x - s.x) ** 2 +
          (p.y - s.y) ** 2 -
          ((q.x - s.x) ** 2 + (q.y - s.y) ** 2),
      );
    let cell = box;
    for (const o of others) cell = clipHalfPlane(cell, s, o);
    return cell;
  });
}

/** 用 Voronoi 分割整個窗框，產生壓力測試關卡（純函式） */
export function generateStressLevel(options: StressOptions = {}): LevelData {
  const count = options.count ?? 150;
  const width = options.width ?? 1600;
  const height = options.height ?? 1200;
  const relax = options.relax ?? 2;
  const rng = makeRng(options.seed ?? 1);
  if (!(count >= 1) || !Number.isInteger(count))
    throw new Error('count 必須是正整數');

  let seeds: Point[] = Array.from({ length: count }, () => ({
    x: rng() * width,
    y: rng() * height,
  }));
  for (let i = 0; i < relax; i++) {
    seeds = voronoiCells(seeds, width, height).map((cell, k) =>
      cell.length >= 3 ? polygonCentroid(cell) : seeds[k]!,
    );
  }
  const cells = voronoiCells(seeds, width, height);

  const pieces: PieceData[] = cells.map((cell, i) => {
    // 取兩位小數與 svg-to-level 一致，並去掉因此重合的相鄰點
    const polygon: Point[] = [];
    for (const p of cell) {
      const q = { x: round2(p.x), y: round2(p.y) };
      const last = polygon[polygon.length - 1];
      if (!last || last.x !== q.x || last.y !== q.y) polygon.push(q);
    }
    const first = polygon[0];
    const last = polygon[polygon.length - 1];
    if (
      polygon.length > 1 &&
      first &&
      last &&
      first.x === last.x &&
      first.y === last.y
    )
      polygon.pop();
    if (polygon.length < 3) throw new Error(`第 ${i} 片退化，請換個種子`);
    if (polygonArea(polygon) < 0) polygon.reverse();
    const c = polygonCentroid(polygon);
    return {
      id: `p${String(i + 1).padStart(3, '0')}`,
      polygon,
      color: PALETTE[Math.floor(rng() * PALETTE.length)]!,
      texture: GLASS_TEXTURES[Math.floor(rng() * GLASS_TEXTURES.length)]!,
      centroid: { x: round2(c.x), y: round2(c.y) },
    };
  });

  return { version: 1, width, height, pieces };
}

function main(): void {
  const args = process.argv.slice(2);
  const opts: StressOptions = {};
  let out = 'public/levels/stress-150.json';
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const value = (): string => {
      const v = args[++i];
      if (!v) throw new Error(`${a} 需要指定值`);
      return v;
    };
    if (a === '--count') opts.count = Number(value());
    else if (a === '--seed') opts.seed = Number(value());
    else if (a === '--out') out = value();
    else throw new Error(`未知的選項：${a}`);
  }
  const level = generateStressLevel(opts);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(level)}\n`);
  console.log(`已產生 ${out}（${level.pieces.length} 片）`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (e) {
    console.error(`產生失敗：${(e as Error).message}`);
    process.exitCode = 1;
  }
}
