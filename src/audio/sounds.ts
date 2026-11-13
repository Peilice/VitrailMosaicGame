/** 三個核心音效：拾起、放錯、正確鑲嵌 */
export const SOUND_NAMES = ['pickup', 'wrong', 'set'] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

/**
 * 音效檔的預設路徑（相對於 `baseUrl`，即 `public/` 底下）。
 * 檔案不存在或無法解碼時，會改用 `synth.ts` 合成的備用音效。
 */
export const DEFAULT_SOUND_FILES: Readonly<Record<SoundName, string>> = {
  pickup: 'audio/pickup.mp3',
  wrong: 'audio/wrong.mp3',
  set: 'audio/set.mp3',
};
