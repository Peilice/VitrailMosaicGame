export interface Point {
  x: number;
  y: number;
}

export type GlassTexture = 'ripple' | 'bubble' | 'crackle';

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
