const HEX_RE = /^#([0-9a-f]{6})$/i;

function parse(hex: string): number {
  const m = HEX_RE.exec(hex);
  if (!m) throw new Error(`無效的顏色「${hex}」，需要 #rrggbb`);
  return parseInt(m[1]!, 16);
}

/** `#rrggbb` 轉成數字（0xrrggbb） */
export const hexToNumber = (hex: string): number => parse(hex);

/** `#rrggbb` 轉成 0 到 1 的 [r, g, b]（給 shader 的 uniform 用） */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parse(hex);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 與白色混合，`amount` 為 0 時原色、1 時純白；回傳數字（0xrrggbb） */
export function lighten(hex: string, amount: number): number {
  const n = parse(hex);
  const a = Math.min(Math.max(amount, 0), 1);
  const mix = (c: number): number => Math.round(c + (255 - c) * a);
  return (
    (mix((n >> 16) & 255) << 16) | (mix((n >> 8) & 255) << 8) | mix(n & 255)
  );
}
