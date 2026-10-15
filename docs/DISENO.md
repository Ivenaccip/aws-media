# Carta de diseño — Irremplazables

Fecha: 2026-09-25 · Decidida por el dueño sobre el lienzo de propuestas
(https://claude.ai/artifact/AHYpxmhtur9e528hAjgHmv) · Plan: `docs/PLAN-UI.md` §7 y §8

Revisada el 2026-10-15 con la decisión del dueño sobre el prototipo «Mapa con
Irremplazables»: el menú lateral se retira (el mapa lo reemplaza, §7) y el título
«Irremplazables» lleva dorado (§3).

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
- El **orbe** de espera y el **mapa** del inicio (mapa en X → tres opciones →
  pantalla, §7). El menú lateral ya no existe: lo reemplazó el mapa (dueño,
  15-oct-2026).
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
| `#111f33` | superficie | tarjetas (también la tarjeta única del inicio, §7) | — |
| `#18293f` | elevada | campos, hover de secundario, popovers | fondo de enlaces azules `#5b8dd6` (4.36:1) |
| `#22354f` | línea | bordes de tarjeta, separadores | bordes de campos (no llega a 3:1) |
| `#55708f` | línea de campo | bordes de campos y de botón secundario (3.2–3.5:1) | texto |
| `#ece8e1` | texto | todo texto principal | — |
| `#93a3b8` | secundario | texto de apoyo (6.45:1 sobre superficie) | — |
| `#6b7a8f` | secundario apagado | solo decoración o texto deshabilitado | texto normal (3.79:1 sobre superficie) |
| `#da8c28` | **acento ámbar** | el botón principal, el foco, el ✦ | texto largo, fondos grandes |
| `#f0a94a` | ámbar claro | hover del principal, anillo de foco | — |
| `#a96716` | ámbar hondo | bordes y detalles | fondo con texto (4.19:1 con la tinta) |
| `#f3dc92` | dorado claro | solo el título «Irremplazables»: arriba de su degradado (12.2:1 sobre la superficie) | texto largo, otros títulos |
| `#e6c35c` | dorado | solo el título «Irremplazables»: en medio del degradado, y su color liso si el navegador no recorta el fondo a la letra (9.7:1) | texto largo, otros títulos |
| `#b98d2f` | dorado hondo | solo el título «Irremplazables»: abajo del degradado, su parte más oscura (5.45:1 sobre la superficie) | texto largo, otros títulos |
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
- El **dorado** (`#f3dc92` → `#e6c35c` → `#b98d2f`) no es un segundo acento: es
  la firma del título «Irremplazables» y de nada más (dueño, 15-oct-2026). Va
  como degradado de arriba abajo, con los tokens `--color-oro-claro`,
  `--color-oro` y `--color-oro-hondo` de `tokens.css` y la clase `texto-oro`
  (`bg-clip-text text-transparent`). Un navegador que no recorte el fondo a la
  letra pinta el título en `#e6c35c` liso, nunca invisible.
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
  - Desde UI·18 son tokens en `web/src/estilos/tokens.css`: `--dur-rapida`
    (120 ms), `--dur-media` (250 ms, algo que entra, sale o cambia de lugar),
    `--ease-salida` y `--curva-resorte` (un resorte con `linear()` que se pasa
    ≈9 % y regresa; solo para lo que llega, nunca para lo que se va).
  - Las ocho tarjetas de movimiento (UI·18 a UI·25) usan esos tokens o una
    duración propia con su porqué al lado: 280 ms entre pantallas; 150/100 ms
    los diálogos (entran más lento de lo que salen, `--ease-entrada` para lo
    que se va); el saldo que baja rueda 700 ms, la píldora se tiñe 900 ms y
    el «−N» vuela 600 ms; lo que llega a una lista abre su espacio en 240 ms
    y lo que se reordena viaja 300 ms; el calendario sale en 180 ms y entra
    en 250 ms con 24 px de desplazamiento; un campo tiembla 240 ms cuando
    aparece su error y la palomita de «Guardado» se dibuja en 300 ms; el
    punto del buzón llega en 300 ms con el resorte y suelta una sola onda de
    900 ms.
  - Nada anima por defecto lo que ya estaba al abrir la pantalla: la primera
    carga no rueda, no se enciende y no entra animada.
  - Lo que cambia con un reloj, y no con CSS, también obedece a «reducir
    movimiento», pero la regla global de `tokens.css` NO lo alcanza (acorta las
    animaciones y transiciones de `*`, no corta un `setTimeout`, y `::placeholder`
    ni siquiera es `*`): quien corre el reloj pregunta por la preferencia
    (`nucleo/useAmbiente.ts`, que además se entera si cambia con la pantalla
    abierta) y se queda quieto. Caso de hoy (dueño, 14-oct-2026): la pista del
    campo de Edición rota entre 4 ideas cada 4 s con un fundido de `--dur-media`
    (sale con `--ease-entrada`, entra con `--ease-salida`), empieza siempre en la
    primera y sin animación, y NO rota con «reducir movimiento» (fija en la
    primera), con el foco en el campo, con texto escrito ni con la pestaña
    oculta. Sin `aria-live`: no se anuncia.
  - Entre pantallas hay View Transition (fundido; la píldora del saldo se
    queda quieta; la miniatura de una película lista se agranda hasta su
    reproductor). `web/e2e/movimiento-reducido.spec.ts` vigila que con
    «reducir movimiento» nada se quede moviéndose en las 12 pantallas.
  - Un botón que se apaga mientras puede tener el foco (el «Mes anterior»
    del calendario al volver al mes en curso) usa `aria-disabled`, no
    `disabled`: un botón deshabilitado suelta el foco al `<body>`.
  - Las gráficas de Métricas (UI·23) se dibujan la primera vez que entran en
    pantalla: 500 ms cada barra, 50 ms entre una y la siguiente, y la cifra de
    cada barra asoma al final. Una sola vez; sin JS, al volver o con «reducir
    movimiento» ya están completas. Las barras son del azul de datos.
- **Área táctil:** lo que se toca mide al menos 44 × 44 px, aunque el dibujo
  sea más chico.
- **Foco:** `outline: 2px solid #f0a94a; outline-offset: 3px` en todo lo
  que se enfoca, sin excepción. Si el campo vive dentro de un cuadro con borde y
  fondo (el área de escritura de la caja del inicio: `ui/CuadroDeTexto`), el aro
  lo dibuja el cuadro cuando algo de adentro tiene foco visible y el campo no
  dibuja otro: dos aros, uno dentro del otro, se verían como un error.

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
- **El principal puede no apagarse nunca** (dueño, 14-oct-2026): «Iniciar» de la
  pestaña Edición del inicio es ámbar en TODOS los estados —sin video, sin texto,
  con precio, sin saldo—, igual que «Crear» de Imagen y Video, que tampoco se
  pintan apagados sino que explican al pulsarlos. No es la fila «Sin saldo /
  deshabilitado» de la tabla para este botón: el gris discontinuo queda para el
  `disabled` de verdad (`<Boton apagado>` sigue ahí para quien lo necesite). Lo
  que no cambia: sigue sin `disabled` (retiene el foco), lleva `aria-disabled`
  mientras no se pueda cobrar, explica por qué al pulsarlo o al enfocarlo
  (`aria-describedby`), «Subiendo…» y «Calculando…» se leen ocupados, y el precio
  se ve en el botón («Iniciar ✦ N») antes de cobrar. Abajo sigue el «Te faltan
  ✦ N · Recargar».

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
- El mapa (§7) suma los de sus áreas, grupos y pantallas: Marketing, Ubicación,
  Ajustes, Central, Producto, Ventas, COI, Biblioteca, Pregunta, Glosario y
  Buscar. Viven en `ui/iconos.ts` y `static/iconos.js` (idénticos; los compara
  `tests/test_web_tuberia.py`).

## 7. Navegación

Desde el 15-oct-2026 no hay menú lateral, en ningún ancho: el inicio es un
recorrido de tres pasos dentro de **una sola tarjeta** («Mapa con
Irremplazables», decisión del dueño). La lista de adónde se puede ir es una
sola, `web/src/marca/menu.ts`; el recorrido y las migas de las pantallas salen
de ella, así no se desincronizan.

- **Tres pasos:** el **mapa en X** (las áreas: Marketing, Producto, Central,
  Ventas y Automatizaciones) → las **tres opciones** (los grupos del área
  elegida; los de Marketing son Distrito, Blotato y Avanzado) → **la pantalla**
  (la caja del inicio, o la lista de las pantallas del grupo).
- **Se aterriza en la caja, no en el mapa:** al abrir `/estudio/inicio/` se ve
  Marketing › Distrito › Imagen, como siempre. El mapa se abre desde las migas;
  «Estás aquí» marca el lugar actual.
- **Una tarjeta única:** 820 px de ancho como mucho, centrada en horizontal y
  pegada arriba (64 px; no se centra en vertical para que no salte de un paso a
  otro), en la superficie `#111f33` con borde `#22354f` y radio 16. Adentro, de
  arriba abajo: el `h1` «Irremplazables» (dorado, 32 px, centrado y sin icono; es
  el único `h1` de la pantalla), las migas y el paso con su `h2` («Elige un
  área», «Elige un grupo», «¿Qué vamos a crear hoy?» en la caja, el nombre del
  grupo en la lista).
- **Migas que reabren cada nivel:** la ruta elegida son chips («Marketing ›
  Distrito») y cada chip reabre su nivel: el área vuelve al mapa; el grupo, a las
  tres opciones.
- **«Volver a …» y Esc:** con el mapa o las tres opciones abiertos, «Volver a …»
  dice adónde caerás («Volver a Imagen») y deja todo como estaba. **Esc** hace lo
  mismo cuando el foco está dentro de la tarjeta (el `onKeyDown` es de la
  tarjeta, no global). Si venías de una página hoja (abajo), «Volver a …»
  regresa a ella.
- **La caja siempre montada:** con el mapa, las tres opciones o la lista a la
  vista, la caja se oculta (`hidden`), no se desmonta; así no se pierden el texto
  escrito, el video subido ni una subida en curso. La galería «Mis creaciones» y
  lo que cuelga de la caja se ven solo cuando se ve la caja.
- **Lo que enseña un grupo que no es la caja:** la lista de sus pantallas como
  tarjetas-enlace (icono, título y una línea de apoyo). Las que dependen de
  Blotato se apagan con `aria-disabled` cuando se sabe que la persona no lo ha
  conectado (si no se sabe, no se apaga nada) y su clic abre el diálogo de
  conectar en vez de navegar; el botón «Conecta tu cuenta de Blotato» (o
  «Blotato conectado: ver o cambiar») vive arriba de esa lista. Lo que aún no
  existe (todo Central) sale apagado con la etiqueta «Próximamente» y no navega;
  un grupo sin pantallas dice «Todavía no está disponible.». Producto, Ventas y
  Automatizaciones son fichas inertes en el mapa.
- **Las páginas hoja siguen siendo páginas** (Agenda, Competencia, Métricas, MIX,
  Copiadora de estilos): llevan «← Estudio» y, a su lado, sus migas, «Marketing ›
  Blotato», como **enlaces** al inicio con `?desde=<lugar>&ver=mapa|grupos`.
  «Marketing» abre el mapa y «Blotato» las tres opciones, con ese lugar marcado
  como «Estás aquí». El inicio lee los dos parámetros una sola vez, al abrir, y
  limpia la URL; si alguno no existe, se aterriza en la caja. Las pantallas que
  el mapa no tiene (Admin, Crear, Subir, Clip, Imágenes y Shorts) no llevan migas.
- **Dónde quedó cada cosa:** «De videos a Shorts» es el segundo modo del chip
  «Editar ▾» de la pestaña Edición y ya no tiene entrada propia. La Copiadora de
  estilos está en Marketing › Avanzado **de forma provisional**: irá a «Marcas»,
  que todavía no existe, y quitarla antes dejaría sin puerta una pantalla que
  funciona.
- **Celular (≤ 560 px):** la «X compacta» (dueño, 15-oct-2026): dos columnas,
  con Central como banda de ancho completo en medio y trazos punteados cortos
  hacia ella. En escritorio el mapa es una cuadrícula de 3 × 3 con las dos
  diagonales punteadas (decoración: `aria-hidden`, en `#55708f`, detrás de las
  fichas). En los dos, las fichas miden 44 px o más y el texto 13 px o más;
  «Automatizaciones» y «Estás aquí» no se parten a 390 ni a 320 px, y nada se
  desborda. El riel de la caja pasa a horizontal.
- **Teclado y foco:** el orden de Tab es el de lectura (Marketing, Producto,
  Central, Ventas, Automatizaciones). El foco nunca cae a `<body>`: al cambiar de
  paso va al `h2` del paso nuevo, y solo si se había perdido. Un doble clic en
  una ficha del mapa no elige además un grupo por accidente (se ignora el
  segundo clic si llega en menos de 500 ms).
- El **saldo** se queda en la **píldora de arriba a la derecha** (`monedero.js`),
  con su «＋» para recargar. Se probó al pie del menú lateral (UI·10, hoy
  retirado) y el dueño prefirió la píldora (25-sep). Al cambiar de pantalla
  sale desde el primer cuadro con el último saldo de la pestaña (15 min como
  mucho); si el servidor no lo confirma, se apaga un poco y se lee «sin
  confirmar».

## 8. Estados de la pantalla

| Estado | Regla |
|---|---|
| **Vacío** | Enseña el primer paso. En el inicio de alguien nuevo: **tres caminos** (desde una idea → crear; desde un video largo → shorts; desde tu metraje → subir) y un video de ejemplo. |
| **Espera larga** (producir) | Pasos con nombre en español (Guion aprobado → Voz grabada → Animando las escenas · 2 de 6 → Uniendo el video), el tiempo que falta y «puedes cerrar esta pestaña». |
| **Espera con pasos** (UI·27, `marca/EsperaPasos.tsx`) | La misma tarjeta en crear, clip, imagen, shorts (traer, analizar, renderizar) y el Editor IA de Subir. **Solo pasos de verdad**: donde el servidor no cuenta fases hay pocos pasos y lo demás es el reloj («Llevas 0:45 · suele tardar 1–2 min»); la barra va por pasos y, con un tiempo estimado, avanza dentro del paso sin pasar del 90 % ni retroceder. El orbe solo cuando la IA piensa (una descarga o un render dicen su estado sin orbe). «Puedes cerrar esta pestaña» solo si el trabajo sigue en la nube (una imagen se espera en el navegador). Estilos, Competencia y Mix siguen con el orbe solo: son esperas cortas. |
| **Error en tres partes** (UI·11, compartido en UI·27: `marca/ErrorTresPartes.tsx`) | Todo error de algo que **ya cobró** y falló (crear, clip, imagen con 502, shorts al traer, analizar o renderizar, y la corrida del Editor IA de Subir) dice: **Qué pasó** (en palabras de persona), **Tus créditos** (qué se devolvió; solo con monedero y solo si el servidor de verdad devuelve) y **Qué sigue**. El texto crudo del servidor va plegado en «Detalles técnicos». Lo que no cobró (402, un dato mal escrito) no usa este bloque: va en su campo o en una línea. |
| **Espera corta** | Por ahora como hoy. Los «esqueletos» quedan para después. |
| **Error** | Tres partes: **qué pasó** (sin culpar), **qué pasó con tus créditos** («Te devolvimos ✦ 90») y **qué sigue** (un botón). Lo técnico va plegado en «Detalles técnicos». |
| **Error de campo** | Junto al campo, antes de mandar y sin gastar créditos. Dice cómo arreglarlo. Al aparecer, el campo tiembla una vez (`ui/Campo.tsx`, UI·24). |
| **Tus trabajos** (`static/trabajos.js`) | Cuadro abajo a la derecha en todas las pantallas: lo que corre (paso, avance, «Ver»), lo que terminó en las últimas **24 h** con su enlace y lo que falló con «Te devolvimos ✦ N». Va **plegado**; se abre solo cuando algo termina o falla y no lo habías visto. Lo cerrado no vuelve en ese navegador. En celular, abajo a todo lo ancho (dueño, 25-sep). |
| **Aviso rápido** (`window.avisos.mostrar`) | En el mismo cuadro, encima: guardado o copiado (se va solo; en las pantallas de `web/` el «Guardado» va donde se guardó, con su palomita: `ui/Guardado.tsx`, UI·24), sin conexión y un fallo que no pertenece a ningún campo (se queda hasta cerrarlo). Un error de campo va junto al campo y el aviso de una tarjeta, en su tarjeta. Cada fallo lleva `clave` (`<pantalla>-carga`, `<pantalla>-error`…) y se quita cuando lo mismo sale bien; una lista que no cargó ofrece «Reintentar» en el aviso. La clave `red` es compartida con trabajos.js: una pantalla solo la quita si ella la puso. Se quedan en su sitio: validación, el error o 402 junto al botón que cobra, los estados vacíos de lista y los `confirm()`. |

## 9. Fuera de alcance por ahora

- Propuesta 8 (confirmaciones propias y «deshacer»): en pausa.
- Propuesta 9 (el costo en un solo lugar): rechazada; la pantalla de crear
  se queda como está. El problema de conteo quedó en Trello.
- Propuesta 10 (accesibilidad): para después. §4 ya fija foco, área táctil
  y movimiento reducido para lo nuevo.
