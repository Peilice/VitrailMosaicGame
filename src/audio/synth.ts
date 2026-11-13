import type { SoundName } from './sounds';

/**
 * 程序化合成的備用音效。沒有放真正的音效檔（或載入、解碼失敗）時使用，
 * 讓遊戲在沒有任何素材的情況下也有基本的回饋音。
 * 結果只取決於 (name, sampleRate)，每次都完全相同。
 */

const TAU = Math.PI * 2;

/** 決定性的雜訊產生器（mulberry32），輸出範圍 [-1, 1) */
function noiseSource(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** 一階低通濾波器，`coef` 越小越悶 */
function lowpass(coef: number): (x: number) => number {
  let y = 0;
  return (x) => {
    y += coef * (x - y);
    return y;
  };
}

/** 衰減包絡：極短的淡入避免爆音，之後指數衰減 */
const envelope = (t: number, attack: number, decay: number): number =>
  (t < attack ? t / attack : 1) * Math.exp(-t / decay);

function render(
  seconds: number,
  sampleRate: number,
  sample: (t: number) => number,
): Float32Array {
  const data = new Float32Array(Math.max(1, Math.round(seconds * sampleRate)));
  for (let i = 0; i < data.length; i++) data[i] = sample(i / sampleRate);
  return data;
}

/** 正規化到指定峰值，並對最後 5 毫秒淡出，避免結尾的爆音 */
function finish(
  data: Float32Array,
  sampleRate: number,
  peak: number,
): Float32Array {
  let max = 0;
  for (const v of data) max = Math.max(max, Math.abs(v));
  const gain = max > 0 ? peak / max : 0;
  const fade = Math.min(data.length, Math.round(0.005 * sampleRate));
  for (let i = 0; i < data.length; i++) {
    const out = i >= data.length - fade ? (data.length - 1 - i) / fade : 1;
    data[i] = data[i]! * gain * out;
  }
  return data;
}

/** 拾起：輕微的玻璃摩擦聲（短促、柔和的高頻雜訊） */
function pickup(sampleRate: number): Float32Array {
  const noise = noiseSource(1);
  const filter = lowpass(0.35);
  return finish(
    render(
      0.12,
      sampleRate,
      (t) => filter(noise()) * envelope(t, 0.006, 0.025),
    ),
    sampleRate,
    0.35,
  );
}

/** 放錯：沉悶的敲擊聲（低頻下滑的正弦加一點悶悶的雜訊） */
function wrong(sampleRate: number): Float32Array {
  const noise = noiseSource(2);
  const filter = lowpass(0.1);
  let phase = 0;
  return finish(
    render(0.25, sampleRate, (t) => {
      const freq = 70 + 40 * Math.exp(-t / 0.04);
      phase += (TAU * freq) / sampleRate;
      return (
        Math.sin(phase) * envelope(t, 0.002, 0.06) +
        filter(noise()) * 0.3 * Math.exp(-t / 0.01)
      );
    }),
    sampleRate,
    0.7,
  );
}

/** 鑲嵌：清脆的玻璃卡榫聲，尾巴帶兩個小小的魔法閃音 */
function set(sampleRate: number): Float32Array {
  const noise = noiseSource(3);
  // 玻璃敲擊的泛音不成整數倍，所以聽起來像「叮」而不是音符
  const partials = [
    { freq: 2093, amp: 1, decay: 0.18 },
    { freq: 3322, amp: 0.6, decay: 0.12 },
    { freq: 4699, amp: 0.35, decay: 0.08 },
  ];
  const sparkles = [
    { freq: 3136, start: 0.07 },
    { freq: 4186, start: 0.14 },
  ];
  return finish(
    render(0.7, sampleRate, (t) => {
      let v = noise() * 0.8 * Math.exp(-t / 0.002); // 開頭的「喀」
      for (const p of partials) {
        v += p.amp * Math.sin(TAU * p.freq * t) * envelope(t, 0.001, p.decay);
      }
      for (const s of sparkles) {
        if (t >= s.start) {
          const local = t - s.start;
          v += 0.3 * Math.sin(TAU * s.freq * t) * envelope(local, 0.003, 0.12);
        }
      }
      return v;
    }),
    sampleRate,
    0.55,
  );
}

export function synthesize(name: SoundName, sampleRate: number): Float32Array {
  switch (name) {
    case 'pickup':
      return pickup(sampleRate);
    case 'wrong':
      return wrong(sampleRate);
    case 'set':
      return set(sampleRate);
  }
}
