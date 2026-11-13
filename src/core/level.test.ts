import { describe, expect, it } from 'vitest';
import { LevelError, loadLevel, parseLevel } from './level';

const piece = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: 'a',
  polygon: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
  color: '#ff8800',
  texture: 'ripple',
  centroid: { x: 6.67, y: 3.33 },
  ...over,
});

const level = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  version: 1,
  width: 100,
  height: 80,
  pieces: [piece()],
  ...over,
});

describe('parseLevel', () => {
  it('接受合法資料並原樣回傳內容', () => {
    const data = level({
      pieces: [piece(), piece({ id: 'b', texture: 'crackle' })],
    });
    const parsed = parseLevel(data);
    expect(parsed.version).toBe(1);
    expect(parsed.width).toBe(100);
    expect(parsed.height).toBe(80);
    expect(parsed.pieces.map((p) => p.id)).toEqual(['a', 'b']);
    expect(parsed.pieces[1]!.texture).toBe('crackle');
    expect(parsed.pieces[0]!.polygon).toHaveLength(3);
  });

  it.each([
    ['不是物件', null, '必須是物件'],
    ['版本不符', level({ version: 2 }), '不支援的關卡版本'],
    ['缺少版本', level({ version: undefined }), '不支援的關卡版本'],
    ['width 為 0', level({ width: 0 }), 'width'],
    ['height 不是數字', level({ height: '80' }), 'height'],
    ['pieces 為空', level({ pieces: [] }), '非空陣列'],
    ['pieces 不是陣列', level({ pieces: {} }), '非空陣列'],
    ['片不是物件', level({ pieces: [42] }), 'pieces[0]'],
    ['缺少 id', level({ pieces: [piece({ id: '' })] }), '缺少 id'],
    ['顏色格式錯', level({ pieces: [piece({ color: 'red' })] }), 'color'],
    ['顏色含大寫', level({ pieces: [piece({ color: '#FF8800' })] }), 'color'],
    ['紋理無效', level({ pieces: [piece({ texture: 'wood' })] }), 'texture'],
    [
      '頂點不足',
      level({ pieces: [piece({ polygon: [{ x: 0, y: 0 }] })] }),
      '至少需要 3 個',
    ],
    [
      '頂點含 NaN',
      level({
        pieces: [
          piece({
            polygon: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
              { x: NaN, y: 0 },
            ],
          }),
        ],
      }),
      'polygon[2]',
    ],
    [
      '缺少形心',
      level({ pieces: [piece({ centroid: undefined })] }),
      'centroid',
    ],
    ['id 重複', level({ pieces: [piece(), piece()] }), '重複'],
  ])('%s 會丟出 LevelError', (_name, data, message) => {
    expect(() => parseLevel(data)).toThrow(LevelError);
    expect(() => parseLevel(data)).toThrow(message);
  });

  it('錯誤訊息指出是哪一片玻璃', () => {
    expect(() =>
      parseLevel(
        level({ pieces: [piece({ id: 'wing-left', texture: 'wood' })] }),
      ),
    ).toThrow('wing-left');
  });
});

describe('loadLevel', () => {
  const respond = (body: unknown, init: ResponseInit = {}): typeof fetch =>
    (() =>
      Promise.resolve(
        new Response(JSON.stringify(body), init),
      )) as typeof fetch;

  it('抓取並解析關卡', async () => {
    const result = await loadLevel('levels/a.json', respond(level()));
    expect(result.pieces).toHaveLength(1);
  });

  it('把 URL 傳給 fetch', async () => {
    let seen = '';
    const fetchFn = ((url: string) => {
      seen = url;
      return Promise.resolve(new Response(JSON.stringify(level())));
    }) as typeof fetch;
    await loadLevel('levels/a.json', fetchFn);
    expect(seen).toBe('levels/a.json');
  });

  it('網路錯誤會包成 LevelError 並保留原因', async () => {
    const boom = new TypeError('Failed to fetch');
    const fetchFn = (() => Promise.reject(boom)) as typeof fetch;
    const err = await loadLevel('levels/a.json', fetchFn).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(LevelError);
    expect((err as LevelError).cause).toBe(boom);
  });

  it('HTTP 錯誤會帶上狀態碼', async () => {
    await expect(
      loadLevel('levels/a.json', respond({}, { status: 404 })),
    ).rejects.toThrow('404');
  });

  it('回應不是 JSON 時丟出 LevelError', async () => {
    const fetchFn = (() =>
      Promise.resolve(new Response('<html>'))) as typeof fetch;
    await expect(loadLevel('levels/a.json', fetchFn)).rejects.toThrow(
      '不是有效的 JSON',
    );
  });

  it('格式錯誤的訊息包含 URL 與原因', async () => {
    await expect(
      loadLevel('levels/a.json', respond(level({ version: 9 }))),
    ).rejects.toThrow(/levels\/a\.json.*版本/);
  });
});
