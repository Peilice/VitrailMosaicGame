import { GlProgram, Shader } from 'pixi.js';
import { hexToRgb } from '../core/color';
import type { GlassTexture } from '../core/types';

/**
 * 玻璃片的 shader。所有玻璃共用同一個 GlProgram（編譯一次），
 * 但每片有自己的 Shader 與 uniform（顏色、紋理種類、亮度、種子）。
 *
 * 寫法上的考量：
 * - 沒有 `#version 300 es`，所以以 GLSL ES 1.0 編譯，WebGL1 與 WebGL2 都能跑；
 *   因此不用 texelFetch、整數位元運算，迴圈邊界必須是常數。
 * - 要求 highp 精度（裝置不支援時 Pixi 會自動降為 mediump），並且讓紋理座標保持小範圍
 *   （見 piece-view.ts 的 uv 縮放），避免手機上 fp16 造成雜點或色帶。
 * - 輸出是 premultiplied alpha，並乘上 Pixi 提供的 uColor 與 uWorldColorAlpha，
 *   這樣容器或 mesh 的 alpha、tint 才會生效。
 */
const VERTEX = `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}`;

const FRAGMENT = `
precision highp float;

in vec2 vUV;
out vec4 finalColor;

uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;

uniform vec3 uBase;     // 玻璃底色
uniform float uKind;    // 0 水波紋、1 氣泡、2 冰裂紋
uniform float uLit;     // 0 暗沉、1 背後有光
uniform float uSeed;    // 每片玻璃的紋理種子 [0,1)
uniform float uRadius;  // 玻璃片中心到最遠頂點的距離（uv 單位）

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec2 hash2(vec2 p) {
  return vec2(hash(p), hash(p + vec2(37.3, 91.7)));
}

// 每個紋理回傳 vec2(明暗變化, 亮部高光)
vec2 ripple(vec2 p) {
  float a = sin(p.x * 3.0 + sin(p.y * 2.3 + uSeed * 6.0) * 1.8);
  float b = sin(p.y * 4.1 - sin(p.x * 1.9 + uSeed * 3.0) * 1.4);
  float s = (a + b) * 0.25;
  return vec2(s * 0.34, max(0.0, s - 0.28) * 0.6);
}

vec2 bubbles(vec2 p) {
  vec2 q = p * 2.4 + uSeed * 10.0;
  vec2 cell = floor(q);
  vec2 f = fract(q);
  float shade = 0.0;
  float hi = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 id = cell + g;
      float present = step(0.4, hash(id + 3.1));
      float r = 0.12 + 0.2 * hash(id + 7.7);
      float dist = length(f - (g + hash2(id)));
      float rim = smoothstep(r - 0.05, r, dist) - smoothstep(r, r + 0.035, dist);
      float inside = 1.0 - smoothstep(r - 0.03, r, dist);
      shade += present * (0.28 * rim - 0.12 * inside);
      hi += present * (0.55 * rim + 0.08 * inside);
    }
  }
  return vec2(shade, hi);
}

vec2 crackle(vec2 p) {
  vec2 q = p * 1.8 + uSeed * 10.0;
  vec2 cell = floor(q);
  vec2 f = fract(q);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + hash2(cell + g) - f;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  float edge = sqrt(d2) - sqrt(d1);
  float line = 1.0 - smoothstep(0.0, 0.07, edge);
  return vec2((0.5 - d1) * 0.2 - line * 0.08, line * 0.42);
}

void main() {
  vec2 pat;
  if (uKind < 0.5) {
    pat = ripple(vUV);
  } else if (uKind < 1.5) {
    pat = bubbles(vUV);
  } else {
    pat = crackle(vUV);
  }

  float luma = dot(uBase, vec3(0.299, 0.587, 0.114));
  // 還沒拼上：稍微褪色、暗沉，但顏色仍要看得出來（玩家靠顏色找位置）
  vec3 dimCol = mix(vec3(luma), uBase, 0.75) * 0.62;
  // 拼上後：飽和、明亮，中心比邊緣更亮，像背後有光打過來
  float r = clamp(length(vUV) / max(uRadius, 0.0001), 0.0, 1.0);
  vec3 litCol = mix(vec3(luma), uBase, 1.1) * 0.9 * (1.0 + 0.4 * (1.0 - r));

  vec3 col = mix(dimCol, litCol, uLit);
  col *= 1.0 + pat.x;
  col += vec3(pat.y) * mix(0.35, 1.0, uLit);
  col = clamp(col, 0.0, 1.0);

  finalColor = vec4(col, 1.0) * uColor * uWorldColorAlpha;
}`;

const KIND: Record<GlassTexture, number> = { ripple: 0, bubble: 1, crackle: 2 };

let program: GlProgram | null = null;

function getProgram(): GlProgram {
  program ??= GlProgram.from({
    vertex: VERTEX,
    fragment: FRAGMENT,
    name: 'vitrail-glass',
  });
  return program;
}

export interface GlassOptions {
  color: string;
  texture: GlassTexture;
  /** [0, 1)，用來讓每片玻璃的紋理不同 */
  seed: number;
  /** 玻璃片中心到最遠頂點的距離，單位是 uv（已乘上紋理縮放） */
  radius: number;
}

export function createGlassShader(options: GlassOptions): Shader {
  return new Shader({
    glProgram: getProgram(),
    resources: {
      glass: {
        uBase: {
          value: new Float32Array(hexToRgb(options.color)),
          type: 'vec3<f32>',
        },
        uKind: { value: KIND[options.texture], type: 'f32' },
        uLit: { value: 0, type: 'f32' },
        uSeed: { value: options.seed, type: 'f32' },
        uRadius: { value: options.radius, type: 'f32' },
      },
    },
  });
}

export function setGlassLit(shader: Shader, lit: number): void {
  shader.resources.glass.uniforms.uLit = lit;
}
