import { synthesize } from './synth';
import { DEFAULT_SOUND_FILES, SOUND_NAMES } from './sounds';
import type { SoundName } from './sounds';

/**
 * SoundPlayer 實際用到的 Web Audio 部分。真正的 AudioContext 符合這個介面，
 * 測試時則用假物件取代。
 */
export interface AudioContextLike {
  readonly state: string;
  readonly sampleRate: number;
  /** 秒 */
  readonly currentTime: number;
  readonly destination: unknown;
  resume(): Promise<void>;
  decodeAudioData(data: ArrayBuffer): Promise<unknown>;
  createBuffer(
    channels: number,
    length: number,
    sampleRate: number,
  ): { copyToChannel(source: Float32Array, channel: number): void };
  createBufferSource(): {
    buffer: unknown;
    readonly playbackRate: { value: number };
    connect(destination: unknown): unknown;
    start(when?: number): void;
  };
  createGain(): {
    readonly gain: { value: number };
    connect(destination: unknown): unknown;
  };
}

export interface SoundPlayerOptions {
  /** 建立 AudioContext 的函式，預設是 `new AudioContext()` */
  createContext?: () => AudioContextLike;
  fetchFn?: typeof fetch;
  /** [0, 1) 亂數，用於音高的些微變化 */
  random?: () => number;
  /** 音效檔路徑的前綴，預設 './'（與 Vite 的 base 一致） */
  baseUrl?: string;
  files?: Readonly<Record<SoundName, string>>;
  /** 同一個音效兩次播放的最短間隔（秒），避免連續觸發時疊成一團 */
  minInterval?: number;
}

/** 每個音效的音高隨機變化幅度（±），讓重複聽到時不那麼機械 */
const PITCH_VARIATION: Readonly<Record<SoundName, number>> = {
  pickup: 0.06,
  wrong: 0.04,
  set: 0.03,
};

const DEFAULT_MIN_INTERVAL = 0.04;

/**
 * 音效播放器。
 *
 * 瀏覽器的自動播放限制要求 AudioContext 必須在使用者操作（點擊、觸控）當下啟動，
 * 所以流程是：
 * 1. 頁面載入時呼叫 `prefetch()`：先把音效檔下載下來（不需要使用者操作）
 * 2. 第一次 pointerdown 時呼叫 `unlock()`：建立並啟動 AudioContext、解碼音效
 * 3. 之後用 `play(name)` 播放
 *
 * 在 `unlock()` 完成之前呼叫 `play()` 不會有聲音也不會出錯。
 */
export class SoundPlayer {
  private readonly createContext: () => AudioContextLike;
  private readonly fetchFn: typeof fetch;
  private readonly random: () => number;
  private readonly baseUrl: string;
  private readonly files: Readonly<Record<SoundName, string>>;
  private readonly minInterval: number;

  private ctx: AudioContextLike | null = null;
  /** 已建立但可能還沒解碼完成的 context，用來在之後的使用者操作中重試 resume */
  private created: AudioContextLike | null = null;
  private master: { readonly gain: { value: number } } | null = null;
  private prefetching: Promise<void> | null = null;
  private unlocking: Promise<void> | null = null;
  private readonly raw: Partial<Record<SoundName, ArrayBuffer>> = {};
  private readonly buffers: Partial<Record<SoundName, unknown>> = {};
  private readonly lastPlayed: Partial<Record<SoundName, number>> = {};
  private isMuted = false;

  constructor(options: SoundPlayerOptions = {}) {
    this.createContext =
      options.createContext ??
      (() => new AudioContext() as unknown as AudioContextLike);
    this.fetchFn = options.fetchFn ?? ((...args) => fetch(...args));
    this.random = options.random ?? Math.random;
    this.baseUrl = options.baseUrl ?? './';
    this.files = options.files ?? DEFAULT_SOUND_FILES;
    this.minInterval = options.minInterval ?? DEFAULT_MIN_INTERVAL;
  }

  get muted(): boolean {
    return this.isMuted;
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
  }

  /** 下載音效檔（不需要使用者操作）。失敗的檔案會被略過，之後改用合成音效。只會執行一次 */
  prefetch(): Promise<void> {
    this.prefetching ??= Promise.all(
      SOUND_NAMES.map(async (name) => {
        try {
          const res = await this.fetchFn(this.baseUrl + this.files[name]);
          if (res.ok) this.raw[name] = await res.arrayBuffer();
        } catch {
          // 網路錯誤、檔案不存在：用合成音效
        }
      }),
    ).then(() => undefined);
    return this.prefetching;
  }

  /**
   * 必須在使用者操作（pointerdown 等）的事件處理函式中呼叫。
   * AudioContext 的建立與 resume 會同步完成，之後才非同步解碼，
   * 因此即使解碼要花時間，也不會錯過「在使用者操作當下啟動」的時機。
   * 重複呼叫是安全的。
   */
  unlock(): Promise<void> {
    // Chrome 對觸控只在 pointerup（touchend）才算使用者操作，pointerdown 不算，
    // 所以第一次嘗試 resume 可能被拒絕。之後每次呼叫（例如在 pointerup）都再試一次。
    if (this.created?.state === 'suspended') {
      void this.created.resume().catch(() => undefined);
    }
    this.unlocking ??= this.doUnlock();
    return this.unlocking;
  }

  private async doUnlock(): Promise<void> {
    let ctx: AudioContextLike;
    try {
      ctx = this.createContext();
    } catch {
      return; // 瀏覽器不支援 Web Audio：維持無聲，遊戲照常進行
    }
    this.created = ctx;
    const master = ctx.createGain();
    master.gain.value = this.isMuted ? 0 : 1;
    master.connect(ctx.destination);
    // 先記下 master，這樣解碼期間呼叫 setMuted 也會作用在它身上
    this.master = master;
    const resumed = ctx.resume().catch(() => undefined);

    await this.prefetch();
    for (const name of SOUND_NAMES) {
      this.buffers[name] = await this.decode(ctx, name);
    }
    await resumed;

    // 最後才設定 ctx：在這之前 play() 都視為尚未就緒
    this.ctx = ctx;
  }

  private async decode(
    ctx: AudioContextLike,
    name: SoundName,
  ): Promise<unknown> {
    const raw = this.raw[name];
    if (raw) {
      try {
        // 解碼會取走 ArrayBuffer 的所有權，傳複本以免影響之後重試
        return await ctx.decodeAudioData(raw.slice(0));
      } catch {
        // 檔案損毀或格式不支援：用合成音效
      }
    }
    const data = synthesize(name, ctx.sampleRate);
    const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buffer.copyToChannel(data, 0);
    return buffer;
  }

  play(name: SoundName): void {
    const { ctx, master } = this;
    const buffer = this.buffers[name];
    if (!ctx || !master || this.isMuted || !buffer) return;

    const now = ctx.currentTime;
    const last = this.lastPlayed[name];
    if (last !== undefined && now - last < this.minInterval) return;
    this.lastPlayed[name] = now;

    // 來電或切換分頁後 iOS 會把 context 暫停，在使用者操作的路徑上順手恢復
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value =
      1 + (this.random() * 2 - 1) * PITCH_VARIATION[name];
    source.connect(master);
    source.start();
  }
}
