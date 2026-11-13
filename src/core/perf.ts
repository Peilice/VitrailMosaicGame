export interface FrameMonitorOptions {
  /** 前幾幀不計入（載入、編譯 shader 的卡頓），預設 30 */
  warmupFrames?: number;
  /** 每累積這麼多幀就評估一次，預設 90（約 1.5 秒） */
  windowFrames?: number;
  /** 中位數幀時間低於這個值（毫秒）就開啟，預設 18（約 55fps 以上） */
  enableBelowMs?: number;
  /** 已開啟後，中位數幀時間高於這個值（毫秒）就關閉，預設 30（約 33fps 以下） */
  disableAboveMs?: number;
  /** 單幀超過這個時間（毫秒）視為分頁被切走或系統卡住，不計入，預設 250 */
  maxFrameMs?: number;
}

export type FrameVerdict = 'enable' | 'disable' | null;

/**
 * 幀率偵測，決定要不要開啟吃效能的特效（bloom）。
 * 每幀把經過時間丟進 `push`，累積一個視窗後用「中位數」評估
 * （中位數不受偶爾的卡頓影響）：
 * - 效能足夠才開，預設是關閉的
 * - 開啟後如果明顯變慢就關掉，而且之後不再開啟，避免開開關關
 */
export class FrameMonitor {
  private readonly warmupFrames: number;
  private readonly windowFrames: number;
  private readonly enableBelowMs: number;
  private readonly disableAboveMs: number;
  private readonly maxFrameMs: number;

  private seen = 0;
  private samples: number[] = [];
  private enabled = false;
  private gaveUp = false;

  constructor(options: FrameMonitorOptions = {}) {
    this.warmupFrames = options.warmupFrames ?? 30;
    this.windowFrames = options.windowFrames ?? 90;
    this.enableBelowMs = options.enableBelowMs ?? 18;
    this.disableAboveMs = options.disableAboveMs ?? 30;
    this.maxFrameMs = options.maxFrameMs ?? 250;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** 丟入一幀的經過時間（毫秒）。需要切換時回傳 'enable' 或 'disable'，否則 null */
  push(frameMs: number): FrameVerdict {
    if (!(frameMs > 0) || frameMs > this.maxFrameMs) return null;
    if (this.seen < this.warmupFrames) {
      this.seen++;
      return null;
    }
    this.samples.push(frameMs);
    if (this.samples.length < this.windowFrames) return null;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    this.samples = [];

    if (!this.enabled && !this.gaveUp && median <= this.enableBelowMs) {
      this.enabled = true;
      return 'enable';
    }
    if (this.enabled && median >= this.disableAboveMs) {
      this.enabled = false;
      this.gaveUp = true;
      return 'disable';
    }
    return null;
  }
}
