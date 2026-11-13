import { describe, expect, it } from 'vitest';
import { SoundPlayer } from './sound-player';
import type { AudioContextLike } from './sound-player';

interface FakeSource {
  buffer: unknown;
  playbackRate: { value: number };
  connectedTo: unknown;
  started: number;
}

/** 記錄所有呼叫的假 AudioContext */
class FakeContext implements AudioContextLike {
  state = 'suspended';
  sampleRate = 8000;
  currentTime = 0;
  destination = { name: 'destination' };
  resumeCalls = 0;
  resumeFails = false;
  decodeFails: ReadonlySet<number> = new Set();
  decoded: ArrayBuffer[] = [];
  synthesized: Float32Array[] = [];
  sources: FakeSource[] = [];
  master = { gain: { value: -1 }, connectedTo: null as unknown };

  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.resumeFails) return Promise.reject(new Error('blocked'));
    this.state = 'running';
    return Promise.resolve();
  }

  decodeAudioData(data: ArrayBuffer): Promise<unknown> {
    const index = this.decoded.length;
    this.decoded.push(data);
    if (this.decodeFails.has(index)) return Promise.reject(new Error('bad'));
    return Promise.resolve({ decoded: index });
  }

  createBuffer(_channels: number, length: number, sampleRate: number) {
    const buffer = { synth: true, length, sampleRate };
    return {
      ...buffer,
      copyToChannel: (source: Float32Array) => {
        this.synthesized.push(source);
      },
    };
  }

  createBufferSource() {
    const source: FakeSource & {
      connect(d: unknown): void;
      start(): void;
    } = {
      buffer: null,
      playbackRate: { value: 1 },
      connectedTo: null,
      started: 0,
      connect(d) {
        source.connectedTo = d;
      },
      start() {
        source.started++;
      },
    };
    this.sources.push(source);
    return source;
  }

  createGain() {
    const master = this.master;
    return {
      gain: master.gain,
      connect(d: unknown) {
        master.connectedTo = d;
      },
    };
  }
}

const fileResponse = (): Response => new Response(new Uint8Array([1, 2, 3]));
const okFetch: typeof fetch = () => Promise.resolve(fileResponse());
const failingFetch: typeof fetch = () =>
  Promise.reject(new TypeError('offline'));

function make(
  over: {
    ctx?: FakeContext;
    fetchFn?: typeof fetch;
    random?: () => number;
  } = {},
): { player: SoundPlayer; ctx: FakeContext } {
  const ctx = over.ctx ?? new FakeContext();
  const player = new SoundPlayer({
    createContext: () => ctx,
    fetchFn: over.fetchFn ?? failingFetch,
    random: over.random ?? (() => 0.5),
  });
  return { player, ctx };
}

describe('unlock 之前', () => {
  it('play 不會有聲音也不會出錯，也不會提早建立 AudioContext', () => {
    let created = 0;
    const player = new SoundPlayer({
      createContext: () => {
        created++;
        return new FakeContext();
      },
      fetchFn: failingFetch,
    });
    expect(() => player.play('set')).not.toThrow();
    expect(created).toBe(0);
  });
});

describe('unlock', () => {
  it('建立 context、啟動它，並把 master 增益接到輸出', async () => {
    const { player, ctx } = make();
    await player.unlock();
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.state).toBe('running');
    expect(ctx.master.connectedTo).toBe(ctx.destination);
    expect(ctx.master.gain.value).toBe(1);
  });

  it('resume 在同步階段就被呼叫（才符合「在使用者操作當下啟動」）', () => {
    const { player, ctx } = make();
    void player.unlock();
    expect(ctx.resumeCalls).toBe(1);
  });

  it('重複呼叫只會建立與啟動一次', async () => {
    let created = 0;
    const ctx = new FakeContext();
    const player = new SoundPlayer({
      createContext: () => {
        created++;
        return ctx;
      },
      fetchFn: failingFetch,
    });
    await Promise.all([player.unlock(), player.unlock()]);
    await player.unlock();
    expect(created).toBe(1);
    expect(ctx.resumeCalls).toBe(1);
  });

  it('沒有音效檔（下載失敗）時，三個音效都改用合成音效', async () => {
    const { player, ctx } = make({ fetchFn: failingFetch });
    await player.unlock();
    expect(ctx.decoded).toHaveLength(0);
    expect(ctx.synthesized).toHaveLength(3);
    expect(ctx.synthesized.every((d) => d.length > 0)).toBe(true);
  });

  it('伺服器回 404 時也使用合成音效', async () => {
    const notFound: typeof fetch = () =>
      Promise.resolve(new Response('missing', { status: 404 }));
    const { player, ctx } = make({ fetchFn: notFound });
    await player.unlock();
    expect(ctx.decoded).toHaveLength(0);
    expect(ctx.synthesized).toHaveLength(3);
  });

  it('有音效檔時解碼檔案，不使用合成音效', async () => {
    const { player, ctx } = make({ fetchFn: okFetch });
    await player.unlock();
    expect(ctx.decoded).toHaveLength(3);
    expect(ctx.synthesized).toHaveLength(0);
  });

  it('某個檔案解碼失敗時，只有那個音效退回合成', async () => {
    const ctx = new FakeContext();
    ctx.decodeFails = new Set([1]);
    const { player } = make({ ctx, fetchFn: okFetch });
    await player.unlock();
    expect(ctx.decoded).toHaveLength(3);
    expect(ctx.synthesized).toHaveLength(1);
  });

  it('回傳的是檔案的複本，原始資料不會被解碼吃掉', async () => {
    const { player, ctx } = make({ fetchFn: okFetch });
    await player.unlock();
    expect(ctx.decoded[0]!.byteLength).toBe(3);
  });

  it('resume 被拒絕時不會丟出錯誤，音效仍可用', async () => {
    const ctx = new FakeContext();
    ctx.resumeFails = true;
    const { player } = make({ ctx });
    await expect(player.unlock()).resolves.toBeUndefined();
    player.play('set');
    expect(ctx.sources).toHaveLength(1);
  });

  it('瀏覽器不支援 Web Audio（建立 context 就丟錯）時維持無聲、不出錯', async () => {
    const player = new SoundPlayer({
      createContext: () => {
        throw new Error('unsupported');
      },
      fetchFn: failingFetch,
    });
    await expect(player.unlock()).resolves.toBeUndefined();
    expect(() => player.play('pickup')).not.toThrow();
  });

  it('prefetch 可以先於 unlock 執行，且只會下載一次', async () => {
    let fetches = 0;
    const counting: typeof fetch = () => {
      fetches++;
      return Promise.resolve(fileResponse());
    };
    const { player } = make({ fetchFn: counting });
    await player.prefetch();
    await player.prefetch();
    await player.unlock();
    expect(fetches).toBe(3);
  });
});

describe('play', () => {
  it('播放：建立來源、接到 master、開始播放', async () => {
    const { player, ctx } = make();
    await player.unlock();
    player.play('set');
    expect(ctx.sources).toHaveLength(1);
    const source = ctx.sources[0]!;
    expect(source.buffer).toBeTruthy();
    expect((source.connectedTo as { gain: unknown }).gain).toBe(
      ctx.master.gain,
    );
    expect(source.started).toBe(1);
  });

  it('三個音效各自使用自己的緩衝', async () => {
    const { player, ctx } = make({ fetchFn: okFetch });
    await player.unlock();
    player.play('pickup');
    player.play('wrong');
    player.play('set');
    const buffers = ctx.sources.map((s) => JSON.stringify(s.buffer));
    expect(new Set(buffers).size).toBe(3);
  });

  it('音高隨機變化在設定的幅度內', async () => {
    const lo = make({ random: () => 0 });
    await lo.player.unlock();
    lo.player.play('pickup');
    expect(lo.ctx.sources[0]!.playbackRate.value).toBeCloseTo(0.94);

    const hi = make({ random: () => 1 });
    await hi.player.unlock();
    hi.player.play('pickup');
    expect(hi.ctx.sources[0]!.playbackRate.value).toBeCloseTo(1.06);

    const mid = make({ random: () => 0.5 });
    await mid.player.unlock();
    mid.player.play('set');
    expect(mid.ctx.sources[0]!.playbackRate.value).toBeCloseTo(1);
  });

  it('同一個音效在最短間隔內重複觸發會被略過，間隔過後恢復', async () => {
    const { player, ctx } = make();
    await player.unlock();
    player.play('pickup');
    ctx.currentTime = 0.01;
    player.play('pickup');
    expect(ctx.sources).toHaveLength(1);
    ctx.currentTime = 0.05;
    player.play('pickup');
    expect(ctx.sources).toHaveLength(2);
  });

  it('不同音效的間隔互不影響', async () => {
    const { player, ctx } = make();
    await player.unlock();
    player.play('pickup');
    player.play('set');
    expect(ctx.sources).toHaveLength(2);
  });

  it('context 被系統暫停時，播放前會嘗試恢復', async () => {
    const { player, ctx } = make();
    await player.unlock();
    ctx.state = 'suspended';
    player.play('set');
    expect(ctx.resumeCalls).toBe(2);
  });
});

describe('靜音', () => {
  it('靜音時不播放，取消靜音後恢復', async () => {
    const { player, ctx } = make();
    await player.unlock();
    player.setMuted(true);
    expect(player.muted).toBe(true);
    player.play('set');
    expect(ctx.sources).toHaveLength(0);
    expect(ctx.master.gain.value).toBe(0);

    player.setMuted(false);
    expect(player.muted).toBe(false);
    expect(ctx.master.gain.value).toBe(1);
    player.play('set');
    expect(ctx.sources).toHaveLength(1);
  });

  it('unlock 之前就設為靜音：解鎖後仍是靜音', async () => {
    const { player, ctx } = make();
    player.setMuted(true);
    await player.unlock();
    expect(ctx.master.gain.value).toBe(0);
    player.play('set');
    expect(ctx.sources).toHaveLength(0);
  });

  it('在解碼進行中切換靜音也會生效', async () => {
    const { player, ctx } = make({ fetchFn: okFetch });
    const unlocking = player.unlock();
    player.setMuted(true);
    await unlocking;
    expect(ctx.master.gain.value).toBe(0);
  });

  it('預設不是靜音', () => {
    expect(make().player.muted).toBe(false);
  });
});
