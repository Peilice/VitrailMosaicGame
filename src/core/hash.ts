/**
 * 把字串雜湊成 [0, 1) 的數字（FNV-1a）。
 * 用來給每片玻璃一個固定的紋理種子，同一個 id 永遠得到同一個值。
 */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}
