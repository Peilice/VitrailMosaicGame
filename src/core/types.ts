export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** 螢幕座標中的矩形（左上角加尺寸） */
export interface Rect extends Size {
  x: number;
  y: number;
}

export const GLASS_TEXTURES = ['ripple', 'bubble', 'crackle'] as const;
export type GlassTexture = (typeof GLASS_TEXTURES)[number];

/** 關卡 JSON 中的一片玻璃（格子形狀等於玻璃形狀） */
export interface PieceData {
  id: string;
  polygon: Point[];
  color: string;
  texture: GlassTexture;
  centroid: Point;
}

export interface LevelData {
  version: 1;
  width: number;
  height: number;
  pieces: PieceData[];
}
