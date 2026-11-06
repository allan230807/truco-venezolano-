import { describe, expect, it } from 'vitest';
import { makeRng } from '../src/engine/cards';
import { applyAction, legalActions, newMatch, nextBase, partnerOf } from '../src/engine/game';
import { BOTS, botById } from '../src/ai/bots';
import { decide, newMemory, observe, viewFor } from '../src/ai/brain';

describe('Truco Abierto', () => {
  it('Cada jugador ve una sola carta de su compañero y ninguna de los rivales', () => {
    const { state: s } = newMatch(4, makeRng(3));
    for (let seat = 0; seat < 4; seat++) {
      const v = viewFor(s, seat);
      const partner = partnerOf(seat, 4)!;
      expect(v.peeks[partner]?.id).toBe(s.players[partner].dealt[0].id);
      expect(v.peeks.filter(Boolean).length).toBe(1);
      for (const p of v.players) {
        if (p.seat === seat) continue;
        expect(p.dealt).toEqual([]);
        expect(p.hand.every((c) => c.id === '??')).toBe(true);
      }
    }
  });
  it('Truco Cerrado y uno contra uno no muestran cartas', () => {
    expect(newMatch(4, makeRng(3), null, undefined, false).state.peeks.every((c) => c === null)).toBe(true);
    expect(newMatch(2, makeRng(3)).state.peeks.every((c) => c === null)).toBe(true);
  });
  it('Una carta tapada ajena no aparece en la vista', () => {
    const { state: s } = newMatch(2, makeRng(11));
    const seat = s.pending!.seat;
    const hidden = legalActions(s).find((a) => a.t === 'play' && a.hidden);
    if (hidden) {
      applyAction(s, hidden);
      const v = viewFor(s, (seat + 1) % 2);
      expect(v.tricks[0].plays[0].card).toBe(null);
    }
  });
});

describe('Los 10 bots', () => {
  it('Hay 10 niveles distintos, cada uno piensa más que el anterior', () => {
    expect(BOTS.length).toBe(10);
    for (let i = 1; i < 10; i++) expect(BOTS[i].worlds).toBeGreaterThan(BOTS[i - 1].worlds);
    expect(new Set(BOTS.map((b) => b.name)).size).toBe(10);
  });
  it.each([[2 as const], [4 as const]])('%i jugadores: todos juegan partidas completas solo con jugadas legales', (n) => {
    for (const b of BOTS) {
      const rng = makeRng(100 + b.id);
      const { state: s, events } = newMatch(n, rng);
      const mems = Array.from({ length: n }, () => newMemory(n));
      mems.forEach((m) => observe(m, s, events));
      let guard = 0;
      while (s.phase !== 'match-over' && guard++ < 20000) {
        if (s.phase === 'base-over') { const ev = nextBase(s, rng); mems.forEach((m) => observe(m, s, ev)); continue; }
        const seat = s.pending!.seat;
        const d = decide(s, seat, botById(b.id), mems[seat], rng);
        const ev = applyAction(s, d.action);
        mems.forEach((m) => observe(m, s, ev));
      }
      expect(s.phase).toBe('match-over');
    }
  }, 120000);
  it('Ningún bot experto suelta un Envite gigante sin mano casi segura', () => {
    const rng = makeRng(77);
    const prof = botById(10);
    let big = 0, seen = 0;
    for (let i = 0; i < 400; i++) {
      const { state: s } = newMatch(2, rng);
      const seat = s.pending!.seat;
      const d = decide(s, seat, prof, newMemory(2), rng);
      seen++;
      if (d.action.t === 'envido' && (d.action.amount === 'falta' || d.action.amount > 10)) {
        const info = s.players[seat];
        expect(info).toBeTruthy();
        big++;
      }
    }
    expect(big / seen).toBeLessThan(0.05);
  }, 60000);
});
