import { Application, Graphics } from 'pixi.js';

async function bootstrap(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) throw new Error('找不到 #app 容器');

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#0b0b10',
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  host.appendChild(app.canvas);

  // 佔位內容：確認 PixiJS 管線可運作，之後由關卡場景取代
  const g = new Graphics()
    .poly([-60, 40, 0, -70, 60, 40])
    .fill(0x4aa3ff)
    .stroke({ width: 8, color: 0x000000 });
  g.position.set(app.screen.width / 2, app.screen.height / 2);
  app.stage.addChild(g);
}

void bootstrap();
