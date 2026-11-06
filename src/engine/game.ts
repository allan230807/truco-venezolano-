// Motor de reglas: una máquina de estados pura, sin interfaz. Sus decisiones siguen el
// libro "El Juego de Truco"; los casos ambiguos y simplificados están en REGLAS.md.
import { Card, Rng, cardById, enviteInfo, makeDeck, pieces, shuffle, trucoPower } from './cards';

export type Team = 0 | 1;
export interface PlayedCard { seat: number; card: Card | null; hidden: boolean; under?: Card | null; kill?: boolean }
export interface Trick { plays: PlayedCard[]; result: Team | 'parda' | 'pending' | null; winnerSeat: number | null }
export interface PlayerState {
  seat: number; team: Team; hand: Card[]; dealt: Card[]; played: number;
  declared: boolean; aley: boolean; burnt: boolean; passAll: boolean; calledTruco: boolean; killCard: Card | null;
}
export type Pending =
  | { kind: 'turn'; seat: number }
  | { kind: 'truco-response'; seat: number }
  | { kind: 'envite-response'; seat: number }
  | { kind: 'flor-voice'; seat: number }
  | { kind: 'flor-response'; seat: number }
  | { kind: 'privo'; seat: number }
  | { kind: 'privo-response'; seat: number };
export type Action =
  | { t: 'play'; cardId: string; hidden?: boolean }
  | { t: 'kill'; killId: string; topId: string }
  | { t: 'aley' } | { t: 'flor' } | { t: 'truco' } | { t: 'fold' } | { t: 'delegate' }
  | { t: 'envido'; amount: number | 'falta' }
  | { t: 'quiero' } | { t: 'noquiero' } | { t: 'retruco' }
  | { t: 'flor-envida'; amount: number | 'falta' } | { t: 'flor-chica' }
  | { t: 'privo' } | { t: 'noprivo' };
export type GameEvent =
  | { e: 'deal'; mano: number; pie: number; vira: Card }
  | { e: 'canto'; seat: number; text: string; kind: CantoKind }
  | { e: 'play'; seat: number; card: Card | null; hidden: boolean; under: boolean; trick: number; kill?: boolean }
  | { e: 'trick'; index: number; result: Team | 'parda' | 'pending'; winnerSeat: number | null }
  | { e: 'reveal'; seat: number; card: Card; result: Team | 'parda' }
  | { e: 'score'; team: Team; points: number; reason: string; total: number }
  | { e: 'base-end'; lines: ScoreLine[]; hands: Card[][] }
  | { e: 'chico'; team: Team; chicos: [number, number]; bonito: boolean }
  | { e: 'match'; team: Team };
export type CantoKind = 'truco' | 'envite' | 'flor' | 'answer' | 'ley' | 'privo' | 'mazo';
export interface ScoreLine { team: Team; points: number; reason: string }

export interface Envite { status: 'none' | 'offered' | 'wanted' | 'rejected'; total: number; prev: number; lastTeam: Team | null; falta: boolean }
export interface FlorContest { status: 'none' | 'voice' | 'chica' | 'offered' | 'wanted' | 'rejected'; total: number; prev: number; lastTeam: Team | null }
export interface TrucoState { level: 0 | 1 | 2 | 3 | 4; pending: boolean; voice: Team | null; caller: Team | null; rejectedBy: Team | null }
export interface Cantando { team: Team; singer: number; privoSeat: number | null; goesTruco: boolean; rejected: boolean; passed: boolean }

export interface GameState {
  n: 2 | 4; humanSeat: number | null; open: boolean; peeks: (Card | null)[]; players: PlayerState[]; vira: Card; mano: number; pie: number;
  scores: [number, number]; chicos: [number, number]; baseNumber: number;
  tricks: Trick[]; pending: Pending | null; queue: Pending[]; truco: TrucoState; envite: Envite; flor: FlorContest;
  cantando: Cantando | null; decidedTeam: Team | null; foldedTeam: Team | null; phase: 'playing' | 'base-over' | 'match-over';
  matchWinner: Team | null; signals: { from: number; to: number; piece: 'perico' | 'perica' | 'espadilla' | 'bastillo' }[];
}

export const TARGET = 24;
export const TRUCO_NAMES = ['', 'Truco', 'Retruco', 'Vale Nueve', 'Vale Juego'];
const ACCEPTED_VALUE = [1, 3, 6, 9, 0]; // Vale Juego gana el chico entero.
const REJECTED_VALUE = [1, 1, 3, 6, 9];
export const teamOf = (seat: number, n: number): Team => (seat % 2) as Team;
export const other = (t: Team): Team => (t === 0 ? 1 : 0);
export const partnerOf = (seat: number, n: number): number | null => (n === 4 ? (seat + 2) % 4 : null);
const nextSeat = (s: GameState, seat: number) => (seat + 1) % s.n;
/** Distancia a El Mano: menor es más mano. */
export const manoOrder = (s: GameState, seat: number) => (seat - s.mano + s.n) % s.n;
export const faltaAmount = (s: GameState) => TARGET - Math.max(s.scores[0], s.scores[1]);
export const handInfo = (s: GameState, seat: number) => enviteInfo(s.players[seat].dealt, s.vira);

export function newMatch(n: 2 | 4, rng: Rng, humanSeat: number | null = null, mano?: number, open = true): { state: GameState; events: GameEvent[] } {
  const firstMano = mano ?? Math.floor(rng() * n);
  const state: GameState = {
    n, humanSeat, open: open && n === 4, peeks: [], players: [], vira: makeDeck()[0], mano: firstMano, pie: (firstMano - 1 + n) % n,
    scores: [0, 0], chicos: [0, 0], baseNumber: 0, tricks: [], pending: null, queue: [],
    truco: { level: 0, pending: false, voice: null, caller: null, rejectedBy: null },
    envite: { status: 'none', total: 0, prev: 0, lastTeam: null, falta: false },
    flor: { status: 'none', total: 0, prev: 0, lastTeam: null },
    cantando: null, decidedTeam: null, foldedTeam: null, phase: 'playing', matchWinner: null, signals: [],
  };
  const events: GameEvent[] = [];
  startBase(state, rng, events);
  return { state, events };
}

export function startBase(s: GameState, rng: Rng, events: GameEvent[], fixedHands?: Card[][], fixedVira?: Card): void {
  const deck = shuffle(makeDeck(), rng);
  const hands = fixedHands ?? Array.from({ length: s.n }, () => deck.splice(0, 3));
  s.vira = fixedVira ?? deck.pop()!;
  s.players = hands.map((h, seat) => ({
    seat, team: teamOf(seat, s.n), hand: h.slice(), dealt: h.slice(), played: 0,
    declared: false, aley: false, burnt: false, passAll: false, calledTruco: false, killCard: null,
  }));
  // Truco Abierto: cada quien ve una sola carta de su compañero (la primera que recibe).
  s.peeks = hands.map((h) => (s.open ? h[0] : null));
  s.tricks = [{ plays: [], result: null, winnerSeat: null }];
  s.truco = { level: 0, pending: false, voice: null, caller: null, rejectedBy: null };
  s.envite = { status: 'none', total: 0, prev: 0, lastTeam: null, falta: false };
  s.flor = { status: 'none', total: 0, prev: 0, lastTeam: null };
  s.cantando = null; s.decidedTeam = null; s.foldedTeam = null; s.queue = []; s.signals = [];
  s.phase = 'playing'; s.baseNumber += 1; s.pending = { kind: 'turn', seat: s.mano };
  events.push({ e: 'deal', mano: s.mano, pie: s.pie, vira: s.vira });
  const at23 = ([0, 1] as Team[]).filter((t) => s.scores[t] === TARGET - 1);
  if (at23.length) beginCantando(s, at23.includes(teamOf(s.mano, s.n)) ? teamOf(s.mano, s.n) : at23[0], events);
}

// ---------- Estar Cantando ----------
const seatsOf = (s: GameState, t: Team) => s.players.filter((p) => p.team === t).map((p) => p.seat);
/** Orden de fuerza: La Reservada, luego Flor, luego puntos de Envite; el empate lo gana el más mano. */
function strength(s: GameState, seat: number): number {
  const i = handInfo(s, seat);
  return (i.reservada ? 2000 : i.flor ? 1000 : 0) + i.value;
}
const bestSeatOf = (s: GameState, t: Team) => seatsOf(s, t).reduce((a, b) =>
  strength(s, b) > strength(s, a) || (strength(s, b) === strength(s, a) && manoOrder(s, b) < manoOrder(s, a)) ? b : a);

function beginCantando(s: GameState, team: Team, events: GameEvent[]): void {
  const singer = bestSeatOf(s, team);
  const info = handInfo(s, singer);
  s.cantando = { team, singer, privoSeat: null, goesTruco: false, rejected: false, passed: false };
  s.envite.status = 'rejected'; // En Cantando no se acepta otro Envite (regla 83).
  events.push({ e: 'canto', seat: singer, kind: 'envite', text: `¡${info.value}${info.flor ? ' con Flor' : ''}!` });
  s.pending = { kind: 'privo', seat: answerSeat(s, other(team), singer) };
}

function answerSeat(s: GameState, team: Team, after: number): number {
  const human = s.humanSeat;
  if (human !== null && teamOf(human, s.n) === team) return human;
  let seat = nextSeat(s, after);
  while (s.players[seat].team !== team) seat = nextSeat(s, seat);
  return seat;
}

// ---------- Vistas y acciones legales ----------
const currentTrickIndex = (s: GameState) => s.tricks.length - 1;
const firstParda = (s: GameState) => s.tricks[0]?.result === 'parda';
const secondParda = (s: GameState) => firstParda(s) && s.tricks[1]?.result === 'parda';
const anyDeclared = (s: GameState) => s.players.some((p) => p.declared);

export function holdsUndeclaredFlor(s: GameState, seat: number): boolean {
  const p = s.players[seat];
  return handInfo(s, seat).flor && !p.declared && !p.burnt;
}
function canDeclareFlor(s: GameState, seat: number): boolean {
  if (s.cantando) return false;
  const p = s.players[seat];
  if (!holdsUndeclaredFlor(s, seat)) return false;
  return p.played === 0 || (p.played === 1 && p.aley) || handInfo(s, seat).reservada;
}
function canCallEnvido(s: GameState, seat: number): boolean {
  const p = s.players[seat];
  if (s.cantando || s.envite.status !== 'none' || currentTrickIndex(s) !== 0 || p.played !== 0) return false;
  return !anyDeclared(s) && !p.calledTruco && (!handInfo(s, seat).flor || handInfo(s, seat).reservada);
}
function canCallTruco(s: GameState, seat: number): boolean {
  const t = s.truco;
  if (t.pending || t.level >= 4 || s.decidedTeam !== null) return false;
  return t.level === 0 || t.voice === s.players[seat].team;
}
function raiseAmounts(total: number, falta: boolean, cap: number): (number | 'falta')[] {
  if (falta) return [];
  const out: (number | 'falta')[] = [];
  for (const add of [2, 5]) if (total + add < cap) out.push(total + add);
  out.push('falta');
  return out;
}

export function legalActions(s: GameState): Action[] {
  const d = s.pending;
  if (!d || s.phase !== 'playing') return [];
  const seat = d.seat;
  const out: Action[] = [];
  switch (d.kind) {
    case 'turn': {
      const p = s.players[seat];
      const idx = currentTrickIndex(s);
      if (canDeclareFlor(s, seat)) out.push({ t: 'flor' });
      if (canCallEnvido(s, seat)) {
        out.push({ t: 'envido', amount: 2 }, { t: 'envido', amount: 5 });
        const behind = Math.abs(s.scores[0] - s.scores[1]);
        if (s.scores[p.team] < s.scores[other(p.team)] && behind > 2 && behind !== 5) out.push({ t: 'envido', amount: behind });
        const need = TARGET - s.scores[p.team]; // "Envido 15": lo que le falta a quien envida (caso 11).
        if (need > 5 && need !== behind && need !== faltaAmount(s)) out.push({ t: 'envido', amount: need });
        out.push({ t: 'envido', amount: 'falta' });
      }
      if (canCallTruco(s, seat)) out.push({ t: 'truco' });
      if (!s.cantando && idx === 0 && p.played === 0 && !p.aley && !p.declared && seat !== s.pie) out.push({ t: 'aley' });
      out.push(...playableCards(s, seat));
      out.push({ t: 'fold' });
      break;
    }
    case 'truco-response': {
      out.push({ t: 'quiero' }, { t: 'noquiero' });
      if (s.truco.level < 4) out.push({ t: 'retruco' });
      if (canDeclareFlor(s, seat)) out.push({ t: 'flor' });
      if (canCallEnvidoResponding(s, seat)) { out.push({ t: 'envido', amount: 2 }, { t: 'envido', amount: 'falta' }); }
      if (partnerOf(seat, s.n) !== null) out.push({ t: 'delegate' });
      break;
    }
    case 'envite-response': {
      out.push({ t: 'quiero' }, { t: 'noquiero' });
      for (const a of raiseAmounts(s.envite.total, s.envite.falta, TARGET + 6)) out.push({ t: 'envido', amount: a });
      if (canDeclareFlor(s, seat)) out.push({ t: 'flor' });
      if (partnerOf(seat, s.n) !== null) out.push({ t: 'delegate' });
      break;
    }
    case 'flor-voice':
      out.push({ t: 'flor-envida', amount: 2 }, { t: 'flor-envida', amount: 'falta' }, { t: 'flor-chica' });
      break;
    case 'flor-response':
      out.push({ t: 'quiero' }, { t: 'noquiero' });
      for (const a of raiseAmounts(s.flor.total, false, TARGET + 6)) out.push({ t: 'flor-envida', amount: a });
      break;
    case 'privo':
      out.push({ t: 'privo' }, { t: 'noprivo' });
      break;
    case 'privo-response':
      out.push({ t: 'quiero' });
      if (!mustGoTruco(s)) out.push({ t: 'noquiero' });
      break;
  }
  return out;
}
function canCallEnvidoResponding(s: GameState, seat: number): boolean {
  if (s.cantando || s.envite.status !== 'none' || currentTrickIndex(s) !== 0 || anyDeclared(s)) return false;
  return s.players[seat].played === 0 && (!handInfo(s, seat).flor || handInfo(s, seat).reservada);
}
/** Reglas 85 y 86: con 22 puntos o con 20 y Flor del contrario, quien canta debe ir al Truco. */
function mustGoTruco(s: GameState): boolean {
  if (!s.cantando) return false;
  const opp = other(s.cantando.team);
  if (s.scores[opp] >= TARGET - 2) return true;
  return s.scores[opp] >= TARGET - 4 && seatsOf(s, opp).some((seat) => handInfo(s, seat).flor);
}

/** Cartas que se pueden jugar en este turno, incluidas tapadas y Matar Tapado. */
function playableCards(s: GameState, seat: number): Action[] {
  const p = s.players[seat];
  if (p.killCard && p.hand.length === 0) return [];
  const idx = currentTrickIndex(s);
  if (p.passAll) return [{ t: 'play', cardId: p.hand[0].id, hidden: true }];
  if (firstParda(s)) {
    // Tras parda de primera se juegan las dos juntas, con la más alta arriba.
    if (idx === 1) {
      const top = [...p.hand].sort((a, b) => trucoPower(b, s.vira) - trucoPower(a, s.vira))[0];
      return [{ t: 'play', cardId: top.id }];
    }
    return [{ t: 'play', cardId: p.hand[0].id }];
  }
  const out: Action[] = p.hand.map((c) => ({ t: 'play', cardId: c.id }));
  if (idx === 0 && p.played === 0) { if (!handInfo(s, seat).flor) out.push({ t: 'play', cardId: p.hand[0].id, hidden: true }); }
  else out.push(...p.hand.map((c): Action => ({ t: 'play', cardId: c.id, hidden: true })));
  if (canKillHidden(s, seat)) {
    const [a, b] = p.hand;
    out.push({ t: 'kill', killId: a.id, topId: b.id }, { t: 'kill', killId: b.id, topId: a.id });
  }
  return out;
}
function canKillHidden(s: GameState, seat: number): boolean {
  const p = s.players[seat];
  const idx = currentTrickIndex(s);
  if (idx !== 1 || p.hand.length !== 2 || firstParda(s)) return false;
  const plays = s.tricks[1].plays;
  if (plays.length !== s.n - 1 || plays.length === 0) return false;
  const best = bestPlay(s, plays);
  return best !== null && s.players[best.seat].team !== p.team; // Matar al compañero no vale.
}
const powerOf = (s: GameState, pc: PlayedCard) => (pc.hidden || !pc.card ? 0 : trucoPower(pc.card, s.vira));
function bestPlay(s: GameState, plays: PlayedCard[]): PlayedCard | null {
  let best: PlayedCard | null = null;
  for (const pc of plays) if (!best || powerOf(s, pc) > powerOf(s, best)) best = pc;
  return best;
}

// ---------- Aplicar acciones ----------
export function applyAction(s: GameState, action: Action): GameEvent[] {
  const events: GameEvent[] = [];
  const d = s.pending;
  if (!d) throw new Error('No hay decisión pendiente');
  const legal = legalActions(s);
  if (!legal.some((a) => sameAction(a, action))) throw new Error(`Acción ilegal ${JSON.stringify(action)} en ${d.kind}`);
  const seat = d.seat;
  const p = s.players[seat];
  const say = (text: string, kind: CantoKind, from = seat) => events.push({ e: 'canto', seat: from, text, kind });

  switch (action.t) {
    case 'flor':
      declareFlor(s, seat, events, d.kind === 'turn' ? '¡Flor!' : 'Flor tengo');
      break;
    case 'aley':
      p.aley = true; say('A Ley', 'ley');
      break;
    case 'truco': {
      autoDeclare(s, seat, events);
      s.truco.level = (s.truco.level + 1) as TrucoState['level'];
      s.truco.pending = true; s.truco.caller = p.team; p.calledTruco = true;
      say(`¡${TRUCO_NAMES[s.truco.level]}!`, 'truco');
      s.queue.unshift(d);
      s.pending = { kind: 'truco-response', seat: answerSeat(s, other(p.team), seat) };
      break;
    }
    case 'retruco': {
      autoDeclare(s, seat, events);
      s.truco.level = (s.truco.level + 1) as TrucoState['level'];
      s.truco.caller = p.team;
      say(`¡Quiero y ${TRUCO_NAMES[s.truco.level]}!`, 'truco');
      s.pending = { kind: 'truco-response', seat: answerSeat(s, other(p.team), seat) };
      break;
    }
    case 'envido':
      callEnvido(s, seat, d, action.amount, events);
      break;
    case 'delegate': {
      const partner = partnerOf(seat, s.n)!;
      s.pending = { kind: d.kind, seat: partner } as Pending;
      break;
    }
    case 'quiero':
      answerYes(s, seat, d, events);
      break;
    case 'noquiero':
      answerNo(s, seat, d, events);
      break;
    case 'flor-envida': {
      const f = s.flor;
      const accepted = f.status === 'offered' ? f.total : 0;
      f.prev = f.status === 'offered' ? f.total : 1;
      f.total = action.amount === 'falta' ? faltaAmount(s) : action.amount;
      f.status = 'offered'; f.lastTeam = p.team;
      say(accepted ? 'La mía quiere y envida' : 'Mi Flor envida', 'flor');
      s.pending = { kind: 'flor-response', seat: floraResponder(s, other(p.team), seat) };
      break;
    }
    case 'flor-chica':
      s.flor.status = 'chica'; say('Mi Flor es chica', 'flor');
      resume(s);
      break;
    case 'privo':
      s.cantando!.privoSeat = seat; say('¡Privo y Truco!', 'privo');
      s.pending = { kind: 'privo-response', seat: answerSeat(s, s.cantando!.team, seat) };
      break;
    case 'noprivo':
      s.cantando!.passed = true; say('Ganaste, no privo', 'answer');
      finishBase(s, events);
      break;
    case 'fold':
      say('Me voy al mazo', 'mazo');
      s.foldedTeam = p.team; s.decidedTeam = other(p.team);
      finishBase(s, events);
      break;
    case 'play':
      playCard(s, seat, action.cardId, !!action.hidden, events);
      break;
    case 'kill':
      playKill(s, seat, action.killId, action.topId, events);
      break;
  }
  return events;
}
export function sameAction(a: Action, b: Action): boolean { return JSON.stringify(a) === JSON.stringify(b); }

function resume(s: GameState): void { s.pending = s.queue.shift() ?? null; }
function autoDeclare(s: GameState, seat: number, events: GameEvent[]): void {
  // Reglas 57 y 63: al responder o pegar Truco se identifica primero la Flor.
  const i = handInfo(s, seat);
  if (i.flor && !i.reservada && canDeclareFlor(s, seat)) declareFlor(s, seat, events, 'Con Flor', true);
}
function declareFlor(s: GameState, seat: number, events: GameEvent[], text: string, keepTurn = false): void {
  const p = s.players[seat];
  p.declared = true;
  events.push({ e: 'canto', seat, kind: 'flor', text });
  if (s.envite.status === 'offered') { // Una Flor en la mesa anula el Envite sin ley ya en juego.
    s.envite.status = 'none'; s.envite.total = 0; s.envite.lastTeam = null;
    if (s.pending?.kind === 'envite-response') resume(s);
  }
  const both = ([0, 1] as Team[]).every((t) => seatsOf(s, t).some((x) => s.players[x].declared));
  if (both && s.flor.status === 'none') {
    s.flor.status = 'voice';
    const declared = s.players.filter((x) => x.declared).sort((a, b) => manoOrder(s, a.seat) - manoOrder(s, b.seat));
    // Al pegar o responder un Truco con Flor no se abre la voz: sigue el canto y las Flores se comparan al final.
    if (!keepTurn) {
      if (s.pending) s.queue.unshift(s.pending);
      s.pending = { kind: 'flor-voice', seat: declared[0].seat };
    }
  }
}
function floraResponder(s: GameState, team: Team, after: number): number {
  const declared = seatsOf(s, team).filter((x) => s.players[x].declared);
  if (s.humanSeat !== null && declared.includes(s.humanSeat)) return s.humanSeat;
  return declared.length ? declared.sort((a, b) => manoOrder(s, a) - manoOrder(s, b))[0] : answerSeat(s, team, after);
}
function callEnvido(s: GameState, seat: number, d: Pending, amount: number | 'falta', events: GameEvent[]): void {
  const p = s.players[seat];
  const e = s.envite;
  const prev = e.status === 'offered' ? e.total : 1;
  const isFalta = amount === 'falta';
  const total = isFalta ? faltaAmount(s) : amount;
  let text: string;
  if (e.status !== 'offered') {
    text = isFalta ? '¡Envido la Falta!' : total === 2 ? '¡Envido!' : `¡Envido ${total} piedras!`;
    if (d.kind === 'turn' || d.kind === 'truco-response') s.queue.unshift(d);
    if (p.aley) text = `A Ley: ${text}`;
  } else {
    const more = total - prev;
    text = isFalta ? '¡Quiero y la Falta!' : prev === 2 && more === 2 ? '¡Quiero y Envido!' : `¡Quiero y ${more} piedras más!`;
  }
  e.status = 'offered'; e.total = total; e.prev = prev; e.lastTeam = p.team; e.falta = isFalta;
  events.push({ e: 'canto', seat, kind: 'envite', text });
  s.pending = { kind: 'envite-response', seat: answerSeat(s, other(p.team), seat) };
}
function answerYes(s: GameState, seat: number, d: Pending, events: GameEvent[]): void {
  const say = (text: string, kind: CantoKind = 'answer') => events.push({ e: 'canto', seat, kind, text });
  if (d.kind === 'envite-response') {
    autoDeclareForEnvite(s, seat, events);
    if (s.envite.status === 'offered') { s.envite.status = 'wanted'; say('Quiero'); resume(s); }
    return;
  }
  if (d.kind === 'truco-response') {
    const flor = handInfo(s, seat).flor && !handInfo(s, seat).reservada && canDeclareFlor(s, seat);
    autoDeclare(s, seat, events);
    s.truco.pending = false; s.truco.voice = s.players[seat].team;
    say(flor ? 'Con Flor quiero' : 'Quiero');
    if (s.pending?.kind === 'truco-response') resume(s);
    else s.queue = s.queue.filter((q) => q.kind !== 'truco-response');
    return;
  }
  if (d.kind === 'flor-response') { s.flor.status = 'wanted'; say('La mía quiere', 'flor'); resume(s); return; }
  if (d.kind === 'privo-response') {
    const c = s.cantando!;
    c.goesTruco = true; s.truco.level = 1; s.truco.pending = false; s.truco.voice = c.team; s.truco.caller = other(c.team);
    say('Quiero');
    s.pending = { kind: 'turn', seat: s.mano };
  }
}
function autoDeclareForEnvite(s: GameState, seat: number, events: GameEvent[]): void {
  const i = handInfo(s, seat);
  if (i.flor && !i.reservada && canDeclareFlor(s, seat)) declareFlor(s, seat, events, 'Con Ley quiero');
}
function answerNo(s: GameState, seat: number, d: Pending, events: GameEvent[]): void {
  const say = (text: string) => events.push({ e: 'canto', seat, kind: 'answer', text });
  if (d.kind === 'envite-response') {
    s.envite.status = 'rejected'; say('No quiero'); resume(s);
    return;
  }
  if (d.kind === 'truco-response') {
    s.truco.pending = false; s.truco.rejectedBy = s.players[seat].team;
    s.decidedTeam = other(s.players[seat].team);
    say('No quiero');
    finishBase(s, events);
    return;
  }
  if (d.kind === 'flor-response') { s.flor.status = 'rejected'; say('La mía es chica'); resume(s); return; }
  if (d.kind === 'privo-response') {
    s.cantando!.rejected = true; say('No quiero');
    finishBase(s, events);
  }
}

// ---------- Cartas y vueltas ----------
function takeCard(p: PlayerState, id: string): Card {
  const i = p.hand.findIndex((c) => c.id === id);
  if (i < 0) throw new Error(`Carta ${id} no está en la mano`);
  return p.hand.splice(i, 1)[0];
}
function checkFlorOnPlay(s: GameState, p: PlayerState): void {
  const info = handInfo(s, p.seat);
  if (!info.flor || p.declared || info.reservada || s.cantando) return;
  if (p.played === 0 && !p.aley) p.burnt = true;
  if (p.played === 1) p.burnt = true;
}
function playCard(s: GameState, seat: number, id: string, hidden: boolean, events: GameEvent[]): void {
  const p = s.players[seat];
  checkFlorOnPlay(s, p);
  const idx = currentTrickIndex(s);
  const card = takeCard(p, id);
  if (hidden && idx === 0) p.passAll = true;
  let under = false;
  const pc: PlayedCard = { seat, card, hidden };
  if (idx === 1 && firstParda(s) && p.hand.length === 1) { pc.under = p.hand[0]; under = true; }
  s.tricks[idx].plays.push(pc);
  p.played += 1;
  events.push({ e: 'play', seat, card: hidden ? null : card, hidden, under, trick: idx });
  if (!hidden && card.id === pieces(s.vira).perico.id && s.tricks.some((t) => t.result === p.team)) {
    // Regla 34: quien ya hizo una vuelta y juega el Perico no puede perder.
    s.decidedTeam = p.team;
    finishTrick(s, events, true);
    finishBase(s, events);
    return;
  }
  advance(s, events);
}
function playKill(s: GameState, seat: number, killId: string, topId: string, events: GameEvent[]): void {
  const p = s.players[seat];
  checkFlorOnPlay(s, p);
  const kill = takeCard(p, killId);
  const top = takeCard(p, topId);
  p.killCard = kill; p.played = 3;
  s.tricks[1].plays.push({ seat, card: kill, hidden: true, kill: true });
  events.push({ e: 'play', seat, card: null, hidden: true, under: false, trick: 1, kill: true });
  // La tercera carta queda visible encima, jugada de antemano.
  s.tricks[1].result = 'pending';
  const visible = s.tricks[1].plays.filter((x) => !x.kill);
  const best = bestPlay(s, visible)!;
  s.tricks[1].winnerSeat = best.seat;
  events.push({ e: 'trick', index: 1, result: 'pending', winnerSeat: best.seat });
  s.tricks.push({ plays: [{ seat, card: top, hidden: false }], result: null, winnerSeat: null });
  events.push({ e: 'play', seat, card: top, hidden: false, under: false, trick: 2 });
  s.pending = { kind: 'turn', seat: best.seat };
  if (best.seat === seat) advance(s, events);
}
function playersThisTrick(s: GameState): number[] {
  const idx = currentTrickIndex(s);
  if (idx === 2 && secondParda(s)) return tiedSeats(s, 1);
  return s.players.map((p) => p.seat);
}
function tiedSeats(s: GameState, idx: number): number[] {
  const plays = s.tricks[idx].plays;
  const best = bestPlay(s, plays);
  if (!best) return [];
  const top = powerOf(s, best);
  return plays.filter((x) => powerOf(s, x) === top).map((x) => x.seat);
}
function advance(s: GameState, events: GameEvent[]): void {
  const idx = currentTrickIndex(s);
  const seats = playersThisTrick(s);
  const trick = s.tricks[idx];
  if (trick.plays.length >= seats.length) {
    finishTrick(s, events, false);
    if (s.phase !== 'playing' || s.decidedTeam !== null) { if (s.phase === 'playing') finishBase(s, events); return; }
    startNextTrick(s, events);
    return;
  }
  let seat = s.pending!.seat;
  do { seat = nextSeat(s, seat); } while (!seats.includes(seat) || trick.plays.some((x) => x.seat === seat));
  s.pending = { kind: 'turn', seat };
}
function finishTrick(s: GameState, events: GameEvent[], partial: boolean): void {
  const idx = currentTrickIndex(s);
  const trick = s.tricks[idx];
  const best = bestPlay(s, trick.plays)!;
  const top = powerOf(s, best);
  const tops = trick.plays.filter((x) => powerOf(s, x) === top);
  const teams = new Set(tops.map((x) => s.players[x.seat].team));
  trick.winnerSeat = best.seat;
  trick.result = teams.size > 1 && !partial ? 'parda' : s.players[best.seat].team;
  events.push({ e: 'trick', index: idx, result: trick.result, winnerSeat: trick.winnerSeat });
  if (s.decidedTeam === null) s.decidedTeam = decideTruco(s, events);
}
/** Devuelve el equipo que ganó el aspecto Truco, o null si sigue la base. */
function decideTruco(s: GameState, events: GameEvent[]): Team | null {
  const t = s.tricks;
  if (t.length === 3 && t[1].result === 'pending') resolveKill(s, events);
  const r = t.map((x) => x.result);
  if (r[0] === 'parda') {
    if (r.length < 2) return null;
    if (r[1] !== 'parda') return r[1] as Team;
    if (r.length < 3) return null;
    if (r[2] !== 'parda') return r[2] as Team;
    const tied = tiedSeats(s, 2).sort((a, b) => manoOrder(s, a) - manoOrder(s, b));
    return s.players[tied[0]].team; // Ganar de mano.
  }
  if (r.length < 2 || r[1] === 'pending') return null;
  if (r[1] === 'parda' || r[1] === r[0]) return r[0] as Team; // Ganar por primera.
  if (r.length < 3) return null;
  return r[2] === 'parda' ? (r[0] as Team) : (r[2] as Team);
}
function resolveKill(s: GameState, events: GameEvent[]): void {
  const trick = s.tricks[1];
  const killPlay = trick.plays.find((x) => x.kill)!;
  const visible = trick.plays.filter((x) => !x.kill);
  const bestVisible = bestPlay(s, visible)!;
  const killPower = trucoPower(killPlay.card!, s.vira);
  const bestPower = powerOf(s, bestVisible);
  const killer = s.players[killPlay.seat];
  killPlay.hidden = false;
  if (killPower > bestPower) { trick.result = killer.team; trick.winnerSeat = killPlay.seat; }
  else if (killPower === bestPower) trick.result = 'parda';
  else trick.result = s.players[bestVisible.seat].team;
  events.push({ e: 'reveal', seat: killPlay.seat, card: killPlay.card!, result: trick.result as Team | 'parda' });
}
function startNextTrick(s: GameState, events: GameEvent[]): void {
  const idx = currentTrickIndex(s);
  const prev = s.tricks[idx];
  s.tricks.push({ plays: [], result: null, winnerSeat: null });
  let leader: number;
  if (prev.result === 'parda') {
    const seats = idx === 1 && firstParda(s) ? tiedSeats(s, 1) : s.players.map((p) => p.seat);
    leader = seats.sort((a, b) => manoOrder(s, a) - manoOrder(s, b))[0];
  } else leader = prev.winnerSeat!;
  s.pending = { kind: 'turn', seat: leader };
  void events;
}

// ---------- Fin de base y puntuación ----------
function finishBase(s: GameState, events: GameEvent[]): void {
  if (s.phase !== 'playing') return;
  s.pending = null; s.queue = [];
  const lines = s.cantando ? settleCantando(s) : settleNormal(s);
  applyScores(s, lines, events);
}
function validFlorSeats(s: GameState): number[] {
  // Quien no llegó a su primer turno aún podía declarar: se le reconoce al mostrar.
  return s.players.filter((p) => handInfo(s, p.seat).flor && !p.burnt && (p.declared || p.played === 0)).map((p) => p.seat);
}
function beats(s: GameState, a: number, b: number): boolean {
  const sa = strength(s, a), sb = strength(s, b);
  return sa > sb || (sa === sb && manoOrder(s, a) < manoOrder(s, b));
}
function settleEnviteFlor(s: GameState): ScoreLine[] {
  const lines: ScoreLine[] = [];
  const e = s.envite;
  const reservadaSeat = s.players.find((p) => handInfo(s, p.seat).reservada && !p.burnt)?.seat ?? null;
  const flors = validFlorSeats(s).filter((x) => x !== reservadaSeat);
  if (reservadaSeat !== null) {
    const team = s.players[reservadaSeat].team, opp = other(team);
    const partner = partnerOf(reservadaSeat, s.n);
    const partnerFlor = partner !== null && flors.includes(partner);
    const oppFlors = flors.filter((x) => s.players[x].team === opp);
    const oppDeclared = oppFlors.filter((x) => s.players[x].declared).length > 0;
    const resDeclared = s.players[reservadaSeat].declared;
    if (oppDeclared && !resDeclared) { // Regla 71.
      lines.push({ team: opp, points: 3 * oppFlors.length, reason: 'Flor (La Reservada no se cantó)' });
      return lines;
    }
    if (e.status === 'rejected' && e.lastTeam === opp && !partnerFlor) { // Regla 68: rechazó por error.
      lines.push({ team: opp, points: e.prev, reason: 'Envite no querido' });
      if (oppFlors.length) lines.push({ team: opp, points: 3 * oppFlors.length, reason: 'Flor' });
      else lines.push({ team, points: 3, reason: 'La Reservada' });
      return lines;
    }
    lines.push({ team, points: 3 + (partnerFlor ? 3 : 0), reason: partnerFlor ? 'La Reservada y Flor' : 'La Reservada' });
    const florAmount = s.flor.status === 'wanted' ? s.flor.total : s.flor.status === 'rejected' ? s.flor.prev : 0;
    if (partnerFlor) { if (florAmount) lines.push({ team, points: florAmount, reason: 'Envite de Flores' }); return lines; }
    const sinLey = e.status === 'wanted' ? e.total : e.status === 'rejected' ? e.prev : 0;
    lines.push({ team, points: Math.max(1, sinLey, florAmount), reason: 'Envite de La Reservada' });
    return lines;
  }
  if (flors.length) {
    const teams = new Set(flors.map((x) => s.players[x].team));
    if (teams.size === 1) {
      lines.push({ team: s.players[flors[0]].team, points: 3 * flors.length, reason: flors.length > 1 ? 'Dos Flores' : 'Flor' });
      return lines;
    }
    const f = s.flor;
    if (f.status === 'rejected' && f.lastTeam !== null) {
      const mine = flors.filter((x) => s.players[x].team === f.lastTeam).length;
      lines.push({ team: f.lastTeam, points: 3 * mine + f.prev, reason: 'Flor y Envite no querido' });
      return lines;
    }
    const best = flors.reduce((a, b) => (beats(s, b, a) ? b : a));
    const team = s.players[best].team;
    const oppBest = flors.filter((x) => s.players[x].team !== team).reduce((a, b) => (beats(s, b, a) ? b : a));
    const count = flors.filter((x) => s.players[x].team === team && beats(s, x, oppBest)).length;
    lines.push({ team, points: 3 * count, reason: count > 1 ? 'Flor más alta (dos Flores)' : 'Flor más alta' });
    if (f.status === 'wanted') lines.push({ team, points: f.total, reason: 'Envite de Flores' });
    return lines;
  }
  if (e.status === 'rejected' && e.lastTeam !== null) {
    lines.push({ team: e.lastTeam, points: e.prev, reason: 'Envite no querido' });
  } else if (e.status === 'wanted') {
    const seats = s.players.map((p) => p.seat);
    const winnerAll = seats.reduce((a, b) => (beats(s, b, a) ? b : a));
    lines.push({ team: s.players[winnerAll].team, points: e.total, reason: e.falta ? 'Envite (la Falta)' : 'Envite' });
  }
  return lines;
}
function trucoWinner(s: GameState): Team {
  if (s.decidedTeam !== null) return s.decidedTeam;
  return decideFromPartial(s);
}
function decideFromPartial(s: GameState): Team { return s.tricks.find((t) => t.result === 0 || t.result === 1)?.result as Team ?? teamOf(s.mano, s.n); }
function settleNormal(s: GameState): ScoreLine[] {
  let lines = settleEnviteFlor(s);
  const burntTeams = new Set(s.players.filter((p) => p.burnt).map((p) => p.team));
  // Regla 56: quien esconde Flor no cobra lo que gane, pero sí paga lo que pierda.
  lines = lines.map((l) => (burntTeams.has(l.team) ? { ...l, team: other(l.team), reason: `${l.reason} (Flor quemada)` } : l));
  if (s.foldedTeam !== null && s.envite.status === 'none' && !s.players.some((p) => p.declared)) {
    lines.push({ team: other(s.foldedTeam), points: 1, reason: 'Se fue al mazo (Envite)' });
  }
  const winner = trucoWinner(s);
  const t = s.truco;
  if (t.rejectedBy !== null) {
    lines.push({ team: other(t.rejectedBy), points: REJECTED_VALUE[t.level], reason: `${TRUCO_NAMES[t.level]} no querido` });
    return lines;
  }
  const value = t.level === 0 || t.pending ? (t.pending ? REJECTED_VALUE[t.level] : 1) : ACCEPTED_VALUE[t.level];
  const name = t.level === 0 ? 'La base' : TRUCO_NAMES[t.level];
  if (burntTeams.has(winner) && !burntTeams.has(other(winner))) {
    lines.push({ team: other(winner), points: 1, reason: 'Truco (Flor quemada)' });
  } else if (t.level === 4 && !t.pending) {
    lines.push({ team: winner, points: TARGET, reason: 'Vale Juego' });
  } else {
    lines.push({ team: winner, points: value, reason: s.foldedTeam !== null ? `Se fue al mazo (${name})` : name });
  }
  return lines;
}
function settleCantando(s: GameState): ScoreLine[] {
  const c = s.cantando!;
  const opp = other(c.team);
  if (c.passed) return [{ team: c.team, points: 1, reason: 'Nadie privó' }];
  const bestOpp = bestSeatOf(s, opp);
  const beat = beats(s, bestOpp, c.singer);
  if (s.foldedTeam === opp) return [{ team: c.team, points: 1, reason: 'Se fueron al mazo' }];
  if (!beat) return [{ team: c.team, points: 1, reason: 'El privo era falso' }];
  const info = handInfo(s, bestOpp);
  const singerInfo = handInfo(s, c.singer);
  if (c.rejected || s.foldedTeam === c.team) {
    if (info.reservada || singerInfo.flor) return [{ team: opp, points: 5, reason: 'Privo con Flor, sin Truco' }];
    if (info.flor) return [{ team: opp, points: 4, reason: 'Privo con Flor, sin Truco' }];
    return [{ team: opp, points: 2, reason: 'Privo y Truco no querido' }];
  }
  const winner = trucoWinner(s);
  if (winner === c.team) return [{ team: c.team, points: 1, reason: 'Ganó el Truco cantando' }];
  const lines: ScoreLine[] = [];
  if (info.reservada || singerInfo.flor) lines.push({ team: opp, points: 4, reason: 'Privo con Flor y Envite' });
  else if (info.flor) lines.push({ team: opp, points: 3, reason: 'Privo con Flor' });
  else lines.push({ team: opp, points: 1, reason: 'Privo (Envite)' });
  if (s.truco.level === 4 && !s.truco.pending) lines.push({ team: opp, points: TARGET, reason: 'Vale Juego' });
  else lines.push({ team: opp, points: ACCEPTED_VALUE[s.truco.level] || 1, reason: TRUCO_NAMES[s.truco.level] });
  return lines;
}
function applyScores(s: GameState, lines: ScoreLine[], events: GameEvent[]): void {
  // Los puntos de Envite y Flor se cobran antes que los del Truco (reglas 20 y 40).
  s.phase = 'base-over';
  const shown: ScoreLine[] = [];
  let chicoWinner: Team | null = null;
  for (const l of lines) {
    if (l.points <= 0) continue;
    s.scores[l.team] += l.points;
    shown.push(l);
    events.push({ e: 'score', team: l.team, points: l.points, reason: l.reason, total: s.scores[l.team] });
    if (s.scores[l.team] >= TARGET) { chicoWinner = l.team; break; }
  }
  events.push({ e: 'base-end', lines: shown, hands: s.players.map((p) => p.dealt) });
  if (chicoWinner !== null) {
    s.chicos[chicoWinner] += 1;
    const bonito = s.chicos[0] === 1 && s.chicos[1] === 1;
    events.push({ e: 'chico', team: chicoWinner, chicos: [s.chicos[0], s.chicos[1]], bonito });
    s.scores = [0, 0];
    if (s.chicos[chicoWinner] >= 2) {
      s.phase = 'match-over'; s.matchWinner = chicoWinner;
      events.push({ e: 'match', team: chicoWinner });
    }
  }
}
export function nextBase(s: GameState, rng: Rng): GameEvent[] {
  if (s.phase !== 'base-over') throw new Error('La base no ha terminado');
  s.pie = s.mano;
  s.mano = nextSeat(s, s.mano);
  const events: GameEvent[] = [];
  startBase(s, rng, events);
  return events;
}
export { cardById };
