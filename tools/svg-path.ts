import type { Point } from '../src/core/types.ts';

export interface Subpath {
  points: Point[];
  closed: boolean;
}

const NUMBER_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

/** path `d` 屬性的掃描器 */
class Scanner {
  private pos = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  skipSeparators(): void {
    while (this.pos < this.text.length && /[\s,]/.test(this.text[this.pos]!))
      this.pos++;
  }

  atEnd(): boolean {
    this.skipSeparators();
    return this.pos >= this.text.length;
  }

  /** 下一個字元若是指令字母則回傳（不消耗） */
  peekCommand(): string | null {
    this.skipSeparators();
    const ch = this.text[this.pos];
    return ch !== undefined && /[A-Za-z]/.test(ch) ? ch : null;
  }

  consume(): string {
    return this.text[this.pos++]!;
  }

  number(): number {
    this.skipSeparators();
    NUMBER_RE.lastIndex = this.pos;
    const m = NUMBER_RE.exec(this.text);
    if (!m) {
      throw new Error(
        `path 資料在位置 ${this.pos} 需要數字：「${this.text.slice(this.pos, this.pos + 12)}」`,
      );
    }
    this.pos += m[0].length;
    return Number(m[0]);
  }

  /** 弧線旗標只能是單一字元 0 或 1，且可能與後面的數字相連（如 `a1 1 0 011 1`） */
  flag(): boolean {
    this.skipSeparators();
    const ch = this.text[this.pos];
    if (ch !== '0' && ch !== '1') {
      throw new Error(`path 資料在位置 ${this.pos} 需要弧線旗標 0 或 1`);
    }
    this.pos++;
    return ch === '1';
  }
}

function distToChord(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / Math.sqrt(len2);
}

const mid = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

/** 三次貝茲曲線遞迴細分，輸出不含起點 */
function flattenCubic(
  p0: Point,
  c1: Point,
  c2: Point,
  p3: Point,
  tol: number,
  out: Point[],
  depth = 0,
): void {
  if (
    depth >= 16 ||
    Math.max(distToChord(c1, p0, p3), distToChord(c2, p0, p3)) <= tol
  ) {
    out.push(p3);
    return;
  }
  const p01 = mid(p0, c1);
  const p12 = mid(c1, c2);
  const p23 = mid(c2, p3);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const m = mid(p012, p123);
  flattenCubic(p0, p01, p012, m, tol, out, depth + 1);
  flattenCubic(m, p123, p23, p3, tol, out, depth + 1);
}

/** 橢圓弧（SVG 規格 F.6.5 端點轉中心參數），輸出不含起點 */
function flattenArc(
  p0: Point,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  large: boolean,
  sweep: boolean,
  p1: Point,
  tol: number,
  out: Point[],
): void {
  if (p0.x === p1.x && p0.y === p1.y) return;
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) {
    out.push(p1);
    return;
  }
  const phi = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (p0.x + p1.x) / 2;
  const cy = sin * cxp + cos * cyp + (p0.y + p1.y) / 2;
  const theta1 = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
  let dtheta = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx) - theta1;
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI;

  const rmax = Math.max(rx, ry);
  const step = rmax > tol ? 2 * Math.acos(1 - tol / rmax) : Math.PI / 2;
  const n = Math.max(1, Math.ceil(Math.abs(dtheta) / step));
  for (let i = 1; i < n; i++) {
    const t = theta1 + (dtheta * i) / n;
    out.push({
      x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
      y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
    });
  }
  out.push(p1);
}

const COMMANDS = 'MmLlHhVvCcSsQqTtAaZz';

/**
 * 解析 SVG path 的 `d` 屬性，把曲線與弧線攤平成折線。
 * `tolerance` 是折線與真實曲線的最大距離（使用者座標單位）。
 */
export function flattenPath(d: string, tolerance: number): Subpath[] {
  const sc = new Scanner(d);
  const subpaths: Subpath[] = [];
  let cur: Subpath | null = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let cmd = '';
  let lastCubic: Point | null = null; // 上一個 C/S 的第二控制點（供 S 反射）
  let lastQuad: Point | null = null; // 上一個 Q/T 的控制點（供 T 反射）

  const ensure = (): Point[] => {
    if (cur === null) {
      cur = { points: [{ x, y }], closed: false };
      subpaths.push(cur);
    }
    return cur.points;
  };

  while (!sc.atEnd()) {
    const letter = sc.peekCommand();
    if (letter !== null) {
      if (!COMMANDS.includes(letter))
        throw new Error(`path 含有不支援的指令：${letter}`);
      cmd = sc.consume();
      if (subpaths.length === 0 && cmd !== 'M' && cmd !== 'm') {
        throw new Error('path 必須以 M 或 m 開頭');
      }
    } else if (cmd === '' || cmd === 'Z' || cmd === 'z') {
      throw new Error('path 資料在指令之後出現多餘的數字');
    }

    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    let nextCubic: Point | null = null;
    let nextQuad: Point | null = null;

    switch (cmd.toUpperCase()) {
      case 'M': {
        x = sc.number() + ox;
        y = sc.number() + oy;
        startX = x;
        startY = y;
        cur = { points: [{ x, y }], closed: false };
        subpaths.push(cur);
        cmd = rel ? 'l' : 'L'; // M 後面接續的座標視為 L
        break;
      }
      case 'L': {
        const p = { x: sc.number() + ox, y: sc.number() + oy };
        ensure().push(p);
        x = p.x;
        y = p.y;
        break;
      }
      case 'H': {
        x = sc.number() + ox;
        ensure().push({ x, y });
        break;
      }
      case 'V': {
        y = sc.number() + oy;
        ensure().push({ x, y });
        break;
      }
      case 'C': {
        const c1 = { x: sc.number() + ox, y: sc.number() + oy };
        const c2 = { x: sc.number() + ox, y: sc.number() + oy };
        const p = { x: sc.number() + ox, y: sc.number() + oy };
        flattenCubic({ x, y }, c1, c2, p, tolerance, ensure());
        nextCubic = c2;
        x = p.x;
        y = p.y;
        break;
      }
      case 'S': {
        const c1 = lastCubic
          ? { x: 2 * x - lastCubic.x, y: 2 * y - lastCubic.y }
          : { x, y };
        const c2 = { x: sc.number() + ox, y: sc.number() + oy };
        const p = { x: sc.number() + ox, y: sc.number() + oy };
        flattenCubic({ x, y }, c1, c2, p, tolerance, ensure());
        nextCubic = c2;
        x = p.x;
        y = p.y;
        break;
      }
      case 'Q':
      case 'T': {
        let q: Point;
        if (cmd.toUpperCase() === 'Q') {
          q = { x: sc.number() + ox, y: sc.number() + oy };
        } else {
          q = lastQuad
            ? { x: 2 * x - lastQuad.x, y: 2 * y - lastQuad.y }
            : { x, y };
        }
        const p = { x: sc.number() + ox, y: sc.number() + oy };
        const p0 = { x, y };
        // 二次貝茲升為三次
        const c1 = {
          x: p0.x + (2 / 3) * (q.x - p0.x),
          y: p0.y + (2 / 3) * (q.y - p0.y),
        };
        const c2 = {
          x: p.x + (2 / 3) * (q.x - p.x),
          y: p.y + (2 / 3) * (q.y - p.y),
        };
        flattenCubic(p0, c1, c2, p, tolerance, ensure());
        nextQuad = q;
        x = p.x;
        y = p.y;
        break;
      }
      case 'A': {
        const rx = sc.number();
        const ry = sc.number();
        const rot = sc.number();
        const large = sc.flag();
        const sweep = sc.flag();
        const p = { x: sc.number() + ox, y: sc.number() + oy };
        flattenArc({ x, y }, rx, ry, rot, large, sweep, p, tolerance, ensure());
        x = p.x;
        y = p.y;
        break;
      }
      case 'Z': {
        if (cur !== null) (cur as Subpath).closed = true;
        cur = null;
        x = startX;
        y = startY;
        break;
      }
    }
    lastCubic = nextCubic;
    lastQuad = nextQuad;
  }
  return subpaths;
}
