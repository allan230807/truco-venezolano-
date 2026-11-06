// Todo el arte se pinta por código en baja resolución: cartas, caras, paño y paredes.
import { Card, Suit, makeRng } from '../engine/cards';
import { BotProfile } from '../ai/bots';

export function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  return [c, g];
}
const SUIT_COLOR: Record<Suit, string> = { oros: '#c9962a', copas: '#a82a24', espadas: '#2f4f7f', bastos: '#2f6a33' };

function drawSuit(g: CanvasRenderingContext2D, s: Suit, x: number, y: number, k: number): void {
  g.save(); g.translate(x, y); g.scale(k, k);
  g.lineJoin = 'round';
  if (s === 'oros') {
    g.fillStyle = '#7d5a12'; g.beginPath(); g.arc(0, 0, 7, 0, 7); g.fill();
    g.fillStyle = '#e4b53a'; g.beginPath(); g.arc(0, 0, 5.8, 0, 7); g.fill();
    g.fillStyle = '#f6e08a'; g.beginPath(); g.arc(-1, -1, 3, 0, 7); g.fill();
    g.fillStyle = '#a57a1c'; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.fillRect(Math.cos(a) * 5 - .5, Math.sin(a) * 5 - .5, 1, 1); }
  } else if (s === 'copas') {
    g.fillStyle = '#6d1612'; g.fillRect(-5.5, -7, 11, 2); g.beginPath(); g.moveTo(-5.5, -6); g.lineTo(5.5, -6); g.lineTo(3, 1); g.lineTo(-3, 1); g.fill();
    g.fillStyle = '#c23a2e'; g.beginPath(); g.moveTo(-4.3, -5.4); g.lineTo(4.3, -5.4); g.lineTo(2.3, .3); g.lineTo(-2.3, .3); g.fill();
    g.fillStyle = '#e6c15c'; g.fillRect(-1, 1, 2, 3); g.fillRect(-3.5, 4, 7, 2);
  } else if (s === 'espadas') {
    g.fillStyle = '#c3cbd3'; g.beginPath(); g.moveTo(0, -8); g.lineTo(2, -5); g.lineTo(1.3, 3); g.lineTo(-1.3, 3); g.lineTo(-2, -5); g.fill();
    g.fillStyle = '#6e7f90'; g.fillRect(0, -6, 1.3, 9);
    g.fillStyle = '#c9962a'; g.fillRect(-4.5, 3, 9, 1.8);
    g.fillStyle = '#6a3b1a'; g.fillRect(-1, 4.8, 2, 3);
  } else {
    g.fillStyle = '#4c2c11'; g.beginPath(); g.moveTo(-2, 8); g.lineTo(2, 8); g.lineTo(3.8, -5); g.lineTo(1, -8); g.lineTo(-3, -6); g.fill();
    g.fillStyle = '#7f5024'; g.beginPath(); g.moveTo(-1, 7.5); g.lineTo(1, 7.5); g.lineTo(2.6, -5); g.lineTo(.6, -7); g.lineTo(-2, -5.5); g.fill();
    g.fillStyle = '#2f6a33'; g.fillRect(-4, -5, 2.5, 2); g.fillRect(2.4, -2, 2.4, 2);
  }
  g.restore();
}
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]], 2: [[0, -1], [0, 1]], 3: [[0, -1.25], [0, 0], [0, 1.25]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1.2], [1, -1.2], [0, 0], [-1, 1.2], [1, 1.2]],
  6: [[-1, -1.25], [1, -1.25], [-1, 0], [1, 0], [-1, 1.25], [1, 1.25]],
  7: [[-1, -1.4], [1, -1.4], [-1, -.3], [1, -.3], [0, .55], [-1, 1.4], [1, 1.4]],
};
function drawFigure(g: CanvasRenderingContext2D, card: Card, W: number, H: number): void {
  const col = SUIT_COLOR[card.s];
  const cx = W / 2;
  const body = (c: string) => { g.fillStyle = c; g.fillRect(cx - 9, 42, 18, 22); g.fillRect(cx - 12, 44, 24, 5); };
  const head = () => { g.fillStyle = '#d9a877'; g.fillRect(cx - 5, 27, 10, 11); g.fillStyle = '#1c1612'; g.fillRect(cx - 3, 31, 2, 2); g.fillRect(cx + 1, 31, 2, 2); g.fillRect(cx - 2, 35, 4, 1); };
  if (card.r === 12) {
    body(col); head();
    g.fillStyle = '#e4b53a'; g.fillRect(cx - 6, 22, 12, 5); g.fillRect(cx - 6, 19, 2, 3); g.fillRect(cx - 1, 19, 2, 3); g.fillRect(cx + 4, 19, 2, 3);
    g.fillStyle = '#6a4a22'; g.fillRect(cx - 4, 38, 8, 4);
    g.fillStyle = '#e8dcc0'; g.fillRect(cx - 9, 50, 18, 2);
  } else if (card.r === 11) {
    g.fillStyle = '#6a4a26'; g.fillRect(cx - 16, 50, 32, 12); g.fillRect(cx + 11, 40, 8, 14); g.fillRect(cx - 15, 62, 4, 8); g.fillRect(cx + 11, 62, 4, 8); g.fillRect(cx - 7, 62, 4, 8); g.fillRect(cx + 3, 62, 4, 8);
    g.fillStyle = '#151210'; g.fillRect(cx + 17, 42, 2, 2);
    g.fillStyle = col; g.fillRect(cx - 7, 38, 13, 14); head();
    g.fillStyle = col; g.fillRect(cx - 7, 22, 14, 5);
  } else {
    body(col); head();
    g.fillStyle = '#3a2412'; g.fillRect(cx - 6, 24, 12, 4); g.fillRect(cx - 6, 28, 2, 6);
    g.fillStyle = '#e4b53a'; g.fillRect(cx - 9, 42, 18, 2);
    g.fillStyle = col; g.fillRect(cx - 8, 64, 6, 8); g.fillRect(cx + 2, 64, 6, 8);
  }
  drawSuit(g, card.s, cx - 13, 37, 0.6);
}
function grime(g: CanvasRenderingContext2D, W: number, H: number, seed: number, amount: number): void {
  const r = makeRng(seed);
  for (let i = 0; i < W * H * amount; i++) {
    const v = r() < .55 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${r() * .11})`;
    g.fillRect(Math.floor(r() * W), Math.floor(r() * H), 1, 1);
  }
  for (let i = 0; i < 3; i++) {
    g.fillStyle = `rgba(70,45,15,${.05 + r() * .09})`;
    g.beginPath(); g.ellipse(r() * W, r() * H, 3 + r() * 13, 2 + r() * 8, r() * 3, 0, 7); g.fill();
  }
}
const faces = new Map<string, HTMLCanvasElement>();
export type CardTag = 'perico' | 'perica' | null;
export function cardFace(card: Card, tag: CardTag = null): HTMLCanvasElement {
  const key = `${card.id}|${tag}`;
  const hit = faces.get(key);
  if (hit) return hit;
  const W = 64, H = 96;
  const [c, g] = canvasOf(W, H);
  g.fillStyle = '#e7dfc6'; g.fillRect(0, 0, W, H);
  g.strokeStyle = SUIT_COLOR[card.s]; g.lineWidth = 2; g.strokeRect(2, 2, W - 4, H - 4);
  g.fillStyle = '#17120e'; g.font = 'bold 13px Georgia, serif'; g.textBaseline = 'top';
  const label = String(card.r);
  g.fillText(label, 5, 4);
  g.save(); g.translate(W, H); g.rotate(Math.PI); g.fillText(label, 5, 4); g.restore();
  if (card.r <= 7) {
    const k = card.r === 1 ? 2.3 : card.r <= 3 ? 1.1 : 0.9;
    for (const [px, py] of PIPS[card.r]) drawSuit(g, card.s, W / 2 + px * 13, H / 2 + py * 17, k);
  } else {
    drawFigure(g, card, W, H);
  }
  if (tag) {
    g.fillStyle = tag === 'perico' ? '#d12b1d' : '#8a2bbd';
    g.fillRect(2, H - 15, W - 4, 11);
    g.fillStyle = '#fff4c8'; g.font = 'bold 9px Verdana, sans-serif'; g.textAlign = 'center';
    g.fillText(tag.toUpperCase(), W / 2, H - 14);
    g.textAlign = 'start';
  }
  grime(g, W, H, card.id.charCodeAt(0) * 31 + card.r * 7, .09);
  faces.set(key, c);
  return c;
}
export function cardBack(): HTMLCanvasElement {
  const [c, g] = canvasOf(64, 96);
  g.fillStyle = '#7e1b16'; g.fillRect(0, 0, 64, 96);
  g.strokeStyle = '#e0c88a'; g.lineWidth = 2; g.strokeRect(3, 3, 58, 90);
  g.fillStyle = '#5a100d';
  for (let y = 6; y < 92; y += 6) for (let x = 6 + ((y / 6) % 2) * 3; x < 60; x += 6) g.fillRect(x, y, 3, 3);
  g.fillStyle = '#e0c88a'; g.beginPath(); g.arc(32, 48, 10, 0, 7); g.fill();
  g.fillStyle = '#7e1b16'; g.beginPath(); g.arc(32, 48, 7, 0, 7); g.fill();
  grime(g, 64, 96, 7, .12);
  return c;
}
/** Retrato usado en la interfaz y en la cara del personaje. */
export function faceCanvas(b: BotProfile['look'], size = 48): HTMLCanvasElement {
  const [c, g] = canvasOf(32, 32);
  g.fillStyle = '#2b2219'; g.fillRect(0, 0, 32, 32);
  g.fillStyle = b.shirt; g.fillRect(4, 25, 24, 7);
  g.fillStyle = b.skin; g.fillRect(9, 8, 14, 17); g.fillRect(13, 24, 6, 4);
  g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(9, 20, 14, 5);
  g.fillStyle = b.hair; g.fillRect(9, 6, 14, 5); g.fillRect(8, 8, 2, 8); g.fillRect(22, 8, 2, 8);
  g.fillStyle = '#efe6d3'; g.fillRect(11, 14, 4, 3); g.fillRect(17, 14, 4, 3);
  g.fillStyle = '#16100c'; g.fillRect(13, 14, 2, 3); g.fillRect(19, 14, 2, 3); g.fillRect(11, 12, 4, 1); g.fillRect(17, 12, 4, 1);
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(15, 15, 2, 4);
  if (b.mustache) { g.fillStyle = b.hair === '#ececec' || b.hair === '#bdbdbd' ? '#cfcfcf' : '#17110c'; g.fillRect(12, 20, 8, 2); g.fillRect(11, 21, 2, 2); g.fillRect(19, 21, 2, 2); } else { g.fillStyle = '#5a2c22'; g.fillRect(13, 21, 6, 1); }
  if (b.glasses) { g.strokeStyle = '#111'; g.lineWidth = 1; g.strokeRect(10.5, 13.5, 5, 4); g.strokeRect(16.5, 13.5, 5, 4); }
  if (b.hat) { g.fillStyle = b.hat; g.fillRect(5, 6, 22, 2); g.fillRect(9, 2, 14, 5); }
  const [out, o] = canvasOf(size, size);
  o.drawImage(c, 0, 0, size, size);
  return out;
}
/** Paño verde gastado, con quemaduras de cigarro y aros de vaso. */
export function feltTexture(): HTMLCanvasElement {
  const [c, g] = canvasOf(256, 256);
  g.fillStyle = '#1e4a30'; g.fillRect(0, 0, 256, 256);
  const r = makeRng(5);
  for (let i = 0; i < 9000; i++) {
    const v = r();
    g.fillStyle = v < .5 ? `rgba(0,0,0,${r() * .13})` : `rgba(130,170,110,${r() * .07})`;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1);
  }
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(55,35,15,${.07 + r() * .12})`;
    g.beginPath(); g.ellipse(r() * 256, r() * 256, 5 + r() * 28, 4 + r() * 18, r() * 3, 0, 7); g.fill();
  }
  for (let i = 0; i < 6; i++) {
    const x = r() * 256, y = r() * 256;
    g.fillStyle = '#0d0a07'; g.fillRect(x, y, 3 + r() * 3, 3); g.fillStyle = 'rgba(90,60,20,.5)'; g.fillRect(x - 1, y - 1, 7, 1);
  }
  for (let i = 0; i < 4; i++) {
    g.strokeStyle = `rgba(30,20,8,${.2 + r() * .2})`; g.lineWidth = 1 + r();
    g.beginPath(); g.arc(r() * 256, r() * 256, 9 + r() * 5, 0, 7); g.stroke();
  }
  g.strokeStyle = 'rgba(205,190,130,.12)'; g.lineWidth = 2; g.beginPath(); g.arc(128, 128, 96, 0, 7); g.stroke();
  return c;
}
export function woodTexture(): HTMLCanvasElement {
  const [c, g] = canvasOf(128, 64);
  g.fillStyle = '#4b2c16'; g.fillRect(0, 0, 128, 64);
  const r = makeRng(9);
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(${r() < .5 ? '20,10,4' : '120,80,40'},${r() * .22})`; g.fillRect(0, r() * 64, 128, 1); }
  for (let i = 0; i < 16; i++) { g.fillStyle = 'rgba(10,5,2,.3)'; g.fillRect(r() * 128, r() * 64, 2 + r() * 6, 1 + r() * 2); }
  return c;
}
/** Pared de pulpería: pintura vieja, humedad y afiches inventados. */
export function wallTexture(): HTMLCanvasElement {
  const [c, g] = canvasOf(256, 128);
  g.fillStyle = '#6f7f63'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#7c6f54'; g.fillRect(0, 88, 256, 40);
  g.fillStyle = 'rgba(30,25,15,.6)'; g.fillRect(0, 86, 256, 3);
  const r = makeRng(21);
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(0,0,0,${r() * .06})`; g.fillRect(r() * 256, r() * 128, 1, 1 + r() * 2); }
  for (let i = 0; i < 22; i++) {
    g.fillStyle = `rgba(32,26,16,${.05 + r() * .12})`;
    g.beginPath(); g.ellipse(r() * 256, r() * 128, 8 + r() * 26, 4 + r() * 22, 0, 0, 7); g.fill();
  }
  const poster = (x: number, y: number, bg: string, t1: string, t2: string) => {
    g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(x + 1, y + 1, 36, 48);
    g.fillStyle = bg; g.fillRect(x, y, 36, 48);
    g.fillStyle = '#f0e2b5'; g.font = 'bold 7px Verdana'; g.fillText(t1, x + 3, y + 13); g.font = '6px Verdana'; g.fillText(t2, x + 3, y + 24);
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x + 4, y + 30, 28, 13);
  };
  poster(26, 18, '#8b241d', 'GRAN', 'TORNEO');
  poster(190, 22, '#2b476c', 'BOLERO', 'SÁBADO');
  return c;
}
