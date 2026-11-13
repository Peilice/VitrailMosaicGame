import type { Point } from '../src/core/types.ts';

/** SVG 仿射矩陣 [a, b, c, d, e, f]：x' = a·x + c·y + e，y' = b·x + d·y + f */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** 回傳 m1 · m2（先套用 m2，再套用 m1） */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function applyMatrix(m: Matrix, p: Point): Point {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}

/** 矩陣的平均縮放倍率（行列式絕對值的平方根） */
export function matrixScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

function parseNumbers(args: string, name: string): number[] {
  const parts = args
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) {
    throw new Error(`transform 的 ${name}() 含有無法解析的數字：${args}`);
  }
  return nums;
}

/** 解析 transform 屬性字串（matrix / translate / scale / rotate / skewX / skewY） */
export function parseTransform(value: string | null | undefined): Matrix {
  if (!value) return IDENTITY;
  let result: Matrix = IDENTITY;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const name = match[1]!;
    const n = parseNumbers(match[2]!, name);
    let m: Matrix;
    switch (name) {
      case 'matrix':
        if (n.length !== 6)
          throw new Error('transform 的 matrix() 需要 6 個數字');
        m = [n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!];
        break;
      case 'translate':
        m = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0];
        break;
      case 'scale':
        m = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const rad = ((n[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rot: Matrix = [cos, sin, -sin, cos, 0, 0];
        if (n.length >= 3) {
          const cx = n[1]!;
          const cy = n[2]!;
          m = multiply(multiply([1, 0, 0, 1, cx, cy], rot), [
            1,
            0,
            0,
            1,
            -cx,
            -cy,
          ]);
        } else {
          m = rot;
        }
        break;
      }
      case 'skewX':
        m = [1, 0, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        m = [1, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
      default:
        throw new Error(`不支援的 transform：${name}()`);
    }
    result = multiply(result, m);
  }
  return result;
}
