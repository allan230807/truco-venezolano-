// Todo el arte se pinta por código: cartas, caras, paño, madera y paredes.
import { Card, Suit, makeRng } from '../engine/cards';
import { BotProfile } from '../ai/bots';

export function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}
const SUIT_COLOR: Record<Suit, string> = { oros: '#b98212', copas: '#a3201b', espadas: '#23497f', bastos: '#27662e' };
const SUIT_DARK: Record<Suit, string> = { oros: '#7a5206', copas: '#6a100c', espadas: '#142b4d', bastos: '#163f1b' };

function drawSuit(g: CanvasRenderingContext2D, s: Suit, x: number, y: number, k: number): void {
  g.save(); g.translate(x, y); g.scale(k, k); g.lineJoin = 'round'; g.lineCap = 'round';
  if (s === 'oros') {
    const grad = g.createRadialGradient(-2, -2, 1, 0, 0, 8);
    grad.addColorStop(0, '#ffe88a'); grad.addColorStop(.6, '#e0a92b'); grad.addColorStop(1, '#9c6c10');
    g.fillStyle = grad; g.beginPath(); g.arc(0, 0, 7.6, 0, 7); g.fill();
    g.strokeStyle = '#6e4a08'; g.lineWidth = .7; g.stroke();
    g.beginPath(); g.arc(0, 0, 5.4, 0, 7); g.strokeStyle = 'rgba(110,74,8,.75)'; g.lineWidth = .4; g.stroke();
    g.fillStyle = '#8a5f0e';
    for (let i = 0; i < 8; i++) { g.save(); g.rotate(i * Math.PI / 4); g.beginPath(); g.moveTo(-.8, -2.1); g.lineTo(0, -4.8); g.lineTo(.8, -2.1); g.fill(); g.restore(); }
    g.beginPath(); g.arc(0, 0, 2, 0, 7); g.fillStyle = '#ffdf74'; g.fill(); g.strokeStyle = '#6e4a08'; g.lineWidth = .35; g.stroke();
  } else if (s === 'copas') {
    g.fillStyle = '#c7912a'; g.strokeStyle = '#5e3c06'; g.lineWidth = .4;
    g.beginPath(); g.moveTo(-3.8, 7.2); g.quadraticCurveTo(0, 5, 3.8, 7.2); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(-1, 5.8); g.lineTo(-.7, 1.6); g.lineTo(.7, 1.6); g.lineTo(1, 5.8); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(0, 3.2, 1.4, .8, 0, 0, 7); g.fill(); g.stroke();
    const grad = g.createLinearGradient(-5, 0, 5, 0);
    grad.addColorStop(0, '#7b130e'); grad.addColorStop(.35, '#d43a2c'); grad.addColorStop(1, '#6d100b');
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(-5.6, -6.6); g.quadraticCurveTo(-5.6, 2, 0, 2); g.quadraticCurveTo(5.6, 2, 5.6, -6.6); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(0, -6.6, 5.6, 1.2, 0, 0, 7); g.fillStyle = '#e6bb4b'; g.fill(); g.stroke();
    g.beginPath(); g.ellipse(0, -6.6, 4.3, .75, 0, 0, 7); g.fillStyle = '#4a0d09'; g.fill();
  } else if (s === 'espadas') {
    const blade = g.createLinearGradient(-2, 0, 2, 0);
    blade.addColorStop(0, '#5d7892'); blade.addColorStop(.5, '#d3deea'); blade.addColorStop(.51, '#46617e'); blade.addColorStop(1, '#2d4562');
    g.fillStyle = blade; g.strokeStyle = '#0d2038'; g.lineWidth = .75;
    g.beginPath(); g.moveTo(0, -9); g.lineTo(1.9, -6.2); g.lineTo(1.5, 3.2); g.lineTo(-1.5, 3.2); g.lineTo(-1.9, -6.2); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#d8a737'; g.beginPath(); g.moveTo(-5, 3); g.quadraticCurveTo(0, 4.3, 5, 3); g.lineTo(5, 4.3); g.quadraticCurveTo(0, 5.6, -5, 4.3); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#3f2410'; g.fillRect(-1.05, 5, 2.1, 3); g.strokeRect(-1.05, 5, 2.1, 3);
    g.fillStyle = '#d8a737'; g.beginPath(); g.arc(0, 8.8, 1.4, 0, 7); g.fill(); g.stroke();
  } else {
    const wood = g.createLinearGradient(-4, 0, 4, 0);
    wood.addColorStop(0, '#5a3614'); wood.addColorStop(.45, '#a7743a'); wood.addColorStop(1, '#442709');
    g.fillStyle = wood; g.strokeStyle = '#2a1605'; g.lineWidth = .45;
    g.beginPath(); g.moveTo(-1.5, 8.8); g.lineTo(1.5, 8.8); g.lineTo(3, 1); g.quadraticCurveTo(5, -2.5, 3.8, -5.6);
    g.quadraticCurveTo(3.3, -8.6, .7, -9); g.quadraticCurveTo(-2.9, -9.2, -3.6, -6); g.quadraticCurveTo(-4.9, -2.5, -2.8, 1); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#3a200a';
    for (const [a, b] of [[-1.3, -5.8], [1.5, -3.2], [-1, -.7], [.7, 3]] as [number, number][]) { g.beginPath(); g.ellipse(a, b, .9, .55, .4, 0, 7); g.fill(); }
    g.fillStyle = '#3c8b42';
    g.beginPath(); g.moveTo(3.2, -3.4); g.quadraticCurveTo(6.8, -5.4, 7.4, -2); g.quadraticCurveTo(4.6, -1.2, 3.2, -3.4); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(-3.6, -.8); g.quadraticCurveTo(-7.2, -2.2, -7.2, 1.2); g.quadraticCurveTo(-4.8, 1.8, -3.6, -.8); g.fill(); g.stroke();
  }
  g.restore();
}
// Posiciones de los símbolos, en una rejilla que respeta las esquinas de la carta.
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]], 2: [[0, -1], [0, 1]], 3: [[0, -1.25], [0, 0], [0, 1.25]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1.2], [1, -1.2], [0, 0], [-1, 1.2], [1, 1.2]],
  6: [[-1, -1.25], [1, -1.25], [-1, 0], [1, 0], [-1, 1.25], [1, 1.25]],
  7: [[-1, -1.4], [1, -1.4], [-1, -.3], [1, -.3], [0, .55], [-1, 1.4], [1, 1.4]],
};
function drawFigure(g: CanvasRenderingContext2D, card: Card): void {
  const col = SUIT_COLOR[card.s], dark = SUIT_DARK[card.s];
  const cx = 32;
  const skin = '#e0ae80', line = '#2a1a10';
  g.lineWidth = .5; g.strokeStyle = line; g.lineJoin = 'round';
  const shape = (fill: string, pts: [number, number][]) => { g.fillStyle = fill; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); g.stroke(); };
  const circle = (x: number, y: number, r: number, fill: string) => { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke(); };
  const face = (x: number, y: number) => {
    circle(x, y, 4.6, skin);
    g.fillStyle = line; g.fillRect(x - 2.1, y - 1, 1.1, 1.1); g.fillRect(x + 1, y - 1, 1.1, 1.1);
    g.fillStyle = '#9c4a33'; g.fillRect(x - 1.2, y + 2, 2.4, .6);
  };
  if (card.r === 11) { // Caballo
    shape('#6b4422', [[cx - 15, 56], [cx + 11, 54], [cx + 14, 46], [cx + 13, 39], [cx + 19, 36], [cx + 21, 42], [cx + 17, 44], [cx + 16, 58], [cx + 10, 62], [cx - 11, 63], [cx - 17, 60]]);
    for (const x of [-14, -7, 5, 11]) shape('#4f3116', [[cx + x, 61], [cx + x + 3, 61], [cx + x + 3, 73], [cx + x + 4.5, 75], [cx + x - .5, 75], [cx + x, 73]]);
    shape('#2a1a10', [[cx + 12, 37], [cx + 15, 34], [cx + 16, 38], [cx + 13, 46]]);
    circle(cx + 18, 39, .6, '#000');
    shape(dark, [[cx - 7, 47], [cx + 8, 47], [cx + 8, 57], [cx - 7, 57]]);
    shape(col, [[cx - 6, 30], [cx + 5, 30], [cx + 7, 47], [cx - 8, 47]]);
    shape(col, [[cx - 5, 47], [cx + 1, 47], [cx + 1, 58], [cx - 5, 58]]);
    face(cx - .5, 25);
    shape(dark, [[cx - 5.6, 22], [cx + 4.8, 22], [cx + 3, 17], [cx - 3.5, 17]]);
    drawSuit(g, card.s, cx - 13.5, 36, .62);
  } else if (card.r === 12) { // Rey
    shape(col, [[cx - 8, 31], [cx + 8, 31], [cx + 12, 75], [cx - 12, 75]]);
    shape(dark, [[cx - 3, 31], [cx + 3, 31], [cx + 2.2, 75], [cx - 2.2, 75]]);
    shape('#e6bb4b', [[cx - 12, 70], [cx + 12, 70], [cx + 12, 75], [cx - 12, 75]]);
    shape('#f3ecd9', [[cx - 8, 30], [cx + 8, 30], [cx + 9.5, 34], [cx - 9.5, 34]]);
    face(cx, 23);
    shape('#6a4a22', [[cx - 4.4, 25], [cx + 4.4, 25], [cx + 2.6, 32], [cx - 2.6, 32]]);
    shape('#e6bb4b', [[cx - 5.4, 20], [cx + 5.4, 20], [cx + 6.6, 11.5], [cx + 3, 16], [cx, 10.5], [cx - 3, 16], [cx - 6.6, 11.5]]);
    drawSuit(g, card.s, cx - 13, 46, .78);
  } else { // Sota
    shape(dark, [[cx - 5, 56], [cx - .7, 56], [cx - 1.5, 76], [cx - 5.8, 76]]);
    shape(dark, [[cx + .7, 56], [cx + 5, 56], [cx + 5.8, 76], [cx + 1.5, 76]]);
    shape(col, [[cx - 7.5, 31], [cx + 7.5, 31], [cx + 9.5, 58], [cx - 9.5, 58]]);
    shape('#e6bb4b', [[cx - 9.3, 50], [cx + 9.3, 50], [cx + 9.5, 53], [cx - 9.5, 53]]);
    face(cx, 25);
    shape('#3a2412', [[cx - 5, 24], [cx + 5, 24], [cx + 5.8, 30], [cx + 3.6, 27], [cx - 3.6, 27], [cx - 5.8, 30]]);
    shape(dark, [[cx - 6.5, 21.6], [cx + 6.5, 21.6], [cx + 3.5, 15.5], [cx - 3.5, 15.5]]);
    shape('#f3ecd9', [[cx + 2, 16], [cx + 9, 9.5], [cx + 6, 17]]);
    drawSuit(g, card.s, cx + 13, 44, .68);
  }
}
function paperNoise(g: CanvasRenderingContext2D, W: number, H: number, seed: number): void {
  const r = makeRng(seed);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(90,62,24,${r() * .05})`;
    g.fillRect(r() * W, r() * H, 1 + r() * 7, 1);
  }
  for (let i = 0; i < 3; i++) {
    const x = r() * W, y = r() * H, rad = 24 + r() * 60;
    const blot = g.createRadialGradient(x, y, 1, x, y, rad);
    blot.addColorStop(0, `rgba(100,70,28,${.03 + r() * .06})`); blot.addColorStop(1, 'rgba(100,70,28,0)');
    g.fillStyle = blot; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}
const faces = new Map<string, HTMLCanvasElement>();
export type CardTag = 'perico' | 'perica' | null;
const CW = 256, CH = 384, UNIT = CW / 64;
export function cardFace(card: Card, tag: CardTag = null): HTMLCanvasElement {
  const key = `${card.id}|${tag}`;
  const hit = faces.get(key);
  if (hit) return hit;
  const [c, g] = canvasOf(CW, CH);
  const base = g.createLinearGradient(0, 0, CW, CH);
  base.addColorStop(0, '#f4edd9'); base.addColorStop(1, '#e6dcc0');
  g.fillStyle = base; g.fillRect(0, 0, CW, CH);
  paperNoise(g, CW, CH, card.id.charCodeAt(0) * 31 + card.r * 7);
  g.save(); g.scale(UNIT, UNIT);
  // Marco con las rayas de la baraja española: 0 oros, 1 copas, 2 espadas, 3 bastos.
  const color = SUIT_COLOR[card.s];
  g.strokeStyle = color; g.lineWidth = .9; g.strokeRect(2.2, 2.2, 59.6, 91.6);
  const breaks = { oros: 0, copas: 1, espadas: 2, bastos: 3 }[card.s];
  g.fillStyle = '#efe7d0';
  for (let i = 0; i < breaks; i++) { const x = 28 + (i - (breaks - 1) / 2) * 6; g.fillRect(x, 1.4, 2.4, 1.7); g.fillRect(x, 93, 2.4, 1.7); }
  // Índices grandes en dos esquinas, para leer la carta aunque esté tapada en parte.
  const corner = () => {
    g.fillStyle = '#16100a'; g.font = '900 19px Georgia, "Times New Roman", serif'; g.textBaseline = 'top'; g.textAlign = 'center';
    g.fillText(String(card.r), 12.5, 4.5);
    drawSuit(g, card.s, 12.5, 30, .72);
  };
  corner();
  g.save(); g.translate(64, 96); g.rotate(Math.PI); corner(); g.restore();
  if (card.r <= 7) {
    // Espadas y bastos son altos: se dibujan menores para que no se monten entre sí.
    const tall = card.s === 'espadas' || card.s === 'bastos';
    const k = card.r === 1 ? 2.5 : card.r <= 3 ? (tall ? 1.3 : 1.5) : tall ? .84 : 1.02;
    const stepX = 10.5, stepY = card.r <= 3 ? 20 : 15.5;
    for (const [px, py] of PIPS[card.r]) drawSuit(g, card.s, 35 + px * stepX, 48 + py * stepY, k);
  } else {
    g.save(); g.translate(4, 2.5); drawFigure(g, card); g.restore();
  }
  if (tag) {
    g.fillStyle = tag === 'perico' ? '#c5221a' : '#7b23ac';
    g.fillRect(14, 79, 36, 10);
    g.fillStyle = '#fff5cc'; g.font = '800 7.2px Verdana, Geneva, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(tag.toUpperCase(), 32, 84.4);
  }
  g.restore();
  faces.set(key, c);
  return c;
}
let backCache: HTMLCanvasElement | null = null;
export function cardBack(): HTMLCanvasElement {
  if (backCache) return backCache;
  const [c, g] = canvasOf(CW, CH);
  g.fillStyle = '#7c1b16'; g.fillRect(0, 0, CW, CH);
  g.save(); g.scale(UNIT, UNIT);
  g.strokeStyle = '#d9bf80'; g.lineWidth = .9; g.strokeRect(3, 3, 58, 90);
  g.lineWidth = .35; g.strokeRect(4.6, 4.6, 54.8, 86.8);
  g.strokeStyle = 'rgba(225,195,130,.45)'; g.lineWidth = .4;
  for (let i = -96; i < 64 + 96; i += 6) { g.beginPath(); g.moveTo(i, 4.8); g.lineTo(i + 86, 91.2); g.stroke(); g.beginPath(); g.moveTo(i + 86, 4.8); g.lineTo(i, 91.2); g.stroke(); }
  g.fillStyle = '#7c1b16'; g.strokeStyle = '#d9bf80'; g.lineWidth = .7;
  g.beginPath(); g.ellipse(32, 48, 13, 17, 0, 0, 7); g.fill(); g.stroke();
  drawSuit(g, 'oros', 32, 48, 1.2);
  g.restore();
  backCache = c;
  return c;
}
/** Retrato en pixeles usado en los recuadros de la interfaz. */
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
  o.imageSmoothingEnabled = false;
  o.drawImage(c, 0, 0, size, size);
  return out;
}
/** Piel de la cabeza 3D: la cara queda en el frente de la esfera. */
export function headTexture(b: BotProfile['look']): HTMLCanvasElement {
  const [c, g] = canvasOf(512, 256);
  g.fillStyle = b.skin; g.fillRect(0, 0, 512, 256);
  const cx = 128;
  const shade = g.createLinearGradient(0, 120, 0, 256);
  shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(40,18,8,.32)');
  g.fillStyle = shade; g.fillRect(0, 120, 512, 136);
  for (const x of [cx - 56, cx + 56]) {
    const cheek = g.createRadialGradient(x, 150, 2, x, 150, 34);
    cheek.addColorStop(0, 'rgba(165,60,40,.22)'); cheek.addColorStop(1, 'rgba(165,60,40,0)');
    g.fillStyle = cheek; g.fillRect(x - 34, 116, 68, 68);
  }
  // Cuencas de los ojos, cejas y boca.
  g.fillStyle = 'rgba(50,25,12,.2)';
  for (const x of [cx - 40, cx + 40]) { g.beginPath(); g.ellipse(x, 116, 25, 13, 0, 0, 7); g.fill(); }
  g.strokeStyle = b.hair === '#ececec' || b.hair === '#bdbdbd' ? '#a8a8a8' : b.hair; g.lineWidth = 6; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - 64, 100); g.quadraticCurveTo(cx - 40, 88, cx - 17, 100); g.stroke();
  g.beginPath(); g.moveTo(cx + 17, 100); g.quadraticCurveTo(cx + 40, 88, cx + 64, 100); g.stroke();
  g.strokeStyle = '#6b2c20'; g.lineWidth = 4.5;
  g.beginPath(); g.moveTo(cx - 25, 176); g.quadraticCurveTo(cx, 182, cx + 25, 176); g.stroke();
  g.strokeStyle = 'rgba(70,30,20,.35)'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(cx - 18, 188); g.quadraticCurveTo(cx, 194, cx + 18, 188); g.stroke();
  if (b.mustache) {
    const stubble = g.createLinearGradient(0, 170, 0, 230);
    stubble.addColorStop(0, 'rgba(25,18,12,.22)'); stubble.addColorStop(1, 'rgba(25,18,12,.08)');
    g.fillStyle = stubble; g.fillRect(cx - 74, 170, 148, 60);
  }
  return c;
}
/** Paño verde gastado, con quemaduras de cigarro y aros de vaso. */
export function feltTexture(): HTMLCanvasElement {
  const S = 1024;
  const [c, g] = canvasOf(S, S);
  const img = g.createImageData(S, S);
  const r = makeRng(5);
  for (let i = 0; i < S * S; i++) {
    const n = (r() - .5) * 15;
    img.data[i * 4] = 26 + n * .55; img.data[i * 4 + 1] = 78 + n; img.data[i * 4 + 2] = 48 + n * .65; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 16000; i++) { // Fibras.
    const v = r();
    g.strokeStyle = v < .5 ? `rgba(4,20,10,${r() * .14})` : `rgba(120,165,110,${r() * .07})`;
    g.lineWidth = 1;
    const x = r() * S, y = r() * S, a = r() * 6.3, len = 2 + r() * 8;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
  }
  const worn = g.createRadialGradient(S / 2, S / 2, 40, S / 2, S / 2, 400);
  worn.addColorStop(0, 'rgba(160,190,130,.13)'); worn.addColorStop(1, 'rgba(160,190,130,0)');
  g.fillStyle = worn; g.fillRect(0, 0, S, S);
  const edge = g.createRadialGradient(S / 2, S / 2, 380, S / 2, S / 2, 512);
  edge.addColorStop(0, 'rgba(10,8,2,0)'); edge.addColorStop(1, 'rgba(10,8,2,.55)');
  g.fillStyle = edge; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 18; i++) { // Manchas.
    const x = r() * S, y = r() * S, rad = 22 + r() * 90;
    const stain = g.createRadialGradient(x, y, rad * .2, x, y, rad);
    stain.addColorStop(0, `rgba(48,30,12,${.08 + r() * .16})`); stain.addColorStop(1, 'rgba(48,30,12,0)');
    g.fillStyle = stain; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 8; i++) { // Quemaduras.
    const x = 120 + r() * 780, y = 120 + r() * 780, rad = 4 + r() * 5;
    const burn = g.createRadialGradient(x, y, 1, x, y, rad * 2.8);
    burn.addColorStop(0, '#080604'); burn.addColorStop(.4, 'rgba(25,14,5,.95)'); burn.addColorStop(1, 'rgba(70,45,15,0)');
    g.fillStyle = burn; g.fillRect(x - rad * 3, y - rad * 3, rad * 6, rad * 6);
  }
  for (let i = 0; i < 6; i++) { // Aros de vaso.
    g.strokeStyle = `rgba(35,22,8,${.14 + r() * .18})`; g.lineWidth = 2 + r() * 2;
    g.beginPath(); g.arc(120 + r() * 780, 120 + r() * 780, 32 + r() * 12, 0, 7); g.stroke();
  }
  return c;
}
/** Relieve fino del paño. */
export function feltBump(): HTMLCanvasElement {
  const S = 256;
  const [c, g] = canvasOf(S, S);
  const img = g.createImageData(S, S);
  const r = makeRng(17);
  for (let i = 0; i < S * S; i++) { const v = 110 + r() * 60; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
}
export function woodTexture(): HTMLCanvasElement {
  const W = 1024, H = 256;
  const [c, g] = canvasOf(W, H);
  const img = g.createImageData(W, H);
  const r = makeRng(9);
  const waves = Array.from({ length: 6 }, () => ({ a: r() * 18, f: .003 + r() * .012, p: r() * 6.3 }));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let warp = y;
      for (const w of waves) warp += Math.sin(x * w.f + w.p) * w.a;
      const grain = Math.sin(warp * .55) * .5 + Math.sin(warp * 1.7 + 1.3) * .22 + (r() - .5) * .25;
      const i = (y * W + x) * 4;
      img.data[i] = 78 + grain * 26; img.data[i + 1] = 44 + grain * 17; img.data[i + 2] = 22 + grain * 10; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 36; i++) { // Rayones.
    g.strokeStyle = `rgba(${r() < .5 ? '15,8,3' : '175,130,85'},${r() * .22})`; g.lineWidth = 1;
    const x = r() * W, y = r() * H;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 20 + r() * 110, y + (r() - .5) * 8); g.stroke();
  }
  return c;
}
/** Pared de pulpería: pintura vieja, humedad y carteles inventados. */
export function wallTexture(): HTMLCanvasElement {
  const W = 1024, H = 512;
  const [c, g] = canvasOf(W, H);
  g.fillStyle = '#6d7d65'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#6a4b2e'; g.fillRect(0, 350, W, 162);
  const r = makeRng(21);
  for (let i = 0; i < 26000; i++) { g.fillStyle = `rgba(${r() < .7 ? '20,18,10' : '190,195,165'},${r() * .05})`; g.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3); }
  for (let i = 0; i < 34; i++) { // Humedad.
    const x = r() * W, y = r() * 340, rx = 18 + r() * 100;
    const damp = g.createRadialGradient(x, y, 2, x, y, rx);
    damp.addColorStop(0, `rgba(30,25,14,${.1 + r() * .17})`); damp.addColorStop(1, 'rgba(30,25,14,0)');
    g.fillStyle = damp; g.fillRect(x - rx, y - rx, rx * 2, rx * 2);
  }
  for (let i = 0; i < 12; i++) { // Pintura caída.
    g.fillStyle = `rgba(175,170,145,${.3 + r() * .3})`;
    g.beginPath(); const x = r() * W, y = r() * 330; g.moveTo(x, y);
    for (let k = 0; k < 6; k++) g.lineTo(x + (r() - .5) * 40, y + (r() - .5) * 26);
    g.fill();
  }
  g.fillStyle = '#2c1c0e'; g.fillRect(0, 344, W, 9);
  for (let x = 0; x < W; x += 64) { g.fillStyle = 'rgba(15,8,3,.5)'; g.fillRect(x, 353, 2, 159); }
  const poster = (x: number, y: number, w: number, h: number, bg: string, lines: [string, number][]) => {
    g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(x + 4, y + 4, w, h);
    g.fillStyle = bg; g.fillRect(x, y, w, h);
    g.fillStyle = '#f0e2b5'; g.textAlign = 'center';
    let yy = y + 30;
    for (const [t, s] of lines) { g.font = `bold ${s}px Georgia, serif`; g.fillText(t, x + w / 2, yy); yy += s + 9; }
    g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(x, y + h - 26, w, 26);
  };
  poster(90, 60, 150, 205, '#8b241d', [['GRAN', 25], ['TORNEO', 23], ['de Truco', 19], ['Sábado', 16], ['8 p. m.', 16]]);
  poster(780, 76, 140, 190, '#2b476c', [['BOLERO', 22], ['en vivo', 18], ['y joropo', 18], ['Domingo', 16]]);
  return c;
}
export function floorTexture(): HTMLCanvasElement {
  const S = 512;
  const [c, g] = canvasOf(S, S);
  const r = makeRng(31);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    g.fillStyle = (x + y) % 2 ? '#2f2720' : '#463b30';
    g.fillRect(x * 128, y * 128, 128, 128);
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x * 128, y * 128, 128, 2); g.fillRect(x * 128, y * 128, 2, 128);
  }
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(10,8,5,${r() * .1})`; g.fillRect(r() * S, r() * S, 1 + r() * 4, 1 + r() * 4); }
  return c;
}
/** Mancha suave para humo y polvo. */
export function softSprite(): HTMLCanvasElement {
  const [c, g] = canvasOf(64, 64);
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,.9)'); grad.addColorStop(.5, 'rgba(255,255,255,.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return c;
}
