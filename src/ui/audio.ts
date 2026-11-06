// Sonidos y música sintetizados en el navegador, con cinta sucia de fondo.
type SfxName = 'slap' | 'deal' | 'flip' | 'blip' | 'confirm' | 'truco' | 'envido' | 'flor' | 'win' | 'lose' | 'stone' | 'parda' | 'victory' | 'defeat';

export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode; private musicBus!: GainNode; private fx!: GainNode;
  private noiseBuf!: AudioBuffer; private timer = 0; private step = 0;
  music = true; sfx = true; voices = true;

  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = .75; this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = .16; this.musicBus.connect(this.master);
    this.fx = this.ctx.createGain(); this.fx.gain.value = .9; this.fx.connect(this.master);
    this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.startHiss();
    this.timer = window.setInterval(() => this.tick(), 190);
  }
  setMusic(on: boolean): void { this.music = on; if (this.musicBus && this.ctx) this.musicBus.gain.setTargetAtTime(on ? .16 : 0, this.ctx.currentTime, .1); }
  private startHiss(): void {
    const c = this.ctx!;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = .4;
    const g = c.createGain(); g.gain.value = .05;
    src.connect(f); f.connect(g); g.connect(this.musicBus); src.start();
  }
  private tone(freq: number, dur: number, type: OscillatorType, vol: number, bus: GainNode, t = 0, slide = 0): void {
    const c = this.ctx!; const at = c.currentTime + t;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, at);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), at + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(.0008, at + dur);
    o.connect(g); g.connect(bus); o.start(at); o.stop(at + dur + .02);
  }
  private burst(dur: number, freq: number, vol: number, q = 1, t = 0): void {
    const c = this.ctx!; const at = c.currentTime + t;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = .7 + Math.random() * .5;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(.0008, at + dur);
    s.connect(f); f.connect(g); g.connect(this.fx); s.start(at); s.stop(at + dur + .02);
  }
  // Música: rasgueo de cuatro en 3/4 sobre bajo sencillo, a lo pulpería.
  private tick(): void {
    if (!this.ctx || !this.music || this.ctx.state !== 'running') return;
    const chords = [[147, 220, 294, 370], [165, 247, 330, 415], [110, 220, 277, 330], [147, 220, 294, 370], [196, 247, 294, 392], [110, 220, 277, 330]];
    const beat = this.step % 3; const bar = Math.floor(this.step / 3) % chords.length;
    const ch = chords[bar];
    if (beat === 0) this.tone(ch[0] / 2, .35, 'triangle', .5, this.musicBus);
    const notes = beat === 1 ? ch.slice(1) : beat === 2 ? ch.slice(1, 3) : [];
    notes.forEach((f, i) => this.tone(f * (1 + (Math.random() - .5) * .006), .18, 'sawtooth', .07, this.musicBus, i * .012));
    if (Math.random() < .12) this.tone(ch[3] * 2, .22, 'square', .025, this.musicBus, .05);
    this.step++;
  }
  play(name: SfxName): void {
    if (!this.ctx || !this.sfx) return;
    switch (name) {
      case 'slap': this.burst(.09, 1400, 1.3, .7); this.tone(120, .1, 'sine', .55, this.fx, 0, -60); break;
      case 'deal': this.burst(.05, 3000, .35, .8); break;
      case 'flip': this.burst(.06, 2200, .4, 1.2); break;
      case 'blip': this.tone(620, .05, 'square', .1, this.fx); break;
      case 'confirm': this.tone(520, .07, 'square', .14, this.fx); this.tone(780, .1, 'square', .14, this.fx, .06); break;
      case 'truco': this.tone(82, .6, 'sawtooth', .7, this.fx, 0, -30); this.tone(165, .5, 'sawtooth', .35, this.fx, .02); this.tone(247, .45, 'square', .18, this.fx, .04); this.burst(.3, 500, 1.1, .6); break;
      case 'envido': this.tone(330, .16, 'square', .22, this.fx); this.tone(392, .16, 'square', .22, this.fx, .11); this.tone(494, .28, 'square', .22, this.fx, .22); break;
      case 'flor': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, .28, 'triangle', .28, this.fx, i * .07)); break;
      case 'win': this.tone(440, .1, 'square', .16, this.fx); this.tone(659, .2, 'square', .16, this.fx, .09); break;
      case 'lose': this.tone(247, .25, 'triangle', .26, this.fx, 0, -70); break;
      case 'stone': this.burst(.03, 3600, .5, 3); this.tone(1800 + Math.random() * 600, .03, 'triangle', .14, this.fx); break;
      case 'parda': this.tone(300, .12, 'square', .12, this.fx); this.tone(300, .12, 'square', .12, this.fx, .15); break;
      case 'victory': [392, 523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, .4, 'square', .18, this.fx, i * .12)); break;
      case 'defeat': [392, 349, 311, 262].forEach((f, i) => this.tone(f, .5, 'sawtooth', .18, this.fx, i * .24)); break;
    }
  }
  say(text: string): void {
    if (!this.voices || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text.replace(/[¡!¿?]/g, ''));
    u.lang = 'es-ES'; u.rate = 1.15; u.pitch = .85 + Math.random() * .3; u.volume = .9;
    const es = speechSynthesis.getVoices().find((v) => v.lang.startsWith('es'));
    if (es) u.voice = es;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
  dispose(): void { clearInterval(this.timer); }
}
