# Auditoría UI/UX — video-stack (servicio web)

Fecha: 2026-09-03
Superficies analizadas: `static/index.html` (hub), `static/e1.html` (editar y subir), `static/crear.html` (generador de películas), `tools/editor/index.html` (editor de cortes).
Backend contrastado: `server/app.py`, `server/editor.py`, `server/media_api.py`, `server/overlays_api.py`, `server/publicar_api.py`, `PLAN-IMPLEMENTACION.md` (deudas C1–C6).

Contexto del producto: editor de video con Claude como cerebro editorial. Dos caminos: **Editar** (metraje real, corte en editor con chat de Claude, subtítulos, b-roll IA, publicar vía Blotato) y **Crear** (película animada desde un brief, narrada con IA). Se cobra por uso con un monedero de créditos (preparar = 10 cr; producir = ceil(3 × duración_s) cr). Aún no hay autenticación en la UI (usuario piloto fijo) ni pasarela de recarga.

---

## 1. Resumen ejecutivo

### Hallazgos principales

1. **Callejón sin salida en Crear.** Un proyecto que llega a revisión sin opciones de personaje no puede producirse ni retroceder. Los 10 créditos de preparar ya se cobraron.
2. **El monedero es invisible hasta el último botón.** El formulario inicial no muestra saldo ni costo. El 402 (sin saldo) llega como texto plano sin ruta de recarga.
3. **Vocabulario interno filtrado a la interfaz:** e1, s1, b1, b2, b3, g1, fn1, fn2, "clasificar", "concat", "drive", "render FAILED — see server console".
4. **Conflicto de ediciones Claude vs usuario** en el editor de cortes: guardar tras un cambio de Claude sobrescribe su trabajo sin aviso.
5. **Subida de metraje sin progreso ni cancelación** para archivos de cientos de MB, y sin siguiente paso una vez subidos.
6. **Ayuda solo por tooltip de hover** en el editor: atajos y significado de colores no existen para teclado ni pantalla táctil.
7. **Sin cancelación ni lista de proyectos** en Crear: la única forma de volver a una película es la URL con `?p=`.

### Evaluación general

La base es sólida en lo que más importa a un producto que cobra por uso: preview de costo antes de gastar, confirmación explícita antes de publicar, reanudación por URL, undo/redo y aviso al cerrar con cambios sin guardar. Las debilidades están en los bordes: estados de error y de vacío, transparencia del saldo, terminología, y todo lo que no sea un desktop con ratón. El editor de cortes es una herramienta profesional bien pensada para quien ya la conoce, pero hostil para el primer uso.

**Lo que ya está bien y conviene proteger:** costos en dólares antes de cada acción de pago (regenerar recursos IA, b-roll, muestra de voz), confirmación antes de publicar, `history.replaceState('?p=')` para reanudar, `beforeunload` con cambios sucios, undo/redo con snapshots, subida directa a S3 sin pasar por el servidor.

### Conteo por prioridad

| P0 | P1 | P2 | P3 |
|---|---|---|---|
| 2 | 13 | 14 | 4 |

---

## 2. Hallazgos de UI/UX

Prioridades: **P0** bloquea o perjudica gravemente la tarea · **P1** importante, resolver pronto · **P2** mejora relevante · **P3** refinamiento.

| Prioridad | Área | Problema | Evidencia en código | Impacto usuario | Recomendación |
|---|---|---|---|---|---|
| P0 | Crear · revisión | Proyecto sin opciones de personaje no puede avanzar ni retroceder | `crear.html` `renderRevision`: "No se generaron opciones de personaje (¿sin referencia?)"; `#producir` exige `elegida != null`; `app.py producir` → 422 si `url_elegida is None`. `PLAN-IMPLEMENTACION.md` deuda C5-8 | Bloqueo total con 10 créditos ya cobrados. La única salida es "Nueva película", que también pierde el guion | Si no hay opciones: ofrecer "Subir referencia y generar personaje" o "Producir sin personaje" (si el pipeline lo soporta), y devolver créditos si no. Nunca cobrar una etapa que puede terminar en un estado sin salida |
| P0 | Crear · monedero | Sin saldo, el usuario descubre el 402 después de llenar todo el formulario, como texto crudo y sin acción posible | `crear.html`: `if (!r.ok) { $('#ferr').textContent = await errTxt(r); }`; `app.py`: `HTTPException(402, str(e))`. Existe `GET /api/creditos` pero ninguna pantalla lo consume | Frustración y desconfianza: se invierte tiempo en brief y referencias para chocar con un muro. No hay dónde recargar | Cabecera con saldo (consumir `/api/creditos` al cargar), costo de "Escribir el guion" (10 cr) junto al botón, botón deshabilitado con explicación si el saldo no alcanza, estado 402 con CTA "Recargar créditos" (aunque hoy sea "escríbenos" mientras no haya pasarela) |
| P1 | Crear · botón producir | El botón mezcla dos monedas y sigue activo aunque el saldo no alcance | `estimar()`: `"Producir la película → ≈ $1.31 · ~4 min · 90 créditos (saldo 80)"` sin comparar `creditos` vs `creditos_saldo` | Confusión dólares/créditos; el clic termina en 402 después de guardar guion y personaje | Una sola moneda de cara al usuario (créditos) con el equivalente en dólares en secundario; si créditos > saldo, deshabilitar con "Te faltan 10 créditos" |
| P1 | Crear · progreso | Etapas mostradas con nombres internos, sin tiempo estimado ni cancelación | `$('#petapa').textContent = p.etapa` (valores: clasificar, research, guion, tts, media, concat, drive). No existe endpoint de cancelar | El usuario no sabe cuánto falta ni puede parar una producción equivocada que le cuesta créditos | Mapa etapa → texto humano ("Investigando fuentes", "Grabando la voz", "Uniendo escenas") + minutos estimados (ya los devuelve `/estimacion`). Añadir "Cancelar" al menos en preparación |
| P1 | Crear · red | Si el polling falla, la pantalla se congela sin aviso | `refrescar()`: `if (!r.ok) return;` y sin `catch` en el fetch → excepción silenciosa dentro del `setInterval` | Con conexión caída el progreso parece colgado; el usuario recarga o abandona | Contador de fallos consecutivos → banner "Sin conexión, reintentando…" con backoff; al recuperar, refrescar |
| P1 | Crear · error | Reintentar vuelve a cobrar y no se explica qué pasó con los créditos anteriores | `#reintentar` → `POST /producir` (cobra `costo_cr` de nuevo); PLAN: el worker devuelve solo en caminos limpios, un crash a DLQ no devuelve | Miedo a doble cobro; en el peor caso, cobro duplicado real sin explicación | En la pantalla de error mostrar "Se devolvieron N créditos" (o "verificando devolución") y el costo del reintento antes de pulsar. Traducir `p.error` a mensaje humano |
| P1 | Crear · persistencia | Las ediciones del guion, nombre y voz solo se guardan al pulsar Producir | `PUT /guion` y `PUT /personaje` se llaman dentro de `#producir.onclick`; refrescar pierde todo | Un refresh, un cierre de pestaña o el 402 tras editar 10 escenas destruye el trabajo | Autoguardar con debounce (ya existe el patrón en `estimar()`) y `beforeunload` cuando haya cambios pendientes |
| P1 | Crear · navegación | No hay lista de películas previas ni forma de volver a una sin la URL | `GET /api/proyectos` existe pero no se usa; "Nueva película" hace `location.href='/'` | Usuario recurrente pierde su película lista al cerrar la pestaña; no puede descargar después | Sección "Tus películas" en `crear.html` (estado, fecha, brief truncado) y en el hub; botón "Descargar" en resultado |
| P1 | Contenido · global | Códigos internos y spanglish en la interfaz | `e1.html`: "Shorts (s1)", título "Editar · e1"; editor: tooltips "b1: frame de muestra…", "b2: Claude propone…", "b3: descargar (fn1) o agendar (fn2)", "Mode: Edited", "saved: cuts ✓", "render FAILED — see server console", "proxy/manifest length mismatch — rebuild proxy" | Un usuario nuevo no puede interpretar la pantalla; los errores no le dicen qué hacer | Glosario único en español: "Subtítulos", "B-roll con IA", "Publicar", "Vista: editada / cruda", "Guardado", "El render falló: [causa] — vuelve a intentarlo". Retirar los códigos de rebanada del texto visible |
| P1 | Editar · subida | Subida de video sin barra de progreso, sin límite visible, sin cancelar y sin aviso al abandonar | `e1.html subir()`: `fetch PUT` con texto fijo "Subiendo X MB…"; sin progreso XHR, sin `beforeunload`, sin validación de nombre en cliente (el backend rechaza con `_validar_nombre`) | Con 800 MB y conexión doméstica el usuario ve un texto estático durante minutos; cerrar la pestaña rompe la subida sin aviso | `XMLHttpRequest` con `onprogress` (porcentaje + MB + tiempo restante), botón Cancelar (`abort`), `beforeunload` durante la subida, validación del nombre en cliente con el mismo patrón que el backend |
| P1 | Editar · siguiente paso | Tras subir, el proyecto solo ofrece "ver subida" (link externo al CDN); no hay camino para editarlo | `app.py proyectos_edicion`: `editor_listo=False` para proyectos solo-nube ("el cut-editor sobre S3 es deuda C4"); `e1.html fila()`: `<a href=cdn target=_blank>` | Expectativa rota: el copy dice "queda listo para editar" pero no se puede | Cambiar el copy a lo que hoy es cierto ("subido; la edición en nube llega pronto") y mostrar chip "en la nube" con el próximo paso real (`/empezar` local o esperar) |
| P1 | Editor · concurrencia | Guardar después de que Claude modificó `cuts.json` sobrescribe sus cambios | `reloadData()`: si `dirty` → solo `setStatus("…guarda y recarga la página")`; `save()` envía `DATA` completo (copia local antigua) | Se pierde el trabajo de Claude (que costó un turno) o, si recarga sin guardar, el del usuario | Al detectar `cuts_mtime` distinto: bloquear Guardar y ofrecer "Ver cambios de Claude" / "Conservar los míos" con un diff mínimo por clip, o guardar como versión nueva y fusionar en servidor |
| P1 | Editor · ayuda | Toda la ayuda y los atajos viven en tooltips CSS de hover | `[data-tip]:hover::after`; atajos I/O/C solo en el ⓘ de `#tltools`; `#txBar` "click = seek · Shift+click = seleccionar rango · doble click = corregir texto" | Sin ratón no hay ayuda; en el primer uso nadie descubre I/O/C ni el doble clic para corregir texto | Panel "Atajos" abrible con `?` y un botón visible; leyenda de colores permanente bajo el timeline; onboarding de 3 pasos la primera vez (localStorage) |
| P1 | Editor · feedback | Un solo span de estado, truncado a 340 px, mezcla confirmaciones y errores | `#status { max-width:340px; overflow:hidden; text-overflow:ellipsis }` — errores de save, render, selección y conflicto pasan por `setStatus` | Errores largos quedan cortados; los mensajes se pisan y no se sabe si el guardado terminó | Toasts apilables con severidad y duración (error persistente hasta cerrar) y estado de guardado fijo ("Guardado 12:03" / "Sin guardar") |
| P1 | Editor · orientación | El editor no muestra qué proyecto está abierto ni cómo volver | `j.project` solo se usa en `loadNotes()`; no hay enlace a `/e1.html` ni a `/` | Con varios proyectos en pestañas se edita el equivocado; el back del navegador es la única salida | Nombre del proyecto en el header + breadcrumb "Inicio › Editar › video-3" |
| P2 | Crear · formulario | Sin validación en cliente: brief vacío, referencias >4 recortadas en silencio, sin quitar imágenes ni límite de tamaño | `files = [...e.target.files].slice(0,4)`; no hay botón de eliminar en `#thumbs`; el 422 llega del servidor | Ida y vuelta innecesaria; sorpresa de "¿dónde quedó mi quinta imagen?" | Deshabilitar el botón con brief vacío y mensaje inline; contador "3/4 imágenes"; × en cada miniatura; aviso si supera N MB |
| P2 | Crear · costo por duración | El slider de duración define el cobro pero el costo no aparece hasta revisión | producir cobra `ceil(3 × duracion_s)` créditos; el formulario solo muestra "45s" | El usuario elige 60 s sin saber que cuesta 180 créditos frente a 45 por 15 s | Mostrar "45 s ≈ 135 créditos" junto al slider, actualizado en vivo |
| P2 | Crear · escenas | Borrar escena con ✕ es inmediato, sin confirmación ni deshacer; los textareas no tienen etiqueta | `d.querySelector('button').onclick = () => { d.remove(); renum(); }` | Un clic accidental borra 14 palabras redactadas con cuidado | Deshacer inline ("Escena 3 eliminada · Deshacer") durante 5 s; `aria-label="Escena N"` en cada textarea |
| P2 | Crear · voz | El costo de "Escuchar" ($0.01) solo está en el atributo `title` | `<button id="oir" title="Escuchar la escena 1 con esta voz (≈ $0.01)">` | En táctil no existe el tooltip; se gasta sin saberlo (poco, pero rompe la regla "costo antes de gastar") | Texto visible "▶ Escuchar · $0.01 dólares" |
| P2 | Diálogos | Balanceador de rubro y confirmaciones con `confirm()`/`alert()` nativos | `if (confirm(\`⚖️ ${d.balanceador}…\`))`; editor: `alert()` en propuestas b2, `confirm()` en g1, b2 y publicar | No estilizables, bloquean la pestaña, no muestran opciones claras ("Aceptar" ≠ "Crear de todos modos") | Diálogo propio con dos botones nombrados por la acción y el costo en el botón de confirmar |
| P2 | Crear · resultado | Sin botón de descarga; "Abrir en Drive" solo si existe link | `#rlink` solo con `p.resultado.link`; `<video src>` del API sin download | El usuario tiene que saber hacer clic derecho sobre el video | Botón "Descargar MP4" (reutilizar el patrón `descarga/{clave}` del editor) |
| P2 | Editar · lista | Filas no accionables parecen enlaces y la columna de shorts solo da instrucciones | `fila()`: `<a>` sin `href` para "sin corte aún" y "transcript listo — usa /shorts" | Se hace clic y no pasa nada; se aprende que la web "no sirve" para shorts | Filas no accionables como `<div>` con chip de estado y texto "Se edita desde Claude Code con /shorts" con botón "Copiar comando" |
| P2 | Editar · error de carga | Si falla la carga, la columna de shorts queda en "Cargando proyectos…" para siempre | `catch { reel.innerHTML = 'No pude cargar…'; return; }` no toca `#lista-shorts` | Estado inconsistente; sin botón de reintentar | Un solo estado de error para ambas columnas con "Reintentar" |
| P2 | Editor · render | Cualquier error de render se reporta como "render busy"; el progreso es la última línea del log | `if (!r.ok) { setStatus("render busy", "err"); }` — el backend también devuelve 404/500 | Diagnóstico imposible desde la UI; "see server console" no aplica a un usuario del servicio | Leer `detail` del error; progreso con porcentaje si el engine lo emite, o al menos "Render en curso · 2 min" con spinner |
| P2 | Editor · recargas | `location.reload()` tras importar, activar versión o animar pierde posición, panel y selección | `impSeguir`, `g1activar`, `g1animar` → `location.reload()` | Se pierde el contexto de trabajo; con cambios sucios el `beforeunload` interrumpe el flujo | Reutilizar `reloadData()` conservando `currentTime`, panel y zoom |
| P2 | Editor · publicar | Dejar la fecha vacía publica de inmediato; la zona horaria no se indica | "Sin fecha = publicar de inmediato."; `datetime-local` → `toISOString()` | La opción más irreversible es el default por omisión; la hora puede no ser la que el usuario cree | Radio explícito "Publicar ahora / Programar" (programar por defecto); zona horaria del navegador visible junto al campo |
| P2 | Editor · subtítulos | El frame de muestra se toma del instante actual sin decirlo; ver el export sustituye el video del editor | `b1flujo()`: `frame = Math.round(vid.currentTime*10)/10 \|\| 10`; `b1ver`: `vid.src = "ver/subtitulado"` + "recarga la página para volver a editar" | Muestra en un frame negro o irrelevante; después el editor queda en un estado de solo-ver confuso | Texto "Muestra en el segundo 34 (posición actual)"; abrir el export en un modal o pestaña, no en el player de edición |
| P2 | Editor · fluff | Las sugerencias de relleno no tienen botón "Aplicar"; hay que seleccionar palabras y cortar a mano | `showFluff()`: "Para aceptarla: selecciona sus palabras/bloques y córtalos. Para rechazarla: ignórala." | Tres acciones para aceptar una sugerencia que el sistema ya calculó | Botones "Aplicar" / "Descartar" en el detalle de la sugerencia (crea el cut manual con s/e de la sugerencia) |
| P2 | Editor · dispositivos | Solo ratón y solo desktop: drag con `mousedown`, alturas fijas, `overflow: hidden` | `inner.addEventListener("mousedown"…)`; `#timeline { height:266px }`; `body { overflow:hidden }`; sin media queries | Inutilizable en tablet o pantalla estrecha; aceptable como herramienta pro si se declara | Al menos pointer events (`pointerdown/move`) para trackpad y lápiz, y aviso "Usa una pantalla de al menos 1024 px" en lugar de una UI rota |
| P2 | Hub | El hub no muestra estado ni saldo; los títulos de pestaña difieren entre páginas | `index.html` "Edición y generación", `crear.html` "Estudio de video", `e1.html` "Editar · e1" | Sin sensación de un solo producto; no se sabe si hay algo en curso | Nombre único del producto en todos los `<title>`; en el hub: saldo, "1 película produciéndose", últimos proyectos |
| P3 | Formato | Precios sin la palabra "dólares" en `crear.html`; la regla del repo (CLAUDE.md) la exige | `` `≈ $${c.total.toFixed(2)}` `` vs `usd()` del editor → "$0.02 dólares" | Ambigüedad de moneda para audiencia LATAM ("$" = peso) | Reutilizar un formateador único |
| P3 | Editor · notas | Las notas de flags viven en localStorage: cambiar de navegador las pierde sin aviso | `NOTES_KEY = "fnotes:" + project; persistNotes() → localStorage` | Trabajo perdido en escenarios multi-dispositivo | Guardarlas en `cuts.json` como campo `nota_usuario`, o avisar que son locales |
| P3 | Editor · chat | El aviso de login es un párrafo largo dentro del chat | `chatLoginPrompt()`: texto de 4 líneas con instrucciones de terminal | Ruido en el hilo; el comando no es copiable | Tarjeta corta con botón "Copiar `claude /login`" y estado en vivo |
| P3 | Editor · deep link | Abrir `/editor/{name}/` sin `cuts.json` devuelve JSON crudo | `editor.py`: `HTTPException(404, "…corre /clean-cut o el puente del generador")` | Pantalla de JSON para un enlace guardado | Página HTML "Este proyecto aún no tiene corte" con el paso siguiente |

---

## 3. Problemas de accesibilidad

- **Idioma incorrecto en el editor.** `<html lang="en">` con toda la interfaz en español: los lectores de pantalla la pronuncian en inglés. Cambiar a `lang="es"`.
- **Botones solo con ícono sin nombre accesible.** ↩ ↪ ][ ⌫[ ]⌫ 🗑 ➤ ▶ ✕ en el editor; ✕ de escenas en `crear.html`. Añadir `aria-label` ("Deshacer", "Dividir bloque en el cursor", "Quitar escena 3").
- **Ayuda solo en hover.** `[data-tip]:hover::after` no se muestra con foco ni en táctil. Mostrarlo también en `:focus-visible` y ofrecer la misma información en un panel.
- **Sin estado de foco visible.** Ni el editor ni `crear.html` definen `:focus-visible`; solo hay estilos de hover. Navegar con Tab no muestra dónde se está.
- **Chips de estado sin semántica.** Modo, estilo y flags usan clases `.on/.active` visuales; falta `aria-pressed` o un grupo radio. Las opciones de personaje son `<img>` clicables sin rol ni teclado.
- **Información solo por color.** Categorías de corte (rojo/naranja/ocre/morado) y palabras tachadas coloreadas; el semáforo de voces usa puntos de color (el emoji en el `<select>` sí ayuda). Añadir texto o patrón (borde, etiqueta) además del color.
- **Contraste insuficiente en texto pequeño.** `#6f6d66` sobre `#1d2026` en `e1.html` (`.vacio`, `.nota`, 12.5 px) ronda 3.2:1, por debajo de AA para texto normal. Los textos de 10–11 px del timeline en `--dim` están al límite.
- **Timeline sin alternativa de teclado ni anuncios.** El drag de bordes solo funciona con ratón; `#status` no tiene `aria-live`, así que los errores no se anuncian.
- **Formularios sin etiquetas.** Textareas de escenas, input de nombre de proyecto y de rubro dependen del placeholder, que desaparece al escribir. Usar `<label>` visibles o `aria-label`.
- **Modales sin gestión de foco.** g1, b1 y b3 no atrapan el foco, no cierran con Escape ni devuelven el foco al disparador. `<dialog>` nativo resuelve los tres.
- **Sin `prefers-reduced-motion`.** Barras con transición y scroll suave del karaoke (`scrollIntoView({behavior:"smooth"})`) no se desactivan.

---

## 4. Estados y casos de uso faltantes

### Usuario nuevo que abre el hub
- **Qué ocurre:** dos tarjetas ("Editar", "Crear") sin contexto de qué requiere cada una ni cuánto cuesta. "Editar" lleva a listas vacías con instrucciones de terminal.
- **Riesgo:** abandono en el primer minuto; no distingue que "Editar" depende de Claude Code local y "Crear" de créditos.
- **Recomendado:** subtítulo por tarjeta con el requisito ("necesita metraje propio" / "consume créditos: desde 55 por película") y un estado vacío en Editar con los dos caminos: subir metraje aquí o correr `/empezar`.

### Saldo insuficiente (402)
- **Qué ocurre:** texto de error plano bajo el botón; en producir, después de haber guardado guion y personaje.
- **Riesgo:** sensación de muro; no hay forma de recargar (los abonos son por CLI admin).
- **Recomendado:** estado propio "Te faltan N créditos" con saldo, costo y CTA de recarga o contacto; deshabilitar de antemano cuando el saldo se conoce.

### Datos vacíos o incompletos en revisión
- **Qué ocurre:** sin opciones de personaje → bloqueo (P0). Sin voces → se inventa `{id:'George', nivel:'amarillo', motivo:'sin recomendación'}`. Sin dossier → tarjeta oculta (bien).
- **Riesgo:** callejón sin salida y voz por defecto que el usuario no eligió.
- **Recomendado:** cada bloque con estado vacío accionable; nunca un default silencioso en algo que se cobra.

### Pérdida de conexión durante progreso, subida o render
- **Qué ocurre:** progreso congelado sin aviso; subida falla con "Error: Failed to fetch"; los polling de render, subtítulos e importación lanzan excepciones no capturadas dentro de `setInterval`.
- **Riesgo:** el usuario no sabe si el trabajo sigue en el servidor (sí sigue) y recarga o vuelve a lanzar, duplicando costos.
- **Recomendado:** banner de conexión con reintento automático; texto "La producción sigue en la nube, puedes cerrar esta pestaña y volver con este enlace".

### Doble clic y acciones duplicadas
- **Qué ocurre:** los botones se deshabilitan durante el fetch (bien). El backend reconoce una ventana de doble cobro en producir (PLAN deuda C5-4). "Quemar" y "Animar" se deshabilitan; "Sugerir títulos" y "Escuchar" no protegen contra repetición rápida.
- **Riesgo:** cobro doble en el peor caso; llamadas LLM/TTS repetidas.
- **Recomendado:** idempotency key por clic en las acciones con costo y deshabilitar todos los botones de pago mientras haya una petición viva.

### Cancelación
- **Qué ocurre:** no existe en ningún flujo: ni preparar, ni producir, ni subida, ni render, ni turno de Claude.
- **Riesgo:** un brief equivocado se produce completo (hasta 180 créditos) sin poder detenerlo.
- **Recomendado:** "Cancelar" en preparación (barato) y en producción mientras esté en cola/casting; `abort` de la subida; "Detener" el turno del chat.

### Sesión expirada / sin permisos / permisos parciales
- **Qué ocurre:** no hay autenticación en la UI: usuario piloto fijo y endpoints abiertos (deuda C1). No es evaluable en el código actual.
- **Riesgo:** cuando llegue Cognito, cada fetch puede devolver 401 en mitad de un polling y hoy ningún handler lo distingue de un error genérico.
- **Recomendado:** centralizar fetch en un helper que trate 401 (redirigir a login conservando `?p=`) y 403 ("no tienes acceso a este proyecto").

### Refresh, back/forward y deep links
- **Qué ocurre:** Crear reanuda con `?p=` (bien) pero pierde ediciones; hub y e1 no tienen estado; el editor pierde selección y posición al recargar; `/editor/{name}/` sin corte devuelve JSON.
- **Riesgo:** trabajo perdido y enlaces guardados que fallan de forma fea.
- **Recomendado:** autoguardado en Crear; posición del playhead en URL o localStorage del editor; página HTML de 404 con el siguiente paso.

### Cambios concurrentes (Claude vs usuario, dos pestañas)
- **Qué ocurre:** se detecta por mtime solo tras un turno de chat; guardar sobrescribe. Dos pestañas del mismo proyecto se pisan sin aviso.
- **Riesgo:** pérdida silenciosa de decisiones editoriales.
- **Recomendado:** enviar el mtime base en `/api/save` y rechazar con 409 si cambió; en UI ofrecer fusionar o ver diferencias.

### Contenido extremo
- **Qué ocurre:** brief de 5000 caracteres → escenas de más de 14 palabras marcadas solo en ámbar; guion de 40 escenas en un scroll interno; videos de 1 h en el timeline con zoom mínimo 4 px/s (14 400 px de ancho, funciona). Título de post de Blotato sin límite por plataforma.
- **Riesgo:** costo mayor por escenas partidas sin que el usuario lo entienda; post rechazado por longitud.
- **Recomendado:** aviso inline "Esta escena se partirá en 2 (+N créditos)"; contador de caracteres por plataforma en publicar.

### Formatos regionales
- **Qué ocurre:** costos en "$" sin unidad en `crear.html`; fecha de publicación sin zona; segundos con punto decimal.
- **Riesgo:** audiencia LATAM: "$" puede leerse como peso; el post sale a otra hora.
- **Recomendado:** "dólares" explícito (regla del repo) y zona horaria visible.

---

## 5. Flujo ideal

### Crear una película
1. **Hub con contexto.** Veo mi saldo, mis películas recientes y qué cuesta empezar una nueva.
2. **Brief con costo en vivo.** Mientras muevo la duración veo "45 s ≈ 135 créditos + 10 de guion". El botón dice "Escribir el guion · 10 créditos" y se deshabilita con explicación si no alcanza.
3. **Progreso legible y abandonable.** "Investigando fuentes (2 de 6 pasos, ~3 min)". Puedo cancelar y puedo cerrar la pestaña: el enlace me trae de vuelta.
4. **Revisión con autoguardado.** Edito escenas, elijo voz (con costo visible) y personaje; si no hay opciones, subo una referencia desde aquí. Todo se guarda solo.
5. **Producir con una sola cifra.** "Producir · 135 créditos (te quedan 200) · ~4 min". Confirmación con el resumen.
6. **Resultado accionable.** Ver, descargar, abrir en Drive, publicar, y volver a la lista.

### Editar metraje
1. **Lista con estados claros.** Cada proyecto con chip ("subido", "transcrito", "con corte", "publicado") y el siguiente paso como botón o comando copiable.
2. **Subida con progreso y cancelar.** Porcentaje, tiempo restante, aviso si cierro la pestaña, y al terminar el paso siguiente real.
3. **Editor orientado.** Nombre del proyecto, enlace de vuelta, leyenda de colores visible, atajos con `?`, estado de guardado permanente.
4. **Decisiones sin colisión.** Si Claude cambió el corte, lo veo antes de guardar y elijo.
5. **Exportar y publicar.** Subtítulos con muestra en el frame que elijo; publicar con "Programar" por defecto y hora con zona.

---

## 6. Recomendaciones priorizadas

### Quick wins (alto impacto / bajo esfuerzo)
- Saldo y costo de preparar en `crear.html` (ya existe `/api/creditos`).
- Deshabilitar Producir cuando créditos > saldo; una sola moneda visible.
- Mapa de etapas a texto humano y estimación de minutos.
- Salida para "sin opciones de personaje" (botón para subir referencia o devolver créditos).
- `lang="es"`, `aria-label` en botones de ícono, `:focus-visible`.
- Retirar códigos e1/s1/b1/b2/b3/g1/fn1/fn2 del texto visible; mensajes de error en español.
- Nombre del proyecto y enlace de vuelta en el editor.
- "Programar" como default en publicar y zona horaria visible.
- Estado de error único con "Reintentar" en e1.

### Mejoras de producto (impacto medio/alto / esfuerzo medio)
- Autoguardado del guion, voz y personaje en revisión.
- Subida con progreso real, cancelar y `beforeunload`.
- Lista "Tus películas" y descarga en resultado.
- Banner de conexión y polling resiliente en todos los intervalos.
- Panel de atajos y leyenda permanente en el editor; onboarding de primer uso.
- Toasts con severidad y estado de guardado fijo.
- Botones Aplicar/Descartar en sugerencias de relleno.
- Diálogos propios en lugar de `confirm()`/`alert()`, con costo en el botón.
- Pantalla de error con devolución de créditos explicada.

### Cambios estructurales (alto impacto / mayor esfuerzo)
- Cancelación real de preparar/producir/render/turno de chat (endpoints + UI).
- Control de concurrencia en `/api/save` (mtime base → 409) y UI de fusión.
- Sección de monedero: movimientos, packs y recarga (depende de la pasarela pendiente).
- Camino de edición para proyectos solo-nube (hoy "deuda C4"), o retirar la promesa del copy.
- Helper de fetch con manejo de 401/403 antes de exigir login Cognito.
- Pointer events y layout mínimo para tablet en el editor, o gate explícito de desktop.

---

## 7. Preguntas abiertas

- ¿El pipeline soporta producir sin personaje (modo idea sin referencias)? Cambia si el P0 se resuelve con un camino alterno o con devolución de créditos.
- ¿Cuándo habrá pasarela de recarga? Define si el 402 lleva a un flujo de pago o a un contacto.
- ¿El editor de cortes va a exponerse a usuarios del servicio en nube o solo a quien corre Claude Code local? Cambia cuánto invertir en onboarding y en mensajes tipo "see server console".
- ¿Se puede cancelar una ejecución de Step Functions/Fargate a mitad y devolver créditos proporcionales? Define el alcance de "Cancelar".
- ¿La web va a cubrir shorts en algún momento o seguirá siendo solo terminal? Define si la columna de shorts debe existir en e1.

---

## 8. Conclusión

Primero hay que cerrar los dos P0 porque tocan dinero: dar salida al proyecto sin personaje y hacer visible el saldo antes de gastar. Después, en la misma semana, la tanda de quick wins de contenido y accesibilidad (idioma, etiquetas, códigos internos, etapas humanas), porque son cambios de texto y atributos con impacto directo en el primer uso. La tercera prioridad es proteger el trabajo del usuario: autoguardado en revisión, subida con progreso y control de concurrencia en el editor. Todo lo estructural (cancelación, monedero completo, edición en nube) depende de decisiones de producto que están en las preguntas abiertas.
