# Carta de diseño — Irremplazables

Fecha: 2026-09-25 · Decidida por el dueño sobre el lienzo de propuestas
(https://claude.ai/artifact/AHYpxmhtur9e528hAjgHmv) · Plan: `docs/PLAN-UI.md` §7 y §8

Esta carta manda sobre cualquier gusto de agente. Si algo no está aquí, se
decide con el dueño y se agrega aquí antes de usarlo.

**Precedencia:** `CLAUDE.md` > este documento > `.claude/skills/diseno-ui/SKILL.md`
> `referencias/taste-v2.md` > `referencias/redesign.md`.

---

## 1. Invariantes (no se tocan)

- Paleta **«ámbar sobre medianoche»** (M20): ningún color fuera de la tabla
  de §3. Lo vigila `tests/test_m20_paleta.py`.
- **Solo modo oscuro.** No hay modo claro ni interruptor.
- Botones de cobro **«Verbo ✦ N»**: la acción y lo que cuesta, nada más (M21).
- El **orbe** de espera y el **menú lateral**.
- **Sin gasto sin ver el costo antes.** Precios solo de `tools/tarifas.json`
  o de la API; nunca inventados.
- **Todo en español**, con tuteo.
- **Sin recursos externos:** fuentes, iconos e imágenes se sirven desde el
  propio dominio. Nada de Google Fonts, CDNs ni imágenes de stock.
- No se retrocede en accesibilidad (M3): foco visible, etiquetas, contraste.

## 2. Tipografía

| Papel | Fuente | Pesos |
|---|---|---|
| Títulos (h1, h2 y el saldo) | **Bricolage Grotesque** | 700, 800 |
| Texto, botones, campos, tablas | **Geist** | 400, 500, 600 |
| Números que cambian (saldo, contadores, tiempos) | Geist con `font-variant-numeric: tabular-nums` | 500, 600 |

Las dos tienen licencia OFL y se **autoalojan** en `woff2`, con
`font-display: swap`. Si la fuente no ha cargado: `system-ui, sans-serif`.

**Escala** (en px; no se usan tamaños fuera de ella):

| Token | Tamaño / interlineado | Uso |
|---|---|---|
| `texto-xs` | 13 / 1.45 | detalle, ayudas bajo un campo, etiquetas |
| `texto-sm` | 15 / 1.5 | texto de interfaz y botones |
| `texto-md` | 17 / 1.55 | lectura: instrucciones, descripciones |
| `titulo-sm` | 20 / 1.3 | título de tarjeta |
| `titulo-md` | 24 / 1.2 | título de sección · Bricolage 700 |
| `titulo-lg` | 32 / 1.1 | título de pantalla · Bricolage 800, `letter-spacing: -0.02em` |

Líneas de lectura de 45 a 75 caracteres (`max-width: 65ch`). Hoy la app usa
23 tamaños distintos; al migrar cada pantalla se lleva a estos 6.

## 3. Color

### Papel de cada color

| Color | Papel | Dónde **sí** | Dónde **no** |
|---|---|---|---|
| `#0b1626` | fondo | la página | — |
| `#08111e` | fondo hundido | pozos, reproductor, código | — |
| `#111f33` | superficie | tarjetas, menú lateral | — |
| `#18293f` | elevada | campos, hover de secundario, popovers | fondo de enlaces azules `#5b8dd6` (4.36:1) |
| `#22354f` | línea | bordes de tarjeta, separadores | bordes de campos (no llega a 3:1) |
| `#55708f` | línea de campo | bordes de campos y de botón secundario (3.2–3.5:1) | texto |
| `#ece8e1` | texto | todo texto principal | — |
| `#93a3b8` | secundario | texto de apoyo (6.45:1 sobre superficie) | — |
| `#6b7a8f` | secundario apagado | solo decoración o texto deshabilitado | texto normal (3.79:1 sobre superficie) |
| `#da8c28` | **acento ámbar** | el botón principal, el foco, el ✦ | texto largo, fondos grandes |
| `#f0a94a` | ámbar claro | hover del principal, anillo de foco, títulos-marca | — |
| `#a96716` | ámbar hondo | bordes y detalles | fondo con texto (4.19:1 con la tinta) |
| `#14100a` | tinta | el **único** texto sobre ámbar (7.0:1) | — |
| `#a9c6ee` | azul claro | **solo enlaces** (8.4:1 o más sobre cualquier fondo) | botones |
| `#5b8dd6` | azul | gráficas, relleno azul de datos | texto sobre `#18293f` |
| `#3dd68c` | éxito | estados «listo» | acciones |
| `#ff8080` | error | textos y bordes de error | acciones normales |
| `#2e2110` + `#a96716` | aviso | la **caja de aviso** (`.aviso-caja`): fondo, borde e icono en ámbar claro | texto suelto en ámbar |

El resto de la paleta M20 (`#2e2110`, `#102e22`, `#2e1b1b`, `#8f4a4a`,
`#ffb4b4`, los del orbe…) conserva el papel que le da el test.

### Un solo acento

- **El ámbar es el único color que dice «haz algo».** En cada pantalla hay
  **un solo botón ámbar**: el de la acción principal, que casi siempre cobra.
- El **azul claro** es solo para **enlaces** que llevan a otra parte.
- **Verde y rojo** son solo para **estados** (salió bien, salió mal), nunca
  para acciones normales.
- Un **aviso** (algo que conviene notar, sin ser error: «recortamos tu foto»,
  «campaña en pausa») va en la **caja de aviso** de `carta.css`: fondo
  `#2e2110`, borde `#a96716` y el icono en ámbar claro. Nunca como texto
  ámbar suelto, que se confunde con la acción (dueño, 25-sep).
- Las **barras de progreso** van en ámbar, igual en crear, shorts y editar
  metraje (dueño, 25-sep). El azul de datos queda para gráficas.
- **El principal cambia con el estado.** En editar metraje, sin metraje el
  ámbar es «Subir»; con metraje pasa a «Proponer ✦ N» (o «Editar») y Subir
  queda secundario. En el panel del negocio, «Sincronizar costes» es el ámbar
  aunque la pantalla sea de consulta (dueño, 25-sep).
- Todo lo demás es gris: botón secundario con borde `#55708f`.

## 4. Espacio, forma y movimiento

- **Espaciado:** múltiplos de 4 (4, 8, 12, 16, 24, 32, 48, 64).
- **Radios:** 6 (chips, etiquetas) · 10 (campos, botones chicos) ·
  12 (botones de 48 px) · 16 (tarjetas, diálogos).
- **Sombras:** casi ninguna. La profundidad se da con la superficie
  (`#0b1626` → `#111f33` → `#18293f`) y la línea `#22354f`.
- **Movimiento:** 120 ms (hover, apretar) y 200 ms (abrir, cerrar), con
  `ease-out`. Con `prefers-reduced-motion: reduce` todo queda quieto, el
  orbe incluido.
- **Área táctil:** lo que se toca mide al menos 44 × 44 px, aunque el dibujo
  sea más chico.
- **Foco:** `outline: 2px solid #f0a94a; outline-offset: 3px` en todo lo
  que se enfoca, sin excepción.

## 5. Botones: tres niveles, cinco estados

Alto 48 px (40 px en barras densas) · radio 12 · Geist 15 px.

| Nivel | Normal | Encima | Al apretar | Sin saldo / deshabilitado | Trabajando |
|---|---|---|---|---|---|
| **Principal** (uno por pantalla) | fondo `#da8c28`, texto `#14100a`, 600 | fondo `#f0a94a` | fondo `#da8c28`, `scale(0.98)` | borde discontinuo `#55708f`, fondo `#111f33`, texto `#93a3b8`; abajo «Te faltan ✦ N · Recargar» | «Generando…» con el mismo tamaño; no acepta otro clic |
| **Secundario** | transparente, borde `#55708f`, texto `#ece8e1`, 500 | fondo `#18293f`, borde `#93a3b8` | fondo `#1b3049`, `scale(0.98)` | no aplica: no cobra | «Cargando…», texto `#93a3b8` |
| **Enlace** | texto `#a9c6ee`, 500 | texto `#ece8e1` y subrayado a 4 px | igual que encima | — | — |
| **Peligro** (borrar, apagar) | fondo `#2e1b1b`, borde `#8f4a4a`, texto `#ffb4b4`, 600 | borde `#ff8080` | fondo `#8f4a4a`, texto `#ece8e1` | — | — |

- El botón principal **cobra con «Verbo ✦ N»**; si no cobra, dice solo el verbo.
- El estado «al apretar» **no** usa `#a96716` de fondo: con la tinta da
  4.19:1 y no pasa AA. Por eso se queda en `#da8c28` y solo se encoge.
- Doble clic sobre un botón que cobra = **una** petición.

## 6. Iconos (en lugar de emojis)

- Un solo juego de iconos de trazo: **24 px, trazo 1.7, puntas redondas**,
  `currentColor`. SVG en línea o en un sprite propio; sin fuentes de iconos
  ni CDNs.
- Los iconos acompañan una palabra; solos, solo si llevan `aria-label`.
- Los iconos de los títulos van en **gris** (`#93a3b8`). Solo los de estado
  llevan color: verde para «listo», rojo para error (dueño, 25-sep).
- Los emojis quedan solo dentro del contenido del usuario, nunca como
  iconos de la interfaz. El ✦ de créditos **no** es un emoji: se queda.
- Iconos del lienzo (propuesta 4): Video, Imagen, Cortar, Shorts, Guion,
  Personaje, Agenda, Publicar, Métricas, Competencia, Créditos, Aviso.

## 7. Navegación

- **Menú lateral en todas las pantallas** de escritorio, agrupado en
  **Crear** (Video, Imagen, Clip de 8 segundos, Copiar un estilo),
  **Editar** (Mis videos, Shorts), **Publicar** (Agenda, Publicidad
  automática) y **Analizar** (Métricas, Competencia).
- El **saldo** se queda en la **píldora de arriba a la derecha** (`monedero.js`),
  con su «＋» para recargar. Se probó al pie del menú (UI·10) y el dueño
  prefirió la píldora (25-sep).
- En el inicio, el centro sigue siendo el bloque de crear imagen y video
  que ya existe (`.prompt` en `static/index.html`).
- Celular: **sin decidir** (el lienzo proponía pestañas abajo).

## 8. Estados de la pantalla

| Estado | Regla |
|---|---|
| **Vacío** | Enseña el primer paso. En el inicio de alguien nuevo: **tres caminos** (desde una idea → crear; desde un video largo → shorts; desde tu metraje → subir) y un video de ejemplo. |
| **Espera larga** (producir) | Pasos con nombre en español (Guion aprobado → Voz grabada → Animando las escenas · 2 de 6 → Uniendo el video), el tiempo que falta y «puedes cerrar esta pestaña». |
| **Espera corta** | Por ahora como hoy. Los «esqueletos» quedan para después. |
| **Error** | Tres partes: **qué pasó** (sin culpar), **qué pasó con tus créditos** («Te devolvimos ✦ 90») y **qué sigue** (un botón). Lo técnico va plegado en «Detalles técnicos». |
| **Error de campo** | Junto al campo, antes de mandar y sin gastar créditos. Dice cómo arreglarlo. |
| **Tus trabajos** (`static/trabajos.js`) | Cuadro abajo a la derecha en todas las pantallas: lo que corre (paso, avance, «Ver»), lo que terminó en las últimas **24 h** con su enlace y lo que falló con «Te devolvimos ✦ N». Va **plegado**; se abre solo cuando algo termina o falla y no lo habías visto. Lo cerrado no vuelve en ese navegador. En celular, abajo a todo lo ancho (dueño, 25-sep). |
| **Aviso rápido** (`window.avisos.mostrar`) | En el mismo cuadro, encima: guardado o copiado (se va solo), sin conexión y un fallo que no pertenece a ningún campo (se queda hasta cerrarlo). Un error de campo va junto al campo y el aviso de una tarjeta, en su tarjeta. Cada fallo lleva `clave` (`<pantalla>-carga`, `<pantalla>-error`…) y se quita cuando lo mismo sale bien; una lista que no cargó ofrece «Reintentar» en el aviso. La clave `red` es compartida con trabajos.js: una pantalla solo la quita si ella la puso. Se quedan en su sitio: validación, el error o 402 junto al botón que cobra, los estados vacíos de lista y los `confirm()`. |

## 9. Fuera de alcance por ahora

- Propuesta 8 (confirmaciones propias y «deshacer»): en pausa.
- Propuesta 9 (el costo en un solo lugar): rechazada; la pantalla de crear
  se queda como está. El problema de conteo quedó en Trello.
- Propuesta 10 (accesibilidad): para después. §4 ya fija foco, área táctil
  y movimiento reducido para lo nuevo.
