// Los 10 rivales. La dificultad sale de cuánto piensan, cuánto deducen y cuánto engañan.
export interface BotProfile {
  id: number; name: string; title: string; town: string; stars: number;
  worlds: number;      // Manos posibles que imagina en cada decisión.
  inference: number;   // 0 a 1: cuánto deduce de los cantos ajenos.
  noise: number;       // Error de cálculo en sus decisiones.
  bluff: number;       // Frecuencia de farol.
  aggression: number;  // Disposición a subir con ventaja.
  deception: number;   // Slowplay, A Ley sin Flor, cartas pasadas y Matar Tapado.
  adapts: number;      // 0 a 1: cuánto aprende de cómo juegas tú.
  senas: number;       // Probabilidad de hacerle señas al compañero.
  look: { skin: string; shirt: string; hat: string | null; hair: string; mustache: boolean; glasses: boolean };
  voice: { truco: string[]; envido: string[]; win: string[]; lose: string[]; fold: string[] };
}

const V = (truco: string[], envido: string[], win: string[], lose: string[], fold: string[]) => ({ truco, envido, win, lose, fold });

export const BOTS: BotProfile[] = [
  { id: 1, name: 'Chuíto', title: 'El Aprendiz', town: 'Cumaná', stars: 1, worlds: 0, inference: 0, noise: 0.06, bluff: 0.01, aggression: 0.2, deception: 0, adapts: 0, senas: 0.1,
    look: { skin: '#c78d5c', shirt: '#b44a2a', hat: null, hair: '#231811', mustache: false, glasses: false },
    voice: V(['¿Truco? Creo...'], ['¿Envido, será?'], ['¡Gané! ¿En serio?'], ['Ay, mi madre.'], ['Mejor me voy.']) },
  { id: 2, name: 'Doña Carmen', title: 'La de la bodega', town: 'Carúpano', stars: 2, worlds: 12, inference: 0.05, noise: 0.05, bluff: 0.02, aggression: 0.28, deception: 0, adapts: 0, senas: 0.2,
    look: { skin: '#a56f45', shirt: '#6b4f8f', hat: null, hair: '#8b8b8b', mustache: false, glasses: true },
    voice: V(['Truco, mijito.'], ['Envido, a ver.'], ['Eso se llama experiencia.'], ['Ya me desquito.'], ['No me gusta eso.']) },
  { id: 3, name: 'Yorman', title: 'El Pana', town: 'Barcelona', stars: 3, worlds: 30, inference: 0.15, noise: 0.04, bluff: 0.05, aggression: 0.38, deception: 0.05, adapts: 0, senas: 0.3,
    look: { skin: '#8f5a36', shirt: '#2f6b6e', hat: '#c53a2c', hair: '#1a1411', mustache: false, glasses: false },
    voice: V(['¡Truco, mi pana!'], ['¡Envido, loco!'], ['¡Fino, fino!'], ['Tranquilo, viene la mía.'], ['Paso, pana.']) },
  { id: 4, name: 'Maestro Rafael', title: 'El Carpintero', town: 'Puerto La Cruz', stars: 4, worlds: 70, inference: 0.3, noise: 0.03, bluff: 0.07, aggression: 0.45, deception: 0.12, adapts: 0.1, senas: 0.45,
    look: { skin: '#b57f52', shirt: '#7c6a3e', hat: '#51442c', hair: '#6d6d6d', mustache: true, glasses: false },
    voice: V(['Truco, con respeto.'], ['Envido, compadre.'], ['Se trabajó bien.'], ['Otra base será.'], ['Esa madera está mala.']) },
  { id: 5, name: 'La Negra Iris', title: 'La Dura', town: 'Maturín', stars: 5, worlds: 130, inference: 0.45, noise: 0.022, bluff: 0.1, aggression: 0.55, deception: 0.22, adapts: 0.25, senas: 0.6,
    look: { skin: '#5e3a24', shirt: '#b0282f', hat: null, hair: '#0f0b0a', mustache: false, glasses: false },
    voice: V(['¡Truco, y aguántalo!'], ['¡Envido, chico!'], ['Toma pa\' que lleves.'], ['Esto no se queda así.'], ['Gástate esa.']) },
  { id: 6, name: 'Compadre Goyo', title: 'El Pescador', town: 'Margarita', stars: 6, worlds: 220, inference: 0.6, noise: 0.016, bluff: 0.12, aggression: 0.6, deception: 0.35, adapts: 0.4, senas: 0.7,
    look: { skin: '#9a6238', shirt: '#2a4f7a', hat: '#d8c79a', hair: '#ececec', mustache: true, glasses: false },
    voice: V(['Truco, y pica el anzuelo.'], ['Envido, mar adentro.'], ['Cayó en la red.'], ['Mañana hay más peces.'], ['Hoy no pica.']) },
  { id: 7, name: 'El Profe Aular', title: 'Matemático', town: 'Caracas', stars: 7, worlds: 360, inference: 0.75, noise: 0.011, bluff: 0.13, aggression: 0.66, deception: 0.45, adapts: 0.55, senas: 0.8,
    look: { skin: '#c49a6c', shirt: '#44524c', hat: null, hair: '#3a3a3a', mustache: false, glasses: true },
    voice: V(['Truco: la probabilidad me sonríe.'], ['Envido, según mis cálculos.'], ['Era lo esperado.'], ['Varianza, nada más.'], ['El valor esperado es negativo.']) },
  { id: 8, name: 'Tío Pancho', title: 'El Viejo Zorro', town: 'Cariaco', stars: 8, worlds: 520, inference: 0.86, noise: 0.008, bluff: 0.16, aggression: 0.72, deception: 0.62, adapts: 0.7, senas: 0.9,
    look: { skin: '#8a5a38', shirt: '#d7cfae', hat: '#2d2a24', hair: '#bdbdbd', mustache: true, glasses: false },
    voice: V(['Truco, muchacho.'], ['Envido, y mírame a los ojos.'], ['Cuarenta años en esto.'], ['Me dejé ganar, ¿sabes?'], ['Por esta vez, vete tú.']) },
  { id: 9, name: 'La Bruja', title: 'Lee las señas', town: 'Güiria', stars: 9, worlds: 760, inference: 0.94, noise: 0.005, bluff: 0.19, aggression: 0.78, deception: 0.78, adapts: 0.85, senas: 1,
    look: { skin: '#6f4a31', shirt: '#231a2e', hat: '#17121c', hair: '#3b1d4a', mustache: false, glasses: false },
    voice: V(['Truco. Ya vi tus cartas.'], ['Envido. Te tiembla el ojo.'], ['Te lo dijeron las cartas.'], ['Hoy la luna está torcida.'], ['Esa mano está salada.']) },
  { id: 10, name: 'El Coime', title: 'La Leyenda', town: 'Sucre', stars: 10, worlds: 1100, inference: 1, noise: 0.003, bluff: 0.21, aggression: 0.85, deception: 0.9, adapts: 1, senas: 1,
    look: { skin: '#a5774e', shirt: '#121212', hat: '#0c0c0c', hair: '#101010', mustache: true, glasses: true },
    voice: V(['Truco. Y conozco el libro.'], ['Envido. Regla nueve.'], ['Se cobra lo justo.'], ['Bien jugado. Una vez.'], ['Paga y baraja.']) },
];
export const botById = (id: number) => BOTS.find((b) => b.id === id)!;
