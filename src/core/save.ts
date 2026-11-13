/**
 * 存檔。規則見 docs/MVP-spec.md「存檔」：
 * - 存已鑲嵌的玻璃片 id、托盤的隨機種子、是否已完成，附 `version`
 * - 重新整理後回到上次進度，托盤順序不變
 * - 版本不符或資料有問題時重置，不載入壞資料
 * - localStorage 不可用時退回記憶體狀態，不顯示錯誤
 */

export const SAVE_VERSION = 1;

export interface SaveData {
  version: typeof SAVE_VERSION;
  /** 已鑲嵌的玻璃片 id */
  setIds: string[];
  /** 托盤順序的種子（見 `seededShuffle`） */
  traySeed: number;
  completed: boolean;
}

/** localStorage 的最小介面，測試時可用假物件取代 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SEED_RANGE = 2 ** 32;

/** 產生托盤種子：[0, 2^32) 的整數。`random` 回傳 [0, 1)，預設 Math.random */
export function newTraySeed(random: () => number = Math.random): number {
  return Math.floor(random() * SEED_RANGE);
}

/** 新遊戲的存檔內容 */
export function createSave(random: () => number = Math.random): SaveData {
  return {
    version: SAVE_VERSION,
    setIds: [],
    traySeed: newTraySeed(random),
    completed: false,
  };
}

/**
 * 記錄一片玻璃鑲嵌完成，回傳新的存檔內容（不修改原物件）。
 * 已經鑲嵌過的重複呼叫無影響；最後一片鑲嵌後 `completed` 變為 true。
 * `allPieceIds` 是這個關卡全部的玻璃片 id；id 不在其中時丟出錯誤。
 */
export function markSet(
  data: SaveData,
  pieceId: string,
  allPieceIds: readonly string[],
): SaveData {
  if (!allPieceIds.includes(pieceId)) {
    throw new Error(`關卡中沒有玻璃片「${pieceId}」`);
  }
  const setIds = data.setIds.includes(pieceId)
    ? data.setIds
    : [...data.setIds, pieceId];
  return {
    ...data,
    setIds: [...setIds],
    completed: setIds.length === allPieceIds.length,
  };
}

/**
 * 驗證從儲存空間讀到的資料。任何一項有問題都回傳 null：
 * - 版本不是目前的版本
 * - setIds 含有關卡中不存在的 id（關卡改版過）或重複的 id
 * - 種子不是 [0, 2^32) 的整數
 * - completed 與「是否全部鑲嵌」不一致
 */
export function parseSave(
  raw: unknown,
  allPieceIds: readonly string[],
): SaveData | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (o.version !== SAVE_VERSION) return null;

  const { setIds, traySeed, completed } = o;
  if (!Array.isArray(setIds)) return null;
  const valid = new Set(allPieceIds);
  const seen = new Set<string>();
  for (const id of setIds) {
    if (typeof id !== 'string' || !valid.has(id) || seen.has(id)) return null;
    seen.add(id);
  }
  if (
    typeof traySeed !== 'number' ||
    !Number.isInteger(traySeed) ||
    traySeed < 0 ||
    traySeed >= SEED_RANGE
  ) {
    return null;
  }
  if (completed !== (seen.size === allPieceIds.length)) return null;

  return {
    version: SAVE_VERSION,
    setIds: [...setIds] as string[],
    traySeed,
    completed,
  };
}

/**
 * 取得可用的 localStorage；不可用時回傳 null。
 * 隱私模式、被封鎖網站資料、或在預覽環境中，存取 localStorage 本身就可能丟出例外，
 * 所以連「取得」都要包 try/catch，並實際寫入一筆測試資料確認真的能寫。
 */
export function getLocalStorage(): StorageLike | null {
  try {
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (!storage) return null;
    const probe = 'vitrail:probe';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

const KEY_PREFIX = 'vitrail:save:';

/**
 * 存檔儲存庫。每個關卡一筆存檔（key 以關卡 id 區分）。
 *
 * 儲存空間（localStorage）不可用，或任何一次讀寫丟出例外（空間已滿等）時，
 * 靜默改用記憶體：這次遊玩期間的進度仍然有效，只是重新整理後會遺失。
 * 一旦發生過例外就不再信任儲存空間，避免讀到比記憶體還舊的資料。
 */
export class SaveStore {
  private storage: StorageLike | null;
  private readonly memory = new Map<string, string>();

  constructor(storage: StorageLike | null = getLocalStorage()) {
    this.storage = storage;
  }

  /** 目前是否真的寫進了持久的儲存空間（false 代表只存在記憶體） */
  get persistent(): boolean {
    return this.storage !== null;
  }

  private key(levelId: string): string {
    return KEY_PREFIX + levelId;
  }

  private read(key: string): string | null {
    if (this.storage) {
      try {
        return this.storage.getItem(key);
      } catch {
        this.storage = null;
      }
    }
    return this.memory.get(key) ?? null;
  }

  private write(key: string, value: string): void {
    this.memory.set(key, value);
    if (this.storage) {
      try {
        this.storage.setItem(key, value);
      } catch {
        this.storage = null;
      }
    }
  }

  private remove(key: string): void {
    this.memory.delete(key);
    if (this.storage) {
      try {
        this.storage.removeItem(key);
      } catch {
        this.storage = null;
      }
    }
  }

  /**
   * 讀取某個關卡的存檔。沒有存檔、資料損毀、版本不符、或關卡已改版時回傳 null，
   * 後三種情況會順便清掉壞資料。`allPieceIds` 是該關卡目前全部的玻璃片 id。
   */
  load(levelId: string, allPieceIds: readonly string[]): SaveData | null {
    const key = this.key(levelId);
    const text = this.read(key);
    if (text === null) return null;

    let parsed: SaveData | null;
    try {
      parsed = parseSave(JSON.parse(text), allPieceIds);
    } catch {
      parsed = null; // 不是有效的 JSON
    }
    if (parsed === null) this.remove(key);
    return parsed;
  }

  save(levelId: string, data: SaveData): void {
    this.write(this.key(levelId), JSON.stringify(data));
  }

  /** 清除某個關卡的存檔（重玩時使用） */
  clear(levelId: string): void {
    this.remove(this.key(levelId));
  }
}
