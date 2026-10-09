// Keyboard / mouse state with per-frame edge detection.

export class Input {
  keys = new Set<string>();
  private pressedThisFrame = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  dragging = false;
  locked = false;
  enabled = true;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (isTyping()) return;
      const k = e.code;
      if (!this.keys.has(k)) this.pressedThisFrame.add(k);
      this.keys.add(k);
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('mousedown', (e) => {
      if (e.button === 0 || e.button === 2) {
        this.dragging = true;
        if (this.enabled && !this.locked && e.button === 0) el.requestPointerLock?.();
      }
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; });
    window.addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
    el.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
  }

  down(code: string) { return this.enabled && !isTyping() && this.keys.has(code); }
  pressed(code: string) { return this.enabled && !isTyping() && this.pressedThisFrame.has(code); }
  /** Pressed regardless of `enabled` (for global hotkeys like Escape / phone). */
  pressedAny(code: string) { return !isTyping() && this.pressedThisFrame.has(code); }
  endFrame() { this.pressedThisFrame.clear(); this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; }
  unlock() { if (this.locked) document.exitPointerLock?.(); }
}

export function isTyping() {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}
