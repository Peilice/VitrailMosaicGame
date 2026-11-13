import { describe, expect, it } from 'vitest';
import type { StorageLike } from './save';
import {
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  SettingsStore,
  parseSettings,
} from './settings';

class MemoryStorage implements StorageLike {
  items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const KEY = 'vitrail:settings';
const muted = { version: SETTINGS_VERSION, muted: true } as const;

describe('parseSettings', () => {
  it('接受合法資料', () => {
    expect(parseSettings(muted)).toEqual(muted);
    expect(parseSettings({ version: SETTINGS_VERSION, muted: false })).toEqual({
      version: SETTINGS_VERSION,
      muted: false,
    });
  });

  it.each([
    ['不是物件', 5],
    ['null', null],
    ['陣列', []],
    ['版本不符', { version: 2, muted: true }],
    ['缺少版本', { muted: true }],
    ['muted 不是布林', { version: SETTINGS_VERSION, muted: 'yes' }],
    ['缺少 muted', { version: SETTINGS_VERSION }],
  ])('%s：回傳 null', (_name, raw) => {
    expect(parseSettings(raw)).toBeNull();
  });
});

describe('SettingsStore', () => {
  it('沒有存過時回傳預設值（有聲）', () => {
    expect(new SettingsStore(new MemoryStorage()).load()).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('預設值不會被呼叫端改動而污染', () => {
    const store = new SettingsStore(new MemoryStorage());
    store.load().muted = true;
    expect(store.load().muted).toBe(false);
  });

  it('存檔後可讀回，模擬重新整理（新的 store 讀同一份儲存空間）', () => {
    const storage = new MemoryStorage();
    new SettingsStore(storage).save(muted);
    expect(storage.items.has(KEY)).toBe(true);
    expect(new SettingsStore(storage).load()).toEqual(muted);
  });

  it('資料不是有效的 JSON：回傳預設值並清掉壞資料', () => {
    const storage = new MemoryStorage();
    storage.setItem(KEY, '{oops');
    expect(new SettingsStore(storage).load()).toEqual(DEFAULT_SETTINGS);
    expect(storage.items.has(KEY)).toBe(false);
  });

  it('版本不符：回傳預設值並清掉舊資料', () => {
    const storage = new MemoryStorage();
    storage.setItem(KEY, JSON.stringify({ version: 99, muted: true }));
    expect(new SettingsStore(storage).load()).toEqual(DEFAULT_SETTINGS);
    expect(storage.items.has(KEY)).toBe(false);
  });

  it('與遊戲進度分開：不會用到進度存檔的 key', () => {
    const storage = new MemoryStorage();
    new SettingsStore(storage).save(muted);
    expect([...storage.items.keys()]).toEqual([KEY]);
  });

  describe('儲存空間不可用', () => {
    it('storage 為 null：設定保存在記憶體，不丟錯誤', () => {
      const store = new SettingsStore(null);
      store.save(muted);
      expect(store.load()).toEqual(muted);
    });

    it('寫入丟出例外：不丟錯誤，之後仍讀得到剛存的值', () => {
      const storage = new MemoryStorage();
      storage.setItem = () => {
        throw new DOMException('quota', 'QuotaExceededError');
      };
      const store = new SettingsStore(storage);
      expect(() => store.save(muted)).not.toThrow();
      expect(store.load()).toEqual(muted);
    });

    it('讀取丟出例外：不丟錯誤，回傳預設值', () => {
      const storage = new MemoryStorage();
      storage.getItem = () => {
        throw new Error('denied');
      };
      expect(new SettingsStore(storage).load()).toEqual(DEFAULT_SETTINGS);
    });

    it('刪除丟出例外：不丟錯誤', () => {
      const storage = new MemoryStorage();
      storage.setItem(KEY, '{oops');
      storage.removeItem = () => {
        throw new Error('denied');
      };
      expect(() => new SettingsStore(storage).load()).not.toThrow();
    });
  });
});
