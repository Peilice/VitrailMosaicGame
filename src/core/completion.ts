import { clamp01, easeInOutCubic, easeOutCubic, lerp } from './ease';

/**
 * 完成動畫的時間軸（純函式，渲染層每幀依經過時間查詢）。
 * 規則見 docs/MVP-spec.md：最後一片拼上時，整個畫面瞬間亮起，一道陽光穿透畫面，
 * 並在背景投射出彩色的玻璃倒影；約 3 到 4 秒，結束後停留在最終畫面。
 *
 *   0.00 ─ 0.50  玻璃全部閃亮到最大
 *   0.15 ─ 2.00  光帶由左掃到右
 *   0.50 ─ 1.80  背景的彩色倒影浮現
 *   0.50 ─ 2.60  亮度從最大回落到最終亮度
 *   3.60         結束
 */
export const COMPLETION_SECONDS = 3.6;
/** 動畫結束後，玻璃停留的額外亮度（0 = 與鑲嵌後相同，1 = 閃亮最大） */
export const FINAL_BOOST = 0.25;
/** 動畫結束後，背景倒影的不透明度 */
export const FINAL_REFLECTION = 0.6;

const SWEEP_START = 0.15;
const SWEEP_END = 2.0;

/** 光帶的進度：一半線性、一半緩入緩出，起訖稍慢但中段不會太快衝過去 */
function sweepProgress(t: number): number {
  const p = phase(t, SWEEP_START, SWEEP_END);
  return lerp(p, easeInOutCubic(p), 0.5);
}

export interface CompletionFrame {
  /** 所有玻璃的額外亮度 [0, 1] */
  boost: number;
  /** 光帶的掃過進度 [0, 1]；光帶不在畫面上時為 null */
  sweep: number | null;
  /** 背景倒影的不透明度 */
  reflection: number;
  done: boolean;
}

const phase = (t: number, start: number, end: number): number =>
  clamp01((t - start) / (end - start));

export function completionFrame(t: number): CompletionFrame {
  const rise = easeOutCubic(phase(t, 0, 0.5));
  const settle = easeInOutCubic(phase(t, 0.5, 2.6));
  return {
    boost: rise * (1 - settle * (1 - FINAL_BOOST)),
    sweep: t >= SWEEP_START && t <= SWEEP_END ? sweepProgress(t) : null,
    reflection: easeOutCubic(phase(t, 0.5, 1.8)) * FINAL_REFLECTION,
    done: t >= COMPLETION_SECONDS,
  };
}

/** 動畫結束後（或讀取已完成的存檔時）的最終畫面 */
export const FINAL_FRAME: CompletionFrame = {
  boost: FINAL_BOOST,
  sweep: null,
  reflection: FINAL_REFLECTION,
  done: true,
};
