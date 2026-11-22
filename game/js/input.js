// 키보드 + 포인터락 마우스 입력
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this.canvas = canvas;
    this.enabled = false;
    addEventListener('keydown', (e) => { if (this.enabled) this.keys.add(e.code); if (e.code === 'Space' && this.enabled) e.preventDefault(); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== canvas) return;
      this.mouseDX += e.movementX; this.mouseDY += e.movementY;
    });
  }
  get locked() { return document.pointerLockElement === this.canvas; }
  lock() { try { this.canvas.requestPointerLock()?.catch?.(() => {}); } catch {} }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  down(code) { return this.keys.has(code); }
  consumeMouse() { const d = [this.mouseDX, this.mouseDY]; this.mouseDX = this.mouseDY = 0; return d; }
}
