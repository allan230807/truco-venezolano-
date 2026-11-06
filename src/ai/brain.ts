// IA: imagina manos compatibles con lo visto (Monte Carlo), pondera por lo que delatan los
// cantos, simula las vueltas y elige la acción de mayor valor según el marcador.
// Nunca lee cartas ajenas: recibe solo la vista filtrada de viewFor().
import { Card, Rng, enviteInfo, makeDeck, pieces, shuffle, trucoPower } from '../engine/cards';
import { Action, GameEvent, GameState, TARGET, Team, faltaAmount, legalActions, manoOrder, other, partnerOf, teamOf } from '../engine/game';
import { BotProfile } from './bots';

/** Lo que ha mostrado cada asiento en esta base; alimenta la deducción. */
export interface SeatRead { envRaised: number; envWanted: boolean; envRejected: boolean; envSilent: boolean; trucoCalled: number; trucoWanted: boolean; florClaim: boolean; aley: boolean; mustNotHaveFlor: boolean }
const emptyRead = (): SeatRead => ({ envRaised: 0, envWanted: false, envRejected: false, envSilent: false, trucoCalled: 0, trucoWanted: false, florClaim: false, aley: false, mustNotHaveFlor: false });
/** Memoria entre bases: cómo juega cada rival. */
export interface OpponentModel { foldedTruco: number; facedTruco: number; bluffsCaught: number; calledTruco: number; wantedEnv: number; facedEnv: number }
export const emptyModel = (): OpponentModel => ({ foldedTruco: 0, facedTruco: 0, bluffsCaught: 0, calledTruco: 0, wantedEnv: 0, facedEnv: 0 });

export interface Memory { reads: SeatRead[]; models: OpponentModel[]; lastBase: number }
export const newMemory = (n: number): Memory => ({ reads: Array.from({ length: n }, emptyRead), models: Array.from({ length: n }, emptyModel), lastBase: 0 });

export type View = GameState; // Mismo formato, con las cartas ajenas retiradas.
/** Quita lo que este asiento no puede ver, incluidas las cartas tapadas ajenas. */
export function viewFor(s: GameState, seat: number): View {
  const v: GameState = structuredClone(s);
  const signals = v.signals.filter((x) => x.to === seat || x.from === seat);
  v.signals = signals;
  const partnerSeat = partnerOf(seat, v.n);
  v.peeks = v.peeks.map((c, i) => (i === partnerSeat ? c : null));
  v.players.forEach((p) => {
    if (p.seat === seat) return;
    p.hand = p.hand.map(() => HIDDEN);
    p.dealt = [];
    p.killCard = null;
  });
  v.tricks.forEach((t) => t.plays.forEach((pc) => {
    if (pc.seat !== seat && pc.hidden) pc.card = null;
    if (pc.seat !== seat) pc.under = null;
  }));
  return v;
}
const HIDDEN: Card = { id: '??', s: 'oros', r: 1 };

/** Actualiza la memoria con los eventos públicos. */
export function observe(mem: Memory, s: GameState, events: GameEvent[]): void {
  if (mem.lastBase !== s.baseNumber) { mem.reads = mem.reads.map(emptyRead); mem.lastBase = s.baseNumber; }
  for (const ev of events) {
    if (ev.e !== 'canto') continue;
    const r = mem.reads[ev.seat];
    const m = mem.models[ev.seat];
    if (!r) continue;
    const text = ev.text;
    if (ev.kind === 'envite') { r.envRaised += 1; }
    if (ev.kind === 'truco') { r.trucoCalled += 1; m.calledTruco += 1; }
    if (ev.kind === 'flor') r.florClaim = true;
    if (ev.kind === 'ley') r.aley = true;
    if (ev.kind === 'answer') {
      if (text.includes('No quiero')) {
        if (s.truco.rejectedBy !== null) { m.foldedTruco += 1; m.facedTruco += 1; } else { r.envRejected = true; m.facedEnv += 1; }
      } else if (text.includes('uiero')) {
        const afterTruco = s.truco.level > 0 && s.envite.status !== 'wanted';
        if (afterTruco) { r.trucoWanted = true; m.facedTruco += 1; } else { r.envWanted = true; m.wantedEnv += 1; m.facedEnv += 1; }
      }
    }
  }
}

// ---------- Mundos posibles ----------
interface World { hands: Card[][]; weight: number }
const ownHand = (v: View, seat: number) => v.players[seat].hand;
function visibleIds(v: View, seat: number): Set<string> {
  const ids = new Set<string>([v.vira.id, ...v.players[seat].dealt.map((c) => c.id)]);
  v.tricks.forEach((t) => t.plays.forEach((pc) => { if (pc.card) ids.add(pc.card.id); }));
  const partner = partnerOf(seat, v.n);
  const peek = partner !== null ? v.peeks[partner] : null;
  if (peek) ids.add(peek.id); // Nadie más puede tener la carta vista del compañero.
  return ids;
}
const playedBy = (v: View, seat: number) => v.tricks.flatMap((t) => t.plays.filter((pc) => pc.seat === seat && pc.card && !pc.hidden).map((pc) => pc.card!));

function signaledCard(v: View, seat: number, target: number): Card | null {
  const sig = v.signals.find((x) => x.from === target && x.to === seat);
  if (!sig) return null;
  const p = pieces(v.vira);
  const map = { perico: p.perico, perica: p.perica, espadilla: { id: 'e1', s: 'espadas', r: 1 } as Card, bastillo: { id: 'b1', s: 'bastos', r: 1 } as Card };
  return map[sig.piece];
}

function sampleWorlds(v: View, seat: number, count: number, mem: Memory, prof: BotProfile, rng: Rng): World[] {
  const seen = visibleIds(v, seat);
  const unseen = makeDeck().filter((c) => !seen.has(c.id));
  const others = v.players.filter((p) => p.seat !== seat);
  const worlds: World[] = [];
  const maxTries = count * 6;
  for (let tries = 0; tries < maxTries && worlds.length < count; tries++) {
    const deck = shuffle(unseen, rng);
    const hands: Card[][] = v.players.map((p) => (p.seat === seat ? p.hand.slice() : []));
    let ok = true;
    let weight = 1;
    for (const p of others) {
      const need = p.hand.length;
      const known = signaledCard(v, seat, p.seat);
      const hand: Card[] = [];
      // Truco Abierto: la carta vista del compañero sigue en su mano si aún no la ha jugado.
      const peek = v.peeks[p.seat];
      if (peek && need > 0 && !playedBy(v, p.seat).some((c) => c.id === peek.id)) hand.push(peek);
      if (known && !seen.has(known.id) && deck.some((c) => c.id === known.id) && hand.length < need) {
        hand.push(deck.splice(deck.findIndex((c) => c.id === known.id), 1)[0]);
      }
      while (hand.length < need && deck.length) hand.push(deck.pop()!);
      const full = [...playedBy(v, p.seat), ...hand];
      // Cartas tapadas ajenas: se completan al azar para calcular la mano original.
      while (full.length < 3 && deck.length) full.push(deck[deck.length - 1 - full.length] ?? hand[0]);
      if (full.length === 3) {
        const info = enviteInfo(full, v.vira);
        // Restricción dura: quien jugó sin declarar ni salir a ley no tiene Flor (salvo Reservada).
        if (p.declared && !info.flor) { ok = false; break; }
        const couldHide = p.played > 0 && !p.declared && !p.aley && !p.burnt && !v.cantando;
        if (couldHide && info.flor && !info.reservada) { ok = false; break; }
        if (prof.inference > 0) weight *= likelihood(mem.reads[p.seat], info.value, info.flor, handPower(full, v.vira), prof, mem.models[p.seat]);
      }
      hands[p.seat] = hand;
    }
    if (ok) worlds.push({ hands, weight });
  }
  if (!worlds.length) worlds.push({ hands: v.players.map((p) => (p.seat === seat ? p.hand.slice() : shuffle(unseen, rng).slice(0, p.hand.length))), weight: 1 });
  return worlds;
}
function handPower(hand: Card[], vira: Card): number {
  const pw = hand.map((c) => trucoPower(c, vira)).sort((a, b) => b - a);
  return pw[0] * 0.5 + pw[1] * 0.35 + pw[2] * 0.15;
}
/** Probabilidad relativa de haber cantado así con esa mano. */
function likelihood(r: SeatRead, env: number, flor: boolean, power: number, prof: BotProfile, model: OpponentModel): number {
  const a = prof.inference;
  const logistic = (x: number) => 1 / (1 + Math.exp(-x));
  const bluffRate = model.calledTruco > 4 ? Math.min(0.5, model.bluffsCaught / model.calledTruco) : 0.15;
  let w = 1;
  const soften = (p: number) => 1 - a + a * (0.06 + 0.94 * p);
  if (r.envRaised > 0) w *= soften(logistic((env - (24 + r.envRaised * 3)) / 3));
  if (r.envWanted) w *= soften(logistic((env - 27) / 3));
  if (r.envRejected) w *= soften(logistic((28 - env) / 3));
  if (r.florClaim && !flor) w *= 0.02;
  if (r.trucoCalled > 0) {
    const honest = logistic((power - (66 + r.trucoCalled * 4)) / 7);
    w *= soften(honest * (1 - bluffRate) + bluffRate);
  }
  if (r.trucoWanted) w *= soften(logistic((power - 68) / 8));
  return Math.max(w, 1e-4);
}

// ---------- Simulación de vueltas ----------
const power = (c: Card, vira: Card) => trucoPower(c, vira);
function cheapest(hand: Card[], vira: Card, beat: number): Card | null {
  let best: Card | null = null;
  for (const c of hand) { const p = power(c, vira); if (p > beat && (!best || p < power(best, vira))) best = c; }
  return best;
}
function lowest(hand: Card[], vira: Card): Card {
  return hand.reduce((a, b) => (power(b, vira) < power(a, vira) ? b : a));
}
function highest(hand: Card[], vira: Card): Card {
  return hand.reduce((a, b) => (power(b, vira) > power(a, vira) ? b : a));
}
interface SimPlay { seat: number; p: number }
/** Política de juego razonable, usada para rellenar las simulaciones. */
function policy(hand: Card[], plays: SimPlay[], team: Team, n: number, vira: Card, trick: number, wonFirst: boolean, lostFirst: boolean): Card {
  if (hand.length === 1) return hand[0];
  if (plays.length === 0) {
    if (trick === 0) { // Salir: guarda la mejor si tiene dos fuertes.
      const sorted = [...hand].sort((a, b) => power(b, vira) - power(a, vira));
      return power(sorted[1], vira) >= 85 ? sorted[1] : sorted[0];
    }
    return wonFirst ? lowest(hand, vira) : highest(hand, vira);
  }
  let best = -1; let bestSeat = -1;
  for (const x of plays) if (x.p > best) { best = x.p; bestSeat = x.seat; }
  const partnerWinning = teamOf(bestSeat, n) === team;
  if (partnerWinning) return lowest(hand, vira);
  const kill = cheapest(hand, vira, best);
  void lostFirst;
  return kill ?? lowest(hand, vira);
}
/** Devuelve el equipo que gana el Truco en este mundo, con la carta inicial forzada. */
function simulateTruco(v: View, world: World, seat: number, myCard: Card | null, myHidden: boolean): Team {
  const n = v.n, vira = v.vira;
  const hands = world.hands.map((h) => h.slice());
  const results: (Team | 'parda')[] = v.tricks.filter((t) => t.result !== null && t.result !== 'pending').map((t) => t.result as Team | 'parda');
  if (v.tricks[1]?.result === 'pending') results.push(v.tricks[1].plays.length ? teamOf(v.tricks[1].winnerSeat ?? seat, n) : 'parda');
  const current = v.tricks[v.tricks.length - 1];
  let plays: SimPlay[] = current.result === null ? current.plays.map((pc) => ({ seat: pc.seat, p: pc.hidden || !pc.card ? 0 : power(pc.card, vira) })) : [];
  let turn = v.pending?.seat ?? seat;
  if (v.pending?.kind !== 'turn') turn = v.queue.find((q) => q.kind === 'turn')?.seat ?? turn;
  let trickIdx = results.length;
  let first = true;
  const verdict = (): Team | null => {
    if (results[0] === 'parda') {
      if (results.length < 2) return null;
      if (results[1] !== 'parda') return results[1] as Team;
      if (results.length < 3) return null;
      return results[2] !== 'parda' ? (results[2] as Team) : teamOf(v.mano, n);
    }
    if (results.length < 2) return null;
    if (results[1] === 'parda' || results[1] === results[0]) return results[0] as Team;
    if (results.length < 3) return null;
    return results[2] === 'parda' ? (results[0] as Team) : (results[2] as Team);
  };
  for (let guard = 0; guard < 80; guard++) {
    const done = verdict();
    if (done !== null) return done;
    if (plays.length >= n || !hands.some((h) => h.length)) {
      if (!plays.length) return teamOf(v.mano, n);
      let top = -1; for (const x of plays) if (x.p > top) top = x.p;
      const tops = plays.filter((x) => x.p === top);
      const teams = new Set(tops.map((x) => teamOf(x.seat, n)));
      results.push(teams.size > 1 ? 'parda' : teamOf(tops[0].seat, n));
      turn = teams.size > 1 ? v.mano : tops[0].seat;
      plays = [];
      trickIdx++;
      continue;
    }
    if (plays.some((x) => x.seat === turn) || !hands[turn].length) { turn = (turn + 1) % n; if (plays.length && !hands[turn].length && hands.every((h) => !h.length)) plays = plays.concat(); continue; }
    let card: Card;
    let hidden = false;
    if (first && turn === seat && myCard) { card = myCard; hidden = myHidden; first = false; }
    else {
      const team = teamOf(turn, n);
      const wonFirst = results[0] === team;
      card = policy(hands[turn], plays, team, n, vira, trickIdx, wonFirst, results[0] === other(team));
    }
    hands[turn].splice(hands[turn].findIndex((c) => c.id === card.id), 1);
    plays.push({ seat: turn, p: hidden ? 0 : power(card, vira) });
    turn = (turn + 1) % n;
  }
  return teamOf(v.mano, n);
}

// ---------- Valor según el marcador ----------
function chicoEquity(my: number, opp: number): number {
  if (my >= TARGET) return 1;
  if (opp >= TARGET) return 0;
  const a = TARGET - my, b = TARGET - opp;
  return Math.pow(b, 1.5) / (Math.pow(a, 1.5) + Math.pow(b, 1.5));
}
function equity(v: View, team: Team, gain: number, lose: number): number {
  const m = v.scores[team], o = v.scores[other(team)];
  return chicoEquity(m + gain, o + lose);
}

export interface Estimate { pTruco: number; pEnv: number; flor: boolean }
function estimate(v: View, seat: number, worlds: World[]): Estimate {
  const team = teamOf(seat, v.n);
  const my = enviteInfo(v.players[seat].dealt, v.vira);
  let total = 0, tw = 0, ew = 0;
  const myTurn = v.pending?.kind === 'turn' && v.pending.seat === seat;
  const candidates = myTurn ? v.players[seat].hand : [];
  const perCard = candidates.map(() => 0);
  for (const w of worlds) {
    total += w.weight;
    if (candidates.length < 2) { if (simulateTruco(v, w, seat, null, false) === team) tw += w.weight; }
    else candidates.forEach((c, i) => { if (simulateTruco(v, w, seat, c, false) === team) perCard[i] += w.weight; });
    let bestOpp = -1, bestOppMano = 99;
    for (const p of v.players) {
      if (teamOf(p.seat, v.n) === team) continue;
      const full = [...playedBy(v, p.seat), ...w.hands[p.seat]];
      if (full.length < 3) continue;
      const i = enviteInfo(full, v.vira);
      const val = i.reservada ? 2000 : i.flor ? 1000 + i.value : i.value;
      if (val > bestOpp || (val === bestOpp && manoOrder(v, p.seat) < bestOppMano)) { bestOpp = val; bestOppMano = manoOrder(v, p.seat); }
    }
    let myVal = my.reservada ? 2000 : my.flor ? 1000 + my.value : my.value;
    const partner = partnerOf(seat, v.n);
    if (partner !== null) {
      const full = [...playedBy(v, partner), ...w.hands[partner]];
      if (full.length === 3) { const i = enviteInfo(full, v.vira); myVal = Math.max(myVal, i.value); }
    }
    if (myVal > bestOpp || (myVal === bestOpp && manoOrder(v, seat) < bestOppMano)) ew += w.weight;
  }
  if (candidates.length >= 2) tw = Math.max(...perCard);
  return { pTruco: tw / (total || 1), pEnv: ew / (total || 1), flor: my.flor };
}
/** Fuerza por tabla para los bots que no simulan. */
function naiveTruco(v: View, seat: number): number {
  const cards = v.players[seat].hand;
  if (!cards.length) return 0.5;
  const pw = cards.map((c) => trucoPower(c, v.vira)).sort((a, b) => b - a);
  const score = pw[0] * 0.55 + (pw[1] ?? 40) * 0.3 + (pw[2] ?? 40) * 0.15;
  return Math.min(0.97, Math.max(0.03, (score - 45) / 50));
}

// ---------- Decisión ----------
// Probabilidad mínima para aceptar o subir cada nivel; reduce el azar de ir al todo o nada.
const ACCEPT_FLOOR = [0, 0.3, 0.42, 0.56, 0.72];
const RAISE_FLOOR = [0, 0.56, 0.68, 0.8, 0.9];
/** Errores de carta: los novatos tiran cartas sin pensar; los expertos, casi nunca. */
const blunderRate = (prof: BotProfile) => Math.max(0, 0.26 - prof.stars * 0.027);
/** Los novatos se asustan: piden más mano para aceptar y casi nunca suben. */
/** Cuanto más grande el Envite, más segura debe ser la mano. "Envido 24" no es un plan. */
const envAccept = (total: number) => (total <= 2 ? 0.25 : total <= 5 ? 0.42 : total <= 10 ? 0.62 : 0.8);
const envCall = (total: number) => (total <= 2 ? 0.5 : total <= 5 ? 0.68 : total <= 10 ? 0.84 : 0.94);
const timid = (prof: BotProfile) => Math.max(0, 5 - prof.stars) * 0.05;
function foldRateOf(mem: Memory, seats: number[], prof: BotProfile, level: number): number {
  let prior = [0, 0.42, 0.32, 0.24, 0.12][level] ?? 0.25;
  if (prof.adapts > 0) {
    let f = 0, t = 0;
    for (const x of seats) { f += mem.models[x].foldedTruco; t += mem.models[x].facedTruco; }
    if (t >= 3) prior = prior * (1 - prof.adapts) + (f / t) * prof.adapts;
  }
  return prior;
}
function pick<T>(rng: Rng, items: T[]): T { return items[Math.floor(rng() * items.length)]; }

export interface Decision { action: Action; speech?: string; thought: string }

export function decide(state: GameState, seat: number, prof: BotProfile, mem: Memory, rng: Rng, oracle = false): Decision {
  const legal = legalActions(state);
  if (legal.length === 1) return { action: legal[0], thought: 'obligada' };
  const v = viewFor(state, seat);
  const team = teamOf(seat, v.n);
  const pending = state.pending!;
  const has = (t: Action['t']) => legal.some((a) => a.t === t);
  const noisy = (x: number) => x + (rng() - 0.5) * prof.noise * 2;
  const worlds = oracle
    ? [{ hands: state.players.map((p) => p.hand.slice()), weight: 1 }]
    : prof.worlds > 0 ? sampleWorlds(v, seat, prof.worlds, mem, prof, rng) : [];
  const est: Estimate = worlds.length ? estimate(v, seat, worlds) : {
    pTruco: naiveTruco(v, seat),
    pEnv: Math.min(0.95, Math.max(0.05, (enviteInfo(v.players[seat].dealt, v.vira).value - 18) / 18)),
    flor: enviteInfo(v.players[seat].dealt, v.vira).flor,
  };
  const myInfo = enviteInfo(v.players[seat].dealt, v.vira);
  const oppSeats = v.players.filter((p) => p.team !== team).map((p) => p.seat);

  if (pending.kind === 'privo') {
    // Privar sin tener puede salir caro: se verifica al final.
    const singer = v.cantando!.singer;
    void singer;
    const bluff = rng() < prof.bluff * 0.8;
    const strong = est.pEnv > 0.5 || myInfo.value >= 30 || myInfo.flor;
    return { action: { t: strong || bluff ? 'privo' : 'noprivo' }, thought: 'privo' };
  }
  if (pending.kind === 'privo-response') {
    const wanted = noisy(est.pTruco) > 0.42;
    return { action: { t: wanted || !has('noquiero') ? 'quiero' : 'noquiero' }, thought: 'privo-respuesta' };
  }
  if (pending.kind === 'flor-voice') {
    if (myInfo.reservada) return { action: { t: 'flor-envida', amount: 'falta' }, thought: 'reservada' };
    if (noisy(est.pEnv) > 0.72) return { action: { t: 'flor-envida', amount: est.pEnv > 0.88 ? 'falta' : 2 }, speech: pick(rng, prof.voice.envido), thought: 'flor fuerte' };
    if (rng() < prof.bluff * 0.5) return { action: { t: 'flor-envida', amount: 2 }, thought: 'farol flor' };
    return { action: { t: 'flor-chica' }, thought: 'achica' };
  }
  if (pending.kind === 'flor-response') {
    const total = v.flor.total;
    const yes = est.pEnv * equity(v, team, 3 + total, 0) + (1 - est.pEnv) * equity(v, team, 0, 3 + total);
    const no = equity(v, team, 0, 4);
    if (myInfo.reservada) return { action: legal.find((a) => a.t === 'flor-envida' && a.amount === 'falta') ?? { t: 'quiero' }, thought: 'reservada' };
    return { action: { t: noisy(yes - no) > 0 ? 'quiero' : 'noquiero' }, thought: 'flor respuesta' };
  }
  if (pending.kind === 'envite-response') return enviteResponse(v, seat, legal, est, myInfo, prof, mem, rng, noisy);
  if (pending.kind === 'truco-response') return trucoResponse(v, seat, legal, est, myInfo, prof, mem, rng, noisy, oppSeats);
  return turnDecision(v, seat, legal, est, myInfo, worlds, prof, mem, rng, noisy, oppSeats);
}

type Info = ReturnType<typeof enviteInfo>;
function enviteResponse(v: View, seat: number, legal: Action[], est: Estimate, my: Info, prof: BotProfile, mem: Memory, rng: Rng, noisy: (x: number) => number): Decision {
  const team = teamOf(seat, v.n);
  const e = v.envite;
  if (my.reservada) {
    const up = legal.find((a) => a.t === 'envido' && a.amount === 'falta');
    return { action: up ?? { t: 'quiero' }, thought: 'reservada apoya' };
  }
  if (my.flor && legal.some((a) => a.t === 'flor')) return { action: { t: 'flor' }, thought: 'declarar Flor' };
  const p = est.pEnv;
  const yes = p * equity(v, team, e.total, 0) + (1 - p) * equity(v, team, 0, e.total);
  const no = equity(v, team, 0, e.prev);
  let bestAct: Action = { t: noisy(yes - no) >= 0 && noisy(p) >= envAccept(e.total) + timid(prof) ? 'quiero' : 'noquiero' };
  let best = bestAct.t === 'quiero' ? yes : no;
  for (const a of legal) {
    if (a.t !== 'envido') continue;
    const total = a.amount === 'falta' ? faltaAmount(v) : a.amount;
    if (total <= e.total) continue;
    const fold = 0.25 + prof.aggression * 0.15;
    const raised = fold * equity(v, team, e.total, 0) + (1 - fold) * (p * equity(v, team, total, 0) + (1 - p) * equity(v, team, 0, total));
    // La Falta es mejor para quien va adelante si le envidaron más de lo que le falta (página 11).
    if (noisy(raised - best) > 0.005 && p > Math.max(envCall(total), 0.45 + (1 - prof.aggression) * 0.2) + timid(prof)) { best = raised; bestAct = a; }
  }
  if (bestAct.t === 'noquiero' && rng() < prof.bluff * 0.5 && e.total <= 4) bestAct = { t: 'quiero' };
  return { action: bestAct, speech: bestAct.t === 'envido' ? pick(rng, prof.voice.envido) : undefined, thought: `env p=${p.toFixed(2)}` };
}
function trucoResponse(v: View, seat: number, legal: Action[], est: Estimate, my: Info, prof: BotProfile, mem: Memory, rng: Rng, noisy: (x: number) => number, oppSeats: number[]): Decision {
  const team = teamOf(seat, v.n);
  const lvl = v.truco.level;
  const ACC = [1, 3, 6, 9, TARGET];
  const REJ = [1, 1, 3, 6, 9];
  // Antes de responder, un Envite fuerte manda: es prioritario (regla 22).
  const canEnvido = legal.some((a) => a.t === 'envido');
  if (canEnvido && est.pEnv > 0.72 && prof.worlds > 0 && rng() < 0.7 + prof.aggression * 0.3) {
    return { action: { t: 'envido', amount: 2 }, speech: pick(rng, prof.voice.envido), thought: 'envite primero' };
  }
  if (my.flor && !my.reservada && legal.some((a) => a.t === 'flor')) return { action: { t: 'flor' }, thought: 'declarar antes de responder' };
  const p = est.pTruco;
  const yes = p * equity(v, team, ACC[lvl], 0) + (1 - p) * equity(v, team, 0, ACC[lvl]);
  const no = equity(v, team, 0, REJ[lvl]);
  let act: Action = { t: noisy(yes - no) >= 0 && noisy(p) >= ACCEPT_FLOOR[lvl] + timid(prof) ? 'quiero' : 'noquiero' };
  if (lvl < 4 && legal.some((a) => a.t === 'retruco')) {
    const fold = foldRateOf(mem, oppSeats, prof, lvl + 1);
    const raised = fold * equity(v, team, ACC[lvl], 0) + (1 - fold) * (p * equity(v, team, ACC[lvl + 1], 0) + (1 - p) * equity(v, team, 0, ACC[lvl + 1]));
    const threshold = 0.5 + (1 - prof.aggression) * 0.25;
    if (noisy(raised - Math.max(yes, no)) > 0 && noisy(p) > Math.max(threshold, RAISE_FLOOR[lvl + 1]) + timid(prof)) act = { t: 'retruco' };
    else if (act.t === 'noquiero' && rng() < prof.bluff * 0.3 && lvl === 1) act = { t: 'retruco' };
  }
  return { action: act, speech: act.t === 'retruco' ? pick(rng, prof.voice.truco) : act.t === 'noquiero' ? pick(rng, prof.voice.fold) : undefined, thought: `truco p=${p.toFixed(2)}` };
}
function turnDecision(v: View, seat: number, legal: Action[], est: Estimate, my: Info, worlds: World[], prof: BotProfile, mem: Memory, rng: Rng, noisy: (x: number) => number, oppSeats: number[]): Decision {
  const team = teamOf(seat, v.n);
  const me = v.players[seat];
  const has = (t: Action['t']) => legal.some((a) => a.t === t);
  // 1) La Flor primero: rara vez se reserva tras A Ley para ver reacciones.
  if (has('flor')) {
    if (my.reservada) {
      const someoneClaims = v.players.some((p) => p.declared && p.team !== team);
      if (someoneClaims || rng() < 0.35 * (1 - prof.deception) + 0.1) return { action: { t: 'flor' }, thought: 'Reservada' };
    } else {
      const slow = me.played === 0 && has('aley') && rng() < prof.deception * 0.45;
      if (slow) return { action: { t: 'aley' }, thought: 'A Ley con Flor' };
      return { action: { t: 'flor' }, thought: 'Flor' };
    }
  }
  if (has('aley') && !my.flor && rng() < prof.deception * 0.1) return { action: { t: 'aley' }, thought: 'A Ley de farol' };

  // 2) Envite en su turno.
  if (has('envido')) {
    const opts = legal.filter((a) => a.t === 'envido') as Extract<Action, { t: 'envido' }>[];
    const p = my.reservada ? 1 : est.pEnv;
    const envRate = 0.25 + prof.aggression * 0.2;
    let best: Action | null = null;
    let bestV = equity(v, team, 0, 0);
    const adjustedSlow = my.pieceCount > 0 && rng() < prof.deception * 0.25; // Esconder la pieza.
    for (const a of opts) {
      const total = a.amount === 'falta' ? faltaAmount(v) : a.amount;
      const val = envRate * equity(v, team, 1, 0) + (1 - envRate) * (p * equity(v, team, total, 0) + (1 - p) * equity(v, team, 0, total));
      if (noisy(val - bestV) > 0.004 && (my.reservada || p >= envCall(total) + timid(prof))) { bestV = val; best = a; }
    }
    if (best && p > 0.52 - prof.aggression * 0.1 + timid(prof) && !adjustedSlow) return { action: best, speech: pick(rng, prof.voice.envido), thought: `envido p=${p.toFixed(2)}` };
    if (!best && rng() < prof.bluff * 0.35 && p > 0.2 && p < 0.5) return { action: opts[0], thought: 'envido de tanteo' };
  }

  // 3) Truco.
  const level = v.truco.level;
  if (has('truco')) {
    const ACC = [1, 3, 6, 9, TARGET];
    const p = est.pTruco;
    const stay = equity(v, team, ACC[level], 0) * p + equity(v, team, 0, ACC[level]) * (1 - p);
    const fold = foldRateOf(mem, oppSeats, prof, level + 1);
    const nextVal = ACC[level + 1];
    const call = fold * equity(v, team, ACC[level], 0) + (1 - fold) * (p * equity(v, team, nextVal, 0) + (1 - p) * equity(v, team, 0, nextVal));
    const slowPlay = p > 0.9 && me.played === 0 && rng() < prof.deception * 0.55;
    const wantsValue = noisy(call - stay) > 0.003 && noisy(p) > Math.max(0.55 - prof.aggression * 0.08, RAISE_FLOOR[level + 1]) + timid(prof) && !slowPlay;
    const worthIt = call - stay > 0;
    const bluffChance = prof.bluff * (me.played > 0 ? 1 : 0.5) * (worthIt ? 1 + 2.5 * prof.adapts : 0.4);
    const bluffing = p < 0.42 && rng() < bluffChance && level === 0;
    if (wantsValue || bluffing) return { action: { t: 'truco' }, speech: pick(rng, prof.voice.truco), thought: `${bluffing ? 'farol' : 'valor'} p=${p.toFixed(2)}` };
  }

  // 4) Irse al mazo solo si la mano es muy mala y hay mucho en juego.
  if (has('fold') && level >= 2 && !v.truco.pending && est.pTruco < 0.05 && noisy(0) > -0.02) {
    return { action: { t: 'fold' }, speech: pick(rng, prof.voice.fold), thought: 'perdido' };
  }

  // 5) La carta.
  return { action: chooseCard(v, seat, legal, worlds, prof, rng), thought: 'carta' };
}
function chooseCard(v: View, seat: number, legal: Action[], worlds: World[], prof: BotProfile, rng: Rng): Action {
  const team = teamOf(seat, v.n);
  const hand = ownHand(v, seat);
  const plays = legal.filter((a): a is Extract<Action, { t: 'play' }> => a.t === 'play');
  const plain = plays.filter((a) => !a.hidden);
  if (!plain.length) return plays[0] ?? legal.find((a) => a.t === 'play') ?? legal[0];
  if (plain.length === 1 && !plays.some((a) => a.hidden)) return plain[0];
  if (rng() < blunderRate(prof)) return plain[Math.floor(rng() * plain.length)];

  // Sin simulación: bajo nivel juega por tabla, con errores.
  if (!worlds.length) {
    const current = v.tricks[v.tricks.length - 1].plays;
    const best = Math.max(-1, ...current.map((pc) => (pc.hidden || !pc.card ? 0 : power(pc.card, v.vira))));
    const c = current.length ? cheapest(hand, v.vira, best) ?? lowest(hand, v.vira) : highest(hand, v.vira);
    return plain.find((a) => a.cardId === c.id) ?? plain[0];
  }

  let bestAction = plain[0];
  let bestScore = -Infinity;
  const candidates = plays.filter((a) => {
    if (!a.hidden) return true;
    return v.tricks.length > 1 && rng() < prof.deception; // Pasar carta solo a veces se evalúa.
  });
  for (const a of candidates) {
    const card = hand.find((c) => c.id === a.cardId)!;
    let w = 0, total = 0;
    for (const world of worlds) {
      total += world.weight;
      if (simulateTruco(v, world, seat, card, !!a.hidden) === team) w += world.weight;
    }
    let score = (w / (total || 1)) + (rng() - 0.5) * prof.noise;
    // Con la mano ganada, regala la carta menos valiosa y guarda fuerza.
    score -= power(card, v.vira) * 0.00012;
    if (a.hidden) score -= 0.015;
    if (score > bestScore) { bestScore = score; bestAction = a; }
  }
  // Matar Tapado: si la mano ya está decidida en silencio, esconde la carta que mata.
  const kills = legal.filter((a): a is Extract<Action, { t: 'kill' }> => a.t === 'kill');
  if (kills.length && v.tricks[0].result === team && v.truco.level < 2 && rng() < prof.deception * 0.6) {
    const visible = v.tricks[1].plays.filter((pc) => !pc.hidden && pc.card);
    const top = Math.max(0, ...visible.map((pc) => power(pc.card!, v.vira)));
    const goodKill = kills.find((k) => {
      const c = hand.find((x) => x.id === k.killId)!;
      const other_ = hand.find((x) => x.id === k.topId)!;
      return power(c, v.vira) > top && power(other_, v.vira) >= 80;
    });
    if (goodKill) return goodKill;
  }
  return bestAction;
}

/** Señas al compañero al recibir las cartas (página 26). */
export function maybeSignal(s: GameState, seat: number, prof: BotProfile, rng: Rng): 'perico' | 'perica' | 'espadilla' | 'bastillo' | null {
  const partner = partnerOf(seat, s.n);
  if (partner === null || rng() > prof.senas) return null;
  const p = pieces(s.vira);
  const hand = s.players[seat].hand;
  if (hand.some((c) => c.id === p.perico.id)) return 'perico';
  if (hand.some((c) => c.id === p.perica.id)) return 'perica';
  if (hand.some((c) => c.id === 'e1')) return 'espadilla';
  if (hand.some((c) => c.id === 'b1')) return 'bastillo';
  return null;
}
