// Une motor, IA, escena e interfaz en el bucle de la partida.
import './style.css';
import { Card, cardName, enviteInfo, makeRng, pieces, trucoPower } from './engine/cards';
import { Action, GameEvent, GameState, TRUCO_NAMES, Team, applyAction, faltaAmount, handInfo, legalActions, newMatch, nextBase, partnerOf, teamOf } from './engine/game';
import { BOTS, BotProfile, botById } from './ai/bots';
import { Memory, decide, maybeSignal, newMemory, observe } from './ai/brain';
import { CardTag, cardFace, faceCanvas } from './ui/art';
import { TableScene } from './ui/scene';
import { Sound } from './ui/audio';

const HUMAN = 0;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hud = document.getElementById('hud')!;
const stage = document.getElementById('stage')!;
const scene = new TableScene(document.getElementById('game') as HTMLCanvasElement);
const snd = new Sound();
const rng = makeRng((Date.now() ^ (Math.random() * 1e9)) >>> 0);

function fit(): void {
  const k = Math.min(innerWidth / 960, innerHeight / 672);
  stage.style.transform = `scale(${k}) translate(-50%, -50%)`;
}
addEventListener('resize', fit); fit();
function frame(): void { scene.update(); requestAnimationFrame(frame); }
requestAnimationFrame(frame);

function store<T>(key: string, fallback: T): T { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } }
function save(key: string, v: unknown): void { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* sin almacenamiento */ } }

// ---------- Ajustes ----------
interface Settings { music: boolean; sfx: boolean; voices: boolean; filter: boolean; hints: boolean; open: boolean; mode: 2 | 4; rival: number; partner: number }
const settings: Settings = { music: true, sfx: true, voices: false, filter: true, hints: true, open: true, mode: 4, rival: 5, partner: 5, ...store<Partial<Settings>>('truco-settings', {}) };
function applySettings(): void {
  snd.setMusic(settings.music); snd.sfx = settings.sfx; snd.voices = settings.voices;
  scene.setStrength(settings.filter ? 1 : .15);
  save('truco-settings', settings);
}
applySettings();

// ---------- Utilidades de interfaz ----------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
function miniCard(card: Card, tag: CardTag = null): HTMLCanvasElement {
  const src = cardFace(card, tag);
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

// ---------- Partida ----------
class Match {
  state!: GameState; mems: Memory[] = []; bots = new Map<number, BotProfile>(); alive = true;
  shown: [number, number] = [0, 0]; log: string[] = []; panelResolve: ((a: Action) => void) | null = null;
  hiddenMode = false; killMode = false; florWarned = false; signaled = false; root = el('div'); plates = new Map<number, HTMLElement>();
  private peekCard: Card | null = null;

  constructor(public mode: 2 | 4, rival: BotProfile, partner: BotProfile | null, public open: boolean) {
    this.bots.set(1, rival);
    if (mode === 4 && partner) {
      // Tres personas distintas en la mesa: el segundo rival es del nivel más cercano libre.
      const friend = partner.id === rival.id ? botById(rival.id > 1 ? rival.id - 1 : 2) : partner;
      const free = [rival.id + 1, rival.id - 1, rival.id + 2, rival.id - 2].find((id) => id >= 1 && id <= 10 && id !== friend.id)!;
      this.bots.set(2, friend);
      this.bots.set(3, botById(free));
    }
    this.mems = Array.from({ length: mode }, () => newMemory(mode));
  }
  name(seat: number): string { return seat === HUMAN ? 'Tú' : this.bots.get(seat)!.name; }
  teamName(t: Team): string {
    if (this.mode === 2) return t === 0 ? 'Tú' : this.bots.get(1)!.name;
    return t === 0 ? `Tú y ${this.bots.get(2)!.name}` : `${this.bots.get(1)!.name} y ${this.bots.get(3)!.name}`;
  }
  private screenSeat(seat: number): 'bottom' | 'right' | 'top' | 'left' {
    if (seat === 0) return 'bottom';
    if (this.mode === 2) return 'top';
    return (['bottom', 'right', 'top', 'left'] as const)[seat];
  }
  async run(): Promise<void> {
    hud.innerHTML = '';
    hud.append(this.root);
    this.buildHud();
    scene.setPlayers(this.mode, new Map([...this.bots]));
    const { state, events } = newMatch(this.mode, rng, HUMAN, undefined, this.open);
    this.state = state;
    this.observe(events);
    await this.handle(events);
    while (this.alive) {
      const s = this.state;
      if (s.phase === 'match-over') break;
      if (s.phase === 'base-over') {
        await scene.sweep();
        if (!this.alive) return;
        const ev = nextBase(s, rng);
        this.observe(ev);
        await this.handle(ev);
        continue;
      }
      const seat = s.pending!.seat;
      this.setTurn(seat);
      let action: Action;
      if (seat === HUMAN) action = await this.humanAction();
      else action = await this.botAction(seat);
      if (!this.alive) return;
      const ev = applyAction(s, action);
      this.observe(ev);
      await this.handle(ev);
    }
  }
  private observe(ev: GameEvent[]): void { this.mems.forEach((m) => observe(m, this.state, ev)); }
  stop(): void { this.alive = false; this.panelResolve = null; scene.pickable = false; scene.onPick = null; }

  // --- Bots ---
  private async botAction(seat: number): Promise<Action> {
    const prof = this.bots.get(seat)!;
    const plate = this.plates.get(seat);
    plate?.classList.add('think');
    const d = decide(this.state, seat, prof, this.mems[seat], rng);
    const fast = this.state.pending!.kind !== 'turn' ? 420 : 330;
    await wait(fast + rng() * 420 + (d.action.t === 'truco' || d.action.t === 'retruco' ? 260 : 0));
    plate?.classList.remove('think');
    if (d.speech) { this.bubble(seat, d.speech); scene.talk(seat); await wait(360); }
    return d.action;
  }

  // --- Interfaz fija ---
  private buildHud(): void {
    const r = this.root; r.innerHTML = '';
    r.append(el('div', 'frame', ''));
    r.lastElementChild!.remove();
    const score = el('div', 'frame'); score.id = 'score'; r.append(score);
    const vira = el('div', 'frame'); vira.id = 'vira'; r.append(vira);
    const log = el('div', 'frame'); log.id = 'log'; r.append(log);
    const panel = el('div'); panel.id = 'panel'; r.append(panel);
    const hint = el('div'); hint.id = 'hint'; r.append(hint);
    const info = el('div'); info.id = 'envite-info'; r.append(info);
    const menu = el('button', 'frame btn', 'PAUSA'); menu.id = 'menu-btn';
    menu.onclick = () => openPause(); r.append(menu);
    this.plates.clear();
    for (const seat of this.bots.keys()) {
      const p = this.bots.get(seat)!;
      const plate = el('div', 'frame plate');
      plate.append(faceCanvas(p.look));
      const who = el('div', 'who', `<b>${esc(p.name)}</b><span class="tag"></span>`);
      plate.append(who);
      const pos = this.screenSeat(seat);
      if (pos === 'top') { plate.style.left = '488px'; plate.style.top = '10px'; }
      if (pos === 'left') { plate.style.left = '256px'; plate.style.top = '92px'; }
      if (pos === 'right') { plate.style.right = '236px'; plate.style.top = '92px'; }
      r.append(plate); this.plates.set(seat, plate);
    }
    this.renderScore();
  }
  renderScore(): void {
    const box = this.root.querySelector('#score')!;
    const team = (t: Team, cls: string) => {
      const stones = Array.from({ length: 24 }, (_, i) => `<i class="${i < this.shown[t] ? 'on' : ''}"></i>`).join('');
      const chicos = [0, 1].map((i) => `<b class="${i < (this.state?.chicos[t] ?? 0) ? 'on' : ''}"></b>`).join('');
      return `<div class="team ${cls}"><span class="nm">${esc(this.teamName(t))}<span class="chicos">${chicos}</span></span><span class="pts">${this.shown[t]}</span><div class="stones">${stones}</div></div>`;
    };
    box.innerHTML = `<div class="h">TANTEADOR · 24</div>${team(0, 'us')}${team(1, 'them')}`;
  }
  private renderVira(s: GameState): void {
    const box = this.root.querySelector('#vira')!;
    const p = pieces(s.vira);
    box.innerHTML = '<div class="h">LA VIRA</div>';
    const row = el('div', 'pieces');
    for (const [label, card] of [['Vira', s.vira], ['Perico', p.perico], ['Perica', p.perica]] as [string, Card][]) {
      const f = el('figure'); f.append(miniCard(card)); f.append(el('figcaption', '', label)); row.append(f);
    }
    box.append(row);
    box.append(el('div', 'pips', '<span>Vueltas</span><span class="pip" data-t="0"></span><span class="pip" data-t="1"></span><span class="pip" data-t="2"></span>'));
  }
  private renderPeek(s: GameState): void {
    this.root.querySelector('#peek')?.remove();
    this.peekCard = null;
    if (!s.open || s.n !== 4) return;
    const partner = partnerOf(HUMAN, s.n)!;
    const card = s.peeks[partner];
    if (!card) return;
    this.peekCard = card;
    const box = el('div', 'frame'); box.id = 'peek';
    box.append(miniCard(card));
    box.append(el('div', '', `${esc(this.name(partner))} tiene<br><span style="color:var(--gold)">${esc(cardName(card, s.vira))}</span>`));
    this.root.append(box);
  }
  private setTurn(seat: number): void {
    this.plates.forEach((p, s) => p.classList.toggle('turn', s === seat));
    this.renderBadges();
  }
  private renderBadges(): void {
    const s = this.state; if (!s) return;
    this.plates.forEach((p, seat) => {
      const tag = p.querySelector('.tag')!;
      const role = seat === s.mano ? 'El Mano' : seat === s.pie ? 'El Pie' : '';
      const stars = `Nv. ${this.bots.get(seat)!.stars}`;
      const friend = s.n === 4 && teamOf(seat, s.n) === teamOf(HUMAN, s.n) ? 'Compañero' : stars;
      tag.textContent = role ? `${role} · ${friend}` : friend;
    });
  }
  addLog(text: string, big = false): void {
    const box = this.root.querySelector('#log')!;
    box.append(el('div', big ? 'big' : '', esc(text)));
    while (box.children.length > 5) box.firstElementChild!.remove();
  }
  bubble(seat: number, text: string, cls = ''): void {
    const b = el('div', `bubble ${cls}`, esc(text));
    const pos = this.screenSeat(seat);
    if (pos === 'bottom') { b.style.left = '430px'; b.style.bottom = '206px'; }
    if (pos === 'top') { b.style.left = '470px'; b.style.top = '66px'; }
    if (pos === 'left') { b.style.left = '256px'; b.style.top = '148px'; }
    if (pos === 'right') { b.style.right = '236px'; b.style.top = '148px'; }
    this.root.querySelectorAll(`.bubble[data-seat="${seat}"]`).forEach((x) => x.remove());
    b.dataset.seat = String(seat);
    this.root.append(b);
    setTimeout(() => b.remove(), 1500);
  }
  async banner(text: string, cls: string, sub = '', ms = 850): Promise<void> {
    this.root.querySelector('#banner')?.remove();
    const b = el('div', cls, `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`); b.id = 'banner';
    this.root.append(b);
    await wait(ms);
    b.remove();
  }
  setHint(html: string): void { const h = this.root.querySelector('#hint'); if (h) h.innerHTML = html; }

  // --- Eventos ---
  async handle(events: GameEvent[]): Promise<void> {
    for (const ev of events) {
      if (!this.alive) return;
      switch (ev.e) {
        case 'deal': await this.onDeal(ev); break;
        case 'canto': await this.onCanto(ev); break;
        case 'play': await this.onPlay(ev); break;
        case 'trick': await this.onTrick(ev); break;
        case 'reveal':
          await scene.revealTable(ev.seat, ev.card, 1);
          this.addLog(`${this.name(ev.seat)} destapa ${cardName(ev.card, this.state.vira)}`, true);
          snd.play('flip'); scene.punch(.8);
          await this.banner('¡LA MUERTE!', 'gold', cardName(ev.card, this.state.vira), 900);
          break;
        case 'score':
          this.shown[ev.team] = Math.min(24, this.shown[ev.team] + ev.points);
          this.renderScore();
          scene.setStones([this.shown[0], this.shown[1]], () => snd.play('stone'));
          this.addLog(`+${ev.points} ${this.teamName(ev.team)}: ${ev.reason}`, true);
          break;
        case 'base-end': await this.onBaseEnd(ev); break;
        case 'chico': await this.onChico(ev); break;
        case 'match': await this.onMatch(ev); break;
      }
    }
  }
  private async onDeal(ev: Extract<GameEvent, { e: 'deal' }>): Promise<void> {
    const s = this.state;
    this.florWarned = false; this.signaled = false; this.hiddenMode = false; this.killMode = false;
    this.renderVira(s); this.renderBadges(); this.renderPeek(s);
    this.addLog(`Base ${s.baseNumber}. Mano: ${this.name(ev.mano)}`);
    const p = pieces(s.vira);
    const tag = (c: Card): CardTag => (c.id === p.perico.id ? 'perico' : c.id === p.perica.id ? 'perica' : null);
    const human = s.players[HUMAN].hand;
    const hands = s.players.map((pl) => pl.seat).sort((a, b) => ((a - s.mano + s.n) % s.n) - ((b - s.mano + s.n) % s.n)).map((seat) => {
      if (seat === HUMAN) return { seat, cards: human as (Card | null)[], tags: human.map(tag) };
      const friend = s.open && seat === partnerOf(HUMAN, s.n) ? s.peeks[seat] : null;
      return { seat, cards: [friend, null, null] as (Card | null)[] };
    });
    await scene.deal(hands, s.vira, ev.pie, () => snd.play('deal'));
    snd.play('flip');
    // Señas entre compañeros bot y hacia ti.
    if (s.n === 4) {
      for (const seat of [1, 2, 3]) {
        const sig = maybeSignal(s, seat, this.bots.get(seat)!, rng);
        if (!sig) continue;
        const to = partnerOf(seat, s.n)!;
        s.signals.push({ from: seat, to, piece: sig });
        if (to === HUMAN) {
          const SENA = { perico: 'Pica el ojo derecho: el Perico', perica: 'Pica el ojo izquierdo: la Perica', espadilla: 'Mejilla derecha: la Espadilla', bastillo: 'Mejilla izquierda: el Bastillo' };
          this.bubble(seat, SENA[sig], 'hint');
          this.addLog(`Seña: ${SENA[sig]}`, true);
        }
      }
    }
    this.renderEnvite(s);
  }
  private renderEnvite(s: GameState): void {
    const box = this.root.querySelector('#envite-info');
    if (!box || !settings.hints) { if (box) box.textContent = ''; return; }
    const i = handInfo(s, HUMAN);
    box.textContent = i.reservada ? `La Reservada (${i.value})` : i.flor ? `Tienes Flor de ${i.value}` : `Tu Envite: ${i.value}`;
  }
  private async onCanto(ev: Extract<GameEvent, { e: 'canto' }>): Promise<void> {
    const name = this.name(ev.seat);
    this.addLog(`${name}: ${ev.text}`, ev.kind !== 'answer');
    scene.talk(ev.seat, .8);
    const big = ev.kind === 'truco' || ev.kind === 'envite' || ev.kind === 'flor' || ev.kind === 'privo';
    this.bubble(ev.seat, ev.text, big ? ev.kind : '');
    if (ev.text.startsWith('A Ley') && ev.kind === 'ley') { snd.play('blip'); await wait(380); return; }
    if (ev.kind === 'mazo') { snd.play('lose'); await wait(500); return; }
    if (big) {
      snd.play(ev.kind === 'truco' || ev.kind === 'privo' ? 'truco' : ev.kind === 'flor' ? 'flor' : 'envido');
      snd.say(ev.text);
      const heavy = ev.kind === 'truco' || ev.kind === 'privo' || ev.text.includes('Falta');
      const strength = ev.text.includes('Vale Juego') ? 1.7 : ev.text.includes('Vale Nueve') ? 1.35 : heavy ? 1 : .45;
      scene.focus(ev.seat === HUMAN ? null : ev.seat);
      scene.punch(strength); if (heavy) scene.flashScreen(.18 * strength);
      await this.banner(ev.text.replace(/¡|!/g, '').toUpperCase(), ev.kind, name, heavy ? 950 : 720);
      scene.focus(null);
    } else {
      snd.say(ev.text);
      snd.play(ev.text.startsWith('No') ? 'lose' : 'confirm');
      await wait(460);
    }
  }
  private async onPlay(ev: Extract<GameEvent, { e: 'play' }>): Promise<void> {
    const s = this.state;
    const heavy = !!ev.card && !ev.hidden && trucoPower(ev.card, s.vira) >= 95;
    snd.play('deal');
    await scene.playCard(ev.seat, ev.card, ev.trick, { hidden: ev.hidden, under: ev.under, heavy });
    snd.play('slap');
    if (ev.kill) this.addLog(`${this.name(ev.seat)} mata tapado`, true);
    else if (ev.hidden) this.addLog(`${this.name(ev.seat)} pasa una carta`);
    else if (ev.card) this.addLog(`${this.name(ev.seat)}: ${cardName(ev.card, s.vira)}${ev.under ? ' (van juntas)' : ''}`);
    if (ev.seat === partnerOf(HUMAN, s.n) && ev.card && this.peekCard?.id === ev.card.id) this.root.querySelector('#peek')?.classList.add('gone');
    if (heavy && ev.card) {
      scene.punch(.55);
      if (trucoPower(ev.card, s.vira) >= 99) { scene.flashScreen(.2); await this.banner(cardName(ev.card, s.vira).toUpperCase(), 'gold', '', 520); }
    }
    await wait(ev.seat === HUMAN ? 80 : 110);
  }
  private async onTrick(ev: Extract<GameEvent, { e: 'trick' }>): Promise<void> {
    const pip = this.root.querySelector(`.pip[data-t="${ev.index}"]`);
    const names = ['PRIMERA', 'SEGUNDA', 'TERCERA'];
    if (ev.result === 'pending') { pip?.classList.add('tie'); this.addLog('La segunda queda por destapar'); return; }
    if (ev.result === 'parda') {
      pip?.classList.add('tie');
      snd.play('parda');
      scene.markWinner(null, ev.index);
      await this.banner('PARDA', 'info', names[ev.index], 560);
      return;
    }
    const ours = ev.result === teamOf(HUMAN, this.state.n);
    pip?.classList.add(ours ? 'us' : 'them');
    snd.play(ours ? 'win' : 'lose');
    scene.markWinner(ev.winnerSeat, ev.index);
    scene.hit(ev.winnerSeat ?? 0);
    this.addLog(`${names[ev.index]}: ${ev.winnerSeat !== null ? this.name(ev.winnerSeat) : ''}`);
    await wait(380);
  }
  private modal(html: string, build?: (m: HTMLElement) => void): HTMLElement {
    const m = el('div', 'frame modal', html);
    build?.(m);
    this.root.append(m);
    return m;
  }
  private waitContinue(m: HTMLElement, label = 'CONTINUAR'): Promise<void> {
    return new Promise((resolve) => {
      const row = el('div', 'row-btns');
      const b = el('button', 'btn go', label);
      const go = () => { removeEventListener('keydown', key); m.remove(); snd.play('confirm'); resolve(); };
      const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
      b.onclick = go; addEventListener('keydown', key);
      row.append(b); m.append(row);
    });
  }
  private async onBaseEnd(ev: Extract<GameEvent, { e: 'base-end' }>): Promise<void> {
    const s = this.state;
    this.setHint('');
    this.plates.forEach((p) => p.classList.remove('turn'));
    await scene.revealHands(ev.hands);
    const lines = ev.lines.map((l) => `<div class="ln ${l.team === 0 ? 'us' : 'them'}"><span>${esc(this.teamName(l.team))}: ${esc(l.reason)}</span><b>+${l.points >= 24 ? 'CHICO' : l.points}</b></div>`).join('');
    const m = this.modal(`<h2>FIN DE LA BASE ${s.baseNumber}</h2>${lines || '<div class="ln">Sin puntos</div>'}`);
    const hands = el('div', 'hands');
    ev.hands.forEach((h, seat) => {
      const i = enviteInfo(h, s.vira);
      const row = el('div', 'row');
      row.append(el('span', '', esc(this.name(seat))));
      const minis = el('div', 'minis');
      const p = pieces(s.vira);
      h.forEach((c) => minis.append(miniCard(c, c.id === p.perico.id ? 'perico' : c.id === p.perica.id ? 'perica' : null)));
      row.append(minis);
      row.append(el('span', '', i.reservada ? 'Reservada' : i.flor ? `Flor ${i.value}` : `Env. ${i.value}`));
      hands.append(row);
    });
    m.append(hands);
    const burnt = s.players.find((p) => p.burnt);
    if (burnt) m.append(el('div', 'desc', `El Coime: ${esc(this.name(burnt.seat))} quemó su Flor por no cantarla.`));
    await this.waitContinue(m);
  }
  private async onChico(ev: Extract<GameEvent, { e: 'chico' }>): Promise<void> {
    const ours = ev.team === teamOf(HUMAN, this.state.n);
    this.shown = [0, 0];
    snd.play(ours ? 'win' : 'lose');
    scene.punch(1.1);
    const text = ev.bonito ? 'VIENE EL BONITO' : `CHICO PARA ${this.teamName(ev.team).toUpperCase()}`;
    await this.banner(ev.bonito ? `CHICO ${ours ? 'TUYO' : 'PERDIDO'}` : text, ours ? 'gold' : 'truco', ev.bonito ? 'Viene el Bonito, el chico decisivo' : `Chicos ${ev.chicos[0]} a ${ev.chicos[1]}`, 1300);
    this.renderScore();
    scene.setStones([0, 0], () => undefined);
  }
  private async onMatch(ev: Extract<GameEvent, { e: 'match' }>): Promise<void> {
    const won = ev.team === teamOf(HUMAN, this.state.n);
    snd.play(won ? 'victory' : 'defeat');
    scene.punch(1.5); scene.flashScreen(.3);
    if (won) { const beaten = store<number[]>('truco-beaten', []); const id = this.bots.get(1)!.id; if (!beaten.includes(id)) { beaten.push(id); save('truco-beaten', beaten); } }
    const rival = this.bots.get(1)!;
    this.bubble(1, won ? rival.voice.lose[0] : rival.voice.win[0]);
    const m = this.modal(`<h2>${won ? '¡GANASTE EL JUEGO!' : 'PERDISTE EL JUEGO'}</h2><div class="desc">${esc(rival.name)}, ${esc(rival.title)}: «${esc(won ? rival.voice.lose[0] : rival.voice.win[0])}»</div><div class="desc">Chicos ${this.state.chicos[0]} a ${this.state.chicos[1]}</div>`);
    await new Promise<void>((resolve) => {
      const row = el('div', 'row-btns');
      const again = el('button', 'btn go', 'REVANCHA');
      const menu = el('button', 'btn go', 'MENÚ');
      again.onclick = () => { m.remove(); resolve(); this.alive = false; startMatch(); };
      menu.onclick = () => { m.remove(); resolve(); this.alive = false; showMenu(); };
      row.append(menu, again); m.append(row);
    });
  }

  // --- Turno humano ---
  private humanAction(): Promise<Action> {
    return new Promise((resolve) => {
      this.panelResolve = (a) => {
        scene.pickable = false; scene.onPick = null; this.panelResolve = null;
        const p = this.root.querySelector('#panel'); if (p) p.innerHTML = '';
        this.setHint('');
        snd.play('blip');
        if (a.t === 'play' && a.hidden) scene.markHidden(a.cardId);
        if (a.t === 'kill') scene.markHidden(a.killId);
        resolve(a);
      };
      this.renderPanel();
    });
  }
  private choose(a: Action): void { this.panelResolve?.(a); }
  private renderPanel(): void {
    const s = this.state; const d = s.pending!;
    const legal = legalActions(s);
    const panel = this.root.querySelector('#panel')!;
    panel.innerHTML = '';
    const titles: Record<string, [string, string]> = {
      turn: ['TU TURNO', this.turnPrompt(s)],
      'truco-response': [`¡${TRUCO_NAMES[s.truco.level].toUpperCase()}!`, '¿Qué respondes?'],
      'envite-response': ['¡ENVITE!', `En juego: ${s.envite.falta ? 'la Falta' : `${s.envite.total} piedras`}. Si no quieres: ${s.envite.prev}.`],
      'flor-voice': ['TIENES LA VOZ', 'Hay Flor contra Flor.'],
      'flor-response': ['¡FLOR ENVIDA!', `En juego: ${s.flor.total} piedras. Si no quieres, pierdes tu Flor.`],
      privo: ['ESTÁN CANTANDO', 'Si no privas, ganan el chico.'],
      'privo-response': ['¡PRIVO Y TRUCO!', '¿Vas al Truco?'],
    };
    const t = titles[d.kind];
    const title = el('div', 'frame title', `<span class="h">${esc(t[0])}</span><p>${esc(t[1])}</p>`);
    panel.append(title);
    const buttons = this.buttonsFor(legal);
    const keys = 'QWERTYUIOP';
    buttons.forEach((b, i) => {
      const btn = el('button', `frame canto ${b.cls}`, `<kbd>${keys[i] ?? ''}</kbd><span>${esc(b.label)}</span>`);
      btn.style.setProperty('--i', String(i));
      if (b.on) btn.classList.add('on');
      btn.onclick = () => { snd.unlock(); b.run(); };
      btn.dataset.key = keys[i] ?? '';
      panel.append(btn);
    });
    if (d.kind === 'turn') {
      scene.pickable = true;
      scene.onHover = () => snd.play('blip');
      scene.onPick = (id) => this.pickCard(id);
      this.setHint(this.killMode ? 'Elige la carta que <b>mata tapada</b>' : this.hiddenMode ? 'Elige la carta que vas a <b>pasar tapada</b>' : 'Toca una carta, o pulsa <b>1</b> <b>2</b> <b>3</b>');
    }
  }
  private turnPrompt(s: GameState): string {
    const p = s.players[HUMAN];
    if (handInfo(s, HUMAN).flor && !p.declared && !handInfo(s, HUMAN).reservada) return p.aley ? 'Canta tu Flor antes de la segunda carta.' : '¡Tienes Flor! Cántala o sal A Ley.';
    if (s.tricks[0].result === 'parda' && s.tricks.length === 2) return 'Primera parda: juegas tu más alta.';
    return s.tricks.length === 1 ? 'Juega o canta.' : `${['Primera', 'Segunda', 'Tercera'][s.tricks.length - 1]} vuelta.`;
  }
  private buttonsFor(legal: Action[]): { label: string; cls: string; run: () => void; on?: boolean }[] {
    const s = this.state; const d = s.pending!;
    const out: { label: string; cls: string; run: () => void; on?: boolean }[] = [];
    const go = (a: Action) => () => this.choose(a);
    const flor = legal.find((a) => a.t === 'flor');
    if (flor) out.push({ label: d.kind === 'turn' ? 'Flor' : 'Flor tengo', cls: 'flor', run: go(flor) });
    for (const a of legal) {
      switch (a.t) {
        case 'quiero': {
          const i = handInfo(s, HUMAN);
          const flora = i.flor && !i.reservada && !s.players[HUMAN].declared;
          out.push({ label: d.kind === 'flor-response' ? 'La mía quiere' : flora ? 'Con Flor quiero' : 'Quiero', cls: 'yes', run: go(a) });
          break;
        }
        case 'noquiero': out.push({ label: d.kind === 'flor-response' ? 'La mía es chica' : 'No quiero', cls: 'no', run: go(a) }); break;
        case 'retruco': out.push({ label: `Quiero y ${TRUCO_NAMES[s.truco.level + 1]}`, cls: 'truco', run: go(a) }); break;
        case 'truco': out.push({ label: TRUCO_NAMES[s.truco.level + 1], cls: 'truco', run: go(a) }); break;
        case 'envido': out.push({ label: this.envidoLabel(a.amount), cls: 'envite', run: go(a) }); break;
        case 'flor-envida': out.push({ label: a.amount === 'falta' ? 'Mi Flor: la Falta' : d.kind === 'flor-response' ? `Quiero y ${a.amount}` : 'Mi Flor envida', cls: 'flor', run: go(a) }); break;
        case 'flor-chica': out.push({ label: 'Mi Flor es chica', cls: 'no', run: go(a) }); break;
        case 'privo': out.push({ label: 'Privo y Truco', cls: 'truco', run: go(a) }); break;
        case 'noprivo': out.push({ label: 'No privo', cls: 'no', run: go(a) }); break;
        case 'aley': out.push({ label: 'A Ley', cls: 'envite', run: go(a) }); break;
        case 'delegate': out.push({ label: 'Que responda mi compañero', cls: 'no', run: go(a) }); break;
      }
    }
    if (d.kind === 'turn') {
      const hiddenPlays = legal.filter((a) => a.t === 'play' && a.hidden);
      const kills = legal.filter((a) => a.t === 'kill');
      const firstTurn = s.tricks.length === 1 && s.players[HUMAN].played === 0;
      if (hiddenPlays.length && !s.players[HUMAN].passAll) {
        if (firstTurn) out.push({ label: 'Pasar las tres', cls: 'no', run: go(hiddenPlays[0]) });
        else out.push({ label: 'Pasar tapada', cls: 'no tool', on: this.hiddenMode, run: () => { this.hiddenMode = !this.hiddenMode; this.killMode = false; this.renderPanel(); } });
      }
      if (kills.length) out.push({ label: 'Matar tapado', cls: 'no tool', on: this.killMode, run: () => { this.killMode = !this.killMode; this.hiddenMode = false; this.renderPanel(); } });
      const partner = partnerOf(HUMAN, s.n);
      if (partner !== null && !this.signaled && s.tricks.length === 1 && s.players[HUMAN].played === 0) {
        const sig = maybeSignal(s, HUMAN, { ...this.bots.get(partner)!, senas: 1 }, () => 0);
        if (sig) out.push({ label: 'Hacer seña', cls: 'no', run: () => this.sendSignal(sig) });
      }
      const fold = legal.find((a) => a.t === 'fold');
      if (fold) out.push({ label: 'Irse al mazo', cls: 'no', run: go(fold) });
    }
    return out;
  }
  private envidoLabel(amount: number | 'falta'): string {
    const s = this.state; const replying = s.envite.status === 'offered';
    if (amount === 'falta') return `${replying ? 'Quiero y la' : 'Envido la'} Falta (${faltaAmount(s)})`;
    if (!replying) return amount === 2 ? 'Envido' : `Envido ${amount} piedras`;
    const more = amount - s.envite.total;
    return s.envite.total === 2 && more === 2 ? 'Quiero y Envido' : `Quiero y ${more} más`;
  }
  private sendSignal(sig: 'perico' | 'perica' | 'espadilla' | 'bastillo'): void {
    const s = this.state;
    const partner = partnerOf(HUMAN, s.n)!;
    s.signals.push({ from: HUMAN, to: partner, piece: sig });
    this.signaled = true;
    this.addLog(`Seña a ${this.name(partner)}: ${sig}`, true);
    snd.play('blip');
    // Los rivales expertos a veces pillan la seña (página 26).
    for (const seat of [1, 3]) {
      const p = this.bots.get(seat)!;
      if (rng() < Math.max(0, (p.stars - 5) * 0.07)) {
        s.signals.push({ from: HUMAN, to: seat, piece: sig });
        this.bubble(seat, '¡Vi esa seña!', 'hint');
      }
    }
    this.renderPanel();
  }
  private pickCard(id: string): void {
    const s = this.state;
    const legal = legalActions(s);
    if (this.killMode) {
      const a = legal.find((x) => x.t === 'kill' && x.killId === id);
      if (a) { this.killMode = false; this.choose(a); }
      return;
    }
    const hiddenWanted = this.hiddenMode;
    let a = legal.find((x) => x.t === 'play' && x.cardId === id && !!x.hidden === hiddenWanted);
    if (!a) {
      const plays = legal.filter((x) => x.t === 'play');
      if (plays.length === 1) a = plays[0]; // Carta obligada.
    }
    if (!a) return;
    const p = s.players[HUMAN];
    const i = handInfo(s, HUMAN);
    const burns = i.flor && !i.reservada && !p.declared && (p.played === 1 || !p.aley) && p.played < 2;
    if (burns && !this.florWarned) {
      this.florWarned = true;
      this.setHint('<span class="warn">¡Si juegas sin cantar, se te quema la Flor!</span> Toca la carta otra vez para confirmar.');
      snd.play('parda');
      return;
    }
    this.hiddenMode = false;
    this.choose(a);
  }
  key(e: KeyboardEvent): void {
    if (!this.panelResolve) return;
    if (e.key >= '1' && e.key <= '3') {
      const id = scene.handIds()[Number(e.key) - 1];
      if (id && scene.pickable) this.pickCard(id);
      return;
    }
    const k = e.key.toUpperCase();
    const btn = this.root.querySelector<HTMLButtonElement>(`.canto[data-key="${k}"]`);
    btn?.click();
  }
}

// ---------- Menús ----------
let current: Match | null = null;
addEventListener('keydown', (e) => {
  snd.unlock();
  if (e.key === 'Escape') { if (current?.alive) openPause(); return; }
  if (document.querySelector('#pause') || document.querySelector('#menu')) return;
  current?.key(e);
});
function startMatch(): void {
  current?.stop();
  document.querySelector('#menu')?.remove();
  const partner = settings.mode === 4 ? botById(settings.partner) : null;
  current = new Match(settings.mode, botById(settings.rival), partner, settings.open);
  void current.run().catch((err) => { console.error(err); showError(err); });
}
function showError(err: unknown): void {
  const m = el('div', 'frame modal', `<h2>ERROR DEL JUEGO</h2><div class="desc">${esc(String(err))}</div>`);
  const b = el('button', 'btn go', 'VOLVER AL MENÚ'); b.onclick = () => { m.remove(); showMenu(); };
  m.append(b); hud.append(m);
}
function toggles(box: HTMLElement): void {
  const opts: [keyof Settings, string][] = [['music', 'Música'], ['sfx', 'Efectos'], ['voices', 'Voces'], ['filter', 'Filtro sucio'], ['hints', 'Ver mi Envite']];
  opts.forEach(([key, label]) => {
    const b = el('button', 'frame opt', label);
    b.setAttribute('aria-pressed', String(settings[key]));
    b.onclick = () => { (settings[key] as boolean) = !settings[key]; b.setAttribute('aria-pressed', String(settings[key])); applySettings(); snd.play('blip'); };
    box.append(b);
  });
}
function openPause(): void {
  if (document.querySelector('#pause')) return;
  const m = el('div', 'frame modal', '<h2>PAUSA</h2>'); m.id = 'pause';
  const box = el('div', 'opts'); toggles(box); m.append(box);
  const row = el('div', 'row-btns');
  const rules = el('button', 'btn go', 'REGLAS'); rules.onclick = () => { m.remove(); showRules(); };
  const leave = el('button', 'btn go', 'SALIR'); leave.onclick = () => { m.remove(); current?.stop(); showMenu(); };
  const back = el('button', 'btn go', 'SEGUIR'); back.onclick = () => m.remove();
  row.append(rules, leave, back); m.append(row);
  hud.append(m);
}
const RULES = `
<h3>EL OBJETIVO</h3><p>Llega a 24 piedras para ganar un chico. Gana quien haga 2 chicos de 3. Si van 1 a 1, se juega el Bonito.</p>
<h3>LA VIRA</h3><p>La carta volteada elige el palo de las piezas. El Caballo de ese palo es el Perico y la Sota es la Perica. Si la vira es Caballo o Sota, el Rey ocupa su lugar.</p>
<h3>CARTAS DE MAYOR A MENOR</h3><p>Perico, Perica, Espadilla, Bastillo, 7 de espadas, 7 de oros, treses, doses, as de oros y de copas, reyes, caballos, sotas, 7 de copas y de bastos, seises, cincos, cuatros.</p>
<h3>ENVITE</h3><p>Dos cartas del mismo palo valen 20 más sus números. El Perico vale 30 y la Perica 29, más tu carta más alta. Envido querido: 2 piedras. No querido: 1. Puedes subir hasta la Falta. Se compara al final; el empate es del más mano.</p>
<h3>TRUCO</h3><p>Gana la base quien haga 2 vueltas de 3. Sin cantos vale 1. Truco 3, Retruco 6, Vale Nueve 9, Vale Juego gana el chico. No querer paga lo que estaba querido. Solo sube quien tiene la voz.</p>
<h3>PARDAS</h3><p>Primera parda: juegas tu carta más alta y decide la segunda. Si empatan otra vez, destapan quienes empataron. Si todo empata, gana el más mano. Segunda parda: gana quien hizo la primera.</p>
<h3>FLOR</h3><p>Tres cartas del mismo palo, o una pieza con dos del mismo palo. Vale 3 piedras. Cántala antes de tu primera carta o sal A Ley y cántala antes de la segunda. Si no, se quema. Dos piezas juntas son La Reservada, que vale al menos 5.</p>
<h3>ESTAR CANTANDO</h3><p>Con 23 piedras se canta el Envite más alto. El rival debe decir Privo y Truco si lo supera, o el chico se acaba.</p>
<h3>JUGADAS DE VIEJO</h3><p>Pasar tapada: la carta no vale nada. Matar tapado: en segunda, el último jugador esconde la carta que mata y se revela al final. Hacer seña: tu compañero sabrá tu pieza, pero un rival experto puede pillarte.</p>
<h3>TRUCO ABIERTO</h3><p>En parejas, cada jugador ve una carta de su compañero. Esto vale también para los bots.</p>
<p style="margin-top:12px;color:var(--dim)">Resumen propio basado en "El Juego de Truco" de Francisco A. Solé.</p>`;
function showRules(): void {
  const m = el('div', 'frame modal', `<h2>REGLAS</h2><div class="rules">${RULES}</div>`);
  m.style.width = '700px';
  const row = el('div', 'row-btns');
  const back = el('button', 'btn go', 'CERRAR'); back.onclick = () => { m.remove(); snd.play('blip'); };
  row.append(back); m.append(row); hud.append(m);
}
function showTitle(): void {
  hud.innerHTML = '';
  const m = el('div', 'click', '<div class="logo">TRUCO<small>VENEZOLANO</small></div><div class="press">TOCA O PULSA ENTER</div>');
  m.id = 'menu';
  const go = () => { removeEventListener('keydown', key); snd.unlock(); snd.play('confirm'); showMenu(); };
  const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') go(); };
  m.onclick = go; addEventListener('keydown', key);
  hud.append(m);
}
function showMenu(): void {
  scene.setPlayers(2, new Map());
  hud.innerHTML = '';
  const m = el('div', 'click'); m.id = 'menu';
  m.innerHTML = '<div class="logo" style="font-size:34px">TRUCO<small style="font-size:14px">VENEZOLANO</small></div>';
  // Modo
  m.append(el('div', 'sub', 'MODO'));
  const modes = el('div', 'opts');
  const openBox = el('div', 'opts');
  const renderModes = () => {
    modes.innerHTML = '';
    ([[4, 'Parejas: tú y un bot, contra dos'], [2, 'Uno contra uno']] as [2 | 4, string][]).forEach(([v, label]) => {
      const b = el('button', 'frame opt', label); b.setAttribute('aria-pressed', String(settings.mode === v));
      b.onclick = () => { settings.mode = v; applySettings(); snd.play('blip'); renderModes(); renderPartner(); };
      modes.append(b);
    });
    openBox.innerHTML = '';
    if (settings.mode === 4) {
      ([[true, 'Truco Abierto: ves 1 carta de tu compañero'], [false, 'Truco Cerrado']] as [boolean, string][]).forEach(([v, label]) => {
        const b = el('button', 'frame opt', label); b.setAttribute('aria-pressed', String(settings.open === v));
        b.onclick = () => { settings.open = v; applySettings(); snd.play('blip'); renderModes(); };
        openBox.append(b);
      });
    }
  };
  m.append(modes);
  openBox.style.marginTop = '6px';
  m.append(openBox);
  // Rival
  m.append(el('div', 'sub', 'RIVAL'));
  const grid = el('div', 'grid'); m.append(grid);
  const desc = el('div', 'desc');
  const beaten = store<number[]>('truco-beaten', []);
  const describe = (b: BotProfile) => { desc.textContent = `${b.name}, ${b.title}, de ${b.town}. Nivel ${b.stars} de 10.`; };
  const card = (b: BotProfile, pressed: boolean, onClick: () => void) => {
    const btn = el('button', `frame bot${beaten.includes(b.id) ? ' beaten' : ''}`);
    btn.setAttribute('aria-pressed', String(pressed));
    btn.append(faceCanvas(b.look));
    btn.append(el('div', '', `<b>${esc(b.name)}</b><small>${esc(b.title)}</small><span class="lv">Nv. ${b.stars}</span>`));
    btn.onclick = onClick;
    return btn;
  };
  const renderRivals = () => {
    grid.innerHTML = '';
    BOTS.forEach((b) => grid.append(card(b, settings.rival === b.id, () => { settings.rival = b.id; applySettings(); snd.play('blip'); describe(b); renderRivals(); })));
  };
  // Compañero
  const partnerHead = el('div', 'sub', 'COMPAÑERO');
  const partnerBox = el('div', 'opts');
  m.append(partnerHead, partnerBox);
  const renderPartner = () => {
    const show = settings.mode === 4;
    partnerHead.style.display = show ? '' : 'none';
    partnerBox.style.display = show ? '' : 'none';
    partnerBox.innerHTML = '';
    [3, 5, 7, 9].map(botById).forEach((b) => {
      const btn = el('button', 'frame opt', `${esc(b.name)} (Nv. ${b.stars})`);
      btn.setAttribute('aria-pressed', String(settings.partner === b.id));
      btn.onclick = () => { settings.partner = b.id; applySettings(); snd.play('blip'); renderPartner(); };
      partnerBox.append(btn);
    });
  };
  renderModes(); renderRivals(); renderPartner();
  describe(botById(settings.rival));
  const foot = el('div', 'foot');
  foot.append(desc);
  const btns = el('div', 'row-btns'); btns.style.marginTop = '0';
  const rules = el('button', 'btn go', 'REGLAS'); rules.onclick = () => { snd.play('blip'); showRules(); };
  const opts = el('button', 'btn go', 'OPCIONES');
  opts.onclick = () => {
    const box = el('div', 'frame modal', '<h2>OPCIONES</h2>');
    const list = el('div', 'opts'); toggles(list); box.append(list);
    const row = el('div', 'row-btns'); const c = el('button', 'btn go', 'CERRAR'); c.onclick = () => box.remove(); row.append(c); box.append(row);
    hud.append(box);
  };
  const play = el('button', 'btn go', '¡A JUGAR!'); play.id = 'play';
  play.onclick = () => { snd.unlock(); snd.play('confirm'); startMatch(); };
  btns.append(rules, opts, play); foot.append(btns); m.append(foot);
  hud.append(m);
}
showTitle();
