import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SAVE_VERSION,
  SaveStore,
  createSave,
  getLocalStorage,
  markSet,
  newTraySeed,
  parseSave,
} from './save';
import type { SaveData, StorageLike } from './save';

const IDS = ['a', 'b', 'c'];

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

const sample = (over: Partial<SaveData> = {}): SaveData => ({
  version: SAVE_VERSION,
  setIds: ['a'],
  traySeed: 12345,
  completed: false,
  ...over,
});

describe('newTraySeed / createSave', () => {
  it('種子是 [0, 2^32) 的整數', () => {
    expect(newTraySeed(() => 0)).toBe(0);
    expect(newTraySeed(() => 0.5)).toBe(2 ** 31);
    expect(newTraySeed(() => 0.999999999)).toBeLessThan(2 ** 32);
    expect(Number.isInteger(newTraySeed())).toBe(true);
  });

  it('新存檔：沒有鑲嵌、尚未完成、版本為目前版本', () => {
    const data = createSave(() => 0.25);
    expect(data).toEqual({
      version: SAVE_VERSION,
      setIds: [],
      traySeed: 2 ** 30,
      completed: false,
    });
  });
});

describe('markSet', () => {
  it('加入 id，不修改原物件', () => {
    const before = sample({ setIds: [] });
    const after = markSet(before, 'b', IDS);
    expect(after.setIds).toEqual(['b']);
    expect(before.setIds).toEqual([]);
  });

  it('重複鑲嵌同一片不會重複記錄', () => {
    const once = markSet(sample({ setIds: [] }), 'a', IDS);
    expect(markSet(once, 'a', IDS).setIds).toEqual(['a']);
  });

  it('最後一片鑲嵌後 completed 變為 true', () => {
    let data = sample({ setIds: [] });
    data = markSet(data, 'a', IDS);
    data = markSet(data, 'b', IDS);
    expect(data.completed).toBe(false);
    data = markSet(data, 'c', IDS);
    expect(data.completed).toBe(true);
  });

  it('關卡中沒有的 id 會丟出錯誤', () => {
    expect(() => markSet(sample(), 'zzz', IDS)).toThrow('zzz');
  });

  it('保留種子', () => {
    expect(markSet(sample({ setIds: [] }), 'a', IDS).traySeed).toBe(12345);
  });
});

describe('parseSave', () => {
  it('接受合法資料', () => {
    expect(parseSave(sample(), IDS)).toEqual(sample());
    const done = sample({ setIds: ['c', 'a', 'b'], completed: true });
    expect(parseSave(done, IDS)).toEqual(done);
  });

  it('回傳的是複本', () => {
    const raw = sample();
    const parsed = parseSave(raw, IDS)!;
    expect(parsed.setIds).not.toBe(raw.setIds);
  });

  it.each([
    ['不是物件', 42],
    ['null', null],
    ['陣列', []],
    ['版本不符', { ...sample(), version: 2 }],
    ['缺少版本', { ...sample(), version: undefined }],
    ['setIds 不是陣列', { ...sample(), setIds: 'a' }],
    ['setIds 含非字串', { ...sample(), setIds: [1] }],
    ['setIds 含關卡沒有的 id（關卡改版過）', sample({ setIds: ['a', 'old'] })],
    ['setIds 重複', sample({ setIds: ['a', 'a'] })],
    ['種子是小數', sample({ traySeed: 1.5 })],
    ['種子是負數', sample({ traySeed: -1 })],
    ['種子超出範圍', sample({ traySeed: 2 ** 32 })],
    ['種子是 NaN', sample({ traySeed: NaN })],
    ['種子是字串', { ...sample(), traySeed: '5' }],
    ['completed 不是布林', { ...sample(), completed: 'no' }],
    ['completed 為 true 但還沒全部鑲嵌', sample({ completed: true })],
    [
      '全部鑲嵌但 completed 為 false',
      sample({ setIds: IDS, completed: false }),
    ],
  ])('%s：回傳 null', (_name, raw) => {
    expect(parseSave(raw, IDS)).toBeNull();
  });
});

describe('SaveStore', () => {
  const keyOf = (levelId: string): string => `vitrail:save:${levelId}`;

  it('存檔後可讀回，且確實寫進了儲存空間', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage);
    store.save('lv1', sample());
    expect(storage.items.has(keyOf('lv1'))).toBe(true);
    expect(store.load('lv1', IDS)).toEqual(sample());
  });

  it('模擬重新整理：用同一份儲存空間建立新的 store，進度與種子都還在', () => {
    const storage = new MemoryStorage();
    new SaveStore(storage).save('lv1', sample({ setIds: ['a', 'b'] }));
    const reloaded = new SaveStore(storage).load('lv1', IDS);
    expect(reloaded?.setIds).toEqual(['a', 'b']);
    expect(reloaded?.traySeed).toBe(12345);
  });

  it('沒有存檔回傳 null', () => {
    expect(new SaveStore(new MemoryStorage()).load('lv1', IDS)).toBeNull();
  });

  it('各關卡的存檔互不影響', () => {
    const store = new SaveStore(new MemoryStorage());
    store.save('lv1', sample({ setIds: ['a'] }));
    store.save('lv2', sample({ setIds: ['b'] }));
    expect(store.load('lv1', IDS)?.setIds).toEqual(['a']);
    expect(store.load('lv2', IDS)?.setIds).toEqual(['b']);
  });

  it('clear（重玩）會清掉該關卡的存檔，其他關卡不受影響', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage);
    store.save('lv1', sample());
    store.save('lv2', sample());
    store.clear('lv1');
    expect(store.load('lv1', IDS)).toBeNull();
    expect(storage.items.has(keyOf('lv1'))).toBe(false);
    expect(store.load('lv2', IDS)).not.toBeNull();
  });

  it('資料不是有效的 JSON：回傳 null 並清掉壞資料', () => {
    const storage = new MemoryStorage();
    storage.setItem(keyOf('lv1'), '{oops');
    const store = new SaveStore(storage);
    expect(store.load('lv1', IDS)).toBeNull();
    expect(storage.items.has(keyOf('lv1'))).toBe(false);
  });

  it('版本不符：回傳 null 並重置（清掉舊資料）', () => {
    const storage = new MemoryStorage();
    storage.setItem(keyOf('lv1'), JSON.stringify({ ...sample(), version: 99 }));
    const store = new SaveStore(storage);
    expect(store.load('lv1', IDS)).toBeNull();
    expect(storage.items.has(keyOf('lv1'))).toBe(false);
  });

  it('關卡改版（存檔含有新關卡沒有的玻璃片）：重置', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage);
    store.save('lv1', sample({ setIds: ['a', 'b'] }));
    expect(store.load('lv1', ['a', 'x', 'y'])).toBeNull();
    expect(storage.items.has(keyOf('lv1'))).toBe(false);
  });

  describe('儲存空間不可用', () => {
    it('storage 為 null：進度保存在記憶體，不丟錯誤', () => {
      const store = new SaveStore(null);
      expect(store.persistent).toBe(false);
      store.save('lv1', sample());
      expect(store.load('lv1', IDS)).toEqual(sample());
      store.clear('lv1');
      expect(store.load('lv1', IDS)).toBeNull();
    });

    it('寫入丟出例外（空間已滿等）：不丟錯誤，進度仍保留在記憶體', () => {
      const storage = new MemoryStorage();
      storage.setItem = () => {
        throw new DOMException('quota', 'QuotaExceededError');
      };
      const store = new SaveStore(storage);
      expect(() => store.save('lv1', sample())).not.toThrow();
      expect(store.persistent).toBe(false);
      expect(store.load('lv1', IDS)).toEqual(sample());
    });

    it('發生過例外後不再讀儲存空間，避免讀到比記憶體還舊的資料', () => {
      const storage = new MemoryStorage();
      const store = new SaveStore(storage);
      store.save('lv1', sample({ setIds: ['a'] }));
      storage.setItem = () => {
        throw new Error('quota');
      };
      store.save('lv1', sample({ setIds: ['a', 'b'] }));
      expect(store.load('lv1', IDS)?.setIds).toEqual(['a', 'b']);
    });

    it('讀取丟出例外：不丟錯誤，退回記憶體', () => {
      const storage = new MemoryStorage();
      storage.getItem = () => {
        throw new Error('denied');
      };
      const store = new SaveStore(storage);
      expect(store.load('lv1', IDS)).toBeNull();
      expect(store.persistent).toBe(false);
    });

    it('刪除丟出例外：不丟錯誤', () => {
      const storage = new MemoryStorage();
      storage.removeItem = () => {
        throw new Error('denied');
      };
      const store = new SaveStore(storage);
      store.save('lv1', sample());
      expect(() => store.clear('lv1')).not.toThrow();
      expect(store.load('lv1', IDS)).toBeNull();
    });
  });
});

describe('getLocalStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('沒有 localStorage（例如 Node 環境）回傳 null', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(getLocalStorage()).toBeNull();
  });

  it('可用時回傳它，且不留下測試用的資料', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    expect(getLocalStorage()).toBe(storage);
    expect(storage.items.size).toBe(0);
  });

  it('寫入測試失敗（隱私模式）回傳 null', () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error('private mode');
    };
    vi.stubGlobal('localStorage', storage);
    expect(getLocalStorage()).toBeNull();
  });

  it('光是存取 localStorage 就丟出例外（被封鎖網站資料）回傳 null', () => {
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      'localStorage',
    );
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    try {
      expect(getLocalStorage()).toBeNull();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
