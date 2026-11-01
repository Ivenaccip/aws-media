# Plan de migración de la UI — Irremplazables

Fecha: 2026-09-25 · Repo @ `b5de255` · Autor: Claude Code Online (análisis, sin código de producto)

Cómo se hizo: inventario de las 13 pantallas de `static/` y del editor de cortes
(`tools/editor/index.html`), de los acoples con servidor/CI/tests y de tasteskill
(clonado en el commit `c184364`). Tres planes con lentes distintas (riesgo,
diseño, calendario), un juez que los fusionó y un crítico que verificó cada
afirmación contra el repo. Este documento ya trae las correcciones del crítico.

---

## 1. Lo que hay que saber antes de decidir

1. **tasteskill no es para la app.** Lo dice su propio skill
   (`skills/taste-skill/SKILL.md:8` y §13): «Landing pages, portfolios, and
   redesigns. **Not dashboards, not data tables, not multi-step product UI.**»
   Aplica de lleno a la **portada**, a **`/automatizacion`** y a los legales.
   En la app (hub, crear, imágenes, MIX, admin, editor) lo «bonito» sale de
   tres cosas: un **design system propio** (`docs/DISENO.md`: tokens, tipografía
   y espaciado), **componentes accesibles** (Radix) y **`redesign-skill` en modo
   auditar**, que extiende la auditoría que ya existe (`docs/UX-REVIEW.md`).
2. **Unos 20 módulos de tests (~310 funciones) leen el TEXTO de los `.html`.**
   Una migración a build que no los planee rompe CI. Por eso hay una Fase 0
   solo para esto.
3. **Hoy hay XSS reales** por `innerHTML` sin escapar: shorts, admin,
   `guardrail.js`, estilos y un `href` en crear. El token vive en una cookie
   legible desde JS. Se arregla antes de migrar, con un parche invisible.
4. **El login arranca por accidente** (el `fetch` del hub da 401 y eso lleva a
   Cognito). Si `/` pasa a ser una portada, desaparece la única puerta de
   entrada. Por eso `/entrar` va antes que la portada.
5. **No hay que tocar Node 20** (congelado): Vite 8, vitest 4, jsdom 27 y
   TS 5.9 aceptan Node `^20.19`. Astro 7 no (pide 22.12) y Next tampoco
   (necesita Node en runtime).

## 2. Stack recomendado

**Vite 8 + React 19 + TypeScript 5.9 estricto + Tailwind v4 + Radix**, en modo
**multipágina** (una entrada HTML por pantalla, sin router), dentro de `web/`.
Se compila en una etapa `node:20.20.2-bookworm-slim` del Dockerfile. FastAPI
sirve `web/dist` y **en runtime no corre Node**.

| Por qué | Detalle |
|---|---|
| Seguridad | JSX escapa por defecto: elimina de raíz los `innerHTML` sin escapar |
| Accesibilidad | Radix trae diálogo, select, tabs y popover con foco y ARIA. Reemplaza 7 `confirm()`, 1 `alert()` y 3 tipos de modal hechos a mano |
| Agentes | React + TS + Tailwind es lo que mejor escriben; el repo ya usa React 19 + TS en `remotion/` |
| tasteskill | Sus ejemplos son React + Tailwind v4 |
| Convivencia | En MPA, una pantalla es una carpeta. Convivir con lo viejo es un 302 por pantalla |

**Descartadas:**
- **TS vanilla:** tipa el problema pero no lo resuelve.
- **Lit/Web Components:** el shadow DOM choca con Tailwind.
- **Svelte:** sería un tercer paradigma.
- **Astro 7:** pide Node 22.
- **Next:** necesita Node en runtime.

**Versiones:** eslint **9.39.x**, porque `eslint-plugin-jsx-a11y` 6.10.2 no acepta eslint 10.

**Riesgo a aceptar:** Tailwind v4 exige Safari 16.4+, Chrome 111+ y
Firefox 128+. Para las páginas **públicas** se puede usar CSS plano si se
quiere cubrir iPhones viejos.

**Dependencias prohibidas** (un test sobre `web/package.json` las vigila):
`next`, `gsap` (no es MIT), `axios` (se salta el envoltorio de `auth.js`) y
`motion` fuera de la portada.

## 3. Arquitectura en una página

```
web/                       package.json · .npmrc (engine-strict, save-exact) · .nvmrc 20.20.2
  index.html               → /              portada (HTML + Tailwind, sin React)
  estudio/_vitrina/        → catálogo de componentes (noindex)
  estudio/<pantalla>/      → /estudio/<pantalla>/
  estudio/index.html       → /estudio/        la principal: el mapa (desde el 22-oct-2026, §9)
  estudio/<área>/<grupo>/… → una página por nivel del recorrido, generada desde marca/menu.ts (§9)
  src/estilos/tokens.css   ÚNICA fuente de tokens (⊂ PALETA de M20)
  src/nucleo/              api.ts · sondeo.ts · moderar.ts · formato.ts (formato.dolares → "$0.21 dólares")
  src/ui/                  Boton, Dialogo, Confirmar, Campo, Pestanas, Tarjeta, Aviso, Esqueleto, Vacio, TablaDatos…
  src/marca/               BotonCobro («Verbo ✦ N»), NotaSaldo, EsperaIA (orbe), Marco
  src/pantallas/<p>/       Pantalla.tsx · logica.ts · *.test.ts(x) · __fixtures__/
```

- **Servir:** `server/web.py` se monta antes de `app.mount("/"`. Es
  **condicional**: si falta `web/dist`, pytest sigue en verde en Windows.
  - Assets con hash: `immutable`.
  - HTML: `no-cache`.
  - `auth.js` y `monedero.js` siguen revalidando, como pide la tarjeta congelada.
- **Convivencia:** `server/migracion.py` guarda la etapa de cada pantalla:
  - `nueva`: solo se llega tecleando la URL; es el canario del dueño.
  - `todos`: 302 **que conserva el query**, salvo que el usuario tenga la cookie `ui=clasica`.
  - `retirada`: se borra el HTML viejo.
- **Globales:** las páginas privadas cargan `/auth.js` clásico antes del
  módulo. Las públicas **nunca** cargan `auth.js` ni `monedero.js`
  (`monedero.js:170` llama a `/api/creditos` y un 401 manda a Cognito).
- **Precios:** solo imports con nombre desde `tools/tarifas.json`.
  **`pricing.json` nunca entra al cliente**: expondría costos de proveedor y
  márgenes.
- **Local:** Vite en 8011 (el origen registrado en Cognito) con proxy a
  uvicorn en 8012. `/instalar` y `/actualizar` tienen que comprobar
  Node ≥ 20.19 y construir `web/`.
- **Deploy:** es el mismo `cdk deploy aws-media-api aws-media-jobs` con
  `IMAGE_TAG=<sha>` de siempre; lo corre el dueño. **Rollback:** desplegar el
  sha anterior.

## 4. Paso a paso

Reglas para todas las fases:
- **Paridad:** una pantalla migrada cambia el aspecto, no el comportamiento.
- **Lo viejo no se reformatea:** solo recibe arreglos.
- **Pantallas en vuelo:** como máximo 2, y solo 1 que cobre.
- **PRs:** cada PR va por separado.

| Fase | Qué | Cuándo | Deploy |
|---|---|---|---|
| **0 · Red de seguridad** | Separar la UI de los tests mixtos (`blotato_clave`, `mix_ejemplo`, `m22_testers`) en `*_ui.py` con lectura perezosa. Extender m19/m20/m21 a `web/`. Escapar los `innerHTML`. Arreglar el contraste de `.b3sqTxt`. **Medir** `cf-cache-status` y el Init Duration **antes** de poner `no-cache` explícito | 25-sep → 30-sep | sí, **propio el 1-oct**, separado del lanzamiento |
| **1 · Carta de diseño** | `.claude/skills/diseno-ui/` con tasteskill fijado a `c184364` (solo `taste-v2.md`, `redesign.md` y LICENSE, con hashes). `docs/DISENO.md` con tokens, tipografía, un solo acento ámbar, «Verbo ✦ N» y solo modo oscuro | 25-sep → 30-sep | no |
| **2 · Sección pública** | `/automatizacion`, privacidad y términos en **HTML estático sin build**, con la carta de diseño. Además CSP, OG/canonical/robots y `utm_*` guardados. (La funcionalidad son las tarjetas 50, 68 y los topes del tablero) | merge 6-oct, deploy 7-8-oct | sí (el del lanzamiento) |
| **3 · Tubería `web/` + vitrina** | Etapa de Docker, `server/web.py`, `nucleo/*`, `ui/*` y `/estudio/_vitrina/`. En la rama `ui/base`, **sin merge a `dev`** hasta que el release del 6-oct esté desplegado | 29-sep → 9-oct (rama), deploy semana del 12-oct | sí, invisible |
| **4 · `/entrar` + `/estudio/`** | Login de verdad con `volver=`, single-flight en `auth.js` (hoy siete 401 pisan `auth_verifier`), app en `/estudio/` (el mismo `index.html`), guarda anti-bucle y callback por defecto a `/estudio/` | semana del 19-oct | sí |
| **5 · Interruptor + piloto admin** | `server/migracion.py`, `Marco`, `api.ts` y admin en React (solo la usa el dueño) | semana del 26-oct | 3 (nueva → todos → retirada) |
| **6 · Portada en «/»** | taste v2 completo, capturas reales y un solo botón «Entrar». Con sesión, salta a `/estudio/`. Cualquier query de `/` → 302 a `/estudio/?<query>` | semana del 2-nov | sí |
| **7-10 · Pantalla por pantalla** | clip → estilos+competencia → e1 → **hub** → shorts → agenda+métricas → imágenes → MIX → **crear** (la última: la recorren todos y cobra 4 cosas) | nov → feb | 3 por pantalla |
| **11 · Cierre** | `/automatizacion` pasa a `web/`, CSP global, hash en `auth.js`/`monedero.js`, futuro del editor | — | — |

**Se quedan como están:** `callback.html` (solo cambia su destino por
defecto), `orbe*` y el editor de cortes, que es una isla: recibe tokens,
fuente y el arreglo de sesión, pero no se reescribe.

**Esfuerzo total:** unos 55-60 días de agente y unas 35 h del dueño, en 4-5
meses. Alternativa si no alcanza el ritmo: imágenes, MIX y crear se
**retocan en su sitio** con tokens («70 % del valor con 40 % del riesgo»).

## 5. Tests que leen HTML

| Clase | Qué se hace |
|---|---|
| Módulos mixtos (servidor + UI) | Se separan en `*_ui.py` (Fase 0) |
| Guardianes (paleta M20, ✦ M21, favicon/orbe M19) | Se extienden a `web/` |
| Implementación vieja (nombres de funciones, CSS literal) | Se borran junto con su HTML en la etapa `retirada` |
| Dinero y seguridad | Se reescriben en vitest **como comportamiento**, en el mismo PR («doble clic en Producir = 1 POST») |
| Escenarios en node | Pasan 1:1 a vitest con los mismos nombres |
| Registro anti-pérdida | `tests/test_migracion_ui.py`: cada invariante tiene un ID que tiene que existir como test en `web/` antes de retirar lo viejo |

## 6. Huecos que encontró el análisis (no son de UI, pero la afectan)

- **Concurrencia:** API y worker comparten un techo de 10 ejecuciones
  (`OPERACION.md:614`). El lanzamiento público, el sondeo anónimo y la MPA
  suman peticiones. Hay que decidir si se sigue o no antes del 10-oct.
- **Editor de cortes:** no carga `auth.js`. A los 60 min vence el id_token y
  guardar da 401 sin recuperación.
- **Borradores:** ante un 401, `auth.js:84` navega a Cognito y se pierde lo
  escrito. `api.ts` debe guardar el POST en `sessionStorage`.
- **IP detrás de Cloudflare:** `CF-Connecting-IP` se puede falsificar
  entrando por el host `execute-api`, que sigue activo.
- **Costo sin tope en dólares:** `pricing.json` no tiene sección para
  RAG/n8n. `docs/ECONOMIA.md` estima entre $0.20 y $0.35 dólares por flujo.

## 7. Decisiones del dueño (tomadas el 25-sep)

1. **Stack:** ✅ Vite + React + TS + Tailwind + Radix en MPA.
2. **Invariantes de diseño:** ✅ se mantienen la paleta M20, solo modo
   oscuro, «Verbo ✦ N», el orbe y el menú lateral. La fuente se decidió
   en el lienzo (ver §8). ✅ **Acento único: ámbar** (`#da8c28`) para la
   acción; el azul claro solo para enlaces; verde y rojo solo para estados.
   La carta completa está en `docs/DISENO.md`.
3. **10-oct:** 🔀 la sección pública (`/automatizacion`, fase 2) y la
   portada (fase 6) las lleva **otro agente**. Esta línea (etiqueta
   «Claude Code Online») se dedica a mejorar la UI/UX de las pantallas que
   ya existen.
4. **URLs:** ✅
   - la app en `/estudio/`;
   - login en `/entrar`;
   - los enlaces viejos redirigen con 302 y conservan el query;
   - la configuración de Cognito no se toca.
5. **Alcance:** ✅ quedan fuera callback, el orbe y el editor de cortes.
   El orden (crear, imágenes y MIX al final) y la regla de retiro (7 días
   en `todos` sin incidentes de dinero) siguen como propuesta.

6. **Entrada y portada (25-sep, tarjetas 37 y 38):** ✅ las construye esta
   línea (antes iban a otro agente), juntas, porque sin `/entrar` la portada
   deja sin puerta a los usuarios.
   - `/entrar` es una **pantalla de bienvenida** (opción B): primero intenta
     recuperar la sesión en silencio y solo si no puede muestra «Entra a tu
     estudio».
   - Portada **opción 1, «la puerta del club»**: dos frases y «Entrar». Las
     obras reales (opción 3) llegan cuando haya películas con permiso.
   - Quien no tiene cuenta ve un **enlace a la comunidad** (`static/enlaces.js`;
     vacío = no se muestra).
   - Con sesión, «/» **salta directo** a `/estudio/`.
   - Lo público que viene: **`/automatiza`**, con el RAG público (antes
     llamado `/automatizacion` en este plan).
7. **Nota del 15-oct-2026 — el menú lateral se retira (sustituye lo del punto 2
   y la fila 3 de §8, que se quedan como historia del 25-sep):** ✅ el dueño
   aprobó el prototipo «Mapa con Irremplazables» y en `/estudio/inicio/` ya no
   hay menú lateral, en ningún ancho. El inicio es un recorrido de tres pasos
   (mapa en X → tres opciones → pantalla) y, en la segunda ronda del dueño del
   mismo día, **el mapa es el inicio**: se aterriza en él, el título «Irremplazables»
   va arriba y fuera de cualquier tarjeta, solo la caja (Marketing › Distrito)
   lleva tarjeta y ya no hay «Volver a …». Lo que el 25-sep se decidió como «el
   centro del inicio sigue siendo el bloque de crear imagen/video» sigue
   valiendo, un paso adentro (Marketing → Distrito). De lo demás del
   punto 2 nada cambia (paleta M20, solo modo oscuro, «Verbo ✦ N», el orbe). La
   lista de adónde se puede ir es `web/src/marca/menu.ts`; la carta lo recoge en
   `docs/DISENO.md` §7, el inventario de lo que cambió está en
   `docs/migracion/inicio.md` y el QA manual en `docs/QA-UI.md` § inicio
   (pasos 43 a 73). *Desde el 22-oct-2026 el inicio ya no vive en
   `/estudio/inicio/`: cada nivel es una página (punto 8 y §9).*
8. **Nota del 22-oct-2026 — rutas por nivel (dueño, 21-oct-2026: «por cada
   pestaña, una ruta»):** ✅ el recorrido deja de ser una sola página que cambia de
   paso por dentro. El mapa es `/estudio/`, cada área y cada grupo tienen su
   página y la caja es una página con tres direcciones
   (`/estudio/marketing/distrito/imagen|video|edicion/`). Las fichas, tarjetas y
   migas son enlaces y «Atrás» sube un nivel. `/estudio/inicio/` responde 302 a
   `/estudio/`. Dónde quedó y lo que sigue: §9.

**Ramas:** los PRs van a `dev`, nunca a `main`. Cada commit de una tarjeta
empieza con `UI·N:` para poder correlacionar los cambios de la interfaz
con su tarjeta (`git log --grep "^UI·"`).

## 8. Propuestas de diseño elegidas (lienzo del 25-sep)

Lienzo: https://claude.ai/artifact/AHYpxmhtur9e528hAjgHmv

| # | Propuesta | Decisión |
|---|---|---|
| 1 | Tipografía | ✅ **C: Bricolage Grotesque (títulos) + Geist (texto)** |
| 2 | Botones | ✅ tres niveles (principal ámbar, secundario, discreto), cinco estados |
| 3 | Menú lateral | ✅ la versión de escritorio, pero el centro del inicio sigue siendo el bloque de crear imagen/video que ya existe (`.prompt` en `static/index.html`). Móvil: sin decidir |
| 4 | Iconos | ✅ un juego de iconos en lugar de los emojis |
| 5 | Pantallas vacías | ✅ los tres caminos iniciales |
| 6 | Esperas | ✅ **solo la espera larga** (pasos + tiempo restante al producir). Los skeletons de las esperas cortas quedan fuera por ahora; la propuesta se puede mejorar después |
| 7 | Errores | ✅ qué pasó / qué pasó con tus créditos / qué sigue, más la validación en línea |
| 8 | Confirmar vs deshacer | ⏸ en pausa, se platica después |
| 9 | Costo en un solo lugar | ❌ rechazada: la pantalla se queda como está. El problema de conteo («Generar ✦ 100» cuando el primer cobro es ✦ 10) quedó anotado en Trello |
| 10 | Accesibilidad | ❓ por explicar al dueño |

## 9. Rutas por nivel: dónde quedó el inicio y lo que sigue

Fecha: 2026-10-22. E1–E4 ya están en `dev` (PR #203); E5 y E6, en la rama de
trabajo hacia `dev`. Lo que sigue es **plan**, todavía sin código, salvo E7 ✅
(31-oct-2026: las nueve hojas ya viven en su lugar del mapa) y E8 ✅
(1-nov-2026: se retiró el inicio de una sola página), las dos en la misma rama
de trabajo.

### Dónde quedó (E1 a E5; E6, las pruebas de navegador y los docs)

El inicio es **una página por nivel**, sin router. El mapa es la principal,
`/estudio/` (`web/estudio/index.html`); cada área es `/estudio/<área>/`, cada
grupo `/estudio/<área>/<grupo>/` y la caja, una página con tres direcciones
(`/estudio/marketing/distrito/imagen/`, `video/` y `edicion/`). Son 16 páginas,
todas generadas desde `web/src/marca/menu.ts` (`rutas.ts` las enumera,
`paginas.ts` escribe su HTML con `npm run niveles` y `estudio.test.ts` exige que
no se desvíen). `server/web.py` sirve la raíz, corrige con un 302 relativo lo
tecleado sin barra o en mayúsculas, manda `/estudio/inicio/` a `/estudio/` y las
entradas de antes (`?prompt=`, `?brief=`, `?blotato=conectar`) a la caja o al
grupo Blotato, y contesta un 404 con página. Por etapas: E1–E4 (servidor,
direcciones, componentes y las 16 páginas), E5.1 (los enlaces van directo a cada
nivel), E5.2 (la raíz se sirve y lo viejo redirige), E5.3 (se retira la página
única) y E6 (los e2e por páginas de nivel, `web/e2e/niveles.spec.ts` y
`web/e2e/recorrido.ts`, y estos docs). El detalle:
`docs/migracion/inicio.md` § «Rutas por nivel»; la carta: `docs/DISENO.md` §7; el
QA manual: `docs/QA-UI.md` § inicio; la operación: `docs/OPERACION.md`.

**Decisiones del dueño que rigen el corte** (así se citan en estos docs; D9
también en `paginas.ts`):

| # | Decisión |
|---|---|
| D5 | Un área o un grupo vacío tiene su página, «Todavía no está disponible.», con 200 (no un 404) |
| D6 | Las migas de hoy: la del área lleva al mapa y la del grupo, a las opciones del área |
| D9 | La bandeja «Tus trabajos» va en todas las páginas de nivel (`CON_BANDEJA` en `paginas.ts`) |
| D10 | Sin texto de apoyo: las páginas de nivel no suman párrafos de ayuda, y Imagen, Video y Edición salen en su lista sin línea de apoyo |
| D11 | Sin aviso al salir de la caja: salir a un nivel superior descarta lo escrito; cambiar de pestaña dentro de la caja lo conserva |
| D12 | Esc como hoy: en las opciones de un área sube al mapa; en el mapa, en un grupo y en la caja no hace nada |
| D13 | Redirecciones con 302, no 301 |
| D14 | El 404 con el texto que eligió el dueño: «No encontramos esa página», «La dirección no existe o cambió de lugar.», «Subir un nivel» · «Ir al inicio» |

### Lo que sigue (plan)

| Etapa | Qué | Cómo |
|---|---|---|
| **E7 · las hojas a su ruta anidada** ✅ (31-oct-2026, E7.1 a E7.9) | Las 9 hojas del mapa dejan su carpeta plana (`/estudio/agenda/`…) por la de su lugar (`/estudio/marketing/blotato/agenda/`…) | **Una hoja por commit**, en este orden: primero las cuatro que nacieron en la UI nueva, **COI** (`central/distrito/coi`), **Biblioteca** (`central/distrito/biblioteca`), **Constructor** y **Asistente** (`automatizaciones/distrito/…`); después **Agenda**, **Competencia** y **Métricas** (`marketing/blotato/…`), **MIX** (`marketing/avanzado/automaticas`: en el menú se llama `automaticas`) y la **Copiadora de estilos** (`marketing/avanzado/estilos`). Cada commit quita su fila de `HOJAS_AUN_PLANAS` (`web/src/marca/estudio.test.ts`, que ya lo exige) y la dirección plana de antes tendría que seguir llevando a la nueva con un 302, como hoy `/estudio/inicio/` (`alias_del_estudio()` lo deduce de `PANTALLAS[p].nueva`). Las pantallas que el mapa no tiene (admin, clip, crear, imágenes, shorts, subir) se quedan planas (`PLANAS`). **Hecho:** un commit por hoja, en ese orden; cada dirección plana es un 302 relativo a su anidada, con el query intacto y `no-store` (`tests/test_web_niveles.py`, con la app y el dist de verdad, y «las direcciones de antes» de `web/e2e/niveles.spec.ts`). La tabla transitoria se retiró vacía con la última hoja: la reemplaza `rutas.cada_hoja_tiene_su_carpeta.ya_no_queda_ninguna_hoja_plana`. El menú de las cinco de Marketing (en `nueva`) sigue enlazando su URL vieja (`/agenda.html`…), que decide el interruptor |
| **E8 · retirar la deuda de E5.3** ✅ (1-nov-2026, E8.1 a E8.8) | `Inicio.tsx`, `Recorrido.tsx` y `estadoRecorrido.ts`: el inicio de una sola página que ya ninguna página monta (el recorrido en página, `?desde=&ver=`, la `hoja` y su «Volver a …») | Antes de borrar, llevar a su lugar lo que la caja y las páginas de nivel todavía les toman (la caja se pinta con `Recorrido`; las migas, Esc y la guarda del doble clic salen de `estadoRecorrido.ts`) y mudar a la página del grupo las pruebas `inicio.menu.*` e `inicio.blotato.*` sin cambiar su ID (`tests/test_migracion_ui.py` las exige). **Hecho:** `areaDe` y `grupoDe` a `marca/menu.ts`, la guarda del doble clic a `niveles/dobleClic.ts`, la llegada a `inicio/llegada.ts`, las migas y Esc a `niveles/navegar.ts` (`migasDeNivel`, `escapeDeNivel`); los 17 IDs y la suelta de UI·24 a `niveles/PaginaGrupo.test.tsx`; la caja con su propio marco en `niveles/PaginaHerramienta.tsx` (mismo DOM; ya no pide `/api/blotato?redes=0` al cargar); y después los tres archivos y sus pruebas muertas, con lo vivo mudado antes. El detalle, en `docs/migracion/inicio.md` § «Lo que quedaba». Queda vivo sin uso, para E9: `enVista` de `Caja`, el modo botón de `Grupos` y `Mapa`, el `alPulsar` de `Migas` y el diálogo que la caja abre con `?blotato=conectar` (quien pide conectar llega al grupo Blotato; a la caja el parámetro solo llega escrito a mano) |
| **E9 · afinado (opcional)** | Lo que el dueño pida después de recorrer E7 y E8 en dev | Sin alcance fijado |
