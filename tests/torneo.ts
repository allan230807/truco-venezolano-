// Torneo sin interfaz: cada nivel contra el siguiente y contra los extremos.
import { makeRng } from '../src/engine/cards';
import { GameState, applyAction, newMatch, nextBase } from '../src/engine/game';
import { BOTS, BotProfile, botById } from '../src/ai/bots';
import { decide, maybeSignal, newMemory, observe } from '../src/ai/brain';

export function playMatch(n: 2 | 4, a: BotProfile, b: BotProfile, seed: number): { winner: 0 | 1; maxMs: number } {
  const rng = makeRng(seed);
  const { state: s, events } = newMatch(n, rng);
  const mems = Array.from({ length: n }, () => newMemory(n));
  const profOf = (seat: number) => (seat % 2 === 0 ? a : b);
  mems.forEach((m) => observe(m, s, events));
  let maxMs = 0;
  const signals = (st: GameState) => {
    if (n !== 4) return;
    for (let seat = 0; seat < n; seat++) {
      const sig = maybeSignal(st, seat, profOf(seat), rng);
      if (sig) st.signals.push({ from: seat, to: (seat + 2) % 4, piece: sig });
    }
  };
  signals(s);
  let guard = 0;
  while (s.phase !== 'match-over') {
    if (guard++ > 40000) throw new Error('Partida sin fin');
    if (s.phase === 'base-over') {
      const ev = nextBase(s, rng);
      mems.forEach((m) => observe(m, s, ev));
      signals(s);
      continue;
    }
    const seat = s.pending!.seat;
    const t0 = performance.now();
    const d = decide(s, seat, profOf(seat), mems[seat], rng);
    maxMs = Math.max(maxMs, performance.now() - t0);
    const ev = applyAction(s, d.action);
    mems.forEach((m) => observe(m, s, ev));
  }
  return { winner: s.matchWinner!, maxMs };
}

function duel(n: 2 | 4, idA: number, idB: number, games: number): { pct: number; ms: number } {
  let wins = 0, ms = 0;
  const a = botById(idA), b = botById(idB);
  for (let i = 0; i < games; i++) {
    // Cada semilla se juega con los lados invertidos para quitar la ventaja del azar.
    const r1 = playMatch(n, a, b, 1000 + i);
    const r2 = playMatch(n, b, a, 1000 + i);
    wins += (r1.winner === 0 ? 1 : 0) + (r2.winner === 1 ? 1 : 0);
    ms = Math.max(ms, r1.maxMs, r2.maxMs);
  }
  return { pct: (100 * wins) / (2 * games), ms };
}

const games = Number(process.argv[2] ?? 30);
const n = (Number(process.argv[3] ?? 2) === 4 ? 4 : 2) as 2 | 4;
console.log(`Partidos por duelo: ${games * 2}, ${n} jugadores`);
for (let i = 1; i < BOTS.length; i++) {
  const r = duel(n, i + 1, i, games);
  console.log(`Nivel ${String(i + 1).padStart(2)} vs ${String(i).padStart(2)}: ${r.pct.toFixed(1)}% (pensar máx ${r.ms.toFixed(0)} ms)`);
}
for (const [x, y] of [[5, 1], [8, 3], [10, 1], [10, 5]]) {
  const r = duel(n, x, y, games);
  console.log(`Nivel ${x} vs ${y}: ${r.pct.toFixed(1)}%`);
}
