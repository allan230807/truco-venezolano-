// Baraja española de 40 cartas y sus valores en el Truco venezolano.
export type Suit = 'oros' | 'copas' | 'espadas' | 'bastos';
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 10 | 11 | 12;
export interface Card { id: string; s: Suit; r: Rank }

export const SUITS: Suit[] = ['oros', 'copas', 'espadas', 'bastos'];
export const RANKS: Rank[] = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];
const RANK_NAME: Record<Rank, string> = { 1: 'As', 2: 'Dos', 3: 'Tres', 4: 'Cuatro', 5: 'Cinco', 6: 'Seis', 7: 'Siete', 10: 'Sota', 11: 'Caballo', 12: 'Rey' };

export function makeCard(s: Suit, r: Rank): Card { return { id: `${s[0]}${r}`, s, r }; }
export function makeDeck(): Card[] { return SUITS.flatMap((s) => RANKS.map((r) => makeCard(s, r))); }
export function cardById(id: string): Card {
  const suit = SUITS.find((s) => s[0] === id[0]);
  if (!suit) throw new Error(`Carta inválida: ${id}`);
  return makeCard(suit, Number(id.slice(1)) as Rank);
}

/** Con vira caballo el Rey pasa a ser Perico; con vira sota el Rey pasa a ser Perica. */
export function pieces(vira: Card): { perico: Card; perica: Card } {
  return {
    perico: makeCard(vira.s, vira.r === 11 ? 12 : 11),
    perica: makeCard(vira.s, vira.r === 10 ? 12 : 10),
  };
}

export function cardName(c: Card, vira?: Card): string {
  if (vira) {
    const p = pieces(vira);
    if (c.id === p.perico.id) return 'El Perico';
    if (c.id === p.perica.id) return 'La Perica';
  }
  if (c.id === 'e1') return 'La Espadilla';
  if (c.id === 'b1') return 'El Bastillo';
  return `${RANK_NAME[c.r]} de ${c.s}`;
}

/** Jerarquía para el aspecto Truco. Mayor gana; las cartas iguales empardan. */
export function trucoPower(c: Card, vira: Card): number {
  const p = pieces(vira);
  if (c.id === p.perico.id) return 100;
  if (c.id === p.perica.id) return 99;
  if (c.id === 'e1') return 98;
  if (c.id === 'b1') return 97;
  if (c.id === 'e7') return 96;
  if (c.id === 'o7') return 95;
  switch (c.r) {
    case 3: return 90;
    case 2: return 85;
    case 1: return 80; // as de oro y as de copas
    case 12: return 70;
    case 11: return 69;
    case 10: return 68;
    case 7: return 60; // siete de copas y siete de bastos
    case 6: return 50;
    case 5: return 40;
    default: return 30;
  }
}

const nominal = (c: Card): number => (c.r <= 7 ? c.r : 0);

export interface EnviteInfo { value: number; flor: boolean; reservada: boolean; pieceCount: number }

/** Puntos de Envite o de Flor de una mano de tres cartas (se juegue o no alguna ya). */
export function enviteInfo(hand: Card[], vira: Card): EnviteInfo {
  const p = pieces(vira);
  const isPerico = (c: Card) => c.id === p.perico.id;
  const isPerica = (c: Card) => c.id === p.perica.id;
  const piecesHeld = hand.filter((c) => isPerico(c) || isPerica(c));
  const rest = hand.filter((c) => !isPerico(c) && !isPerica(c));
  const pieceValue = piecesHeld.reduce((t, c) => t + (isPerico(c) ? 30 : 29), 0);

  if (piecesHeld.length === 2) {
    return { value: 59 + Math.max(0, ...rest.map(nominal)), flor: true, reservada: true, pieceCount: 2 };
  }
  if (piecesHeld.length === 1) {
    if (rest.length === 2 && rest[0].s === rest[1].s) {
      return { value: pieceValue + nominal(rest[0]) + nominal(rest[1]), flor: true, reservada: false, pieceCount: 1 };
    }
    return { value: pieceValue + Math.max(0, ...rest.map(nominal)), flor: false, reservada: false, pieceCount: 1 };
  }
  if (hand.length === 3 && hand.every((c) => c.s === hand[0].s)) {
    return { value: 20 + hand.reduce((t, c) => t + nominal(c), 0), flor: true, reservada: false, pieceCount: 0 };
  }
  let best = Math.max(0, ...hand.map(nominal));
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      if (hand[i].s === hand[j].s) best = Math.max(best, 20 + nominal(hand[i]) + nominal(hand[j]));
    }
  }
  return { value: best, flor: false, reservada: false, pieceCount: 0 };
}

/** Generador reproducible para partidas, pruebas y torneos. */
export type Rng = () => number;
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
