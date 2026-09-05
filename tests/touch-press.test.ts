import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchPress } from '../src/ui/touch-press';
const start = { pointerId: 1, clientX: 100, clientY: 100 };
function send(target: EventTarget, type: string, patch = {}) {
  target.dispatchEvent(Object.assign(new Event(type), start, patch));
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('touch clip gestures', () => {
  it('opens once after a stationary hold and never also taps', () => {
    const t = new EventTarget(),
      tap = vi.fn(),
      hold = vi.fn();
    watchPress(t, start, tap, hold);
    vi.advanceTimersByTime(500);
    send(t, 'pointerup');
    vi.advanceTimersByTime(1000);
    expect(hold).toHaveBeenCalledTimes(1);
    expect(tap).not.toHaveBeenCalled();
  });
  it('selects on a short tap without opening a menu', () => {
    const t = new EventTarget(),
      tap = vi.fn(),
      hold = vi.fn();
    watchPress(t, start, tap, hold);
    vi.advanceTimersByTime(100);
    send(t, 'pointerup');
    vi.advanceTimersByTime(1000);
    expect(tap).toHaveBeenCalledTimes(1);
    expect(hold).not.toHaveBeenCalled();
  });
  it.each(['pointermove', 'pointercancel', 'pointerdown', 'blur'])(
    'cancels a pending hold on %s',
    (type) => {
      const t = new EventTarget(),
        tap = vi.fn(),
        hold = vi.fn();
      watchPress(t, start, tap, hold);
      send(
        t,
        type,
        type === 'pointermove'
          ? { clientX: 130 }
          : type === 'pointerdown'
            ? { pointerId: 2 }
            : {},
      );
      vi.advanceTimersByTime(1000);
      send(t, 'pointerup');
      expect(tap).not.toHaveBeenCalled();
      expect(hold).not.toHaveBeenCalled();
    },
  );
  it('cleans up timers when the panel closes', () => {
    const hold = vi.fn();
    const clean = watchPress(new EventTarget(), start, vi.fn(), hold);
    clean();
    vi.advanceTimersByTime(1000);
    expect(hold).not.toHaveBeenCalled();
  });
});
