import { Application } from 'pixi.js';
import { SoundPlayer } from './audio/sound-player';
import { Game } from './game';
import { bindGestures } from './input/bind';

const DEFAULT_LEVEL = 'test-window';

function showError(host: HTMLElement, message: string): void {
  const el = document.createElement('p');
  el.textContent = message;
  el.style.cssText =
    'position:fixed;inset:0;display:grid;place-items:center;margin:0;padding:24px;' +
    'color:#e8e8f0;font:16px/1.6 system-ui,sans-serif;text-align:center';
  host.appendChild(el);
}

function setupMuteButton(sounds: SoundPlayer): void {
  const button = document.getElementById('mute');
  if (!(button instanceof HTMLButtonElement)) return;
  const on = button.querySelector<SVGElement>('.icon-on');
  const off = button.querySelector<SVGElement>('.icon-off');
  const render = (): void => {
    button.setAttribute('aria-pressed', String(sounds.muted));
    button.setAttribute('aria-label', sounds.muted ? '取消靜音' : '靜音');
    on?.toggleAttribute('hidden', sounds.muted);
    off?.toggleAttribute('hidden', !sounds.muted);
  };
  // 按鈕本身也是第一次使用者操作，順便解鎖音訊
  button.addEventListener('click', () => {
    void sounds.unlock();
    sounds.setMuted(!sounds.muted);
    render();
  });
  render();
}

/** `?bloom=1` 強制開、`?bloom=0` 強制關，沒有指定就依幀率自動決定 */
function bloomOption(): 'auto' | boolean {
  const v = new URLSearchParams(location.search).get('bloom');
  return v === '1' ? true : v === '0' ? false : 'auto';
}

function setupReplayButton(game: Game): void {
  const button = document.getElementById('replay');
  const status = document.getElementById('status');
  if (!(button instanceof HTMLButtonElement)) return;
  const show = (): void => {
    button.hidden = false;
    if (status) status.textContent = '完成了！';
    button.focus({ preventScroll: true });
  };
  button.addEventListener('click', () => game.restart());
  if (game.finished) show();
  game.onFinished = show;
}

async function bootstrap(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) throw new Error('找不到 #app 容器');

  const requested = new URLSearchParams(location.search).get('level');
  const levelId =
    requested && /^[\w-]+$/.test(requested) ? requested : DEFAULT_LEVEL;

  const app = new Application();
  await app.init({
    // 玻璃 shader 目前只有 WebGL 版本，明確指定而不依賴預設
    preference: 'webgl',
    resizeTo: window,
    background: '#0b0b10',
    antialias: true,
    // 高密度螢幕上限 2 倍，效能與清晰度的折衷
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  host.appendChild(app.canvas);

  const sounds = new SoundPlayer();
  void sounds.prefetch();

  let game: Game;
  try {
    game = await Game.create(
      app,
      `levels/${levelId}.json`,
      levelId,
      sounds,
      undefined,
      {
        bloom: bloomOption(),
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)')
          .matches,
      },
    );
  } catch (e) {
    console.error(e);
    showError(host, `無法載入關卡「${levelId}」。請重新整理頁面再試一次。`);
    return;
  }

  bindGestures(app.canvas, game.controller);
  // 瀏覽器只在「使用者操作」當下允許啟動音訊：滑鼠按下就算，
  // 觸控與觸控筆要等到 pointerup（touchend）才算，所以那兩種等放開時再解鎖
  app.canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') void sounds.unlock();
  });
  app.canvas.addEventListener('pointerup', () => void sounds.unlock());
  setupMuteButton(sounds);
  setupReplayButton(game);
  app.ticker.add((ticker) => game.update(ticker.deltaMS / 1000));

  if (import.meta.env.DEV) {
    (window as unknown as { __game: Game }).__game = game;
  }
}

void bootstrap();
