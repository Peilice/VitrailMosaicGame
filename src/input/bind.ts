import type { Point } from '../core/types';
import type { GestureController } from './gesture';

const LINE_HEIGHT_PX = 16;

/**
 * 把 DOM 的 Pointer Events 與滾輪轉接到 GestureController，回傳解除綁定的函式。
 * 滑鼠只處理左鍵（右鍵留給之後的旋轉）；觸控與觸控筆不受影響。
 */
export function bindGestures(
  element: HTMLElement,
  controller: GestureController,
): () => void {
  // 讓瀏覽器不要自己處理捲動與縮放，全部交給遊戲
  element.style.touchAction = 'none';

  const local = (e: MouseEvent): Point => {
    const rect = element.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      // 指標移出畫布外仍持續收到事件
      element.setPointerCapture(e.pointerId);
    } catch {
      // 指標已經失效時會丟出例外，忽略即可
    }
    e.preventDefault();
    controller.pointerDown(e.pointerId, local(e));
  };

  const onPointerMove = (e: PointerEvent): void => {
    controller.pointerMove(e.pointerId, local(e));
  };

  const onPointerUp = (e: PointerEvent): void => {
    controller.pointerUp(e.pointerId, local(e));
  };

  const onPointerCancel = (e: PointerEvent): void => {
    controller.pointerCancel(e.pointerId);
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // deltaMode：0 像素、1 行、2 頁，統一換算成像素
    const unit =
      e.deltaMode === 1
        ? LINE_HEIGHT_PX
        : e.deltaMode === 2
          ? element.clientHeight
          : 1;
    controller.wheel(local(e), e.deltaY * unit, e.ctrlKey);
  };

  const onContextMenu = (e: Event): void => e.preventDefault();
  const onBlur = (): void => controller.cancel();

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('blur', onBlur);

  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerCancel);
    element.removeEventListener('wheel', onWheel);
    element.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('blur', onBlur);
  };
}
