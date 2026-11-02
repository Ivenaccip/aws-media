# Carta de diseño — Irremplazables

Fecha: 2026-09-25 · Decidida por el dueño sobre el lienzo de propuestas
(https://claude.ai/artifact/AHYpxmhtur9e528hAjgHmv) · Plan: `docs/PLAN-UI.md` §7 y §8

Revisada el 2026-10-15 con la decisión del dueño sobre el prototipo «Mapa con
Irremplazables»: el menú lateral se retira (el mapa lo reemplaza, §7) y el título
«Irremplazables» lleva dorado (§3). Esa misma tarde, segunda ronda del dueño: el
mapa **es** el inicio (se aterriza en él), el título va arriba y fuera de cualquier
tarjeta, solo la caja lleva tarjeta, y ya no hay «Volver a …» (§7).

Revisada el 2026-10-20 al encender Automatizaciones (Constructor y Asistente, §7):
el área abre dos grupos, suma nueve íconos (§6), el aviso rápido gana un botón de
acción y «Deshacer» sale de la pausa como patrón adoptado (§8 y §9). Además
queda anotada una excepción a la escala de formas: el radio de 48 px del
disparador del Constructor (§4).

Revisada el 2026-10-22 con las rutas por nivel (§7): cada nivel del recorrido es
una página con su dirección y su `<title>`, las fichas, tarjetas y migas son
enlaces, «Atrás» del navegador sube un nivel y la caja es una página con tres
direcciones. El aspecto de cada paso no cambió.

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
- El **orbe** de espera y el **mapa** del inicio (mapa en X → opciones del área →
  lista del grupo, una página por nivel, §7), que es la principal, `/estudio/`. El
  menú lateral ya no existe: lo reemplazó el mapa (dueño, 15-oct-2026).
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
| `#111f33` | superficie | tarjetas (también la tarjeta de la caja del inicio, §7) | — |
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
| `#b98d2f` | dorado hondo | solo el título «Irremplazables»: abajo del degradado, su parte más oscura (5.45:1 sobre la superficie), y su color liso al imprimir (3.0:1 sobre papel blanco, el mínimo de un texto de 32 px) | texto largo, otros títulos |
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
  aunque la pantalla sea de consulta (dueño, 25-sep). En el Asistente de
  Automatizaciones, «Armar flujo» es el ámbar hasta que hay un flujo listo; entonces
  pasa a secundario («Armar otro flujo») y el ámbar es «Descargar .json» del resultado.
  En el Constructor el único ámbar es «Descargar .json».
- El **dorado** (`#f3dc92` → `#e6c35c` → `#b98d2f`) no es un segundo acento: es
  la firma del título «Irremplazables» y de nada más (dueño, 15-oct-2026). Va
  como degradado de arriba abajo, con los tokens `--color-oro-claro`,
  `--color-oro` y `--color-oro-hondo` de `tokens.css` y la clase `texto-oro`
  (`bg-clip-text text-transparent`). Un navegador que no recorte el fondo a la
  letra pinta el título en `#e6c35c` liso, y al imprimir lo pinta en `#b98d2f`
  liso (el degradado es un fondo y el navegador no imprime fondos de fábrica):
  nunca invisible.
- Todo lo demás es gris: botón secundario con borde `#55708f`.

## 4. Espacio, forma y movimiento

- **Espaciado:** múltiplos de 4 (4, 8, 12, 16, 24, 32, 48, 64).
- **Radios:** 6 (chips, etiquetas) · 10 (campos, botones chicos) ·
  12 (botones de 48 px) · 16 (tarjetas, diálogos).
  - **Una excepción, dicha tal cual: el disparador del Constructor** (Automatizaciones,
    20-oct-2026). Su cuadro es redondo a la izquierda, con un radio de **48 px** en las
    dos esquinas de ese lado (la mitad de su alto de 96 px) y de 12 px (`rounded-boton`)
    en las de la derecha: la firma visual de n8n. 48 px **no está en la escala** de arriba
    (6/10/12/16/píldora). Se usó la forma del prototipo que el dueño vio y aprobó («casi
    perfecto»); no salió de la escala. Vive SOLO en la regla `.cn-nodo-trig` de
    `web/src/pantallas/constructor/constructor.css` y no se copia a ninguna otra pantalla. Si el
    dueño prefiere quedarse dentro de la escala, el cambio es una línea: el `border-radius` de
    esa regla pasa a `var(--radius-boton, 12px)`, el mismo de los demás cuadros del lienzo.
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
  - El lienzo del Constructor (Automatizaciones, 20-oct-2026) no anima posiciones: un
    cuadro sigue al puntero sin retraso, las flechas son geometría que se recalcula, y lo
    único que transiciona es el color, el borde y el fondo en `--dur-rapida` (120 ms). Ninguna
    transición toca `left`, `top` ni `transform`, no hay `@keyframes`, y traer un cuadro o el
    panel de Ajustes a la vista no usa desplazamiento suave.
- **Área táctil:** lo que se toca mide al menos 44 × 44 px, aunque el dibujo
  sea más chico. Un botón dentro de una fila flexible no cede: lleva `min-w-11`
  (la ✕ de los diálogos a 320 px: con el título en dos líneas, el flex la dejaba
  en 38).
- **Foco:** `outline: 2px solid #f0a94a; outline-offset: 3px` en todo lo
  que se enfoca, sin excepción. Si el campo vive dentro de un cuadro con borde y
  fondo (el área de escritura de la caja del inicio: `ui/CuadroDeTexto`), el aro
  lo dibuja el cuadro cuando algo de adentro tiene foco visible y el campo no
  dibuja otro: dos aros, uno dentro del otro, se verían como un error.
- **Un diálogo nunca mide más que la ventana.** El ancho (`CAJA_ANCHA` de
  `ui/Dialogo`) limita su alto a `100dvh − 1rem` y se desplaza por dentro: centrado y
  sin tope, un teléfono de 568 px de alto le cortaba arriba el título y la ✕ y abajo el
  botón principal, y de lado (320 px de alto) dejaba «Usar» fuera de la pantalla, sin
  forma de tocarlo. Las hojas con lista (`HojaVideos`) ceden primero alto en la LISTA
  (`dvh`, no `vh`: la altura que de verdad se ve, sin las barras del navegador) y dejan su
  pie —«Cancelar» y el botón principal— pegado abajo (`sticky bottom-0`), así que se
  alcanzan siempre. Se prueba a alturas de teléfono (320 × 568, 375 × 553, 360 × 640,
  390 × 664 y 568 × 320), no con una ventana a la que la hoja le quepa (800 px lo esconde).
- **La bandeja «Tus trabajos» repinta solo lo que cambió.** Cada ficha, aviso y la
  caja entera llevan una clave (`data-k`) y `static/trabajos.js` pone al día el DOM en su
  sitio en vez de reemplazarlo con `innerHTML`: el avance de una ficha que corre no repinta
  la ficha de error de al lado (que lleva `role="alert"`, así que el lector de pantalla no
  la vuelve a leer, y conserva el foco de quien llegó con Tab a «Reintentar»). Los atributos
  que pone la bandeja misma mientras algo está en el aire (`aria-busy`, `aria-disabled`
  de «Reintentar») no los borra un repintado.
- **Una hoja `.css` por pantalla, solo para lo que Tailwind no dice bien** (molde:
  `web/src/pantallas/subir/subir.css`). El CSS de una hoja es global, así que lleva tres
  reglas, que el Constructor cumple en `web/src/pantallas/constructor/constructor.css`:
  todo color sale de un token (`var(--color-…)`; el guardián de paleta lee también las
  hojas `.css`, comentarios incluidos), toda clase lleva el prefijo de la pantalla (`cn-`
  en el Constructor: otras hojas usan `.anim`, `.clip`, `.seg`) y todo va dentro de
  `@layer components`, para que las utilidades de Tailwind sigan ganando. Una prueba de
  `Nodo.test.tsx` las fija. En `constructor.css` viven el fondo de puntos del lienzo, la
  forma del disparador, los botones de 44 px con su dibujo de 24 o 28 px adentro y los
  estados de un cuadro.
  - **`avisos.css` es la excepción, y va fuera de `@layer` a propósito.** Pinta el botón de
    acción del cuadro de avisos de abajo a la derecha (`#bandeja`, de `static/trabajos.js`),
    cuyo CSS no tiene capa; una regla con capa siempre pierde contra una sin capa. Ese cuadro
    escribe el botón con las clases `btn btn-sec` de `carta.css`, que las pantallas de `web/`
    no cargan: sin esta hoja el «Deshacer» salía como texto suelto de 36 px. La regla
    (`#bandeja .bj-aviso .btn.btn-sec`) lo pinta como un botón secundario de §5: 44 px de
    alto, borde `#55708f` y texto `#ece8e1`; al pasar el ratón, fondo `#18293f` y borde `#93a3b8`.
    No va en `constructor.css` porque esa hoja exige capa y prefijo. Si la regla sube a
    `tokens.css` (como ya está `#bandeja .ico`), esta hoja se borra.

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
- **Interruptor** (Biblioteca de prompts, Ajustes 3, 16-oct-2026: el «pin» de los
  3 favoritos). Es un botón de nivel secundario que se queda **encendido**:
  `aria-pressed`, alto 44 px, «Fijar» ↔ «Quitar de fijados» (el nombre accesible
  lleva el título: «Fijar «Retrato…»», y repite el texto visible, WCAG 2.5.3).
  Encendido NO es ámbar de botón (el principal es uno por pantalla): borde
  `#a96716` y fondo `#2e2110` —el mismo tono de «elegido» que lleva un chip— con el
  ícono relleno. Cambia al instante y se guarda después; si falla, vuelve atrás y
  lo dice junto a él. Con el tope lleno (3) **no sustituye en silencio**: avisa
  («Ya tienes 3 fijados. Quita uno para fijar este.») y deja el foco donde estaba.
  Lo que acompaña a un favorito (subir, bajar, quitar) son botones solo-icono de
  44 px con el título en su nombre; el extremo que no puede moverse queda
  `aria-disabled` (apagado pero enfocable), para que el foco no se pierda.

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
- La Biblioteca de prompts (Ajustes 3) suma Copiar, Fijar (una chincheta), Llevar
  (una flecha contra una barra: «a la caja») e Investiga (una brújula).
- Automatizaciones suma nueve: Flujo (dos cuadros unidos por un codo: el Constructor),
  Chat (un globo de diálogo), Web (un globo terráqueo), App (cuatro cuadros), Enlace (dos
  eslabones), Un sentido (una flecha), Ida y vuelta (dos flechas opuestas), Papelera y Código
  (los signos `<` `>`, para «Ver el JSON»). Sus nombres, idénticos en `ui/iconos.ts` y
  `static/iconos.js`: `flujo`, `chat`, `web`, `app`, `enlace`, `unSentido`, `idaYVuelta`,
  `papelera`, `codigo`. Los demás íconos de ese mapa ya existían: Rápido (el área), Ubicación
  (Distrito), Magia (Asistente), Automático (Actualizar flujos) y Biblioteca (Tus
  automatizaciones).

## 7. Navegación

Desde el 15-oct-2026 no hay menú lateral, en ningún ancho: el inicio es un
recorrido de tres niveles («Mapa con Irremplazables», decisión del dueño), y su
primer nivel, el **mapa**, es la página principal. Desde el 22-oct-2026 (dueño,
21-oct-2026: «por cada pestaña, una ruta») **cada nivel es su propia página**. La
lista de adónde se puede ir es una sola, `web/src/marca/menu.ts`; las direcciones,
los títulos, el recorrido y las migas de las pantallas salen de ella, así no se
desincronizan. El detalle (cada dirección, lo que redirige el servidor, las
pruebas) está en `docs/migracion/inicio.md` § «Rutas por nivel»; las decisiones
del dueño que lo rigen (D5 a D14) están en `docs/PLAN-UI.md` §9.

- **La regla: una página por nivel, con su dirección y su `<title>`.** El mapa es
  `/estudio/` («Estudio de video»); cada área, `/estudio/<área>/` («Estudio de
  video · Marketing»); cada grupo, `/estudio/<área>/<grupo>/` («Estudio de video ·
  Marketing · Distrito»); y cada herramienta de la caja,
  `/estudio/marketing/distrito/imagen/` (o `video/`, `edicion/`), con su nombre al
  final del título. Las direcciones van en minúsculas, sin acentos y con barra
  final (Marketing se escribe `marketing`). No hay router: cada nivel es un
  `index.html` generado desde `menu.ts`.
- **Tres niveles hasta la herramienta:** el **mapa en X** (las áreas: Marketing,
  Producto, Central, Ventas y Automatizaciones) → las **opciones del área** (sus
  grupos: los de Marketing son Distrito, Blotato y Avanzado; Central y
  Automatizaciones tienen dos, Distrito y Deepseek, y Distrito y Tus
  automatizaciones) → **la lista del grupo** (sus pantallas). La caja es una
  herramienta más: Marketing › Distrito lista Imagen, Video y Edición, y cada una
  abre la caja en esa pestaña.
- **Fichas, tarjetas y migas son enlaces** (`<a href>`, no botones): se pueden
  abrir en otra pestaña o copiar, y cada clic carga otra página con el fundido
  entre pantallas de §4 (sin él con «reducir movimiento»). Lo que no lleva a
  ningún lado no es un enlace: **Producto y Ventas son fichas apagadas** (botones
  con `aria-disabled` y «Próximamente», que siguen en el orden de Tab y el lector
  anuncia como no disponibles), las tarjetas «Próximamente» son quietas, y una
  tarjeta de Blotato apagada es un enlace con `aria-disabled` cuyo clic abre el
  diálogo de conectar en vez de navegar.
- **Se aterriza en el mapa** (dueño, 15-oct-2026, segunda ronda: «el mapa es el
  inicio»): `/estudio/` enseña «Elige un área» y la X, con **nada elegido**. La
  página del mapa no trae la caja: para llegar a ella, Marketing → Distrito → la
  herramienta.
- **El título va arriba y fuera de cualquier tarjeta:** el `h1` «Irremplazables»
  (dorado, 32 px, centrado, sin icono; es el único `h1` de la página) va en
  el mismo lugar en todos los niveles (a 88 px del borde de la ventana: debajo del
  saldo, que es fijo y acaba a 52) y nunca dentro de una tarjeta.
- **Solo la caja lleva tarjeta:** 820 px de ancho como mucho, centrada en
  horizontal, en la superficie `#111f33` con borde `#22354f` y radio 16, con
  32 px de aire bajo el título (el borde cae a 155 px, no a los 64 de antes: se
  sentía pegado arriba) y sin centrarse en vertical, para que no salte cuando
  baja o sube lo que cuelga de ella. Adentro, arriba, las migas y la caja con su
  `h2` «¿Qué vamos a crear hoy?».
- **El mapa, las opciones y las listas son pantallas sueltas, sin cuadro:** nada
  los rodea (sin borde, fondo ni relleno). Van **centrados** en horizontal y en el
  alto que sobra bajo el título (huecos arriba y abajo parecidos: lo medido es
  una diferencia de 0,1 px a 1100×800), con su `h2` («Elige un área», «Elige un
  grupo», el nombre del grupo) y, si hay, las migas centradas bajo el título.
- **Nada se ve elegido** (dueño: «parece que marketing está seleccionado,
  mientras que no debería de verse de ese tono, hasta que lo seleccionen»):
  ninguna ficha ni tarjeta lleva «Estás aquí», tono distinto ni `aria-current`;
  la dirección y el `<title>` dicen dónde estás. Marketing, Central y
  Automatizaciones, las tres que se abren, se ven iguales (`#111f33` con borde
  `#22354f`; el hover y el foco se conservan) y las otras dos, Producto y Ventas,
  siguen apagadas («Próximamente»).
- **Migas, las de hoy (D6):** la ruta son chips («Marketing › Distrito») y cada chip
  es un enlace a su nivel: el área lleva al mapa (`/estudio/`) y el grupo, a las
  opciones del área (`/estudio/<área>/`), también desde la caja. En el mapa no
  hay migas; con la caja van dentro de la tarjeta, arriba; en los demás niveles,
  centradas bajo el título. La miga del nivel donde estás lleva
  `aria-current="step"` y su nombre accesible dice a dónde lleva («Volver al
  mapa para cambiar de área (ahora: Marketing)»).
- **Subir de nivel: las migas o «Atrás».** Cada página es una entrada del
  historial, así que el **«Atrás» del navegador sube un nivel** (caja → grupo →
  área → mapa) y «Adelante» baja otra vez. No hay botón «Volver a …» en ningún
  nivel (dueño, 15-oct-2026: «no podemos poner el botón de "Volver a video"»),
  tampoco hacia la hoja de donde llegaste: eso lo hace «Atrás».
- **Esc (D12):** en las opciones de un área sube al mapa; en el mapa, en la lista de
  un grupo y en la caja no hace nada. Vale con la página recién cargada, sin
  haber tocado nada (lo escucha el documento); con un diálogo o una lista
  abiertos, Esc es de ellos y solo los cierra.
- **La caja: una página, tres direcciones.** Cambiar de pestaña con el riel
  mueve la dirección y el título sin recargar ni agregar historia, y conserva lo
  escrito, el video y la subida. Salir de la caja a un nivel superior (una miga,
  «Atrás», cualquier enlace) es ir a otra página: lo escrito se descarta, sin
  aviso (D11). Solo una subida a medias hace que el navegador pregunte antes de salir.
  La galería «Mis creaciones» y lo que cuelga de la caja viven en esa página.
- **Lo que enseña un grupo:** la lista de sus pantallas como
  tarjetas-enlace (icono, título y, si la trae, una línea de apoyo; las tres de
  la caja van solo con su icono y su nombre). Las que dependen de
  Blotato se apagan con `aria-disabled` cuando se sabe que la persona no lo ha
  conectado (si no se sabe, no se apaga nada) y su clic abre el diálogo de
  conectar en vez de navegar; el botón «Conecta tu cuenta de Blotato» (o
  «Blotato conectado: ver o cambiar») vive arriba de esa lista. Lo que aún no
  existe (Preguntas y Glosario, en Central) sale apagado con la etiqueta «Próximamente» y no navega.
  Automatizaciones se abre: su grupo Distrito lista el Constructor y el
  Asistente (enlaces a `/estudio/automatizaciones/distrito/constructor/` y
  `/estudio/automatizaciones/distrito/asistente/`) y
  «Actualizar flujos», apagada con «Próximamente» y sin enlace.
- **Lo que todavía no trae nada tiene su página igual (D5):** un área o un grupo
  vacío responde con su página, no con un error, y dice «Todavía no está
  disponible.» bajo su título. Hoy son Producto y Ventas (solo tecleando su
  dirección: en el mapa son fichas apagadas), Deepseek (Central) y «Tus
  automatizaciones» (Automatizaciones); los dos grupos dicen «Próximamente» en su
  tarjeta.
- **Las hojas con encabezado propio** (COI, la Biblioteca de prompts, el Constructor y el
  Asistente) no llevan «← Estudio» ni `<Marco>`: su único `h1` es «Irremplazables»
  (dorado, sin ícono, fuera de toda tarjeta, como en el mapa) y debajo, centradas, las
  migas de tres niveles «Área › Grupo › Pantalla» sacadas de `menu.ts`. El área y el grupo
  son enlaces directos a su página (el mapa y las opciones del área); la última
  miga es la pantalla donde estás, un chip quieto. El nombre de la pantalla va como `h2`. El
  Constructor y el Asistente arman ese encabezado con `web/src/marca/EncabezadoHoja.tsx`;
  COI y la Biblioteca lo arman en su carpeta. En el encabezado compartido, a 480 px o
  menos las migas pierden sus íconos y los «›» (así caben en una línea a 390 px y en dos
  a 320).
- **Las páginas hoja siguen siendo páginas** (Agenda, Competencia, Métricas, MIX,
  Copiadora de estilos): llevan «← Estudio» (a `/estudio/`) y, a su lado, sus migas,
  «Marketing › Blotato», como **enlaces directos**: «Marketing» abre el mapa y
  «Blotato» las opciones de Marketing. Sin parámetros, sin «Estás aquí» y sin
  «Volver a …»: para regresar a la hoja, «Atrás». Las pantallas que el mapa no
  tiene (Admin, Crear, Subir, Clip, Imágenes y Shorts) no llevan migas.
- **Las direcciones de antes redirigen con un 302, nunca un 301 (D13):** `/estudio/inicio/`
  (la página única de antes), `/estudio/?prompt=…`, `?brief=…` y
  `?blotato=conectar`, y lo tecleado sin barra o en mayúsculas, llevan a la página
  que hoy hace eso. Un 301 se queda para siempre en la caché del navegador: un
  nivel que cambie de sitio ya no llegaría.
- **El 404 (D14):** una dirección que no existe contesta con una página mínima, en el
  oscuro de siempre y con las fichas de `static/carta.css` (sin colores sueltos):
  «No encontramos esa página», «La dirección no existe o cambió de lugar.» y dos
  enlaces, «Subir un nivel» e «Ir al inicio». Nunca una página en blanco.
- **Dónde quedó cada cosa:** «De videos a Shorts» es el segundo modo del chip
  «Editar ▾» de la pestaña Edición y ya no tiene entrada propia. La Copiadora de
  estilos está en Marketing › Avanzado **de forma provisional**: irá a «Marcas»,
  que todavía no existe, y quitarla antes dejaría sin puerta una pantalla que
  funciona.
- **Celular (≤ 560 px):** la «X compacta» (dueño, 15-oct-2026): dos columnas,
  con Central como banda de ancho completo en medio y trazos punteados cortos
  hacia ella, también centrada. En escritorio el mapa es una cuadrícula de 3 × 3
  con las dos diagonales punteadas (decoración: `aria-hidden`, en `#55708f`,
  detrás de las fichas). En los dos, las fichas miden 44 px o más y el texto 13 px
  o más; «Automatizaciones» y «Próximamente» no se parten a 390 ni a 320 px, y
  nada se desborda. El riel de la caja pasa a horizontal.
- **Teclado y foco:** el orden de Tab es el de lectura (Marketing, Producto,
  Central, Ventas, Automatizaciones). Cada página empieza con el foco arriba, como
  cualquier página: no se le mueve a nadie y el `<title>` dice dónde estás. Un
  doble clic no salta dos niveles: el segundo clic que llega antes de medio
  segundo desde que cargó la página se descarta (a 390 px la ficha de una página
  y la tarjeta de la siguiente caen en el mismo lugar); Enter no cuenta como
  doble clic.
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
| **Aviso rápido** (`window.avisos.mostrar`) | En el mismo cuadro, encima: guardado o copiado (se va solo; en las pantallas de `web/` el «Guardado» va donde se guardó, con su palomita: `ui/Guardado.tsx`, UI·24), sin conexión y un fallo que no pertenece a ningún campo (se queda hasta cerrarlo). Un error de campo va junto al campo y el aviso de una tarjeta, en su tarjeta. Cada fallo lleva `clave` (`<pantalla>-carga`, `<pantalla>-error`…) y se quita cuando lo mismo sale bien; una lista que no cargó ofrece «Reintentar» en el aviso. La clave `red` es compartida con trabajos.js: una pantalla solo la quita si ella la puso. Puede llevar **un botón de acción** (`accion {texto, al}` en `nucleo/avisos.ts` y `nucleo/globales.ts`; `trabajos.js` lo pinta bajo el texto): al pulsarlo se quita el aviso y corre `al`. Hoy lo usan «Deshacer» (abajo) y el «Recargar» del 402. Se quedan en su sitio: validación, el error o 402 junto al botón que cobra, los estados vacíos de lista y los `confirm()`. |

### Deshacer (adoptado el 20-oct-2026, solo en el Constructor de Automatizaciones)

Antes de este día la carta lo tenía «en pausa» (§9). La auditoría ya lo pedía para borrar
(«Escena 3 eliminada · Deshacer», `docs/UX-REVIEW.md`) y el prototipo del Constructor ya lo
traía para quitar un cuadro. El patrón adoptado, tal como lo hace el código
(`web/src/pantallas/constructor/modelo/reductor.ts`, `Constructor.tsx` y `Barra.tsx`):

- **Una pila real de hasta 20 instantáneas** (`MAX_HISTORIAL` en `modelo/datos/constantes.ts`).
  Cada instantánea guarda cuadros, conexiones, nombre del flujo y cuadro elegido. Al pasar de
  20 se descarta la más vieja.
- **Qué entra** (cualquier acción que cambia la estructura del flujo): quitar un cuadro (la ×
  o Supr), quitar una conexión, cambiar el tipo de una conexión, poner un cuadro en medio de
  una conexión, conectar con un cuadro que ya está, agregar un cuadro o elegir el disparador,
  «Limpiar» y «Cargar el ejemplo». (El reductor también tiene `cargarFlujo`, la puerta para
  un flujo de afuera, y la apila igual; hoy ningún botón la usa, porque el Asistente pasa el
  flujo por el borrador al abrir la página.)
- **Qué NO entra:** mover un cuadro (con el puntero o con las flechas del teclado), teclear en
  Ajustes, renombrar el flujo, elegir un cuadro o una flecha, abrir o cerrar menús, empezar o
  cancelar una conexión. Esas acciones **tampoco tiran la pila**: acomodar un cuadro después
  de quitar otro no puede borrar la red de seguridad. Anotan en cada instantánea qué cuadros
  se movieron o se escribieron después de ella y si se renombró el flujo. Al deshacer, vuelve
  lo estructural (qué cuadros y qué conexiones hay), pero los cuadros tocados que siguen
  existiendo conservan su posición y su texto de ahora, igual que el nombre del flujo: Deshacer
  nunca pisa lo que la persona acaba de mover o escribir. La excepción es la instantánea de
  «Cargar el ejemplo» (o de un flujo de afuera): se deshace entera, porque sus ids pueden
  repetirse en el flujo nuevo y no tienen nada que ver con los de antes.
- **Qué la tira:** nada a propósito. Ninguna acción vacía la pila. Salen de ella el tope de 20
  (la más vieja primero), deshacer (la de arriba sale) y recargar o cerrar la página: la pila
  vive en memoria y el borrador guarda solo cuadros, conexiones y nombre.
- **Tres puertas, una misma pila:**
  1. **El aviso con acción** en el cuadro de abajo a la derecha: «Deshacer» (`tipo: 'ok'`, clave
     `constructor`, 10 s en vez de los 5 s de un aviso `ok`; el aviso siguiente lo reemplaza,
     y su botón con él). Lo ofrecen los avisos de lo que **quita o reacomoda**: quitar un cuadro
     o una conexión, cambiar el tipo de una conexión, poner un cuadro en medio, «Limpiar» y
     cargar un flujo. Agregar y conectar entran en la pila, pero su aviso no lo ofrece. Desde el
     aviso solo vale la instantánea de arriba: si la persona cambió otra cosa después, dice «Eso
     ya no se puede deshacer: cambiaste algo después.» y no hace nada.
  2. **El botón «Deshacer» de la barra** (nivel secundario). El aviso queda al final del
     documento y un usuario de teclado llegaría a él después de recorrer todo el lienzo; por eso
     el botón existe siempre. Sin nada que deshacer se apaga con `aria-disabled` (no `disabled`:
     conserva el foco), su descripción dice «Todavía no hay nada que deshacer.» y pulsarlo
     contesta «Ya no hay nada que deshacer.».
  3. **Ctrl+Z (Cmd+Z)** en todo el documento, sin Alt ni Mayús. **No** actúa con el foco en un
     campo de texto (`input`, `textarea`, `select`, `contenteditable`) ni dentro de un diálogo de
     confirmación (`role="alertdialog"`): ahí es del navegador y deshace lo escrito.
- Tras deshacer, el foco va al cuadro que volvió (el elegido, si volvió; si no, el primero que
  volvió) o, si lo que volvió fue una conexión, al cuadro elegido: nunca cae a `<body>`.
- **«Limpiar» pregunta antes** con `ui/Confirmar` (peligro, foco inicial en «Cancelar»), no con
  un «Sí, borrar todo» en línea; la pregunta dice que se puede volver atrás con «Deshacer» o con
  Ctrl+Z, y es verdad porque «Limpiar» entra en la pila. Quitar un cuadro con la × no pregunta
  (es deshacible).
- Sin el cuadro de avisos en la página (las pruebas, la vitrina) el aviso se dice en una
  región `role="status"` de la propia pantalla, con su botón «Deshacer»: un solo mecanismo
  activo a la vez, para que ningún lector de pantalla anuncie el aviso dos veces.

### La voz de las pantallas de Automatizaciones

Sin normas nuevas: anota lo que el Constructor y el Asistente ya cumplen y lo que la carta ya dice
en §1 (todo en español, con tuteo), §5 («Verbo ✦ N») y §8 (errores en tres partes, solo pasos de verdad).

- **Español de LATAM con tuteo** («Escribe», «Elige», «Cuéntale»). El sistema habla en plural
  cuando se refiere a sí mismo («Quitamos «x»», «No pudimos recuperar tu borrador»), sin culpar
  a la persona.
- **Los nombres de la interfaz** son cuadro, flujo, disparador, agente de IA, herramienta y
  conexión. Lo único en inglés es lo que la persona verá en n8n con ese nombre, citado
  literal entre «»: «Import from File».
- **Tipografía del texto:** comillas angulares «…» para nombres y citas, el punto suspensivo `…`
  (U+2026) y no tres puntos, frases en minúscula salvo la primera (también en botones y
  títulos: «Descargar .json», «Armar flujo») y sin el signo `¡`.
- **Dinero:** el contenido de estas dos pantallas (letreros, botones, resultados) no muestra precios, ni ✦, ni la palabra «créditos»; la
  píldora global del saldo en la cabecera (`monedero.js`, «N créditos ✦») sí aparece cuando el monedero está activo, porque es de la página y no de la
  pantalla. El Constructor no cobra. El Asistente solo ofrece escribir cuando el servidor dice que está
  activo **y** que es gratis; si algún día cobra, aplica §5 («Verbo ✦ N», con el precio de la
  API) y exige un verbo nuevo en `tests/test_m21_botones.py` y en `web/src/marca/verbos.ts`.
- **Errores:** lo que no se puede arreglar en un campo se dice en tres partes con
  `ErrorTresPartes` («Qué pasó» y «Qué sigue»; sin «Tus créditos» porque nada se cobró) y lo
  técnico va plegado en «Detalles técnicos». Un error de lo que se escribió va junto al campo,
  con el foco en él.
- **Lo que la persona necesitará después** no vive solo en un aviso que se apaga: la
  instrucción de importar en n8n («en el menú «⋯» de arriba a la derecha, elige «Import from
  File»») está también escrita en la página (en el Asistente, dentro del resultado), y el
  aviso de «Listo: <archivo>.json…» del Constructor se queda hasta cerrarlo.
- **Privacidad dicha en voz alta:** el Constructor siempre muestra, con un candado, «Tu
  borrador se guarda solo en este navegador.» El Asistente, mientras corre en prueba, dice «No
  guardamos lo que escribes.» y que el flujo es un ejemplo elegido por las palabras del pedido.

## 9. Fuera de alcance por ahora

- Propuesta 8 (confirmaciones propias y «deshacer»): en pausa para el resto de la
  app. «Deshacer» salió de la pausa el 20-oct-2026 solo para el Constructor de
  Automatizaciones (§8, «Deshacer»); otra pantalla que lo quiera se decide con el
  dueño.
- Propuesta 9 (el costo en un solo lugar): rechazada; la pantalla de crear
  se queda como está. El problema de conteo quedó en Trello.
- Propuesta 10 (accesibilidad): para después. §4 ya fija foco, área táctil
  y movimiento reducido para lo nuevo.
