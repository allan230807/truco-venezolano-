// Escena 3D de la pulpería. No conoce las reglas: solo anima lo que le piden.
import * as THREE from 'three';
import { Card, pieces } from '../engine/cards';
import { BotProfile } from '../ai/bots';
import { CardTag, cardBack, cardFace, feltBump, feltTexture, floorTexture, headTexture, softSprite, wallTexture, woodTexture } from './art';

const CARD_W = 1.3, CARD_H = 1.95, CARD_T = 0.012;
const RESOLUTIONS: [number, number][] = [[1280, 720], [1024, 576], [854, 480]];
// Suavizado por sobremuestreo. No se usa `samples` (MSAA): en Safari 27 deja la imagen en negro.
const SSAA = 1.5;
const DECK = new THREE.Vector3(-.42, .022, 0);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const outCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const inOut = (t: number) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const outBack = (t: number) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const tmpV = new THREE.Vector3();

let maxAniso = 1;
const texCache = new WeakMap<HTMLCanvasElement, THREE.CanvasTexture>();
function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const hit = texCache.get(c);
  if (hit) return hit;
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(c, t);
  return t;
}
function wrap(t: THREE.Texture, x: number, y: number): THREE.Texture {
  const r = t.clone(); r.wrapS = r.wrapT = THREE.RepeatWrapping; r.repeat.set(x, y); r.needsUpdate = true;
  return r;
}
interface Tween { t: number; dur: number; fn: (k: number) => void; done?: () => void; delay: number }
interface CardObj { mesh: THREE.Mesh; card: Card | null; seat: number; faceUp: boolean; hover: number; marked?: boolean; shown?: number }
interface Actor { yaw: number; group: THREE.Group; head: THREE.Group; eyes: THREE.Group; pupils: THREE.Mesh[]; armR: THREE.Group; talk: number; seed: number; hit: number; think: boolean; nextBlink: number; blink: number }

const POST_FRAG = `
precision highp float;
uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uTime, uShock, uStrength, uFlash, uExposure; varying vec2 vUv;
float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
vec3 smoothSample(vec2 p){
  return (texture2D(tDiffuse, p + uTexel * vec2(-.35, -.6)).rgb + texture2D(tDiffuse, p + uTexel * vec2(.6, -.35)).rgb
        + texture2D(tDiffuse, p + uTexel * vec2(.35, .6)).rgb + texture2D(tDiffuse, p + uTexel * vec2(-.6, .35)).rgb) * .25;
}
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
void main(){
  vec2 uv = vUv;
  vec2 d = uv - .5;
  float tear = uShock * .007 * uStrength * sin(uv.y * 150. + uTime * 40.) * step(.62, rnd(vec2(floor(uTime*18.), floor(uv.y*44.))));
  uv.x += tear;
  float ca = (.00035 + uShock * .0028) * uStrength + dot(d,d) * .0011 * uStrength;
  vec3 col = smoothSample(uv);
  vec3 center = texture2D(tDiffuse, uv).rgb;
  col.r += texture2D(tDiffuse, uv + vec2(ca,0.)).r - center.r;
  col.b += texture2D(tDiffuse, uv - vec2(ca,0.)).b - center.b;
  col = max(col, vec3(0.));
  // Brillo suave alrededor de las luces.
  vec3 glow = vec3(0.);
  for(int i=-2;i<=2;i++){ glow += texture2D(tDiffuse, uv + vec2(float(i)*.0035, 0.)).rgb; glow += texture2D(tDiffuse, uv + vec2(0., float(i)*.006)).rgb; }
  glow /= 10.; col += max(glow - 1.05, 0.) * .3;
  col = aces(col * uExposure);
  col = pow(col, vec3(1./2.2));
  // Tono cálido, un poco sucio.
  float luma = dot(col, vec3(.3,.59,.11));
  col = mix(vec3(luma), col, 1. - .08 * uStrength);
  col *= mix(vec3(1.), vec3(1.025, 1.0, .945), uStrength);
  // Grano de película, líneas muy leves y viñeta.
  col += (rnd(uv * (uTime + 3.)) - .5) * .026 * uStrength;
  col *= 1. - mod(floor(gl_FragCoord.y / 2.), 2.) * .018 * uStrength;
  col *= 1. - dot(d,d) * .62 * uStrength;
  col += uFlash;
  gl_FragColor = vec4(col, 1.);
}`;

export class TableScene {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera: THREE.PerspectiveCamera;
  private rt: THREE.WebGLRenderTarget; private postScene = new THREE.Scene(); private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private post: THREE.ShaderMaterial; private clock = new THREE.Clock(); private tweens: Tween[] = [];
  private actors = new Map<number, Actor>(); private hand: CardObj[] = []; private botHands = new Map<number, CardObj[]>();
  private tableCards: CardObj[] = []; private deck: THREE.Mesh; private vira: CardObj | null = null; private viraCard: Card | null = null;
  private lamp!: THREE.SpotLight; private bulbGlow!: THREE.Sprite; private lampMesh!: THREE.Group;
  private dust: { s: THREE.Sprite; v: THREE.Vector3; life: number }[] = []; private smoke: THREE.Sprite[] = [];
  private stones: THREE.Mesh[][] = [[], []]; private shown: number[] = [0, 0]; private glows: THREE.Mesh[] = [];
  private backTex: THREE.CanvasTexture; private edge = new THREE.MeshStandardMaterial({ color: 0xe4dcc4, roughness: .9 });
  private raycaster = new THREE.Raycaster(); private pointer = new THREE.Vector2(9, 9); private shake = 0; private shock = 0; private flash = 0; private time = 0;
  private camFocus = new THREE.Vector3(0, .5, .1); private camPunch = 0; private camTarget = new THREE.Vector3(0, .5, .1);
  private softTex: THREE.CanvasTexture; private hoverId: string | null = null; private inspected: string | null = null;
  private perf = { frames: 0, total: 0, level: 0 };
  n: 2 | 4 = 2; pickable = false; dealing = false; pace = 1;
  onPick: ((id: string) => void) | null = null; onHover: (() => void) | null = null; onPartnerCard: (() => void) | null = null;
  onInspect: ((card: Card | null, x: number, y: number, touch: boolean) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(RESOLUTIONS[0][0], RESOLUTIONS[0][1], false);
    maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const hdr = this.renderer.extensions.has('EXT_color_buffer_float') || this.renderer.extensions.has('EXT_color_buffer_half_float');
    this.rt = new THREE.WebGLRenderTarget(RESOLUTIONS[0][0] * SSAA, RESOLUTIONS[0][1] * SSAA, { depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType });
    this.backTex = tex(cardBack());
    this.softTex = tex(softSprite());
    this.camera = new THREE.PerspectiveCamera(50, RESOLUTIONS[0][0] / RESOLUTIONS[0][1], .1, 80);
    this.camera.position.set(0, 9.8, 9.6);
    this.camera.lookAt(this.camFocus);
    this.post = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: this.rt.texture }, uTexel: { value: new THREE.Vector2(1 / this.rt.width, 1 / this.rt.height) }, uTime: { value: 0 }, uShock: { value: 0 }, uStrength: { value: 1 }, uFlash: { value: 0 }, uExposure: { value: 1.08 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: POST_FRAG, depthTest: false, depthWrite: false,
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
    this.buildRoom();
    const deckTop = new THREE.MeshStandardMaterial({ map: this.backTex, roughness: .6 });
    this.deck = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, .3, CARD_H), [this.edge, this.edge, deckTop, this.edge, this.edge, this.edge]);
    this.deck.position.set(DECK.x, DECK.y + .15, DECK.z);
    this.deck.rotation.y = .04; this.deck.castShadow = true; this.deck.receiveShadow = true;
    this.scene.add(this.deck);
    canvas.addEventListener('pointermove', (e) => { this.setPointer(e); this.checkInspect(e, false); });
    canvas.addEventListener('pointerdown', (e) => {
      this.setPointer(e);
      if (this.partnerHit()) { this.onPartnerCard?.(); return; }
      this.tryPick();
      this.checkInspect(e, e.pointerType === 'touch');
    });
    canvas.addEventListener('pointerleave', () => { this.pointer.set(9, 9); this.inspected = null; this.onInspect?.(null, 0, 0, false); });
  }
  private setPointer(e: PointerEvent): void {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  setStrength(v: number): void { this.post.uniforms.uStrength.value = v; }

  private buildRoom(): void {
    const s = this.scene;
    s.background = new THREE.Color(0x0c0a08);
    s.fog = new THREE.Fog(0x12100c, 20, 44);
    s.add(new THREE.AmbientLight(0xcfc0a2, .34));
    s.add(new THREE.HemisphereLight(0xe6d6b4, 0x2a1c10, .62));
    // La lámpara da la luz principal y las sombras.
    this.lamp = new THREE.SpotLight(0xffe2b4, 210, 34, .98, .72, 1.75);
    this.lamp.position.set(0, 7.9, 0); this.lamp.target.position.set(0, 0, 0);
    this.lamp.castShadow = true; this.lamp.shadow.mapSize.set(1536, 1536);
    this.lamp.shadow.camera.near = 1.5; this.lamp.shadow.camera.far = 20; this.lamp.shadow.bias = -.00035; this.lamp.shadow.normalBias = .018; this.lamp.shadow.radius = 4;
    s.add(this.lamp, this.lamp.target);
    const back = new THREE.PointLight(0xffb878, 34, 24, 1.8); back.position.set(-5, 5.5, -11); s.add(back);
    const fill = new THREE.DirectionalLight(0xfff0d8, .62); fill.position.set(0, 7, 12); s.add(fill);

    const woodCanvas = woodTexture();
    const woodMat = new THREE.MeshStandardMaterial({ map: wrap(tex(woodCanvas), 5, 1), roughness: .48, metalness: .03 });
    const felt = new THREE.MeshStandardMaterial({ map: tex(feltTexture()), bumpMap: wrap(tex(feltBump(), false), 7, 7), bumpScale: .55, roughness: .98 });
    const top = new THREE.Mesh(new THREE.CylinderGeometry(5.75, 5.75, .24, 72), [woodMat, felt, woodMat]);
    top.position.y = -.12; top.receiveShadow = true; s.add(top);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(5.82, .27, 14, 96), woodMat);
    rim.rotation.x = Math.PI / 2; rim.position.y = -.05; rim.castShadow = true; rim.receiveShadow = true; s.add(rim);
    const leg = new THREE.Mesh(new THREE.LatheGeometry([[.45, -5.1], [1.5, -5.1], [1.5, -4.9], [.5, -4.5], [.42, -1.5], [1.1, -.3], [1.1, -.2]].map(([x, y]) => new THREE.Vector2(x, y)), 28), new THREE.MeshStandardMaterial({ color: 0x281608, roughness: .6 }));
    s.add(leg);
    const floorMat = new THREE.MeshStandardMaterial({ map: wrap(tex(floorTexture()), 9, 9), roughness: .75 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.y = -5; floor.receiveShadow = true; s.add(floor);
    const wallMat = new THREE.MeshStandardMaterial({ map: tex(wallTexture()), roughness: .96 });
    for (const [x, z, ry] of [[0, -18, 0], [-22, 0, Math.PI / 2], [22, 0, -Math.PI / 2]] as [number, number, number][]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(44, 22), wallMat);
      wall.position.set(x, 6, z); wall.rotation.y = ry; s.add(wall);
    }
    // Repisa con botellas al fondo.
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(9, .22, 1), woodMat); shelf.position.set(4, 5.6, -17.5); s.add(shelf);
    const profile = (scale: number) => [[0, 0], [.34, 0], [.36, .08], [.36, 1.05], [.3, 1.3], [.13, 1.62], [.12, 2.15], [.15, 2.2], [.13, 2.3], [0, 2.3]].map(([x, y]) => new THREE.Vector2(x * scale, y * scale));
    const bottleColors = [0x3e2109, 0x153a1d, 0x6d2a0c, 0x223018, 0x4d1a0d];
    bottleColors.forEach((color, i) => {
      const bottle = new THREE.Mesh(new THREE.LatheGeometry(profile(.95), 18), new THREE.MeshStandardMaterial({ color, roughness: .16, metalness: .05 }));
      bottle.position.set(.8 + i * 1.5, 5.7, -17.4); s.add(bottle);
    });
    // Lámpara colgante.
    this.lampMesh = new THREE.Group();
    const shadeShape = [[.18, .55], [.24, .4], [.72, -.02], [1.05, -.36]].map(([x, y]) => new THREE.Vector2(x, y));
    const shade = new THREE.Mesh(new THREE.LatheGeometry(shadeShape, 30), new THREE.MeshStandardMaterial({ color: 0x35442f, roughness: .45, metalness: .35, side: THREE.DoubleSide }));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.17, 18, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.1, 2.5) }));
    bulb.position.y = -.22;
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, 7, 8), new THREE.MeshStandardMaterial({ color: 0x0a0a0a }));
    wire.position.y = 4;
    this.bulbGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.softTex, color: new THREE.Color(1, .82, .5), transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.bulbGlow.scale.setScalar(2.2); this.bulbGlow.position.y = -.25;
    this.lampMesh.add(shade, bulb, wire, this.bulbGlow);
    this.lampMesh.position.set(0, 8.3, 0); s.add(this.lampMesh);

    // Utilería de mesa: cerveza sin marca, vaso, cenicero con humo.
    const glass = new THREE.MeshStandardMaterial({ color: 0x4a260a, roughness: .13, metalness: .05, transparent: true, opacity: .93 });
    const bottle = new THREE.Mesh(new THREE.LatheGeometry(profile(.72), 24), glass);
    bottle.position.set(4.25, .001, -2.9); bottle.castShadow = true; s.add(bottle);
    const label = new THREE.Mesh(new THREE.CylinderGeometry(.262, .262, .48, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0xd9c9a0, roughness: .8 }));
    label.position.set(4.25, .46, -2.9); s.add(label);
    const cupShape = [[0, 0], [.17, 0], [.2, .02], [.26, .62], [.24, .62], [.17, .05], [0, .05]].map(([x, y]) => new THREE.Vector2(x, y));
    const cup = new THREE.Mesh(new THREE.LatheGeometry(cupShape, 22), new THREE.MeshStandardMaterial({ color: 0xddd9c6, roughness: .1, transparent: true, opacity: .34 }));
    cup.position.set(-4.3, .001, -2.7); cup.castShadow = true; s.add(cup);
    const drink = new THREE.Mesh(new THREE.CylinderGeometry(.22, .17, .36, 22), new THREE.MeshStandardMaterial({ color: 0xbf8622, roughness: .25, transparent: true, opacity: .85 }));
    drink.position.set(-4.3, .22, -2.7); s.add(drink);
    const ashShape = [[0, .03], [.3, .03], [.36, .09], [.46, .11], [.5, .06], [.46, 0], [0, 0]].map(([x, y]) => new THREE.Vector2(x, y));
    const ash = new THREE.Mesh(new THREE.LatheGeometry(ashShape, 24), new THREE.MeshStandardMaterial({ color: 0x57524a, roughness: .35, metalness: .55 }));
    ash.position.set(-2.5, .001, -4.3); ash.castShadow = true; s.add(ash);
    const cig = new THREE.Mesh(new THREE.CylinderGeometry(.028, .028, .56, 10), new THREE.MeshStandardMaterial({ color: 0xece4cf, roughness: .85 }));
    cig.rotation.z = Math.PI / 2 + .2; cig.position.set(-2.45, .17, -4.3); s.add(cig);
    const ember = new THREE.Mesh(new THREE.SphereGeometry(.035, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, .9, .2) }));
    ember.position.set(-2.72, .22, -4.3); s.add(ember);
    for (let i = 0; i < 12; i++) {
      const puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.softTex, color: 0xcfc9b6, transparent: true, opacity: .08, depthWrite: false }));
      this.smoke.push(puff); s.add(puff);
    }
    // Piedras del tanteador: tu equipo a la izquierda, el rival a la derecha.
    const stoneGeo = new THREE.IcosahedronGeometry(.105, 1);
    const mats = [new THREE.MeshStandardMaterial({ color: 0xd8cfb4, roughness: .7 }), new THREE.MeshStandardMaterial({ color: 0x8f5d3e, roughness: .7 })];
    for (const team of [0, 1]) {
      for (let i = 0; i < 24; i++) {
        const m = new THREE.Mesh(stoneGeo, mats[team]);
        const row = i < 12 ? 0 : 1, col = i % 12;
        const x = (team === 0 ? -1 : 1) * (2.5 + col * .19);
        const j = Math.sin(i * 12.9 + team * 4) * .025;
        m.position.set(x + j, .09, 3.34 + row * .25 - col * .045 * (row ? 1 : 1) + j);
        m.rotation.set(i * 1.3, i * 2.1, 0); m.castShadow = true;
        m.scale.setScalar(0); m.visible = false; s.add(m); this.stones[team].push(m);
      }
    }
  }
  // --- Personajes ---
  private seatPos(seat: number): THREE.Vector3 {
    const map = this.n === 4 ? [[0, 8], [6.85, .2], [0, -6.35], [-6.85, .2]] : [[0, 8], [0, -6.35]];
    return new THREE.Vector3(map[seat][0], 0, map[seat][1]);
  }
  /** Dirección unitaria del centro hacia el asiento. */
  private dirOf(seat: number): THREE.Vector3 { return this.seatPos(seat).normalize(); }
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
    const pos = this.seatPos(seat);
    g.position.copy(pos); g.position.y = -1;
    // El frente del personaje es +Z local: gira hasta mirar el centro de la mesa.
    g.rotation.y = Math.atan2(-pos.x, -pos.z);
    const L = b.look;
    const shirt = new THREE.MeshStandardMaterial({ color: new THREE.Color(L.shirt), roughness: .88 });
    const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(L.skin), roughness: .68 });
    const hair = new THREE.MeshStandardMaterial({ color: new THREE.Color(L.hair), roughness: .72 });
    const shadow = <T extends THREE.Mesh>(m: T): T => { m.castShadow = true; return m; };
    const limb = (a: THREE.Vector3, c: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh => {
      const len = a.distanceTo(c);
      const m = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(.01, len), 6, 14), mat));
      m.position.copy(a).add(c).multiplyScalar(.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize());
      return m;
    };
    // Silla.
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x3f2512, roughness: .62 });
    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3.9, .22), woodMat); seatBack.position.set(0, 1.9, -1.32); g.add(seatBack);
    const crest = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, 2.7, 12), woodMat); crest.rotation.z = Math.PI / 2; crest.position.set(0, 3.9, -1.32); g.add(crest);
    // Torso.
    const torso = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(.98, 1.35, 8, 26), shirt));
    torso.scale.set(1.08, 1, .66); torso.position.y = 1.72; g.add(torso);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(.33, .075, 8, 20), shirt); collar.rotation.x = Math.PI / 2 - .2; collar.position.set(0, 3.13, .03); g.add(collar);
    const neck = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.29, .34, .5, 18), skin)); neck.position.y = 3.25; g.add(neck);
    // Brazos: el izquierdo sostiene las cartas; el derecho se mueve al jugar.
    const shoulderL = new THREE.Vector3(-1.08, 2.75, .05), elbowL = new THREE.Vector3(-1.42, 1.6, .72), handL = new THREE.Vector3(-.5, 1.98, 1.72);
    g.add(limb(shoulderL, elbowL, .29, shirt), limb(elbowL, handL, .24, shirt));
    const palmL = shadow(new THREE.Mesh(new THREE.SphereGeometry(.25, 14, 10), skin)); palmL.position.copy(handL); g.add(palmL);
    const armR = new THREE.Group(); armR.position.set(1.08, 2.75, .05); g.add(armR);
    const shoulderR = new THREE.Vector3(0, 0, 0), elbowR = new THREE.Vector3(.34, -1.15, .67), handR = new THREE.Vector3(-.58, -.77, 1.67);
    armR.add(limb(shoulderR, elbowR, .29, shirt), limb(elbowR, handR, .24, shirt));
    const palmR = shadow(new THREE.Mesh(new THREE.SphereGeometry(.25, 14, 10), skin)); palmR.position.copy(handR); armR.add(palmR);
    // Cabeza.
    const head = new THREE.Group(); head.position.y = 4.02; g.add(head);
    const faceMat = new THREE.MeshStandardMaterial({ map: tex(headTexture(L)), roughness: .62 });
    const skull = shadow(new THREE.Mesh(new THREE.SphereGeometry(1, 36, 26), faceMat)); skull.scale.set(.72, .88, .76); head.add(skull);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI * .46), hair);
    cap.scale.set(.75, .92, .8); cap.rotation.x = -.34; cap.position.y = .03; head.add(cap);
    if (L.long) {
      const mane = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(.56, .5, 6, 20), hair));
      mane.scale.set(1.15, 1, .5); mane.position.set(0, -.42, -.5); head.add(mane);
    }
    for (const x of [-.71, .71]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), skin); ear.scale.set(.07, .17, .12); ear.position.set(x, -.02, 0); head.add(ear); }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 12), skin); nose.scale.set(.095, .17, .13); nose.position.set(0, -.1, .75); head.add(nose);
    const eyes = new THREE.Group(); head.add(eyes);
    const white = new THREE.MeshStandardMaterial({ color: 0xece6d8, roughness: .25 });
    const iris = new THREE.MeshStandardMaterial({ color: 0x1b120c, roughness: .12 });
    const pupils: THREE.Mesh[] = [];
    for (const x of [-.27, .27]) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), white); ball.scale.set(.115, .085, .05); ball.position.set(x, .1, .665); eyes.add(ball);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(.057, 12, 10), iris); pupil.position.set(x, .1, .695); eyes.add(pupil); pupils.push(pupil);
    }
    if (L.mustache) {
      const light = L.hair === '#ececec' || L.hair === '#bdbdbd';
      const mat = new THREE.MeshStandardMaterial({ color: light ? 0xd5d5d5 : 0x17110c, roughness: .8 });
      for (const side of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(.05, .2, 4, 10), mat);
        m.rotation.z = side * (Math.PI / 2 - .3); m.position.set(side * .14, -.3, .71); head.add(m);
      }
    }
    if (L.glasses) {
      const frame = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: .3, metalness: .4 });
      for (const x of [-.27, .27]) { const rim = new THREE.Mesh(new THREE.TorusGeometry(.15, .017, 8, 22), frame); rim.position.set(x, .1, .72); head.add(rim); }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(.25, .025, .025), frame); bridge.position.set(0, .12, .74); head.add(bridge);
    }
    if (L.hat) {
      const hm = new THREE.MeshStandardMaterial({ color: new THREE.Color(L.hat), roughness: .78 });
      const brim = shadow(new THREE.Mesh(new THREE.CylinderGeometry(1.07, 1.12, .05, 34), hm)); brim.position.y = .57;
      const crown = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.56, .72, .58, 30), hm)); crown.position.y = .86;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(.665, .71, .12, 30), new THREE.MeshStandardMaterial({ color: 0x1b1612, roughness: .7 })); band.position.y = .66;
      const lid = new THREE.Mesh(new THREE.SphereGeometry(.56, 26, 10, 0, Math.PI * 2, 0, Math.PI / 2), hm); lid.scale.y = .22; lid.position.y = 1.14;
      head.add(brim, crown, band, lid);
    }
    this.scene.add(g);
    return { yaw: pos.x > 0 ? .55 : pos.x < 0 ? -.55 : 0, group: g, head, eyes, pupils, armR, talk: 0, seed: seat * 1.7 + 1, hit: 0, think: false, nextBlink: 1 + seat * .7, blink: 0 };
  }
  talk(seat: number, seconds = .9): void { const a = this.actors.get(seat); if (a) a.talk = seconds; }
  hit(seat: number): void { const a = this.actors.get(seat); if (a) a.hit = 1; }
  setThinking(seat: number, on: boolean): void { const a = this.actors.get(seat); if (a) a.think = on; }
  focus(seat: number | null): void {
    if (seat === null) { this.camTarget.set(0, .5, .1); return; }
    const d = this.dirOf(seat);
    this.camTarget.set(d.x * .8, .6, .1 + d.z * .55);
  }
  punch(amount = 1): void { this.shake = Math.max(this.shake, .085 * amount); this.shock = Math.max(this.shock, amount); this.camPunch = Math.max(this.camPunch, amount); }
  flashScreen(v = .3): void { this.flash = Math.max(this.flash, v); }

  // --- Cartas ---
  private tagFor(card: Card): CardTag {
    if (!this.viraCard) return null;
    const p = pieces(this.viraCard);
    return card.id === p.perico.id ? 'perico' : card.id === p.perica.id ? 'perica' : null;
  }
  private faceMat(card: Card): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ map: tex(cardFace(card, this.tagFor(card))), roughness: .62 });
  }
  private makeCardMesh(card: Card | null, faceUp: boolean): THREE.Mesh {
    const front = card ? this.faceMat(card) : new THREE.MeshStandardMaterial({ map: this.backTex, roughness: .62 });
    const back = new THREE.MeshStandardMaterial({ map: this.backTex, roughness: .62 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H), [this.edge, this.edge, front, back, this.edge, this.edge]);
    if (!faceUp) m.rotation.x = Math.PI;
    m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }
  private tween(dur: number, fn: (k: number) => void, delay = 0): Promise<void> {
    return new Promise((resolve) => this.tweens.push({ t: 0, dur: dur * this.pace, fn, done: resolve, delay: delay * this.pace }));
  }
  private handSlot(i: number, count: number): { pos: THREE.Vector3; rot: THREE.Euler } {
    const spread = 1.42; const off = i - (count - 1) / 2;
    return { pos: new THREE.Vector3(off * spread, 2.22 - Math.abs(off) * .02, 5.82), rot: new THREE.Euler(.795, 0, -off * .03, 'XYZ') };
  }
  private botSlot(seat: number, i: number, count: number): { pos: THREE.Vector3; rot: THREE.Euler } {
    const d = this.dirOf(seat); const lat = new THREE.Vector3(-d.z, 0, d.x);
    const off = i - (count - 1) / 2;
    const pos = d.clone().multiplyScalar(Math.abs(d.x) > .5 ? 5.1 : 4.72).addScaledVector(lat, off * .62); pos.y = 1.18 - Math.abs(off) * .05;
    return { pos, rot: new THREE.Euler(1.12, Math.atan2(d.x, d.z), off * .2, 'YXZ') };
  }
  /** Hileras separadas por jugador, para que ninguna carta tape a otra. */
  private cardSlot(seat: number, trick: number): { pos: THREE.Vector3; rotY: number } {
    const d = this.dirOf(seat);
    const jitter = Math.sin(seat * 13 + trick * 7) * .025;
    if (Math.abs(d.x) > .5) {
      const side = Math.sign(d.x);
      const layer = side > 0 ? trick : 2 - trick;
      return { pos: new THREE.Vector3(side * (2.42 + trick * 1.14), .032 + layer * .002, 0), rotY: -side * .04 + jitter };
    }
    return { pos: new THREE.Vector3((trick - 1) * 1.42, .032 + trick * .001, Math.sign(d.z) * 2.28), rotY: jitter };
  }
  /** Reparte, y deja la vira boca arriba debajo del mazo. */
  async deal(hands: { seat: number; cards: (Card | null)[] }[], vira: Card, onCard: () => void): Promise<void> {
    this.clearAll();
    this.viraCard = vira;
    this.dealing = true;
    const from = this.deck.position.clone(); from.y += .22;
    const order: { seat: number; i: number; card: Card | null }[] = [];
    for (let i = 0; i < 3; i++) for (const h of hands) order.push({ seat: h.seat, i, card: h.cards[i] });
    const anims: Promise<void>[] = [];
    order.forEach((o, idx) => {
      const isHuman = o.seat === 0;
      const count = hands.find((h) => h.seat === o.seat)!.cards.length;
      const slot = isHuman ? this.handSlot(o.i, count) : this.botSlot(o.seat, o.i, count);
      const mesh = this.makeCardMesh(o.card, isHuman);
      mesh.position.copy(from);
      const start = mesh.quaternion.clone();
      const endQ = new THREE.Quaternion().setFromEuler(slot.rot);
      const obj: CardObj = { mesh, card: o.card, seat: o.seat, faceUp: isHuman, hover: 0, marked: !isHuman && !!o.card, shown: 0 };
      if (obj.marked) {
        // Carta que puedes mirar: reverso con un brillo que invita a tocarla.
        const m = (mesh.material as THREE.MeshStandardMaterial[])[3];
        m.emissive.setHex(0x8a6a18); m.emissiveIntensity = .4;
      }
      if (isHuman) this.hand.push(obj);
      else { if (!this.botHands.has(o.seat)) this.botHands.set(o.seat, []); this.botHands.get(o.seat)!.push(obj); }
      anims.push(this.tween(.42, (k) => {
        const e = outCubic(k);
        mesh.position.lerpVectors(from, slot.pos, e);
        mesh.position.y += Math.sin(k * Math.PI) * .5;
        mesh.quaternion.slerpQuaternions(start, endQ, e);
        mesh.rotateY((1 - e) * 3.2);
        if (!mesh.userData.ticked) { mesh.userData.ticked = 1; onCard(); }
      }, idx * .1));
    });
    await Promise.all(anims);
    // Se levanta el mazo, la carta de abajo se voltea y queda atravesada debajo.
    const v = this.makeCardMesh(vira, true);
    const end = new THREE.Vector3(DECK.x + 1.03, .014, DECK.z);
    v.position.copy(this.deck.position);
    this.vira = { mesh: v, card: vira, seat: -1, faceUp: true, hover: 0 };
    const deckY = this.deck.position.y;
    const startPos = v.position.clone();
    await this.tween(.56, (k) => {
      const e = inOut(k);
      this.deck.position.y = deckY + Math.sin(k * Math.PI) * .95;
      v.position.lerpVectors(startPos, end, e);
      v.position.y = lerp(startPos.y, end.y, e) + Math.sin(k * Math.PI) * .42;
      v.rotation.set((1 - e) * Math.PI, 0, 0);
      v.rotation.y = -Math.PI / 2 * e;
      v.rotation.order = 'YXZ';
    });
    this.deck.position.y = deckY;
    this.dustAt(end, 4);
    this.dealing = false;
  }
  async playCard(seat: number, card: Card | null, trick: number, opts: { hidden?: boolean; under?: boolean; heavy?: boolean } = {}): Promise<void> {
    let obj: CardObj | undefined;
    if (seat === 0) {
      obj = card ? this.hand.find((h) => h.card?.id === card.id) : this.hand.find((h) => h.mesh.userData.chosenHidden) ?? this.hand[0];
      if (obj) this.hand.splice(this.hand.indexOf(obj), 1);
    } else {
      const list = this.botHands.get(seat);
      // La carta marcada sale de su sitio; las demás, de la última posición.
      const known = card ? list?.find((o) => o.card?.id === card.id) : undefined;
      const anon = list ? [...list].reverse().find((o) => !o.card) ?? list[list.length - 1] : undefined;
      obj = known ?? anon;
      if (obj && list) list.splice(list.indexOf(obj), 1);
    }
    if (!obj) return;
    this.hit(seat);
    const mesh = obj.mesh;
    mesh.scale.setScalar(1);
    obj.shown = 0;
    if (obj.marked) (mesh.material as THREE.MeshStandardMaterial[])[3].emissiveIntensity = 0;
    obj.marked = false;
    const faceDown = !!opts.hidden || !card;
    if (card && seat !== 0) (mesh.material as THREE.Material[])[2] = this.faceMat(card);
    obj.card = card ?? obj.card;
    const slot = this.cardSlot(seat, trick);
    const startPos = mesh.position.clone(); const startQ = mesh.quaternion.clone();
    const endQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(faceDown ? Math.PI : 0, slot.rotY, 0, 'YXZ'));
    const end = slot.pos.clone(); if (opts.under) end.y += .02;
    await this.tween(opts.heavy ? .4 : .46, (k) => {
      const e = inOut(k);
      mesh.position.lerpVectors(startPos, end, e);
      mesh.position.y += Math.sin(k * Math.PI) * (opts.heavy ? 1.5 : .85);
      mesh.quaternion.slerpQuaternions(startQ, endQ, e);
    });
    obj.seat = seat; obj.faceUp = !faceDown;
    this.tableCards.push(obj);
    this.dustAt(end, opts.heavy ? 8 : 3);
    this.shake = Math.max(this.shake, opts.heavy ? .05 : .012);
    this.layoutBot(seat);
  }
  /** Rodea la carta ganadora con un resplandor, sin taparla ni quemarla. */
  markWinner(seat: number | null, trick: number): void {
    if (seat === null) return;
    const slot = this.cardSlot(seat, trick);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W + .28, CARD_H + .28), new THREE.MeshBasicMaterial({ map: this.softTex, color: new THREE.Color(1.6, 1.15, .35), transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.rotation.x = -Math.PI / 2; glow.rotation.z = slot.rotY;
    glow.position.set(slot.pos.x, .018, slot.pos.z);
    glow.scale.set(1.25, 1.25, 1);
    this.scene.add(glow); this.glows.push(glow);
    this.dustAt(slot.pos, 5);
  }
  async revealTable(seat: number, card: Card, trick: number): Promise<void> {
    const slot = this.cardSlot(seat, trick);
    const c = this.tableCards.find((x) => x.seat === seat && x.mesh.position.distanceTo(slot.pos) < .6 && !x.faceUp);
    if (!c) return;
    (c.mesh.material as THREE.Material[])[2] = this.faceMat(card);
    c.card = card;
    const y = c.mesh.rotation.y;
    await this.tween(.42, (k) => { c.mesh.rotation.set(Math.PI * (1 - k), y, 0, 'YXZ'); c.mesh.position.y = .03 + Math.sin(k * Math.PI) * .8; });
    c.faceUp = true;
  }
  /** Muestra las manos de los bots al final de la base. */
  async revealHands(hands: Card[][]): Promise<void> {
    const anims: Promise<void>[] = [];
    this.botHands.forEach((list, seat) => {
      const left = hands[seat].filter((c) => !this.tableCards.some((t) => t.card?.id === c.id));
      list.forEach((o, i) => {
        const card = left[i]; if (!card) return;
        (o.mesh.material as THREE.Material[])[2] = this.faceMat(card);
        (o.mesh.material as THREE.MeshStandardMaterial[])[3].emissiveIntensity = 0;
        o.card = card; o.faceUp = true; o.marked = false; o.shown = 0; o.mesh.scale.setScalar(1);
        const d = this.dirOf(seat);
        const side = Math.abs(d.x) > .5;
        const end = side
          ? new THREE.Vector3(d.x * 4.2, .05, (i - (list.length - 1) / 2) * 1.5 + 2.1 * Math.sign(i - (list.length - 1) / 2 || 1))
          : new THREE.Vector3((i - (list.length - 1) / 2) * 1.42, .05, d.z * 4.3);
        const sp = o.mesh.position.clone(); const sq = o.mesh.quaternion.clone();
        const eq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0));
        anims.push(this.tween(.5, (k) => { const e = inOut(k); o.mesh.position.lerpVectors(sp, end, e); o.mesh.position.y += Math.sin(k * Math.PI) * .7; o.mesh.quaternion.slerpQuaternions(sq, eq, e); }, i * .08));
      });
    });
    await Promise.all(anims);
  }
  private layoutBot(seat: number): void {
    const list = this.botHands.get(seat); if (!list) return;
    list.forEach((o, i) => {
      if (o.shown) return;
      const s = this.botSlot(seat, i, list.length);
      const sp = o.mesh.position.clone(); const sq = o.mesh.quaternion.clone(); const eq = new THREE.Quaternion().setFromEuler(s.rot);
      void this.tween(.22, (k) => { const e = outCubic(k); o.mesh.position.lerpVectors(sp, s.pos, e); o.mesh.quaternion.slerpQuaternions(sq, eq, e); });
    });
  }
  /** Muestra u oculta la carta del compañero: se gira hacia ti y luego vuelve a su mano. */
  showPartnerCard(on: boolean): void {
    for (const [seat, list] of this.botHands) {
      const o = list.find((x) => x.marked);
      if (!o) continue;
      const i = list.indexOf(o);
      const rest = this.botSlot(seat, i, list.length);
      o.shown = on ? 1 : 0;
      const ray = new THREE.Vector3(0, .22, .5).unproject(this.camera).sub(this.camera.position).normalize();
      const targetPos = on ? this.camera.position.clone().addScaledVector(ray, 8.2) : rest.pos;
      const faceCamera = this.camera.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
      const targetQ = on ? faceCamera : new THREE.Quaternion().setFromEuler(rest.rot);
      const targetS = on ? 1.2 : 1;
      o.mesh.castShadow = !on;
      const sp = o.mesh.position.clone(); const sq = o.mesh.quaternion.clone(); const ss = o.mesh.scale.x;
      void this.tween(.3, (k) => {
        const e = inOut(k);
        o.mesh.position.lerpVectors(sp, targetPos, e);
        o.mesh.quaternion.slerpQuaternions(sq, targetQ, e);
        o.mesh.scale.setScalar(lerp(ss, targetS, e));
      });
    }
  }
  private removeCard(o: CardObj): void {
    this.scene.remove(o.mesh);
    (o.mesh.material as THREE.Material[]).forEach((m) => { if (m !== this.edge) m.dispose(); });
    o.mesh.geometry.dispose();
  }
  clearAll(): void {
    this.hand.forEach((o) => this.removeCard(o)); this.hand = [];
    this.botHands.forEach((l) => l.forEach((o) => this.removeCard(o))); this.botHands.clear();
    this.tableCards.forEach((o) => this.removeCard(o)); this.tableCards = [];
    if (this.vira) { this.removeCard(this.vira); this.vira = null; }
    this.glows.forEach((g) => { this.scene.remove(g); g.geometry.dispose(); (g.material as THREE.Material).dispose(); }); this.glows = [];
    this.tweens = this.tweens.filter((t) => t.done);
  }
  async sweep(): Promise<void> {
    const all = [...this.tableCards, ...this.hand, ...[...this.botHands.values()].flat(), ...(this.vira ? [this.vira] : [])];
    this.glows.forEach((g) => { g.visible = false; });
    const dest = this.deck.position.clone(); dest.y += .2;
    await Promise.all(all.map((o, i) => {
      const sp = o.mesh.position.clone();
      return this.tween(.42, (k) => o.mesh.position.lerpVectors(sp, dest, inOut(k)), i * .02);
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
        const y = .09;
        void this.tween(.34, (k) => { m.scale.setScalar(outBack(k)); m.position.y = y + (1 - k) * 1.3; if (k > .9 && !m.userData.t) { m.userData.t = 1; onStone(); } }, (i - this.shown[team]) * .09).then(() => { m.position.y = y; m.userData.t = 0; });
      }
      this.shown[team] = target;
    });
  }
  private dustAt(p: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.softTex, color: 0xcfc6a8, transparent: true, opacity: .4, depthWrite: false }));
      s.scale.setScalar(.16 + Math.random() * .16);
      s.position.copy(p); s.position.y = .1;
      this.scene.add(s);
      const a = Math.random() * Math.PI * 2;
      this.dust.push({ s, v: new THREE.Vector3(Math.cos(a) * (.5 + Math.random() * .8), .8 + Math.random() * .9, Math.sin(a) * (.5 + Math.random() * .8)), life: 1 });
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
  /** ¿El puntero está sobre la carta que se puede mirar del compañero? */
  partnerHit(): boolean {
    const marked = [...this.botHands.values()].flat().filter((o) => o.marked);
    if (!marked.length) return false;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(marked.map((o) => o.mesh)).length > 0;
  }
  /** Avisa qué carta visible hay bajo el puntero, para mostrarla en grande. */
  private checkInspect(e: PointerEvent, touch: boolean): void {
    if (!this.onInspect) return;
    const list = [...this.tableCards.filter((c) => c.faceUp), ...(this.vira ? [this.vira] : []), ...[...this.botHands.values()].flat().filter((c) => c.faceUp)];
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const blockers = this.deck;
    const hits = this.raycaster.intersectObjects([...list.map((c) => c.mesh), blockers]);
    const top = hits[0]?.object;
    const found = top && top !== blockers ? list.find((c) => c.mesh === top) : undefined;
    const id = found?.card?.id ?? null;
    if (id !== this.inspected || touch) { this.inspected = id; this.onInspect(found?.card ?? null, e.clientX, e.clientY, touch); }
    else if (id) this.onInspect(found!.card, e.clientX, e.clientY, false);
  }
  update(): void {
    const raw = this.clock.getDelta();
    const dt = Math.min(.05, raw);
    this.time += dt;
    this.adaptResolution(raw);
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const t = this.tweens[i];
      if (t.delay > 0) { t.delay -= dt; continue; }
      t.t += dt;
      const k = Math.min(1, t.t / t.dur);
      t.fn(k);
      if (k >= 1) { this.tweens.splice(i, 1); t.done?.(); }
    }
    // Cartas de la mano: la señalada se levanta y se acerca.
    const hov = this.pickable ? this.hovered() : null;
    if (hov !== this.hoverId) { this.hoverId = hov; if (hov) this.onHover?.(); }
    this.hand.forEach((h, i) => {
      const want = h.card?.id === hov ? 1 : 0;
      h.hover = lerp(h.hover, want, Math.min(1, dt * 14));
      if (!this.dealing) {
        const s = this.handSlot(i, this.hand.length);
        tmpV.set(s.pos.x, s.pos.y + h.hover * .48, s.pos.z - h.hover * .3);
        h.mesh.position.lerp(tmpV, Math.min(1, dt * 12));
        h.mesh.rotation.copy(s.rot);
        h.mesh.scale.setScalar(1 + h.hover * .1);
      }
    });
    // La carta marcada del compañero brilla despacio.
    this.botHands.forEach((list) => list.forEach((o) => {
      if (o.marked) (o.mesh.material as THREE.MeshStandardMaterial[])[3].emissiveIntensity = .28 + Math.sin(this.time * 3) * .2;
    }));
    // Personajes: respiran, parpadean, miran y hablan.
    this.actors.forEach((a) => {
      a.talk = Math.max(0, a.talk - dt); a.hit = Math.max(0, a.hit - dt * 2.4);
      a.group.position.y = -1 + Math.sin(this.time * 1.2 + a.seed) * .022;
      const lookDown = a.think ? .3 + Math.sin(this.time * 1.5 + a.seed) * .04 : .02;
      a.head.rotation.x = lerp(a.head.rotation.x, lookDown + (a.talk > 0 ? Math.sin(this.time * 15) * .045 : 0), Math.min(1, dt * 5));
      a.head.rotation.y = a.yaw + (a.think ? Math.sin(this.time * .9 + a.seed) * .1 : Math.sin(this.time * .55 + a.seed) * .16 + (a.talk > 0 ? Math.sin(this.time * 9) * .05 : 0));
      a.armR.rotation.x = -a.hit * .55;
      a.nextBlink -= dt;
      if (a.nextBlink <= 0) { a.blink = 1; a.nextBlink = 2 + Math.random() * 4; }
      a.blink = Math.max(0, a.blink - dt * 8);
      a.eyes.scale.y = 1 - Math.sin(a.blink * Math.PI) * .9;
      const gaze = Math.sin(this.time * .7 + a.seed * 2) * .012;
      a.pupils.forEach((p, i) => { p.position.x = (i ? .27 : -.27) + gaze; });
    });
    // Polvo y humo.
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i];
      d.life -= dt * 1.5; d.v.y -= dt * 3;
      d.s.position.addScaledVector(d.v, dt);
      d.s.material.opacity = Math.max(0, d.life * .36);
      if (d.life <= 0) { this.scene.remove(d.s); d.s.material.dispose(); this.dust.splice(i, 1); }
    }
    this.smoke.forEach((m, i) => {
      const k = (this.time * .1 + i / this.smoke.length) % 1;
      m.position.set(-2.72 + Math.sin(k * 7 + i) * (.04 + k * .5), .25 + k * 4.5, -4.3 + Math.cos(k * 5 + i) * k * .22);
      m.scale.setScalar(.25 + k * 1.9);
      m.material.opacity = Math.sin(k * Math.PI) * .13;
    });
    // Luz vieja con un temblor leve, y lámpara que apenas se mece.
    const flicker = Math.sin(this.time * 2.3) * .015 + (Math.random() < .004 ? -.1 : 0) + Math.sin(this.time * 31) * .005;
    this.lamp.intensity = 210 * (1 + flicker);
    this.bulbGlow.material.opacity = .55 + flicker;
    this.lampMesh.rotation.z = Math.sin(this.time * .7) * .012; this.lampMesh.rotation.x = Math.cos(this.time * .55) * .009;
    this.lamp.position.x = Math.sin(this.time * .7) * .06;
    // Cámara.
    this.camFocus.lerp(this.camTarget, Math.min(1, dt * 3));
    this.camPunch = Math.max(0, this.camPunch - dt * 2.4);
    this.shake = Math.max(0, this.shake - dt * .34);
    const baseZ = 9.6 - this.camPunch * .5, baseY = 9.8 - this.camPunch * .4;
    this.camera.position.set(Math.sin(this.time * .23) * .05 + (Math.random() - .5) * this.shake, baseY + Math.sin(this.time * .37) * .03 + (Math.random() - .5) * this.shake, baseZ + (Math.random() - .5) * this.shake);
    this.camera.lookAt(this.camFocus);
    this.shock = Math.max(0, this.shock - dt * 2);
    this.flash = Math.max(0, this.flash - dt * 1.7);
    const u = this.post.uniforms;
    u.uTime.value = this.time % 100; u.uShock.value = this.shock; u.uFlash.value = this.flash;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
  }
  /** Si el equipo no da abasto, baja la resolución para mantener la fluidez. */
  private adaptResolution(raw: number): void {
    if (raw > .25) return; // Pestaña en segundo plano.
    const p = this.perf;
    p.frames++; p.total += raw;
    if (p.frames < 150) return;
    const avg = p.total / p.frames;
    p.frames = 0; p.total = 0;
    if (avg > .03 && p.level < RESOLUTIONS.length - 1) {
      p.level++;
      const [w, h] = RESOLUTIONS[p.level];
      this.renderer.setSize(w, h, false);
      this.rt.setSize(w * SSAA, h * SSAA);
      this.post.uniforms.uTexel.value.set(1 / this.rt.width, 1 / this.rt.height);
    }
  }
  resolutionLevel(): number { return this.perf.level; }
  /** Los ids en orden de pantalla, para los atajos 1, 2 y 3 del teclado. */
  handIds(): string[] { return this.hand.map((h) => h.card!.id); }
  markHidden(id: string): void { const h = this.hand.find((x) => x.card?.id === id); if (h) h.mesh.userData.chosenHidden = true; }
}
