import { GLASS_TEXTURES } from './types';
import type { GlassTexture, LevelData, PieceData, Point } from './types';

/** 關卡資料格式不符或載入失敗 */
export class LevelError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LevelError';
  }
}

const COLOR_RE = /^#[0-9a-f]{6}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function parsePoint(v: unknown, where: string): Point {
  if (!isRecord(v) || !isFiniteNumber(v.x) || !isFiniteNumber(v.y)) {
    throw new LevelError(`${where}必須是 { x, y } 且皆為有限數字`);
  }
  return { x: v.x, y: v.y };
}

function parsePiece(v: unknown, index: number): PieceData {
  if (!isRecord(v)) throw new LevelError(`pieces[${index}] 必須是物件`);

  if (typeof v.id !== 'string' || v.id === '') {
    throw new LevelError(`pieces[${index}] 缺少 id`);
  }
  const id = v.id;
  const label = `玻璃片「${id}」`;

  if (typeof v.color !== 'string' || !COLOR_RE.test(v.color)) {
    throw new LevelError(`${label}的 color 必須是小寫 #rrggbb`);
  }
  if (
    typeof v.texture !== 'string' ||
    !(GLASS_TEXTURES as readonly string[]).includes(v.texture)
  ) {
    throw new LevelError(
      `${label}的 texture 無效，可用值：${GLASS_TEXTURES.join('、')}`,
    );
  }
  if (!Array.isArray(v.polygon) || v.polygon.length < 3) {
    throw new LevelError(`${label}的 polygon 至少需要 3 個頂點`);
  }

  return {
    id,
    color: v.color,
    texture: v.texture as GlassTexture,
    polygon: v.polygon.map((p, i) => parsePoint(p, `${label}的 polygon[${i}]`)),
    centroid: parsePoint(v.centroid, `${label}的 centroid`),
  };
}

/** 驗證並轉換未知資料為 LevelData，格式有誤時丟出 LevelError */
export function parseLevel(data: unknown): LevelData {
  if (!isRecord(data)) throw new LevelError('關卡資料必須是物件');
  if (data.version !== 1) {
    throw new LevelError(
      `不支援的關卡版本：${String(data.version)}（目前只支援 1）`,
    );
  }
  if (
    !isFiniteNumber(data.width) ||
    !isFiniteNumber(data.height) ||
    data.width <= 0 ||
    data.height <= 0
  ) {
    throw new LevelError('width 與 height 必須是大於 0 的數字');
  }
  if (!Array.isArray(data.pieces) || data.pieces.length === 0) {
    throw new LevelError('pieces 必須是非空陣列');
  }

  const seen = new Set<string>();
  const pieces = data.pieces.map((raw, i) => {
    const piece = parsePiece(raw, i);
    if (seen.has(piece.id)) {
      throw new LevelError(`玻璃片 id「${piece.id}」重複`);
    }
    seen.add(piece.id);
    return piece;
  });

  return { version: 1, width: data.width, height: data.height, pieces };
}

/** 抓取並驗證關卡 JSON。`fetchFn` 可注入，方便測試 */
export async function loadLevel(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<LevelData> {
  let res: Response;
  try {
    res = await fetchFn(url);
  } catch (e) {
    throw new LevelError(`無法載入關卡 ${url}`, { cause: e });
  }
  if (!res.ok) {
    throw new LevelError(`無法載入關卡 ${url}（HTTP ${res.status}）`);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (e) {
    throw new LevelError(`關卡 ${url} 不是有效的 JSON`, { cause: e });
  }
  try {
    return parseLevel(json);
  } catch (e) {
    if (e instanceof LevelError) {
      throw new LevelError(`關卡 ${url} 格式錯誤：${e.message}`, { cause: e });
    }
    throw e;
  }
}
