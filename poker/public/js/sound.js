/** WebAudio 로 합성하는 효과음 (외부 파일 없음) */

class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.enabled = true;
  }

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.55;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp).connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.6);
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (_) { /* 오디오 미지원 */ }
  }

  noise({ dur = 0.08, type = 'bandpass', freq = 2000, to, q = 1, gain = 0.3, attack = 0.002, when = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.05);
  }

  tone({ freq = 440, to, dur = 0.15, type = 'sine', gain = 0.15, attack = 0.004, when = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  click(when = 0, pitch = 1) {
    this.tone({ freq: 3400 * pitch, dur: 0.035, type: 'triangle', gain: 0.09, when });
    this.tone({ freq: 5200 * pitch, dur: 0.025, type: 'sine', gain: 0.05, when: when + 0.004 });
    this.noise({ dur: 0.03, type: 'highpass', freq: 4000, gain: 0.08, when });
  }

  play(name) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    try {
      switch (name) {
        case 'deal':
          this.noise({ dur: 0.1, freq: 1800, to: 5200, q: 0.7, gain: 0.32 });
          break;
        case 'flip':
          this.noise({ dur: 0.06, type: 'highpass', freq: 2600, gain: 0.22 });
          this.tone({ freq: 900, to: 500, dur: 0.05, type: 'triangle', gain: 0.05 });
          break;
        case 'shuffle':
          for (let i = 0; i < 12; i++) this.noise({ dur: 0.035, freq: 2600 + Math.random() * 1500, q: 1.2, gain: 0.1, when: i * 0.028 });
          break;
        case 'chip':
          this.click(0, 1);
          this.click(0.05, 0.93);
          break;
        case 'chips':
          for (let i = 0; i < 5; i++) this.click(i * 0.035 + Math.random() * 0.02, 0.85 + Math.random() * 0.3);
          break;
        case 'collect':
          this.noise({ dur: 0.28, freq: 1400, to: 3000, q: 0.8, gain: 0.12 });
          for (let i = 0; i < 4; i++) this.click(0.12 + i * 0.04, 0.9 + Math.random() * 0.2);
          break;
        case 'check':
          for (const w of [0, 0.12]) {
            this.tone({ freq: 190, to: 80, dur: 0.1, gain: 0.45, when: w });
            this.noise({ dur: 0.03, type: 'lowpass', freq: 900, gain: 0.25, when: w });
          }
          break;
        case 'fold':
          this.noise({ dur: 0.24, type: 'lowpass', freq: 2200, to: 300, gain: 0.22 });
          break;
        case 'allin':
          this.tone({ freq: 196, to: 784, dur: 0.45, type: 'sawtooth', gain: 0.05 });
          this.tone({ freq: 392, to: 1568, dur: 0.45, type: 'triangle', gain: 0.06 });
          for (let i = 0; i < 7; i++) this.click(0.15 + i * 0.03, 0.8 + Math.random() * 0.4);
          break;
        case 'turn':
          this.tone({ freq: 784, dur: 0.16, type: 'triangle', gain: 0.16 });
          this.tone({ freq: 1175, dur: 0.28, type: 'triangle', gain: 0.14, when: 0.12 });
          break;
        case 'tick':
          this.tone({ freq: 1500, dur: 0.03, type: 'square', gain: 0.04 });
          break;
        case 'win':
          [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
            this.tone({ freq: f, dur: 0.5, type: 'triangle', gain: 0.11, when: i * 0.08 });
            this.tone({ freq: f * 2, dur: 0.3, type: 'sine', gain: 0.03, when: i * 0.08 + 0.01 });
          });
          for (let i = 0; i < 6; i++) this.click(0.45 + i * 0.04, 1 + Math.random() * 0.3);
          break;
        case 'lose':
          this.tone({ freq: 392, to: 370, dur: 0.25, type: 'triangle', gain: 0.07 });
          this.tone({ freq: 311, to: 294, dur: 0.4, type: 'triangle', gain: 0.07, when: 0.18 });
          break;
        case 'pop':
          this.tone({ freq: 880, to: 1400, dur: 0.07, type: 'sine', gain: 0.08 });
          break;
        case 'join':
          this.tone({ freq: 660, dur: 0.12, type: 'sine', gain: 0.08 });
          this.tone({ freq: 990, dur: 0.18, type: 'sine', gain: 0.08, when: 0.09 });
          break;
        default:
      }
    } catch (_) { /* ignore */ }
  }
}

export const sound = new Sound();
