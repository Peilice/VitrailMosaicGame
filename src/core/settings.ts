import { getLocalStorage } from './save';
import type { StorageLike } from './save';

/**
 * 使用者設定（目前只有靜音）。與遊戲進度分開存，所以重玩、關卡改版都不會影響它。
 * 儲存空間不可用時的處理與存檔相同：靜默改用記憶體，不顯示錯誤。
 */
export const SETTINGS_VERSION = 1;

export interface Settings {
  version: typeof SETTINGS_VERSION;
  muted: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  version: SETTINGS_VERSION,
  muted: false,
};

const KEY = 'vitrail:settings';

/** 驗證讀到的資料。版本不符或欄位型別不對時回傳 null（呼叫端改用預設值） */
export function parseSettings(raw: unknown): Settings | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (o.version !== SETTINGS_VERSION || typeof o.muted !== 'boolean') {
    return null;
  }
  return { version: SETTINGS_VERSION, muted: o.muted };
}

export class SettingsStore {
  private storage: StorageLike | null;
  private memory: string | null = null;

  constructor(storage: StorageLike | null = getLocalStorage()) {
    this.storage = storage;
  }

  /** 讀取設定；沒有、損毀或版本不符時回傳預設值（壞資料會順便清掉） */
  load(): Settings {
    let text: string | null;
    if (this.storage) {
      try {
        text = this.storage.getItem(KEY);
      } catch {
        this.storage = null;
        text = this.memory;
      }
    } else {
      text = this.memory;
    }
    if (text === null) return { ...DEFAULT_SETTINGS };

    let parsed: Settings | null;
    try {
      parsed = parseSettings(JSON.parse(text));
    } catch {
      parsed = null; // 不是有效的 JSON
    }
    if (parsed === null) {
      this.remove();
      return { ...DEFAULT_SETTINGS };
    }
    return parsed;
  }

  save(settings: Settings): void {
    const text = JSON.stringify(settings);
    this.memory = text;
    if (this.storage) {
      try {
        this.storage.setItem(KEY, text);
      } catch {
        this.storage = null;
      }
    }
  }

  private remove(): void {
    this.memory = null;
    if (this.storage) {
      try {
        this.storage.removeItem(KEY);
      } catch {
        this.storage = null;
      }
    }
  }
}
