// Escena 3D de baja resolución con filtro de consola vieja. No conoce las reglas: solo anima lo que le piden.
import * as THREE from 'three';
import { Card } from '../engine/cards';
import { BotProfile } from '../ai/bots';
import { CardTag, cardBack, cardFace, faceCanvas, feltTexture, wallTexture, woodTexture } from './art';

THREE.ColorManagement.enabled = false;
const LOW_W = 640, LOW_H = 448;
const CARD_W = 1.16, CARD_H = 1.74, CARD_T = 0.012;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const outCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const inOut = (t: number) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const outBack = (t: number) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

const tmpV = new THREE.Vector3();
function tex(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
interface Tween { t: number; dur: number; fn: (k: number) => void; done?: () => void; delay: number }
interface CardObj { mesh: THREE.Mesh; card: Card | null; seat: number; faceUp: boolean; baseY?: number; target?: THREE.Vector3; hover: number; order: number }
interface Actor { group: THREE.Group; head: THREE.Mesh; armL: THREE.Mesh; armR: THREE.Mesh; talk: number; seed: number; hit: number }

const POST_FRAG = `
precision highp float;
uniform sampler2D tDiffuse; uniform float uTime, uShock, uStrength, uFlash; uniform vec2 uRes; varying vec2 vUv;
float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec2 uv = vUv;
  vec2 d = uv - .5;
  uv += d * dot(d,d) * .05 * uStrength;                                  // curvatura ligera
  float line = floor(uv.y * ${LOW_H.toFixed(1)});
  float tear = uShock * .022 * sin(line * .35 + uTime * 40.) * step(.5, rnd(vec2(floor(uTime*18.), floor(line/10.))));
  uv.x += tear;
  vec2 snap = (floor(uv * vec2(${LOW_W.toFixed(1)}, ${LOW_H.toFixed(1)})) + .5) / vec2(${LOW_W.toFixed(1)}, ${LOW_H.toFixed(1)});
  float ca = (.0009 + uShock * .006) * uStrength + length(d) * .0014 * uStrength;
  vec3 col;
  col.r = texture2D(tDiffuse, snap + vec2(ca,0.)).r;
  col.g = texture2D(tDiffuse, snap).g;
  col.b = texture2D(tDiffuse, snap - vec2(ca,0.)).b;
  // Sangrado de color y brillo pobre, como salida de video compuesto.
  vec3 glow = vec3(0.);
  for(int i=-2;i<=2;i++){ glow += texture2D(tDiffuse, snap + vec2(float(i)*.004, 0.)).rgb; glow += texture2D(tDiffuse, snap + vec2(0., float(i)*.006)).rgb; }
  glow /= 10.; col += max(glow - .55, 0.) * .85 * uStrength;
  // Paleta reducida con tramado 4x4.
  ivec2 ip = ivec2(mod(uv * vec2(${LOW_W.toFixed(1)}, ${LOW_H.toFixed(1)}), 4.));
  float dth = rnd(vec2(float(ip.x), float(ip.y))) - .5;
  float levels = mix(256., 34., uStrength);
  col = floor(col * levels + dth * uStrength + .5) / levels;
  // Tinte sucio.
  float luma = dot(col, vec3(.3,.59,.11));
  col = mix(vec3(luma), col, .86);
  col *= vec3(1.03, 1.0, .9);
  col = mix(col, col * col * (3. - 2. * col), .35);
  // Escaneo entrelazado.
  float y = gl_FragCoord.y;
  float scan = mod(floor(y / 2.) + floor(mod(uTime*30., 2.)), 2.);
  col *= 1. - scan * .13 * uStrength;
  // Ruido de cinta y viñeta.
  col += (rnd(uv * uTime) - .5) * .055 * uStrength;
  col *= 1. - dot(d,d) * .75 * uStrength;
  col += uFlash;
  gl_FragColor = vec4(col, 1.);
}`;

export class TableScene {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera: THREE.PerspectiveCamera;
  private rt: THREE.WebGLRenderTarget; private postScene = new THREE.Scene(); private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private post: THREE.ShaderMaterial; private clock = new THREE.Clock(); private tweens: Tween[] = [];
  private actors = new Map<number, Actor>(); private hand: CardObj[] = []; private botHands = new Map<number, CardObj[]>();
  private tableCards: CardObj[] = []; private deck: THREE.Group; private vira: CardObj | null = null;
  private lamp!: THREE.PointLight; private lampMesh!: THREE.Group; private dust: { m: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
  private smoke: THREE.Mesh[] = []; private stones: THREE.Mesh[][] = [[], []]; private shown: number[] = [0, 0];
  private backTex = tex(cardBack()); private edge = new THREE.MeshLambertMaterial({ color: 0xd8cfae }); private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(9, 9); private shake = 0; private shock = 0; private flash = 0; private time = 0; private camFocus = new THREE.Vector3(0, .6, .1);
  private camPunch = 0; private camTarget = new THREE.Vector3(0, .6, .1); n: 2 | 4 = 2; pickable = false; onPick: ((id: string) => void) | null = null;
  private dustGeo = new THREE.PlaneGeometry(.1, .1); private dustMat = new THREE.MeshBasicMaterial({ color: 0xcfc6a8, transparent: true, opacity: .7, depthWrite: false });
  private smokeMat: THREE.MeshBasicMaterial; private hoverId: string | null = null; orbit = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setSize(LOW_W * 2, LOW_H * 2, false);
    this.rt = new THREE.WebGLRenderTarget(LOW_W, LOW_H, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: true });
    this.camera = new THREE.PerspectiveCamera(54, LOW_W / LOW_H, .1, 70);
    this.camera.position.set(0, 8.6, 8.9);
    this.camera.lookAt(this.camFocus);
    this.post = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: this.rt.texture }, uTime: { value: 0 }, uShock: { value: 0 }, uStrength: { value: 1 }, uFlash: { value: 0 }, uRes: { value: new THREE.Vector2(LOW_W, LOW_H) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: POST_FRAG, depthTest: false, depthWrite: false,
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
    this.smokeMat = new THREE.MeshBasicMaterial({ color: 0xb8b39a, transparent: true, opacity: .1, depthWrite: false });
    this.buildRoom();
    this.deck = new THREE.Group();
    const stack = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, .22, CARD_H), [this.edge, this.edge, new THREE.MeshLambertMaterial({ map: this.backTex }), this.edge, this.edge, this.edge]);
    stack.position.y = .11; this.deck.add(stack);
    this.deck.position.set(-.85, 0, .05); this.deck.rotation.y = .22;
    this.scene.add(this.deck);
    canvas.addEventListener('pointermove', (e) => this.setPointer(e));
    canvas.addEventListener('pointerdown', (e) => { this.setPointer(e); this.tryPick(); });
    canvas.addEventListener('pointerleave', () => this.pointer.set(9, 9));
  }
  private setPointer(e: PointerEvent): void {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  setStrength(v: number): void { this.post.uniforms.uStrength.value = v; }

  private buildRoom(): void {
    const s = this.scene;
    s.background = new THREE.Color(0x0a0907);
    s.fog = new THREE.Fog(0x171410, 17, 36);
    s.add(new THREE.AmbientLight(0x8f8672, 1.55));
    s.add(new THREE.HemisphereLight(0xb5a988, 0x2a1a0a, .95));
    this.lamp = new THREE.PointLight(0xffdfa8, 8.5, 28, .9);
    this.lamp.position.set(0, 6.2, 0); s.add(this.lamp);

    const felt = tex(feltTexture()); const wood = tex(woodTexture(), true); wood.repeat.set(5, 1);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(5.7, 5.7, .22, 12), [new THREE.MeshLambertMaterial({ map: wood, flatShading: true }), new THREE.MeshLambertMaterial({ map: felt }), new THREE.MeshLambertMaterial({ map: wood })]);
    top.position.y = -.11; s.add(top);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(5.7, .24, 5, 12), new THREE.MeshLambertMaterial({ map: wood, flatShading: true }));
    rim.rotation.x = Math.PI / 2; rim.position.y = -.02; s.add(rim);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(.5, 1.1, 5, 7), new THREE.MeshLambertMaterial({ color: 0x281608, flatShading: true }));
    leg.position.y = -2.7; s.add(leg);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: 0x2c2620 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -5; s.add(floor);
    const wallT = tex(wallTexture(), true);
    for (const [x, z, ry] of [[0, -15, 0], [-17, 0, Math.PI / 2], [17, 0, -Math.PI / 2]] as [number, number, number][]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(36, 16), new THREE.MeshLambertMaterial({ map: wallT }));
      wall.position.set(x, 2, z); wall.rotation.y = ry; s.add(wall);
    }
    // Lámpara colgante
    this.lampMesh = new THREE.Group();
    const shade = new THREE.Mesh(new THREE.ConeGeometry(1, .7, 7, 1, true), new THREE.MeshLambertMaterial({ color: 0x2f3b2a, side: THREE.DoubleSide, flatShading: true }));
    const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(.17, 0), new THREE.MeshBasicMaterial({ color: 0xfff2c4 }));
    bulb.position.y = -.2;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(3.4, 6.2, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: .035, depthWrite: false, side: THREE.DoubleSide }));
    cone.position.y = -3.3;
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, 6), new THREE.MeshBasicMaterial({ color: 0x080808 }));
    wire.position.y = 3.2;
    this.lampMesh.add(shade, bulb, cone, wire);
    this.lampMesh.position.set(0, 6.9, 0); s.add(this.lampMesh);

    // Utilería de mesa: cerveza sin marca, vaso, cenicero con humo.
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x4b2a0d, flatShading: true });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.2, .22, .8, 6), glassMat); body.position.set(3.5, .4, -3.6);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(.08, .2, .4, 6), glassMat); neck.position.set(3.5, 1, -3.6);
    const label = new THREE.Mesh(new THREE.CylinderGeometry(.205, .22, .3, 6, 1, true), new THREE.MeshLambertMaterial({ color: 0xd8c69a, flatShading: true })); label.position.set(3.5, .38, -3.6);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(.2, .15, .42, 6), new THREE.MeshLambertMaterial({ color: 0x9a8c55, transparent: true, opacity: .75 })); cup.position.set(-3.6, .21, -3.5);
    const ash = new THREE.Mesh(new THREE.CylinderGeometry(.46, .38, .14, 8), new THREE.MeshLambertMaterial({ color: 0x46413a, flatShading: true })); ash.position.set(-2.1, .07, -4.5);
    const cig = new THREE.Mesh(new THREE.BoxGeometry(.5, .05, .05), new THREE.MeshLambertMaterial({ color: 0xe8e0c8 })); cig.position.set(-2.0, .17, -4.5); cig.rotation.z = .2;
    s.add(body, neck, label, cup, ash, cig);
    const smokeGeo = new THREE.PlaneGeometry(.55, .55);
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(smokeGeo, this.smokeMat.clone());
      m.position.set(-2.1, .3 + i * .35, -4.5); this.smoke.push(m); s.add(m);
    }
    // Piedras del tanteador: junto a cada equipo.
    const stoneGeo = new THREE.IcosahedronGeometry(.1, 0);
    const mats = [new THREE.MeshLambertMaterial({ color: 0xc8bfa6, flatShading: true }), new THREE.MeshLambertMaterial({ color: 0x7b5138, flatShading: true })];
    for (const team of [0, 1]) {
      for (let i = 0; i < 24; i++) {
        const m = new THREE.Mesh(stoneGeo, mats[team]);
        const row = i < 12 ? 0 : 1; const col = i % 12;
        const cx = team === 0 ? -4.55 : 4.55;
        m.position.set(cx + (team === 0 ? 1 : -1) * row * .28, .09, 2.1 - col * .28 - row * .05);
        m.scale.setScalar(0); m.visible = false; s.add(m); this.stones[team].push(m);
      }
    }
  }
  // --- Personajes ---
  private seatPos(seat: number): { pos: THREE.Vector3; rotY: number } {
    const map = this.n === 4
      ? [[0, 8.2, 0], [6.9, -.6, -Math.PI / 2], [0, -7.2, Math.PI], [-6.9, -.6, Math.PI / 2]]
      : [[0, 8.2, 0], [0, -7.2, Math.PI]];
    const m = map[seat];
    return { pos: new THREE.Vector3(m[0], 0, m[1]), rotY: m[2] };
  }
  /** Dirección unitaria del asiento hacia el jugador. */
  private dirOf(seat: number): THREE.Vector3 { return this.seatPos(seat).pos.setY(0).normalize(); }
  setPlayers(n: 2 | 4, bots: Map<number, BotProfile>): void {
    this.n = n;
    this.actors.forEach((a) => this.scene.remove(a.group));
    this.actors.clear();
    bots.forEach((b, seat) => this.actors.set(seat, this.buildActor(b, seat)));
    this.stones.forEach((list) => list.forEach((m) => { m.visible = false; m.scale.setScalar(0); }));
    this.shown = [0, 0];
    this.clearAll();
  }
  private buildActor(b: BotProfile, seat: number): Actor {
    const g = new THREE.Group();
    const { pos, rotY } = this.seatPos(seat);
    g.position.copy(pos); g.rotation.y = rotY + Math.PI;
    const shirt = new THREE.MeshLambertMaterial({ color: new THREE.Color(b.look.shirt), flatShading: true });
    const skin = new THREE.MeshLambertMaterial({ color: new THREE.Color(b.look.skin), flatShading: true });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.35, 3.2, 6), shirt); torso.position.y = .9; g.add(torso);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(.5, .5, 2.2), shirt); armL.position.set(-1.1, .75, 1.3);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(.5, .5, 2.2), shirt); armR.position.set(1.1, .75, 1.3);
    const handL = new THREE.Mesh(new THREE.BoxGeometry(.4, .3, .4), skin); handL.position.set(0, 0, 1.2); armL.add(handL);
    const handR = new THREE.Mesh(new THREE.BoxGeometry(.4, .3, .4), skin); handR.position.set(0, 0, 1.2); armR.add(handR);
    g.add(armL, armR);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(.3, .35, .4, 6), skin); neck.position.y = 2.6; g.add(neck);
    const faceT = tex(faceHead(b));
    const headMats = [skin, skin, new THREE.MeshLambertMaterial({ color: new THREE.Color(b.look.hair), flatShading: true }), skin, new THREE.MeshLambertMaterial({ map: faceT }), new THREE.MeshLambertMaterial({ color: new THREE.Color(b.look.hair), flatShading: true })];
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.3, 1.05), headMats); head.position.y = 3.35; g.add(head);
    if (b.look.hat) {
      const hm = new THREE.MeshLambertMaterial({ color: new THREE.Color(b.look.hat), flatShading: true });
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, .08, 7), hm); brim.position.y = .68;
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(.55, .65, .55, 7), hm); crown.position.y = .95;
      head.add(brim, crown);
    }
    this.scene.add(g);
    return { group: g, head, armL, armR, talk: 0, seed: seat * 1.7 + 1, hit: 0 };
  }
  talk(seat: number, seconds = .9): void { const a = this.actors.get(seat); if (a) a.talk = seconds; }
  hit(seat: number): void { const a = this.actors.get(seat); if (a) a.hit = 1; }
  focus(seat: number | null): void {
    if (seat === null) { this.camTarget.set(0, .6, .1); return; }
    const d = this.dirOf(seat);
    this.camTarget.set(d.x * 1.5, .9, .1 + d.z * 1.1);
  }
  punch(amount = 1): void { this.shake = Math.max(this.shake, .17 * amount); this.shock = Math.max(this.shock, amount); this.camPunch = Math.max(this.camPunch, amount); }
  flashScreen(v = .3): void { this.flash = Math.max(this.flash, v); }
  // --- Cartas ---
  private makeCardMesh(card: Card | null, faceUp: boolean, tag: CardTag): THREE.Mesh {
    const front = new THREE.MeshLambertMaterial({ map: card ? tex(cardFace(card, tag)) : this.backTex });
    const back = new THREE.MeshLambertMaterial({ map: this.backTex });
    // La cara +Y es el frente. La textura ya se ve derecha al mirarla desde arriba.
    const m = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H), [this.edge, this.edge, front, back, this.edge, this.edge]);
    if (!faceUp) m.rotation.x = Math.PI;
    this.scene.add(m);
    return m;
  }
  private tween(dur: number, fn: (k: number) => void, delay = 0): Promise<void> {
    return new Promise((resolve) => this.tweens.push({ t: 0, dur, fn, done: resolve, delay }));
  }
  private handSlot(i: number, count: number): { pos: THREE.Vector3; rot: THREE.Euler } {
    const spread = 1.02; const mid = (count - 1) / 2; const off = i - mid;
    return { pos: new THREE.Vector3(off * spread, 3.45 - Math.abs(off) * .05, 6.5 + i * .012), rot: new THREE.Euler(1.02, -off * .02, -off * .05, 'XYZ') };
  }
  private botSlot(seat: number, i: number, count: number): { pos: THREE.Vector3; rot: THREE.Euler } {
    const d = this.dirOf(seat); const lat = new THREE.Vector3(-d.z, 0, d.x);
    const off = i - (count - 1) / 2;
    const pos = d.clone().multiplyScalar(4.6).addScaledVector(lat, off * .55); pos.y = 1.05 + Math.abs(off) * -.05;
    const angle = Math.atan2(d.x, d.z);
    return { pos, rot: new THREE.Euler(1.15, angle, off * .22, 'YXZ') };
  }
  private cardSlot(seat: number, trick: number): { pos: THREE.Vector3; rotY: number } {
    const d = this.dirOf(seat); const lat = new THREE.Vector3(d.z, 0, -d.x);
    const near = this.n === 2 ? 1.9 : (Math.abs(d.x) > .5 ? 2.55 : 1.95);
    const pos = d.clone().multiplyScalar(near).addScaledVector(lat, (trick - 1) * 1.3);
    pos.y = .03;
    // Todas se leen desde tu asiento; solo se ladean un poco según quién las tiró.
    const rotY = -d.x * .22 + Math.sin(seat * 13 + trick * 7) * .07;
    return { pos, rotY };
  }
  /** Reparte con animación. Termina cuando la vira está volteada. */
  async deal(hands: { seat: number; cards: (Card | null)[]; tags?: CardTag[] }[], vira: Card, fromSeat: number, onCard: () => void): Promise<void> {
    this.clearAll();
    this.dealing = true;
    const from = this.deck.position.clone(); from.y = .3;
    const order: { seat: number; i: number; card: Card | null; tag: CardTag }[] = [];
    for (let i = 0; i < 3; i++) for (const h of hands) order.push({ seat: h.seat, i, card: h.cards[i], tag: h.tags?.[i] ?? null });
    void fromSeat;
    const anims: Promise<void>[] = [];
    order.forEach((o, idx) => {
      const isHuman = o.seat === 0;
      const count = hands.find((h) => h.seat === o.seat)!.cards.length;
      const slot = isHuman ? this.handSlot(o.i, count) : this.botSlot(o.seat, o.i, count);
      const mesh = this.makeCardMesh(isHuman ? o.card : null, isHuman, o.tag);
      if (isHuman) {
        // Tu mano queda fuera del foco de la lámpara: se aclara para que se lea bien.
        const m = (mesh.material as THREE.MeshLambertMaterial[])[2];
        m.emissive.setHex(0xffffff); m.emissiveMap = m.map; m.emissiveIntensity = .42;
      }
      if (!isHuman && o.card) {
        // Carta vista del compañero: su reverso te muestra la cara.
        const t = tex(cardFace(o.card)); t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1;
        (mesh.material as THREE.Material[])[3] = new THREE.MeshLambertMaterial({ map: t, emissive: 0x2a2410 });
      }
      mesh.position.copy(from);
      const start = mesh.quaternion.clone();
      const endQ = new THREE.Quaternion().setFromEuler(slot.rot);
      const obj: CardObj = { mesh, card: o.card, seat: o.seat, faceUp: isHuman, hover: 0, order: o.i };
      if (isHuman) this.hand.push(obj);
      else { if (!this.botHands.has(o.seat)) this.botHands.set(o.seat, []); this.botHands.get(o.seat)!.push(obj); }
      anims.push(this.tween(.3, (k) => {
        const e = outCubic(k);
        mesh.position.lerpVectors(from, slot.pos, e);
        mesh.position.y += Math.sin(k * Math.PI) * .7;
        mesh.quaternion.slerpQuaternions(start, endQ, e);
        mesh.rotateY((1 - e) * 5);
        if (k > 0 && (mesh.userData.ticked ?? 0) === 0) { mesh.userData.ticked = 1; onCard(); }
      }, idx * .055));
    });
    await Promise.all(anims);
    const v = this.makeCardMesh(vira, true, null);
    v.position.copy(from);
    const endPos = new THREE.Vector3(.5, .035, .05);
    this.vira = { mesh: v, card: vira, seat: -1, faceUp: true, hover: 0, order: 0 };
    await this.tween(.28, (k) => {
      const e = outCubic(k);
      v.position.lerpVectors(from, endPos, e); v.position.y += Math.sin(k * Math.PI) * 1.3;
      v.rotation.set((1 - e) * Math.PI, -.1, 0);
    });
    this.dustAt(endPos, 5);
    this.dealing = false;
  }
  async playCard(seat: number, card: Card | null, trick: number, opts: { hidden?: boolean; under?: boolean; heavy?: boolean } = {}): Promise<void> {
    let obj: CardObj | undefined;
    if (seat === 0) {
      obj = card ? this.hand.find((h) => h.card?.id === card.id) : this.hand.find((h) => !h.mesh.userData.gone && h.mesh.userData.chosenHidden) ?? this.hand[0];
      if (obj) this.hand.splice(this.hand.indexOf(obj), 1);
    } else {
      const list = this.botHands.get(seat);
      // La carta vista del compañero sale de su sitio; las demás, de la última posición.
      const known = card ? list?.find((o) => o.card?.id === card.id) : undefined;
      const anon = list ? [...list].reverse().find((o) => !o.card) ?? list[list.length - 1] : undefined;
      obj = known ?? anon;
      if (obj && list) list.splice(list.indexOf(obj), 1);
    }
    if (!obj) return;
    this.hit(seat);
    const mesh = obj.mesh;
    if (seat === 0) (mesh.material as THREE.MeshLambertMaterial[])[2].emissiveIntensity = 0;
    const faceDown = !!opts.hidden || !card;
    if (card && seat !== 0) (mesh.material as THREE.Material[])[2] = new THREE.MeshLambertMaterial({ map: tex(cardFace(card)) });
    obj.card = card ?? obj.card;
    const slot = this.cardSlot(seat, trick);
    const startPos = mesh.position.clone(); const startQ = mesh.quaternion.clone();
    const endQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(faceDown ? Math.PI : 0, slot.rotY, 0, 'YXZ'));
    const end = slot.pos.clone(); if (opts.under) end.y += .02;
    const dur = opts.heavy ? .24 : .3;
    await this.tween(dur, (k) => {
      const e = inOut(k);
      mesh.position.lerpVectors(startPos, end, e);
      mesh.position.y += Math.sin(k * Math.PI) * (opts.heavy ? 1.8 : 1.1);
      mesh.quaternion.slerpQuaternions(startQ, endQ, e);
    });
    obj.seat = seat; obj.faceUp = !faceDown;
    this.tableCards.push(obj);
    this.dustAt(end, opts.heavy ? 12 : 4);
    this.shake = Math.max(this.shake, opts.heavy ? .13 : .035);
    this.layoutBot(seat);
  }
  /** Marca la carta ganadora de la vuelta con un resplandor. */
  markWinner(seat: number | null, trick: number): void {
    this.tableCards.forEach((c) => {
      const mats = c.mesh.material as THREE.MeshLambertMaterial[];
      const slot = this.cardSlot(c.seat, trick);
      if (c.mesh.position.distanceTo(slot.pos) < .5) {
        const color = seat === c.seat ? 0x3a3112 : 0x000000;
        mats[2].emissive?.setHex(color);
        if (seat !== c.seat) mats[2].color.setHex(0x8b8b8b);
      }
    });
    if (seat !== null) {
      const s = this.cardSlot(seat, trick);
      this.dustAt(s.pos, 8);
    }
  }
  async revealTable(seat: number, card: Card, trick: number): Promise<void> {
    const slot = this.cardSlot(seat, trick);
    const c = this.tableCards.find((x) => x.seat === seat && x.mesh.position.distanceTo(slot.pos) < .6 && !x.faceUp);
    if (!c) return;
    const mats = c.mesh.material as THREE.Material[];
    mats[2] = new THREE.MeshLambertMaterial({ map: tex(cardFace(card)) });
    const y = c.mesh.rotation.y;
    await this.tween(.25, (k) => { c.mesh.rotation.set(Math.PI * (1 - k), y, 0, 'YXZ'); c.mesh.position.y = .03 + Math.sin(k * Math.PI) * .8; });
    c.faceUp = true;
  }
  /** Muestra las manos de los bots al final de la base. */
  async revealHands(hands: Card[][]): Promise<void> {
    const anims: Promise<void>[] = [];
    this.botHands.forEach((list, seat) => {
      const known = hands[seat];
      const left = known.filter((c) => !this.tableCards.some((t) => t.card?.id === c.id));
      list.forEach((o, i) => {
        const card = left[i]; if (!card) return;
        (o.mesh.material as THREE.Material[])[2] = new THREE.MeshLambertMaterial({ map: tex(cardFace(card)) });
        const slot = this.botSlot(seat, i, list.length);
        const d = this.dirOf(seat);
        const end = d.clone().multiplyScalar(3.9).add(new THREE.Vector3(-d.z, 0, d.x).multiplyScalar((i - (list.length - 1) / 2) * 1.25)); end.y = .05;
        const sp = o.mesh.position.clone(); const sq = o.mesh.quaternion.clone();
        const eq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(d.x, d.z), 0, 'YXZ'));
        void slot;
        anims.push(this.tween(.35, (k) => { const e = inOut(k); o.mesh.position.lerpVectors(sp, end, e); o.mesh.position.y += Math.sin(k * Math.PI) * .8; o.mesh.quaternion.slerpQuaternions(sq, eq, e); }, i * .05));
      });
    });
    await Promise.all(anims);
  }
  private layoutBot(seat: number): void {
    const list = this.botHands.get(seat); if (!list) return;
    list.forEach((o, i) => {
      const s = this.botSlot(seat, i, list.length);
      const sp = o.mesh.position.clone(); const sq = o.mesh.quaternion.clone(); const eq = new THREE.Quaternion().setFromEuler(s.rot);
      void this.tween(.16, (k) => { const e = outCubic(k); o.mesh.position.lerpVectors(sp, s.pos, e); o.mesh.quaternion.slerpQuaternions(sq, eq, e); });
    });
  }
  clearAll(): void {
    const remove = (o: CardObj) => this.scene.remove(o.mesh);
    this.hand.forEach(remove); this.hand = [];
    this.botHands.forEach((l) => l.forEach(remove)); this.botHands.clear();
    this.tableCards.forEach(remove); this.tableCards = [];
    if (this.vira) { remove(this.vira); this.vira = null; }
  }
  async sweep(): Promise<void> {
    const all = [...this.tableCards, ...this.hand, ...[...this.botHands.values()].flat(), ...(this.vira ? [this.vira] : [])];
    const dest = this.deck.position.clone(); dest.y = .3;
    await Promise.all(all.map((o, i) => {
      const sp = o.mesh.position.clone();
      return this.tween(.26, (k) => o.mesh.position.lerpVectors(sp, dest, inOut(k)), i * .012);
    }));
    this.clearAll();
  }
  setStones(scores: [number, number], onStone: () => void): void {
    ([0, 1] as const).forEach((team) => {
      const target = Math.min(24, scores[team]);
      if (target < this.shown[team]) {
        this.stones[team].forEach((m) => { m.visible = false; m.scale.setScalar(0); });
        this.shown[team] = 0;
      }
      for (let i = this.shown[team]; i < target; i++) {
        const m = this.stones[team][i]; m.visible = true;
        const y = m.position.y;
        void this.tween(.26, (k) => { m.scale.setScalar(outBack(k)); m.position.y = y + (1 - k) * 1.3; if (k > .9 && !m.userData.t) { m.userData.t = 1; onStone(); } }, (i - this.shown[team]) * .07).then(() => { m.position.y = y; m.userData.t = 0; });
      }
      this.shown[team] = target;
    });
  }
  private dustAt(p: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.dustGeo, this.dustMat.clone());
      m.position.copy(p); m.position.y = .1; m.lookAt(this.camera.position);
      this.scene.add(m);
      const a = Math.random() * Math.PI * 2;
      this.dust.push({ m, v: new THREE.Vector3(Math.cos(a) * (.8 + Math.random()), 1 + Math.random() * 1.2, Math.sin(a) * (.8 + Math.random())), life: 1 });
    }
  }
  private tryPick(): void {
    if (!this.pickable || !this.onPick) return;
    const id = this.hovered();
    if (id) this.onPick(id);
  }
  private hovered(): string | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.hand.map((h) => h.mesh));
    if (!hits.length) return null;
    return this.hand.find((h) => h.mesh === hits[0].object)?.card?.id ?? null;
  }
  update(): void {
    const dt = Math.min(.05, this.clock.getDelta());
    this.time += dt;
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const t = this.tweens[i];
      if (t.delay > 0) { t.delay -= dt; continue; }
      t.t += dt;
      const k = Math.min(1, t.t / t.dur);
      t.fn(k);
      if (k >= 1) { this.tweens.splice(i, 1); t.done?.(); }
    }
    // Cartas de la mano: la señalada se levanta.
    const hov = this.pickable ? this.hovered() : null;
    if (hov !== this.hoverId) { this.hoverId = hov; if (hov) this.onHover?.(); }
    this.hand.forEach((h, i) => {
      const want = h.card?.id === hov ? 1 : 0;
      h.hover = lerp(h.hover, want, Math.min(1, dt * 16));
      if (!this.dealing) {
        const s = this.handSlot(i, this.hand.length);
        tmpV.set(s.pos.x, s.pos.y + h.hover * .55, s.pos.z - h.hover * .25);
        h.mesh.position.lerp(tmpV, Math.min(1, dt * 14));
        h.mesh.rotation.copy(s.rot);
      }
    });
    // Personajes: respiran, miran y hablan.
    this.actors.forEach((a) => {
      a.talk = Math.max(0, a.talk - dt); a.hit = Math.max(0, a.hit - dt * 3.2);
      a.group.position.y = -1 + Math.sin(this.time * 1.2 + a.seed) * .03;
      a.head.rotation.y = Math.sin(this.time * .6 + a.seed) * .17 + (a.talk > 0 ? Math.sin(this.time * 11) * .08 : 0);
      a.head.rotation.x = .12 + (a.talk > 0 ? Math.sin(this.time * 16) * .07 : 0);
      a.armR.rotation.x = -a.hit * .9; a.armR.position.y = .75 + a.hit * .6;
    });
    // Polvo y humo.
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i];
      d.life -= dt * 1.9; d.v.y -= dt * 4.3;
      d.m.position.addScaledVector(d.v, dt);
      (d.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, d.life * .55);
      if (d.life <= 0) { this.scene.remove(d.m); (d.m.material as THREE.Material).dispose(); this.dust.splice(i, 1); }
    }
    this.smoke.forEach((m, i) => {
      const k = ((this.time * .13 + i / this.smoke.length) % 1);
      m.position.set(-2.1 + Math.sin(k * 7 + i) * (.08 + k * .55), .25 + k * 4.2, -4.5 + Math.cos(k * 5 + i) * k * .25);
      m.scale.setScalar(.5 + k * 2.1); m.lookAt(this.camera.position);
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - k) * .15;
    });
    // Luz vieja que titila y lámpara que se mece.
    const flicker = Math.sin(this.time * 2.3) * .05 + (Math.random() < .012 ? -.7 : 0) + Math.sin(this.time * 31) * .018;
    this.lamp.intensity = 8.5 + flicker * 3.5;
    this.lampMesh.rotation.z = Math.sin(this.time * .7) * .015; this.lampMesh.rotation.x = Math.cos(this.time * .55) * .012;
    this.lamp.position.x = Math.sin(this.time * .7) * .1;
    // Cámara.
    this.camFocus.lerp(this.camTarget, Math.min(1, dt * 3.8));
    this.camPunch = Math.max(0, this.camPunch - dt * 3.1);
    this.shake = Math.max(0, this.shake - dt * .72);
    const baseZ = 8.9 - this.camPunch * .9, baseY = 8.6 - this.camPunch * .6;
    this.camera.position.set(Math.sin(this.time * .23) * .1 + Math.sin(this.orbit) * 2 + (Math.random() - .5) * this.shake, baseY + Math.sin(this.time * .37) * .05 + (Math.random() - .5) * this.shake, baseZ + (Math.random() - .5) * this.shake);
    this.camera.lookAt(this.camFocus);
    this.orbit += dt * 0;
    this.shock = Math.max(0, this.shock - dt * 2.3);
    this.flash = Math.max(0, this.flash - dt * 2.1);
    const u = this.post.uniforms;
    u.uTime.value = this.time % 100; u.uShock.value = this.shock; u.uFlash.value = this.flash;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }
  onHover: (() => void) | null = null;
  dealing = false;
  /** Los ids en orden de pantalla, para los atajos 1, 2 y 3 del teclado. */
  handIds(): string[] { return this.hand.map((h) => h.card!.id); }
  setKeyHover(id: string | null): void { this.hoverId = id; }
  markHidden(id: string): void { const h = this.hand.find((x) => x.card?.id === id); if (h) h.mesh.userData.chosenHidden = true; }
}
function faceHead(b: BotProfile): HTMLCanvasElement {
  const src = faceCanvas(b.look, 32);
  // Recorta solo la cara del retrato para colocarla en la cabeza.
  const c = document.createElement('canvas'); c.width = 16; c.height = 18;
  const g = c.getContext('2d')!; g.imageSmoothingEnabled = false;
  g.drawImage(src, 8, 6, 16, 18, 0, 0, 16, 18);
  return c;
}
