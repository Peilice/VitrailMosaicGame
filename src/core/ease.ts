export const clamp01 = (t: number): number => Math.min(Math.max(t, 0), 1);

export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;

/** 開始快、結尾慢，適合「卡入」這類到位動作 */
export const easeOutCubic = (t: number): number => 1 - (1 - clamp01(t)) ** 3;

/** 兩端都慢的緩動 */
export const easeInOutCubic = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

/**
 * 讓 current 以指數方式逼近 target，不受幀率影響。
 * `rate` 越大逼近越快（每秒），`dt` 是經過的秒數。
 */
export function smoothTowards(
  current: number,
  target: number,
  dt: number,
  rate: number,
): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}
