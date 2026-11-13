import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import {
  isSimplePolygon,
  polygonArea,
  polygonCentroid,
} from '../src/core/geometry.ts';
import { GLASS_TEXTURES } from '../src/core/types.ts';
import type {
  GlassTexture,
  LevelData,
  PieceData,
  Point,
} from '../src/core/types.ts';
import { flattenPath } from './svg-path.ts';
import {
  IDENTITY,
  applyMatrix,
  matrixScale,
  multiply,
  parseTransform,
} from './svg-transform.ts';
import type { Matrix } from './svg-transform.ts';

export interface ConvertOptions {
  /** 曲線攤平的最大誤差（SVG 使用者座標單位），預設 0.25 */
  tolerance?: number;
}

const DEFAULT_TOLERANCE = 0.25;
const DEFAULT_TEXTURE: GlassTexture = 'ripple';
/** 這些元素內的 path 不是畫面上的玻璃片 */
const NON_RENDERED = new Set([
  'defs',
  'clipPath',
  'mask',
  'symbol',
  'pattern',
  'marker',
  'metadata',
]);

const round2 = (n: number): number => Math.round(n * 100) / 100;

type El = Element;

function parentElement(el: El): El | null {
  const p = el.parentNode as El | null;
  return p && p.nodeType === 1 ? p : null;
}

/** 讀取樣式屬性：style 內的宣告優先於同名屬性，找不到時往祖先尋找（繼承） */
function inheritedProp(el: El, name: string): string | null {
  for (let node: El | null = el; node; node = parentElement(node)) {
    const style = node.getAttribute('style');
    if (style) {
      for (const decl of style.split(';')) {
        const idx = decl.indexOf(':');
        if (idx > 0 && decl.slice(0, idx).trim() === name)
          return decl.slice(idx + 1).trim();
      }
    }
    const attr = node.getAttribute(name);
    if (attr) return attr.trim();
  }
  return null;
}

/** 把 SVG 顏色轉成小寫 #rrggbb，支援 #rgb、#rrggbb、rgb(r,g,b) */
export function parseColor(value: string): string {
  const v = value.trim().toLowerCase();
  const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (hex3)
    return `#${hex3[1]!.repeat(2)}${hex3[2]!.repeat(2)}${hex3[3]!.repeat(2)}`;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const rgb =
    /^rgb\(\s*([\d.]+)(%?)\s*,\s*([\d.]+)(%?)\s*,\s*([\d.]+)(%?)\s*\)$/.exec(v);
  if (rgb) {
    const channel = (num: string, pct: string): string => {
      const n = pct ? (Number(num) / 100) * 255 : Number(num);
      return Math.max(0, Math.min(255, Math.round(n)))
        .toString(16)
        .padStart(2, '0');
    };
    return `#${channel(rgb[1]!, rgb[2]!)}${channel(rgb[3]!, rgb[4]!)}${channel(rgb[5]!, rgb[6]!)}`;
  }
  throw new Error(`無法解析的顏色「${value}」，請改用 #rrggbb`);
}

function documentSize(root: El): {
  width: number;
  height: number;
  minX: number;
  minY: number;
} {
  const viewBox = root.getAttribute('viewBox');
  if (viewBox) {
    const n = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (n.length === 4 && n.every(Number.isFinite) && n[2]! > 0 && n[3]! > 0) {
      return { minX: n[0]!, minY: n[1]!, width: n[2]!, height: n[3]! };
    }
    throw new Error(`viewBox 格式錯誤：「${viewBox}」`);
  }
  const width = parseFloat(root.getAttribute('width') ?? '');
  const height = parseFloat(root.getAttribute('height') ?? '');
  if (width > 0 && height > 0) return { minX: 0, minY: 0, width, height };
  throw new Error('SVG 缺少 viewBox，也沒有 width / height');
}

/** 去掉相鄰重複點，以及與起點重合的終點 */
function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (
    out.length > 1 &&
    first &&
    last &&
    first.x === last.x &&
    first.y === last.y
  )
    out.pop();
  return out;
}

function convertPath(
  el: El,
  matrix: Matrix,
  offset: Point,
  tolerance: number,
  label: string,
): PieceData {
  const id = el.getAttribute('id')?.trim();
  if (!id) throw new Error(`${label}缺少 id`);

  const rawFill = inheritedProp(el, 'fill');
  if (rawFill === null) throw new Error(`玻璃片「${id}」沒有 fill 顏色`);
  if (rawFill === 'none')
    throw new Error(`玻璃片「${id}」的 fill 是 none，需要指定顏色`);
  let color: string;
  try {
    color = parseColor(rawFill);
  } catch (e) {
    throw new Error(`玻璃片「${id}」：${(e as Error).message}`, {
      cause: e,
    });
  }

  const rawTexture = el.getAttribute('data-texture')?.trim() ?? DEFAULT_TEXTURE;
  if (!(GLASS_TEXTURES as readonly string[]).includes(rawTexture)) {
    throw new Error(
      `玻璃片「${id}」的 data-texture「${rawTexture}」無效，可用值：${GLASS_TEXTURES.join('、')}`,
    );
  }
  const texture = rawTexture as GlassTexture;

  const d = el.getAttribute('d');
  if (!d) throw new Error(`玻璃片「${id}」沒有 d 屬性`);

  // 在區域座標攤平，誤差換算成最終座標單位
  const scale = matrixScale(matrix);
  const localTol = scale > 0 ? tolerance / scale : tolerance;
  let subpaths;
  try {
    subpaths = flattenPath(d, localTol);
  } catch (e) {
    throw new Error(`玻璃片「${id}」的路徑解析失敗：${(e as Error).message}`, {
      cause: e,
    });
  }
  if (subpaths.length !== 1) {
    throw new Error(
      `玻璃片「${id}」含有 ${subpaths.length} 個子路徑，一個 path 只能是單一輪廓（不支援挖孔，請拆成獨立的 path）`,
    );
  }

  const transformed = subpaths[0]!.points.map((p) => {
    const q = applyMatrix(matrix, p);
    return { x: round2(q.x - offset.x), y: round2(q.y - offset.y) };
  });
  const polygon = dedupe(transformed);
  if (polygon.length < 3) throw new Error(`玻璃片「${id}」的頂點少於 3 個`);

  if (!isSimplePolygon(polygon))
    throw new Error(`玻璃片「${id}」的輪廓自我相交`);
  const area = polygonArea(polygon);
  if (Math.abs(area) < 1e-6) throw new Error(`玻璃片「${id}」的面積為 0`);
  // 統一繞向，讓之後的程式不用處理兩種方向
  if (area < 0) {
    polygon.reverse();
  }

  const c = polygonCentroid(polygon);
  return {
    id,
    polygon,
    color,
    texture,
    centroid: { x: round2(c.x), y: round2(c.y) },
  };
}

/** 把一份 SVG 文字轉成關卡資料（純函式，方便測試） */
export function convertSvg(
  svg: string,
  options: ConvertOptions = {},
): LevelData {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  if (!(tolerance > 0)) throw new Error('tolerance 必須大於 0');

  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level, msg) => {
      if (level !== 'warning') errors.push(msg);
    },
  }).parseFromString(svg, 'image/svg+xml');
  if (errors.length > 0) throw new Error(`SVG 不是有效的 XML：${errors[0]}`);

  const root = doc.documentElement as El | null;
  if (!root || root.localName !== 'svg') throw new Error('根元素不是 <svg>');

  const { width, height, minX, minY } = documentSize(root);
  const offset = { x: minX, y: minY };

  const pieces: PieceData[] = [];
  const seen = new Set<string>();
  const nodes = Array.from(root.getElementsByTagName('path')) as El[];
  nodes.forEach((el, index) => {
    // 由外到內累積祖先與自身的 transform，並排除不會顯示的區塊
    const chain: El[] = [];
    let hidden = false;
    for (let node: El | null = el; node; node = parentElement(node)) {
      if (node !== el && NON_RENDERED.has(node.localName)) hidden = true;
      chain.unshift(node);
    }
    if (hidden) return;

    let matrix: Matrix = IDENTITY;
    for (const node of chain)
      matrix = multiply(matrix, parseTransform(node.getAttribute('transform')));

    const piece = convertPath(
      el,
      matrix,
      offset,
      tolerance,
      `第 ${index + 1} 個 path `,
    );
    if (seen.has(piece.id)) throw new Error(`玻璃片 id「${piece.id}」重複`);
    seen.add(piece.id);
    pieces.push(piece);
  });

  if (pieces.length === 0) throw new Error('SVG 中沒有任何可用的 <path>');
  return { version: 1, width: round2(width), height: round2(height), pieces };
}

interface CliArgs {
  inputs: string[];
  outDir: string;
  tolerance: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    inputs: [],
    outDir: 'public/levels',
    tolerance: DEFAULT_TOLERANCE,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--out') {
      const v = argv[++i];
      if (!v) throw new Error('--out 需要指定資料夾');
      args.outDir = v;
    } else if (a === '--tolerance') {
      const v = Number(argv[++i]);
      if (!(v > 0)) throw new Error('--tolerance 需要大於 0 的數字');
      args.tolerance = v;
    } else if (a.startsWith('--')) {
      throw new Error(`未知的選項：${a}`);
    } else {
      args.inputs.push(a);
    }
  }
  if (args.inputs.length === 0) {
    // 預設轉換 levels/ 底下所有 SVG
    args.inputs = readdirSync('levels')
      .filter((f) => extname(f).toLowerCase() === '.svg')
      .map((f) => join('levels', f));
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.inputs.length === 0) {
    console.log('levels/ 底下沒有 SVG 檔，沒有東西要轉換。');
    return;
  }
  mkdirSync(args.outDir, { recursive: true });
  for (const input of args.inputs) {
    const level = convertSvg(readFileSync(input, 'utf8'), {
      tolerance: args.tolerance,
    });
    const out = join(args.outDir, `${basename(input, extname(input))}.json`);
    writeFileSync(out, `${JSON.stringify(level, null, 2)}\n`);
    console.log(`已轉換 ${input} → ${out}（${level.pieces.length} 片）`);
  }
}

// 只有直接執行時才跑 CLI，被測試或其他模組匯入時不執行
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (e) {
    console.error(`轉換失敗：${(e as Error).message}`);
    process.exitCode = 1;
  }
}
