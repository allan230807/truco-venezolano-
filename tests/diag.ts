// Diagnóstico: de dónde salen los puntos en un duelo y cómo decide cada bot.
import { makeRng } from '../src/engine/cards';
import { GameEvent, applyAction, newMatch, nextBase } from '../src/engine/game';
import { botById } from '../src/ai/bots';
import { decide, newMemory, observe } from '../src/ai/brain';

const [idA, idB, games] = [Number(process.argv[2] ?? 10), Number(process.argv[3] ?? 1), Number(process.argv[4] ?? 100)];
const oracleA = process.argv[5] === 'oraculo';
const a = botById(idA), b = botById(idB);
const pts: Record<string, [number, number]> = {};
const acts: Record<string, [number, number]> = {};
let bases = 0;
const wins = [0, 0];
for (let i = 0; i < games; i++) {
  for (const flip of [0, 1]) {
    const rng = makeRng(5000 + i);
    const { state: s, events } = newMatch(2, rng);
    const mems = [newMemory(2), newMemory(2)];
    mems.forEach((m) => observe(m, s, events));
    const prof = (seat: number) => ((seat === 0) === (flip === 0) ? a : b);
    const side = (seat: number) => (prof(seat) === a ? 0 : 1);
    const onEvents = (ev: GameEvent[]) => {
      for (const e of ev) {
        if (e.e !== 'score') continue;
        const key = e.reason.replace(/\(.*\)/, '').trim();
        pts[key] ??= [0, 0];
        pts[key][side(e.team)] += e.points;
      }
    };
    while (s.phase !== 'match-over') {
      if (s.phase === 'base-over') { bases++; const ev = nextBase(s, rng); mems.forEach((m) => observe(m, s, ev)); continue; }
      const seat = s.pending!.seat;
      const d = decide(s, seat, prof(seat), mems[seat], rng, oracleA && prof(seat) === a);
      const label = `${s.pending!.kind}:${d.action.t}`;
      acts[label] ??= [0, 0];
      acts[label][side(seat)]++;
      const ev = applyAction(s, d.action);
      mems.forEach((m) => observe(m, s, ev));
      onEvents(ev);
    }
    wins[side(s.matchWinner!)]++;
  }
}
console.log(`Nivel ${idA} gana ${wins[0]} de ${wins[0] + wins[1]} (${(100 * wins[0] / (wins[0] + wins[1])).toFixed(1)}%), bases ${bases}`);
console.log('\nPuntos por motivo (A / B):');
Object.entries(pts).sort((x, y) => y[1][0] + y[1][1] - x[1][0] - x[1][1]).forEach(([k, v]) => console.log(`  ${k.padEnd(36)} ${String(v[0]).padStart(6)} ${String(v[1]).padStart(6)}`));
console.log('\nAcciones (A / B):');
Object.entries(acts).sort().forEach(([k, v]) => console.log(`  ${k.padEnd(36)} ${String(v[0]).padStart(6)} ${String(v[1]).padStart(6)}`));
