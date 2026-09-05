/** A press becomes a menu only while stationary; moving and extra fingers cancel it. */
export function watchPress(
  target: EventTarget,
  start: Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY'>,
  tap: () => void,
  hold: () => void,
  delay = 500,
) {
  let done = false;
  const clean = () => {
    done = true;
    clearTimeout(timer);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', cancel);
    target.removeEventListener('pointerdown', extra);
    target.removeEventListener('blur', clean);
  };
  const move = (event: Event) => {
    const e = event as PointerEvent;
    if (
      e.pointerId === start.pointerId &&
      Math.hypot(e.clientX - start.clientX, e.clientY - start.clientY) > 9
    )
      clean();
  };
  const up = (event: Event) => {
    if ((event as PointerEvent).pointerId !== start.pointerId || done) return;
    clean();
    tap();
  };
  const cancel = (event: Event) => {
    if ((event as PointerEvent).pointerId === start.pointerId) clean();
  };
  const extra = (event: Event) => {
    if ((event as PointerEvent).pointerId !== start.pointerId) clean();
  };
  const timer = setTimeout(() => {
    if (!done) {
      clean();
      hold();
    }
  }, delay);
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', cancel);
  target.addEventListener('pointerdown', extra);
  target.addEventListener('blur', clean);
  return clean;
}
