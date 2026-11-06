# Truco Venezolano

Juego de Truco venezolano para el navegador, con 10 rivales de dificultad creciente y estética de consola vieja.

- **Modos:** parejas (tú y un bot contra dos bots) o uno contra uno.
- **Truco Abierto o Cerrado:** en Abierto, cada jugador ve una carta de su compañero, también los bots.
- **Reglas:** basadas en *El Juego de Truco* de Francisco A. Solé. Las decisiones de interpretación están en [REGLAS.md](REGLAS.md).

## Jugar

La forma más simple es abrir `dist/index.html` en Safari. Necesita internet solo para las fuentes; sin conexión usa una fuente del sistema.

Para desarrollar:

```sh
npm install
npm run dev      # http://localhost:5173
```

## Controles

| Acción | Ratón o táctil | Teclado |
|---|---|---|
| Jugar carta | Tocar la carta | `1` `2` `3` |
| Cantar | Botones de la derecha | La letra de cada botón |
| Continuar | Botón | `Enter` |
| Pausa y opciones | `PAUSA` | `Esc` |

Los cantos aparecen a la derecha solo cuando se pueden hacer.

## Comandos

```sh
npm test                  # reglas, IA y robustez
npm run build             # genera dist/index.html, un solo archivo
npm run torneo -- 60 2    # torneo entre niveles: partidas por lado y jugadores
npx vite-node tests/diag.ts 10 5 100  # de dónde salen los puntos en un duelo
```

## Cómo está hecho

| Parte | Carpeta | Qué hace |
|---|---|---|
| Motor de reglas | `src/engine` | Máquina de estados pura, sin interfaz |
| Inteligencia | `src/ai` | Imagina manos compatibles con lo visto, deduce de los cantos y simula las vueltas |
| Escena e interfaz | `src/ui`, `src/main.ts` | Three.js a 640×448 con filtro sucio, sonido sintetizado y menús |

Los bots solo reciben una vista sin las cartas ajenas (`viewFor`), así que no hacen trampa. Todo el arte y el sonido se generan por código.
