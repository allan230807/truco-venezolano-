import { describe, expect, it } from 'vitest';
import { Card, Rank, Suit, enviteInfo, makeCard, makeRng, pieces, trucoPower } from '../src/engine/cards';
import { Action, GameEvent, GameState, applyAction, legalActions, newMatch, nextBase, startBase, faltaAmount } from '../src/engine/game';

const c = (s: Suit, r: number): Card => makeCard(s, r as Rank);
const O = 'oros' as const, C = 'copas' as const, E = 'espadas' as const, B = 'bastos' as const;

function setup(n: 2 | 4, hands: Card[][], vira: Card, mano = 0, scores: [number, number] = [0, 0]): GameState {
  const { state } = newMatch(n, makeRng(1), null, mano);
  state.scores = scores;
  const ev: GameEvent[] = [];
  startBase(state, makeRng(2), ev, hands, vira);
  return state;
}
const act = (s: GameState, ...acts: Action[]) => acts.flatMap((a) => applyAction(s, a));
const play = (id: string): Action => ({ t: 'play', cardId: id });
const scoreLines = (ev: GameEvent[]) => ev.filter((e) => e.e === 'score') as Extract<GameEvent, { e: 'score' }>[];

describe('Valores de cartas (libro, páginas 5 a 15)', () => {
  it('El Perico y La Perica salen del palo de la vira', () => {
    expect(pieces(c(O, 4)).perico.id).toBe('o11');
    expect(pieces(c(O, 4)).perica.id).toBe('o10');
  });
  it('Vira caballo: el Rey sustituye al Perico. Vira sota: el Rey sustituye a la Perica', () => {
    expect(pieces(c(E, 11)).perico.id).toBe('e12');
    expect(pieces(c(E, 11)).perica.id).toBe('e10');
    expect(pieces(c(B, 10)).perico.id).toBe('b11');
    expect(pieces(c(B, 10)).perica.id).toBe('b12');
  });
  it('Respeta la jerarquía del Truco', () => {
    const vira = c(O, 4);
    const order = [c(O, 11), c(O, 10), c(E, 1), c(B, 1), c(E, 7), c(O, 7), c(C, 3), c(B, 2), c(O, 1), c(E, 12), c(B, 11), c(C, 10), c(C, 7), c(O, 6), c(O, 5), c(E, 4)];
    for (let i = 1; i < order.length; i++) expect(trucoPower(order[i - 1], vira)).toBeGreaterThan(trucoPower(order[i], vira));
    expect(trucoPower(c(O, 1), vira)).toBe(trucoPower(c(C, 1), vira));
    expect(trucoPower(c(C, 7), vira)).toBe(trucoPower(c(B, 7), vira));
  });
  it('Calcula los ejemplos de Envite del libro', () => {
    const vira = c(O, 4);
    expect(enviteInfo([c(C, 3), c(C, 5), c(E, 7)], vira).value).toBe(28);
    expect(enviteInfo([c(B, 12), c(B, 1), c(C, 6)], vira).value).toBe(21);
    expect(enviteInfo([c(O, 11), c(C, 7), c(E, 3)], vira).value).toBe(37);
    expect(enviteInfo([c(O, 10), c(C, 12), c(E, 11)], vira).value).toBe(29);
    expect(enviteInfo([c(C, 4), c(E, 12), c(B, 2)], vira).value).toBe(4);
  });
  it('Calcula Flor Blanca, Flor con pieza y La Reservada', () => {
    const vira = c(O, 4);
    expect(enviteInfo([c(C, 1), c(C, 7), c(C, 12)], vira)).toMatchObject({ value: 28, flor: true, reservada: false });
    expect(enviteInfo([c(O, 11), c(C, 7), c(C, 3)], vira)).toMatchObject({ value: 40, flor: true });
    expect(enviteInfo([c(O, 10), c(E, 5), c(E, 12)], vira)).toMatchObject({ value: 34, flor: true });
    expect(enviteInfo([c(O, 11), c(O, 10), c(C, 7)], vira)).toMatchObject({ flor: true, reservada: true });
  });
});

const VIRA = c(O, 4);
const WEAK_A = [c(C, 4), c(E, 5), c(B, 6)];
const WEAK_B = [c(B, 4), c(C, 5), c(E, 6)];

describe('Envite (páginas 10 y 11)', () => {
  it('Envido no querido da 1 al retador', () => {
    const s = setup(2, [WEAK_A, WEAK_B], VIRA);
    act(s, { t: 'envido', amount: 2 }, { t: 'noquiero' });
    const ev = act(s, { t: 'truco' }, { t: 'noquiero' });
    expect(scoreLines(ev).map((l) => [l.team, l.points])).toEqual([[0, 1], [0, 1]]);
  });
  it('Envido querido da 2 al más alto al final de la base', () => {
    const s = setup(2, [[c(C, 7), c(C, 6), c(B, 4)], WEAK_B], VIRA);
    act(s, { t: 'envido', amount: 2 }, { t: 'quiero' });
    const ev = act(s, { t: 'truco' }, { t: 'noquiero' });
    expect(scoreLines(ev)[0]).toMatchObject({ team: 0, points: 2 });
  });
  it('La escalera Envido, Quiero y Envido, dos más, Quiero vale 6; rechazar paga lo anterior', () => {
    const s = setup(2, [[c(C, 7), c(C, 6), c(B, 4)], WEAK_B], VIRA);
    act(s, { t: 'envido', amount: 2 }, { t: 'envido', amount: 4 }, { t: 'envido', amount: 6 });
    expect(s.envite).toMatchObject({ total: 6, prev: 4 });
    const s2 = setup(2, [WEAK_A, WEAK_B], VIRA);
    act(s2, { t: 'envido', amount: 2 }, { t: 'envido', amount: 4 }, { t: 'noquiero' });
    const ev = act(s2, { t: 'truco' }, { t: 'noquiero' });
    expect(scoreLines(ev)[0]).toMatchObject({ team: 1, points: 2 });
  });
  it('La Falta es lo que le falta a quien va adelante', () => {
    const s = setup(2, [WEAK_A, WEAK_B], VIRA, 0, [20, 9]);
    expect(faltaAmount(s)).toBe(4);
  });
  it('Caso 11: 15 piedras queridas valen 15 aunque superen la Falta', () => {
    const s = setup(2, [WEAK_A, [c(C, 7), c(C, 6), c(B, 4)]], VIRA, 1, [20, 9]);
    act(s, play('c7'));
    void s;
    const t = setup(2, [[c(C, 7), c(C, 6), c(B, 4)], WEAK_B], VIRA, 0, [9, 20]);
    act(t, { t: 'envido', amount: 15 }, { t: 'quiero' });
    const ev = act(t, { t: 'truco' }, { t: 'noquiero' });
    expect(scoreLines(ev)[0]).toMatchObject({ team: 0, points: 15 });
    expect(ev.some((e) => e.e === 'chico' && e.team === 0)).toBe(true);
  });
  it('A 0-0 no se ofrece un Envido que repita a la Falta', () => {
    const s = setup(2, [WEAK_A, WEAK_B], VIRA);
    const amounts = legalActions(s).filter((a) => a.t === 'envido').map((a) => (a.t === 'envido' ? a.amount : 0));
    expect(amounts).toEqual([2, 5, 'falta']);
  });
  it('El empate de Envite lo gana el más mano', () => {
    const s = setup(2, [[c(C, 7), c(B, 6), c(E, 4)], [c(E, 7), c(B, 5), c(C, 4)]], VIRA, 1);
    act(s, { t: 'envido', amount: 2 }, { t: 'quiero' });
    const ev = act(s, { t: 'truco' }, { t: 'noquiero' });
    expect(scoreLines(ev)[0]).toMatchObject({ team: 1, points: 2 });
  });
  it('El Envite es prioritario sobre el Truco', () => {
    const s = setup(2, [WEAK_A, [c(C, 7), c(C, 6), c(B, 4)]], VIRA);
    act(s, { t: 'truco' }, { t: 'envido', amount: 2 });
    expect(s.pending?.kind).toBe('envite-response');
    act(s, { t: 'quiero' });
    expect(s.pending?.kind).toBe('truco-response');
  });
  it('Nadie envida después de pegar Truco, pero su compañero sí', () => {
    const s = setup(4, [WEAK_A, WEAK_B, [c(O, 2), c(C, 2), c(E, 12)], [c(O, 3), c(C, 12), c(B, 7)]], VIRA);
    act(s, { t: 'truco' }, { t: 'quiero' });
    expect(legalActions(s).some((a) => a.t === 'envido')).toBe(false);
    act(s, play(WEAK_A[0].id));
    expect(legalActions(s).some((a) => a.t === 'envido')).toBe(true);
  });
});

describe('Truco (páginas 15 y 16, y reglas 30 a 34)', () => {
  it('Sin cantos la base vale 1', () => {
    const s = setup(2, [[c(O, 3), c(C, 3), c(E, 3)], WEAK_B], VIRA);
    act(s, play('o3'), play('b4'), play('c3'));
    const ev = act(s, play('c5'));
    expect(scoreLines(ev)).toMatchObject([{ team: 0, points: 1 }]);
  });
  it.each([
    [1, 1, 3], [2, 3, 6], [3, 6, 9],
  ])('Nivel %i: no querido paga %i y querido vale %i', (level, no, yes) => {
    const raise = (s: GameState) => {
      act(s, { t: 'truco' });
      for (let i = 1; i < level; i++) act(s, { t: 'retruco' });
    };
    const rejected = setup(2, [[c(O, 3), c(C, 3), c(E, 3)], WEAK_B], VIRA);
    raise(rejected);
    expect(scoreLines(act(rejected, { t: 'noquiero' })).at(-1)!.points).toBe(no);
    const wanted = setup(2, [[c(O, 3), c(C, 3), c(E, 3)], WEAK_B], VIRA);
    raise(wanted);
    act(wanted, { t: 'quiero' });
    if (wanted.pending?.seat === 0) act(wanted, play('o3')); else act(wanted, play('b4'));
    if (wanted.pending?.seat === 1) act(wanted, play('b4'));
    else if (wanted.tricks[0].plays.length === 1) act(wanted, play('o3'));
    act(wanted, play('c3'));
    expect(scoreLines(act(wanted, play('c5'))).at(-1)!.points).toBe(yes);
  });
  it('Vale Juego querido gana el chico; no querido paga 9', () => {
    const s = setup(2, [[c(O, 3), c(C, 3), c(E, 3)], WEAK_B], VIRA);
    act(s, { t: 'truco' }, { t: 'retruco' }, { t: 'retruco' }, { t: 'retruco' }, { t: 'quiero' });
    const ev = act(s, play('o3'), play('b4'), play('c3'), play('c5'));
    expect(ev.some((e) => e.e === 'chico')).toBe(true);
  });
  it('Quien pegó no puede subir; sube quien tiene la voz', () => {
    const s = setup(2, [WEAK_A, WEAK_B], VIRA);
    act(s, { t: 'truco' }, { t: 'quiero' });
    expect(legalActions(s).some((a) => a.t === 'truco')).toBe(false);
    act(s, play('c4'));
    expect(legalActions(s).some((a) => a.t === 'truco')).toBe(true);
  });
  it('Ganar por primera: la segunda empardada es de quien hizo la primera', () => {
    const s = setup(2, [[c(O, 3), c(C, 2), c(E, 4)], [c(E, 5), c(E, 2), c(B, 4)]], VIRA);
    act(s, play('o3'), play('e5'), play('c2'));
    const ev = act(s, play('e2'));
    expect(scoreLines(ev)[0]).toMatchObject({ team: 0 });
  });
  it('Primera empardada: gana la segunda y se juega la más alta', () => {
    const s = setup(2, [[c(O, 3), c(E, 12), c(E, 4)], [c(C, 3), c(E, 5), c(B, 4)]], VIRA);
    act(s, play('o3'), play('c3'));
    expect(s.tricks[0].result).toBe('parda');
    expect(legalActions(s).filter((a) => a.t === 'play')).toEqual([{ t: 'play', cardId: 'e12' }]);
    act(s, play('e12'));
    const ev = act(s, play('e5'));
    expect(scoreLines(ev)[0]).toMatchObject({ team: 0 });
  });
  it('Tres pardas: gana el más mano', () => {
    const s = setup(2, [[c(O, 3), c(O, 2), c(O, 5)], [c(C, 3), c(C, 2), c(C, 5)]], c(B, 4), 1);
    act(s, play('c3'), play('o3'), play('c2'), play('o2'), play('c5'));
    const ev = act(s, play('o5'));
    expect(scoreLines(ev).at(-1)).toMatchObject({ team: 1 });
  });
  it('Regla 34: quien hizo primera y juega el Perico gana enseguida', () => {
    const s = setup(2, [[c(E, 1), c(O, 11), c(C, 4)], WEAK_B], VIRA);
    act(s, play('e1'), play('b4'));
    const ev = act(s, play('o11'));
    expect(s.phase).toBe('base-over');
    expect(scoreLines(ev)[0]).toMatchObject({ team: 0 });
  });
  it('Irse al mazo paga 2: uno de Envite y uno de Truco', () => {
    const s = setup(2, [WEAK_A, WEAK_B], VIRA);
    const ev = act(s, { t: 'fold' });
    expect(scoreLines(ev).reduce((t, l) => t + l.points, 0)).toBe(2);
    expect(scoreLines(ev)[0].team).toBe(1);
  });
  it('Solo se puede pasar la primera si se pasan las tres', () => {
    const s = setup(2, [WEAK_A, WEAK_B], VIRA);
    act(s, { t: 'play', cardId: 'c4', hidden: true }, play('b4'), play('c5'));
    expect(s.pending?.seat).toBe(0);
    expect(legalActions(s).filter((a) => a.t === 'play').every((a) => a.t === 'play' && a.hidden)).toBe(true);
  });
  it('Matar Tapado: la carta se revela al final y decide la segunda', () => {
    const s = setup(2, [[c(O, 3), c(C, 5), c(E, 4)], [c(E, 2), c(B, 1), c(B, 5)]], VIRA, 0);
    act(s, play('o3'), play('e2'), play('c5'));
    const kills = legalActions(s).filter((a) => a.t === 'kill');
    expect(kills.length).toBe(2);
    act(s, { t: 'kill', killId: 'b1', topId: 'b5' });
    expect(s.tricks[1].result).toBe('pending');
    const ev = act(s, play('e4'));
    expect(ev.some((e) => e.e === 'reveal')).toBe(true);
    expect(s.tricks[1].result).toBe(1);
    expect(scoreLines(ev).at(-1)).toMatchObject({ team: 1 });
  });
  it('Caso 5: no se puede matar tapado al propio compañero', () => {
    const s = setup(4, [
      [c(E, 1), c(C, 4), c(E, 12)], [c(C, 5), c(O, 3), c(E, 4)],
      [c(B, 5), c(B, 6), c(E, 6)], [c(O, 5), c(B, 2), c(B, 7)],
    ], VIRA);
    act(s, play('e1'), play('c5'), play('b5'), play('o5')); // Mano hace primera.
    act(s, play('c4'), play('o3'), play('b6'));
    expect(legalActions(s).some((a) => a.t === 'kill')).toBe(false);
  });
});

describe('Flor (páginas 19 a 22 y reglas 49 a 63)', () => {
  const FLOR = [c(C, 1), c(C, 7), c(C, 12)];
  const FLOR_LOW = [c(B, 4), c(B, 2), c(B, 12)]; // 26
  it('Una Flor sin rival vale 3', () => {
    const s = setup(2, [FLOR, WEAK_B], VIRA);
    act(s, { t: 'flor' });
    const ev = act(s, { t: 'truco' }, { t: 'noquiero' });
    expect(scoreLines(ev)[0]).toMatchObject({ team: 0, points: 3 });
  });
  it('Dos Flores del mismo equipo valen 6', () => {
    const s = setup(4, [FLOR, WEAK_B, FLOR_LOW, [c(E, 2), c(O, 3), c(E, 3)]], VIRA);
    act(s, { t: 'flor' }, play('c1'), play('c5'), { t: 'flor' });
    const ev = act(s, { t: 'truco' }, { t: 'noquiero' });
    expect(scoreLines(ev)[0]).toMatchObject({ team: 0, points: 6 });
  });
  it('Flor contra Flor: la voz va al más mano y al achicarse gana la más alta sin Envite', () => {
    const s = setup(2, [FLOR, FLOR_LOW], VIRA);
    act(s, { t: 'flor' }, play('c1'), { t: 'flor' });
    expect(s.pending).toMatchObject({ kind: 'flor-voice', seat: 0 });
    act(s, { t: 'flor-chica' });
    const ev = act(s, { t: 'truco' }, { t: 'noquiero' });
    expect(scoreLines(ev)[0]).toMatchObject({ team: 0, points: 3 });
  });
  it('Caso 12: no querer Flor con Envite da 4 a quien envidó aunque su Flor sea menor', () => {
    const s = setup(2, [FLOR_LOW, FLOR], VIRA);
    act(s, { t: 'flor' }, play('b4'), { t: 'flor' }, { t: 'flor-envida', amount: 2 }, { t: 'noquiero' });
    const ev = act(s, { t: 'truco' }, { t: 'noquiero' });
    expect(scoreLines(ev)[0]).toMatchObject({ team: 0, points: 4 });
  });
  it('Flor querida: el ganador cobra Flor y Envite; el perdedor nada', () => {
    const s = setup(2, [FLOR, FLOR_LOW], VIRA);
    act(s, { t: 'flor' }, play('c1'), { t: 'flor' }, { t: 'flor-envida', amount: 2 }, { t: 'quiero' });
    const ev = act(s, { t: 'truco' }, { t: 'noquiero' });
    expect(scoreLines(ev).slice(0, 2).map((l) => [l.team, l.points])).toEqual([[0, 3], [0, 2]]);
  });
  it('Una Flor en la mesa anula el Envite regular', () => {
    const s = setup(2, [WEAK_A, FLOR], VIRA);
    act(s, { t: 'envido', amount: 5 }, { t: 'flor' });
    expect(s.envite.status).toBe('none');
    const ev = act(s, { t: 'truco' }, { t: 'noquiero' });
    expect(scoreLines(ev)[0]).toMatchObject({ team: 1, points: 3 });
  });
  it('Regla 56: la Flor no cantada se quema; no cobra Truco y el contrario gana 1', () => {
    const s = setup(2, [[c(E, 2), c(E, 3), c(E, 12)], WEAK_B], VIRA);
    act(s, play('e3'));
    expect(s.players[0].burnt).toBe(true);
    act(s, play('b4'), play('e2'));
    const ev = act(s, play('c5'));
    expect(scoreLines(ev)).toMatchObject([{ team: 1, points: 1 }]);
  });
  it('A Ley permite declarar la Flor antes de la segunda carta', () => {
    const s = setup(2, [FLOR, WEAK_B], VIRA);
    act(s, { t: 'aley' }, play('c1'), play('b4'));
    expect(s.players[0].burnt).toBe(false);
    act(s, { t: 'flor' });
    const ev = act(s, { t: 'truco' }, { t: 'noquiero' });
    expect(scoreLines(ev)[0]).toMatchObject({ team: 0, points: 3 });
  });
  it('A Ley sin declarar antes de la segunda carta quema la Flor', () => {
    const s = setup(2, [FLOR, WEAK_B], VIRA);
    act(s, { t: 'aley' }, play('c1'), play('b4'), play('c7'));
    expect(s.players[0].burnt).toBe(true);
  });
  it('El Pie no puede jugar simplemente a ley (regla 76)', () => {
    const s = setup(2, [WEAK_A, WEAK_B], VIRA, 1);
    expect(legalActions(s).some((a) => a.t === 'aley')).toBe(true); // Mano
    act(s, play('b4'));
    expect(legalActions(s).some((a) => a.t === 'aley')).toBe(false); // Pie
  });
});

describe('La Reservada (páginas 22 y reglas 64 a 75)', () => {
  const RES = [c(O, 11), c(O, 10), c(C, 7)];
  it('Vale 3 de Flor, 1 de Envite y al menos 1 de Truco, aunque no se cante', () => {
    const s = setup(2, [RES, WEAK_B], VIRA);
    const ev = act(s, play('c7'), play('b4'), play('o10'), play('c5'));
    const pts = scoreLines(ev).map((l) => l.points);
    expect(pts).toEqual([3, 1, 1]);
  });
  it('Regla 71: si no se canta y el contrario canta Flor, solo cobra el Truco', () => {
    const s = setup(2, [RES, [c(B, 4), c(B, 5), c(B, 12)]], VIRA);
    act(s, play('c7'), { t: 'flor' });
    const ev = act(s, play('b4'), play('o10'), play('b5'));
    expect(scoreLines(ev).map((l) => [l.team, l.points])).toEqual([[1, 3], [0, 1]]);
  });
  it('Regla 74 y caso 5: con Flor del compañero cobra 6 y no el punto de Envite', () => {
    const s = setup(4, [RES, WEAK_B, [c(B, 4), c(B, 5), c(B, 12)], [c(E, 2), c(O, 3), c(E, 3)]], VIRA);
    act(s, { t: 'flor' }, play('c7'), play('c5'), { t: 'flor' });
    const ev = act(s, { t: 'truco' }, { t: 'noquiero' });
    expect(scoreLines(ev).map((l) => l.points)).toEqual([6, 1]);
  });
  it('Caso 1: cobra el Envite mayor entre Sin Ley y Con Ley', () => {
    const s = setup(2, [[c(E, 7), c(B, 5), c(C, 4)], RES], VIRA);
    act(s, { t: 'envido', amount: 5 }, { t: 'envido', amount: 10 }, { t: 'quiero' });
    const ev = act(s, { t: 'truco' }, { t: 'noquiero' });
    expect(scoreLines(ev).map((l) => l.points)).toEqual([3, 10, 1]);
  });
});

describe('Estar Cantando (página 18 y reglas 83 a 89)', () => {
  it('Sin privo, quien canta cobra y gana el chico', () => {
    const s = setup(2, [[c(C, 7), c(C, 6), c(B, 4)], WEAK_B], VIRA, 0, [23, 10]);
    expect(s.pending?.kind).toBe('privo');
    const ev = act(s, { t: 'noprivo' });
    expect(ev.some((e) => e.e === 'chico')).toBe(true);
  });
  it('Privo y Truco no querido da 2 al contrario', () => {
    const s = setup(2, [WEAK_A, [c(C, 7), c(C, 6), c(B, 4)]], VIRA, 0, [23, 10]);
    const ev = act(s, { t: 'privo' }, { t: 'noquiero' });
    expect(scoreLines(ev)).toMatchObject([{ team: 1, points: 2 }]);
  });
  it('Privo falso: si no había Envite mayor, gana quien cantaba', () => {
    const s = setup(2, [[c(C, 7), c(C, 6), c(B, 4)], WEAK_B], VIRA, 0, [23, 10]);
    const ev = act(s, { t: 'privo' }, { t: 'noquiero' });
    expect(ev.some((e) => e.e === 'chico' && e.team === 0)).toBe(true);
  });
  it('Regla 86: con el contrario en 22 hay que ir al Truco', () => {
    const s = setup(2, [WEAK_A, [c(C, 7), c(C, 6), c(B, 4)]], VIRA, 0, [23, 22]);
    act(s, { t: 'privo' });
    expect(legalActions(s).map((a) => a.t)).toEqual(['quiero']);
  });
  it('Regla 83: en Cantando no hay Envite', () => {
    const s = setup(2, [WEAK_A, [c(C, 7), c(C, 6), c(B, 4)]], VIRA, 0, [23, 10]);
    act(s, { t: 'privo' }, { t: 'quiero' });
    expect(legalActions(s).some((a) => a.t === 'envido')).toBe(false);
  });
});

describe('Partido', () => {
  it('El Mano de esta base baraja en la siguiente', () => {
    const s = setup(4, [WEAK_A, WEAK_B, [c(O, 2), c(C, 2), c(E, 12)], [c(O, 3), c(C, 12), c(B, 7)]], VIRA, 1);
    act(s, { t: 'fold' });
    nextBase(s, makeRng(5));
    expect(s.pie).toBe(1);
    expect(s.mano).toBe(2);
  });
  it('Gana quien hace 2 chicos de 3 a 24 piedras', () => {
    const s = setup(2, [WEAK_A, WEAK_B], VIRA, 0, [22, 0]);
    s.chicos = [1, 1];
    act(s, { t: 'truco' }, { t: 'noquiero' });
    expect(s.scores[0]).toBe(23);
    const t = setup(2, [WEAK_A, WEAK_B], VIRA, 0, [21, 0]);
    t.chicos = [1, 1];
    act(t, { t: 'truco' }, { t: 'quiero' }, { t: 'fold' });
    expect(t.phase).toBe('base-over');
    const w = setup(2, [[c(O, 3), c(C, 3), c(E, 3)], WEAK_B], VIRA, 0, [21, 0]);
    w.chicos = [1, 1];
    act(w, { t: 'truco' }, { t: 'quiero' }, play('o3'), play('b4'), play('c3'), play('c5'));
    expect(w.phase).toBe('match-over');
    expect(w.matchWinner).toBe(0);
  });
  it('El Envite se cobra antes que el Truco si ambos llegan a 24', () => {
    const s = setup(2, [[c(C, 7), c(C, 6), c(B, 4)], WEAK_B], VIRA, 0, [22, 23 - 2]);
    act(s, { t: 'envido', amount: 2 }, { t: 'quiero' });
    const ev = act(s, { t: 'truco' }, { t: 'noquiero' });
    const chico = ev.find((e) => e.e === 'chico') as Extract<GameEvent, { e: 'chico' }>;
    expect(chico.team).toBe(0);
  });
});

describe('Robustez con jugadas aleatorias', () => {
  it.each([[2 as const], [4 as const]])('%i jugadores: 3000 partidas sin bloqueos ni estados inválidos', (n) => {
    const rng = makeRng(99);
    let matches = 0;
    for (let i = 0; i < 3000; i++) {
      const { state: s } = newMatch(n, rng);
      let steps = 0;
      while (s.phase !== 'match-over' && steps++ < 6000) {
        if (s.phase === 'base-over') {
          if (s.chicos[0] < 2 && s.chicos[1] < 2) nextBase(s, rng);
          continue;
        }
        const legal = legalActions(s);
        expect(legal.length, `sin acciones en ${s.pending?.kind}`).toBeGreaterThan(0);
        const pool = legal.filter((a) => a.t !== 'fold' && a.t !== 'delegate');
        const a = (pool.length ? pool : legal)[Math.floor(rng() * (pool.length || legal.length))];
        const before = s.players.reduce((t, p) => t + p.hand.length, 0);
        applyAction(s, a);
        expect(s.players.reduce((t, p) => t + p.hand.length, 0)).toBeLessThanOrEqual(before);
        expect(s.scores[0]).toBeGreaterThanOrEqual(0);
      }
      expect(s.phase).toBe('match-over');
      matches++;
    }
    expect(matches).toBe(3000);
  }, 120000);
});
