# PLAN-PRODUCTO.md — mejoras del servicio, por fases

Fecha: 2026-09-03. Fuentes: auditoría [docs/UX-REVIEW.md](docs/UX-REVIEW.md),
decisiones del usuario (2026-09-03) y deudas C1–C6 de
[PLAN-IMPLEMENTACION.md](PLAN-IMPLEMENTACION.md). Este plan cubre **producto y
experiencia**; la infraestructura base (A/B/C) ya está desplegada.

Regla de oro heredada: ningún gasto apreciable sin confirmación; tarifas SOLO de
`tools/tarifas.json`; precios en dólares SOLO de `tools/pricing.json`.

## Decisiones tomadas (2026-09-03)

1. **Pasarela: Stripe US + Payment Links.** Revisable después (MoR si el frente
   fiscal duele). Documentado en docs/ECONOMIA.md §8.
2. **Inscripción: sin auto-registro.** Cuentas provisionadas por el dueño
   (correo + contraseña provisional de Cognito; el miembro la cambia al primer
   login). Para la prueba: alta por CLI en la consola del dueño. La
   sincronización automática con la comunidad (bot en VPS que da de alta a
   miembros activos y suspende churn) es una fase posterior.
3. **Personaje sin imagen de referencia: se generan 2 opciones nuestras** a
   partir del guion, y el usuario elige o pide modificaciones (como en el
   editor). Nunca más un proyecto cobrado sin salida.
4. **Muestra de voz con texto fijo**: "Hola, mi nombre es {nombre} y seré tu
   locutor." — se genera UNA vez por voz, se cachea global (no por proyecto) y
   escuchar voces pasa a costar $0 marginal.
5. **Dashboard de costes: lo construimos nosotros** (página admin sobre datos
   que ya tenemos en Postgres + Langfuse + S3). Sin herramienta externa por
   ahora: Aurora vive en VPC aislada sin acceso público, así que Metabase/
   Grafana necesitarían más infra de la que ahorran.
6. **Editor en nube escalonado**: M7 sale primero SIN chat; el chat se integra
   después, con tests de medición de gasto real (Langfuse) antes de fijar su
   precio en créditos por turno.
7. **Prompts gestionados en Langfuse**: el dueño edita los prompts en la UI de
   Langfuse y el pipeline los toma en la llamada (con caché y fallback a los
   .md del repo). Ver fase M10.

---

## Fase M1 — Dinero y desbloqueo (P0 de la auditoría) — CÓDIGO LISTO 2026-09-03

Lo único que hoy cobra créditos y puede dejar al usuario sin nada a cambio.

- [x] **Personaje sin referencia** (`pipeline/flow.py`, `pipeline/character.py`):
      en `_preparar`, sin referencias, `describir_desde_guion` (LLM, prompt
      `personaje_guion_system.md`) + `preparar_personaje_sin_ref` (2 opciones
      con Nano Banana, subidas a fal para el pipeline). Entra en los 10 cr de
      preparar; si falla NO tumba preparar — la UI ofrece reintentarlo gratis
      con `POST /personaje/generar`. Validado en vivo (local, ~$0.09 dólares).
- [x] **Modificar opción** en revisión: `POST /personaje/modificar`
      {instruccion} → grok edit sobre la elegida; cobra imagen estándar (2 cr de
      `tarifas.json`), devuelve en fallo, y la versión nueva se AGREGA (nunca se
      borra). UI: caja "pide un cambio" + botón "Cambiar · 2 créditos".
- [x] **Reparar los proyectos varados** — HECHO 2026-09-04: 19fde9f1
      (semmelweis, script local contra Aurora) y f0afcc84 (limoncito) +
      fcab9e66 (tucidides) vía `POST /personaje/generar` EN AWS — el endpoint
      respondió en ~16-17 s, dentro de los 29 s de API Gateway: la deuda M1-1
      queda resuelta en la práctica con fal (Google tardaba ~90 s). Los tres
      proyectos quedaron en revisión con 2 opciones, imágenes servidas por
      CDN, saldo intacto (70 cr — gratis como promete la tarifa).
- [x] **Monedero visible**: `static/monedero.js` compartido en hub/crear/e1 —
      saldo de `GET /api/creditos`, refresco al volver el foco y tras cada
      acción con costo; CTA "Recargar" con los packs de `tarifas.json` (el API
      ahora también devuelve `packs` y la tarifa `imagen`).
- [x] **Costo encima de cada botón**: "Escribir el guion → · 10 créditos",
      "Producir → N créditos (te quedan M)"; deshabilitado con "te faltan N
      créditos" ANTES del 402. Una sola moneda (créditos); dólares en
      secundario con la palabra "dólares".
- [x] **402 humano**: el mensaje del monedero + CTA de recarga en crear,
      producir, reintentar y modificar.
- [x] **Muestra de voz cacheada**: `GET /api/voces/{voz}/muestra`, texto fijo
      "Hola, mi nombre es {nombre} y seré tu locutor.", caché global (S3
      `voces/<voz>.mp3` en AWS, `media/voces/` local). Validado en vivo:
      1ª llamada genera (3.1 s), 2ª sale del caché (4 ms). El endpoint viejo
      por-proyecto (que regeneraba por texto) se retiró.

**M1 DESPLEGADA Y VERIFICADA EN AWS (2026-09-04)**. Smoke: /api/creditos con
tarifa imagen + 3 packs; muestra de voz George generada una vez (4.3 s) y
servida de caché S3/CDN (0.4 s); tres proyectos varados reparados con 2
opciones cada uno (ver arriba); imágenes por CDN; saldo 70 cr intacto.
Deuda M1-1 (timeout 29 s del botón) resuelta en la práctica: con fal el
endpoint responde en ~16 s. Gasto del smoke ~$0.28 dólares (voz $0.01 +
3 reparaciones ~$0.09 c/u).

## Fase M2 — Acceso: login y altas (cierra deuda C1) — CÓDIGO LISTO (2026-09-04, falta deploy)

- [x] **`tools/usuarios.py`** (espejo de `tools/creditos.py`):
      `alta correo --plan mensual|anual` → `admin_create_user` en Cognito
      (correo = username, contraseña provisional que Cognito envía por email,
      cambio forzado al primer login) + fila en `usuarios` + abono de cortesía
      100/200 (de tools/tarifas.json) en el mismo comando. `suspender correo`
      deshabilita Y revoca sesiones (global sign-out — lo que llamará el VPS en
      churn); `reactivar`, `lista`, `alta --reenviar` (reenvía la provisional
      sin re-abonar) y `adoptar correo --de piloto` (migra proyectos, versiones,
      costes, movimientos y saldo del id viejo al sub real — sin esto, el
      dueño perdería de vista sus 70 créditos y proyectos al encender el login).
- [x] **Exigir JWT** del pool `us-east-1_WyPvxnj1V` + Hosted UI con
      Authorization Code + PKCE. Self-signup sigue deshabilitado. CAMBIO sobre
      lo planeado: la exigencia vive EN LA APP (`server/auth.py`, middleware
      que valida RS256 contra el JWKS en /api/* y /editor/*), no en un
      authorizer de API Gateway — los `<img>/<audio>/<video>` piden
      /api/.../archivo/... sin poder adjuntar el header Authorization y el
      authorizer solo lee headers; el token viaja por header (fetch) o cookie
      (tags de media). Mismo resultado, testeable en local. El stack cablea
      COGNITO_POOL_ID/CLIENT_ID/DOMINIO y los callback/logout URLs reales.
- [x] **Helper de fetch** (`static/auth.js`, primer script de cada página):
      adjunta el token, 401 → refresca el token y reintenta una vez o redirige
      al Hosted UI conservando la URL (incluye `?p=`), 403 → "no tienes acceso
      a este proyecto". `static/callback.html` canjea el code (PKCE) directo
      contra Cognito. Dev local: /api/auth/config responde activo=false y nada
      cambia.
- [x] **user_id real** end-to-end: `db.usuario_actual()` ahora lee un
      contextvar que fija el middleware con el `sub` del token (workers siguen
      con DEFAULT_USER_ID por proceso); monedero, trazas y claves SSM ya
      estaban indexadas por ese valor — cae el `piloto` fijo.
- [ ] Con el login desplegado, **ya se puede compartir la URL**.

Requiere: 1 `cdk deploy` del usuario al final (aws-media-api; la imagen nueva
del CI antes). Después del deploy: `alta` del dueño + `adoptar` para quedarse
con sus proyectos/saldo, y smoke: URL sin token → login → volver con sesión.
Deuda M2-1: CloudFront sirve el media a quien tenga la URL exacta (el listado
sí exige login); URLs firmadas del CDN quedan para una fase posterior.
Tests: 21 nuevos en tests/test_m2_login.py (162 en total, verdes).

## Fase M3 — UX quick wins (texto y accesibilidad, cero riesgo)

Tanda de la auditoría §6 "quick wins" que son texto/atributos:

- [ ] `lang="es"` en el editor; `aria-label` en botones de ícono; `:focus-visible`.
- [ ] Retirar códigos internos del texto visible (e1/s1/b1/b2/b3/g1/fn1/fn2);
      errores en español con acción ("El render falló: [causa] — reintenta").
- [ ] Etapas humanas con minutos ("Investigando fuentes · ~3 min") usando lo que
      ya devuelve `/estimacion`.
- [ ] Título de producto unificado en los `<title>`; nombre del proyecto y
      enlace de vuelta en el editor.
- [ ] "Programar" como default en publicar + zona horaria visible.
- [ ] Estado de error único con "Reintentar" en e1; leyenda de colores y panel
      de atajos (`?`) en el editor.

## Fase M4 — Recarga con Stripe

Prerrequisito: cuenta Stripe de la LLC; **las claves las crea y coloca el
usuario** en .env/SSM (nunca por chat). Diseño ya escrito en docs/ECONOMIA.md §8:

- [ ] 3 Payment Links (packs 100/500/1,200) con `client_reference_id` = user_id.
- [ ] Webhook `checkout.session.completed` → endpoint en la API → abono
      idempotente por referencia en `monedero_movimientos` (Stripe reintenta).
- [ ] Página/sección "Recargar" enlazada desde la cabecera del saldo y del 402.
- [ ] Decidir el ajuste del pack grande ($19.99 o piso $0.0165 neto) al ver las
      comisiones reales del primer mes.
- [ ] Etapas: concierge → webhook automático (lanzamiento gradual).

## Fase M5 — Proteger el trabajo del usuario

- [ ] Autoguardado con debounce de guion/nombre/voz/personaje en revisión +
      `beforeunload` (hoy solo se guarda al pulsar Producir).
- [ ] Subida con progreso real (`XMLHttpRequest.onprogress`), cancelar,
      `beforeunload` y validación de nombre en cliente.
- [ ] Polling resiliente en todos los `setInterval` (contador de fallos → banner
      "Sin conexión, reintentando…"; texto "la producción sigue en la nube").
- [ ] Lista "Tus películas" en crear.html y el hub (`GET /api/proyectos` ya
      existe) + botón "Descargar MP4" en resultado.
- [ ] Pantalla de error que explique la devolución de créditos y el costo del
      reintento antes de cobrar de nuevo.
- [ ] Idempotencia de clic en acciones con costo (deuda C5-4).

## Fase M6 — Dashboard de costes (admin)

Página `static/admin.html` + `GET /api/admin/resumen`, visibles solo para el
grupo `admin` de Cognito (por eso va después de M2):

- [ ] **Por usuario**: créditos gastados/comprados (tablas `monedero_movimientos`),
      costo de inferencia en dólares (tabla `costes`, alimentada por
      `tools/costes.py sync` — programar el sync, p. ej. EventBridge diario),
      almacenamiento S3 por prefijo de usuario, nº de películas, y el **margen**
      (créditos cobrados × precio − costo IA).
- [ ] **Por corrida**: drill-down usuario → proyecto/sesión con su costo real,
      créditos cobrados y duración (la tabla `costes` ya guarda proyecto + traza;
      el detalle fino enlaza a la traza en Langfuse). Insumo directo de los
      focus groups: qué costó exactamente cada sesión de prueba.
- [ ] **General**: totales del periodo, top usuarios, curva de gasto.
- [ ] **Infra AWS**: no se atribuye por usuario (no es posible nativamente y es
      <2% del variable); enlace al presupuesto de $50/mes y Cost Explorer por
      servicio. Si algún día hace falta el número fino: línea estimada de infra
      por producción (segundos Fargate × tarifa) en la tabla `costes`.
- [ ] Si el volumen crece y la página se queda corta: evaluar QuickSight o
      Metabase (requeriría abrir acceso a Aurora — hoy no lo vale).

## Fase M7 — Editor de cortes en la nube (deuda C4)

Cómo funciona hoy: el editor (`tools/editor/index.html`) lo sirve el FastAPI
**local** leyendo del disco (proxy MP4, `cuts.json`, transcript), y el chat
editorial es Claude Code corriendo en la máquina del usuario. En la nube:

- [ ] **Artefactos a S3**: proxy MP4 y transcript por CloudFront (ya hay bucket
      + OAC de C3); `cuts.json` versionado en Postgres (o S3 con versión) por
      proyecto/usuario.
- [ ] **UI servida por la API Lambda** (es estática, igual que crear.html) con
      los endpoints de load/save apuntando a S3/Postgres.
- [ ] **Save con control de concurrencia**: la UI manda la versión base y el
      server responde 409 si cambió (resuelve también el P1 "Claude vs usuario"
      de la auditoría).
- [ ] **Render del corte = job**: SQS → worker/Fargate con ffmpeg (la imagen de
      A4 ya trae ffmpeg), resultado a S3, la UI hace poll. Nada de render en la
      Lambda de 29 s.
- [ ] **El chat editorial en nube** es la pieza nueva de verdad y va DESPUÉS
      (decisión 2026-09-03): el editor sale primero sin chat (cortar/guardar/
      render), y el chat sigue siendo exclusivo de quien corre Claude Code
      local — el copy lo dice tal cual.
- [ ] **Chat, etapa 2 — medir antes de tarifar**: prototipo con backend de
      agente (nuestra key), corridas de prueba medidas en Langfuse (tokens y
      dólares por turno) y con eso se fija el precio en créditos por turno.
      Números de servilleta como base de diseño (2026-09-03): ~$0.03–0.10
      dólares por turno según modelo (Sonnet vs Opus) y contexto → apunta a
      2–7 cr/turno o un pase plano por sesión. Palanca principal: contexto
      compacto (segmentos, no palabra-por-palabra, ~5× más barato). Sesión
      completa estimada: sin chat ~$0.35–0.75; con chat ~$0.90–2.30.
- [ ] Costo base sin chat por video de 20 min: transcripción $0.09 (AssemblyAI,
      pricing.json) + renders Fargate $0.10–0.30 + CloudFront/S3/Aurora
      ~$0.20–0.45. Solo la transcripción quema dinero por acción → entrada
      nueva en `tarifas.json` (~2 cr por cada 5 min de metraje la cubre).

## Fase M8 — Shorts en la web

Hoy shorts es solo terminal (`/shorts`: transcribe → Claude puntúa candidatos →
el usuario elige → Remotion quema captions → export 9:16). La versión web
reutiliza las piezas de C3/C4:

- [ ] **Subir longform** (ya existe: presign → S3) → **job de transcripción**
      (worker SQS; backend según config, con preview de costo si es nube).
- [ ] **Job de candidatos**: LLM puntúa segmentos y guarda la lista en Postgres.
- [ ] **UI de selección** en e1: lista de candidatos con transcript, ajustar
      inicio/fin, elegir estilo de caption — la parte interactiva del skill,
      ahora con botones.
- [ ] **Render en Fargate**: Remotion headless (la imagen de A4 ya trae Node y
      Chromium) + `export.sh` → S3 → descargar o publicar vía Blotato.
- [ ] Tarifas: transcripción y render de shorts queman dinero → entrada nueva en
      `tools/tarifas.json` (definir con pricing.json antes de encender).
- [ ] Mientras M8 no llegue: la columna de shorts en e1 dice la verdad ("se
      edita desde Claude Code con /shorts" + botón copiar comando) — eso es M3.

## Fase M9 — Automatización de membresías (bot en VPS)

- [ ] Servicio pequeño (VPS o Lambda programada) con secretos propios que
      consulta la plataforma de la comunidad, y por diferencia: alta de miembros
      nuevos (`usuarios.py alta`), suspensión de bajas/churn.
- [ ] **Pregunta abierta**: ¿en qué plataforma vive la comunidad y tiene API o
      webhooks (Skool, Circle, Discord…)? Con API/webhook es un día de trabajo;
      sin ella habría que raspar la lista de miembros, que es frágil — decidir
      cuando toque.
- [ ] Política de gracia para churn (no borrar: suspender; los créditos
      comprados no caducan — regla de ECONOMIA.md).

## Fase M10 — Prompts gestionados en Langfuse

Objetivo: el dueño edita los prompts en la UI de Langfuse (Prompt Management,
versionado con label `production`) sin tocar código ni redesplegar; el pipeline
los toma al hacer la llamada. La arquitectura ayuda: los ~10 prompts ya son
`.md` cargados por nombre vía `pipeline/config.py::load_prompt`, y todas las
llamadas LLM pasan por `pipeline/llm.py::chat_json(name, system, user)`.

- [ ] `tools/prompts_sync.py`: sube los `.md` actuales a Langfuse como versión
      inicial (mismo nombre que usa `load_prompt`).
- [ ] `load_prompt` intenta Langfuse primero (`get_prompt(name,
      label="production")`, caché con TTL del SDK) con **fallback al `.md`
      local** si Langfuse no responde — el pipeline jamás se cae por un prompt.
- [ ] Conservar el templating actual de Python (`.format(**datos)` en
      guionista/editor): se trae el texto crudo y se formatea local — los
      placeholders `{var}` no cambian.
- [ ] Enlazar la versión del prompt a cada generation (el wrapper de Langfuse
      acepta `langfuse_prompt=`): así el dashboard de Langfuse cruza **versión
      de prompt × costo × calidad** — ideal para iterar tras cada focus group.
- [ ] Riesgo a vigilar: un prompt editado en producción sin pasar por tests.
      Mitigación: los tests corren contra los `.md` del repo, y el label
      `production` solo se mueve a mano en Langfuse; documentar "editar →
      probar en una película propia → promover label".

## Fase M11 — Narración primero (guion continuo → TTS → escenas)

Decisión del usuario 2026-09-04: invertir el orden del pipeline de Crear, como
en un documental real — la imagen se corta SOBRE la voz, no al revés. Arregla
de raíz la escritura entrecortada (auditoría + queja del usuario), la
imprecisión de duración (gate A3) y la prosodia del TTS por-escena.

Flujo nuevo (detrás de un flag, A/B contra el pipeline actual):

1. **Guion continuo**: el guionista escribe UNA narración corrida con gancho
   inicial y cadena causal, sin la camisa de fuerza de 8-16 palabras por
   escena (el ajuste de gancho+causa ya se aplicó al prompt actual como
   mejora inmediata, 2026-09-04).
2. **Revisión sobre texto corrido**: el usuario edita un párrafo, no cajitas
   (resuelve de paso el P2 de la auditoría sobre los textareas).
3. **TTS único** de la narración completa → mejor prosodia y duración REAL
   medida (el gate A3 de palabras/segundo se vuelve innecesario).
4. **Alineado por palabra**: whisper sobre el TTS (la pieza YA existe — es lo
   que hace el puente para medir tasa de habla).
5. **Ventanas de 4/6/8 s** que cubren la duración total; el director escribe
   el prompt visual de cada ventana leyendo las palabras que suenan en ella.
   Los cortes NO necesitan caer en fin de oración.
6. **Ensamblaje pista-única**: una sola pista de audio continua + clips de
   video concatenados encima, recortados al tiempo exacto (reemplaza el mux
   audio+video por escena; el "tiempo extra" del clip se corta al concatenar).

- [ ] Validación: misma historia por ambos pipelines (2 películas de 15 s,
      ~$0.70 dólares c/u, con confirmación de gasto), comparación de guion,
      duración y costo en Langfuse.
- [ ] Cobro: sin cambio (3 cr/s por duración objetivo); la duración real
      medida tras el TTS abre la puerta a cobrar exacto más adelante.
- [ ] Riesgos: toca las rutas más probadas (flow.producir, tts, splitter,
      duracion, mux/concat) — por eso el flag y el A/B; las versiones de
      clips por escena se conservan para regeneración granular.
- [ ] Orden recomendado: después de M1-AWS y M2, ANTES de los focus groups —
      cambia la calidad de lo que la gente va a evaluar.

---

## Orden y dependencias

```
M1 (dinero) ──► M2 (login) ──► M4 (Stripe)   M6 (dashboard, tras M2)
                 │
M3 (quick wins, en paralelo con todo)
M5 (proteger trabajo, tras M1)
M7 (cortes nube, sin chat → medir → chat) y M8 (shorts web): tras el núcleo M1–M5
M9 (bot membresías): cuando haya miembros reales que sincronizar
M10 (prompts en Langfuse): independiente — puede ir en cualquier hueco tras M1
M11 (narración primero): tras M1-AWS y M2, ANTES de los focus groups

```

Lo que corre el usuario: `cdk deploy` (M2, M4, M6, M7, M8), claves Stripe (M4),
cuenta/secretos del VPS (M9), y toda confirmación de gasto.

## Preguntas abiertas

1. Plataforma de la comunidad y su API (define M9).
2. ¿El pipeline produce bien con las opciones generadas sin referencia? Se
   valida con la llamada barata de M1 antes de dar por cerrado el P0.
3. Ajuste del pack grande ($19.99 vs piso $0.0165) — se decide en M4 con
   comisiones reales.
4. Chat editorial en la nube (Agent SDK): ¿se cobra en créditos por turno? Se
   diseña al abrir M7.
