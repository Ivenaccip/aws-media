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

## Fase M3 — UX quick wins (texto y accesibilidad, cero riesgo) ✅ CÓDIGO LISTO (2026-09-04, falta deploy)

Tanda de la auditoría §6 "quick wins" que son texto/atributos:

- [x] `lang="es"` en el editor; `aria-label` en botones de ícono; `:focus-visible`.
- [x] Retirar códigos internos del texto visible (e1/s1/b1/b2/b3/g1/fn1/fn2);
      errores en español con acción ("El render falló: [causa] — reintenta").
      En el editor: KEEP/CUT → "SE QUEDA"/"CORTE", categorías traducidas
      (retoma, arranque en falso, repetición), fluff → "relleno", y la bitácora
      de cambios que se guarda con el corte también quedó en español.
- [x] Etapas humanas con minutos ("Investigando fuentes · N/M escenas") usando
      lo que ya devuelve `/estimacion` (los ~min del último estimado se muestran
      en el título del progreso de producción) + aviso "puedes cerrar la
      pestaña: la producción sigue en la nube".
- [x] Título de producto unificado en los `<title>` ("Estudio de video · …" —
      cambiar el nombre después es un buscar/reemplazar); nombre del proyecto y
      enlace "← Editar" en el header del editor (el enlace solo aparece servido
      bajo /editor/{name}/, el server local de raíz no lo muestra).
- [x] "Programar" como default en publicar (radio explícito "Publicar ahora")
      + zona horaria del navegador visible junto al campo de fecha.
- [x] Estado de error único con "Reintentar" en e1 (ambas columnas); leyenda de
      colores y panel de atajos en el editor (botón "❓ Ayuda" + tecla `?`).
- [x] Extra de e1: filas no accionables ya no parecen enlaces (son `<div>`) y la
      columna de shorts dice la verdad ("se edita desde Claude Code" + botón
      "Copiar /shorts") — era el pendiente de M8 para mientras.
- [x] Extra del monedero: `monedero.js` reintenta con backoff (2s→30s) cuando
      /api/creditos falla — la pastilla del saldo ya no queda invisible mientras
      Aurora despierta de la pausa (el bug que viste tras tu primer login).

Requiere: 1 `cdk deploy` del usuario DESPUÉS de que el CI construya la imagen
(cambia código servido: static/ y tools/editor/index.html van dentro de la
imagen). Tests: 162 verdes; smoke local de hub/e1/crear/editor en navegador.

## Fase M4 — Recarga con Stripe ✅ CÓDIGO LISTO (2026-09-04; falta la parte Stripe del usuario + deploy)

Prerrequisito: cuenta Stripe de la LLC; **las claves las crea y coloca el
usuario** en .env/SSM (nunca por chat). Diseño ya escrito en docs/ECONOMIA.md §8:

- [x] Webhook `POST /api/pagos/stripe` (`server/pagos_api.py`): ruta pública
      (su gate es la firma), verificación HMAC-SHA256 manual del header
      Stripe-Signature (sin fijar la librería de Stripe), solo
      `checkout.session.completed` pagado; mapea `amount_total` → pack de
      tarifas.json y abona al `client_reference_id`. Casos raros (sin usuario,
      monto sin pack) responden 200 con motivo + ERROR en el log → abono
      manual concierge con `tools/creditos.py`.
- [x] **Abono idempotente por el libro mayor**: `db.abonar_compra` inserta el
      movimiento contra un índice único de compras (`monedero_mov_compra_ref`,
      nuevo en el ESQUEMA — correr `tools/db_migrate.py`) ANTES de tocar el
      saldo; un reintento de Stripe (aun concurrente) no puede doble-abonar.
- [x] Panel "Recargar" en la cabecera del saldo (monedero.js): packs con
      Payment Link = botones de compra (abren Stripe en otra pestaña; al
      volver, visibilitychange + retry de M3 refrescan el saldo solo); packs
      sin link se muestran en gris y sin envs cae al aviso concierge de
      siempre. El 402 ya apuntaba a este CTA desde M1.
- [x] `/api/creditos` incrusta el user_id en cada link
      (`?client_reference_id=`); envs `STRIPE_WEBHOOK_SECRET` +
      `STRIPE_LINK_100/500/1200` viajan por SSM (`tools/ssm_env.py`, lista
      blanca ampliada; también en `.env.example`).
- [ ] **Parte del usuario** (sin esto opera concierge, nada se rompe):
      crear los 3 Payment Links en Stripe con los precios EXACTOS de
      tarifas.json ($1.99/$8.50/$18.00 — el webhook mapea por monto), crear el
      webhook endpoint apuntando a `{api}/api/pagos/stripe` con el evento
      `checkout.session.completed`, poner el whsec_ y las 3 URLs en `.env`,
      correr `python tools/ssm_env.py`, correr `tools/db_migrate.py` (índice
      nuevo) y el deploy (imagen del CI primero). Probar en modo test de
      Stripe antes de encender el modo live.
- [ ] Decidir el ajuste del pack grande ($19.99 o piso $0.0165 neto) al ver las
      comisiones reales del primer mes.
- [x] Etapas: concierge → webhook automático (lanzamiento gradual) — el código
      cubre ambas: sin envs concierge, con envs automático, y se pueden
      encender links pack por pack.

Deuda M4-1: reembolsos = ajuste negativo manual (`tools/creditos.py abonar -N
--tipo ajuste --ref refund:...`); el webhook no procesa `charge.refunded`.
Tests: 17 nuevos en tests/test_m4_stripe.py (179 en total, verdes).

Claves puestas 2026-09-04 (modo test, verificado): whsec_ + 3 links en `.env`
y SSM; webhook en vivo pasó de 503 a 400 "Firma inválida" = armado. Hallazgos
del testeo: (a) los links traen precios ADAPTATIVOS (Stripe deja pagar en MXN
→ amount_total llega en pesos) — arreglado en pagos_api: `_monto_usd` usa
`currency_conversion.amount_total` (el USD origen) y una divisa desconocida
sin conversión cae a abono manual (+2 tests, 272 verdes); (b) los links de
500 y 1200 cobraban $9.99 — DECISIÓN del dueño 2026-09-05: el pack medio pasa
a **550 cr / $9.99** (mantiene ~20 % de margen neto de comisión, el rol del
"pack a empujar"; tope sin romper el piso neto: 616 cr) y el link del 1200
se retira hasta crear uno de $18.00 exactos (el pack sigue listado en gris).
Cambiado en tarifas.json + ECONOMIA.md §3/§8, `.env`/SSM renombrados a
STRIPE_LINK_550 (los params viejos borrados de SSM).

## Fase M5 — Proteger el trabajo del usuario ✅ CÓDIGO LISTO (2026-09-04, falta deploy)

- [x] Autoguardado con debounce (~1 s) de guion/nombre/voz/personaje en
      revisión + `beforeunload` con cambios pendientes; indicador
      "Guardado ✓ HH:MM" junto a Producir. El PUT explícito de Producir sigue
      siendo la verdad final; un guion vacío jamás se persiste; el fallo de
      red reintenta solo cada 4 s. Verificado en vivo (persistió y restauró).
- [x] Subida con progreso real (`XMLHttpRequest.onprogress`: % + MB + barra),
      botón Cancelar (`abort`, sin basura a medias), `beforeunload` durante la
      subida y validación de nombre en cliente (espejo de `_validar_nombre`).
- [x] Polling resiliente: en crear.html 2 fallos seguidos → banner fijo
      "Sin conexión — reintentando… Tu trabajo sigue en la nube" que
      desaparece al recuperar; los polls de render y subtítulos del editor ya
      no mueren con una excepción silenciosa (siguen esperando).
- [x] Lista "Tus películas" en crear.html (hasta 8, estado humano + fecha,
      clic → `?p=`) y "recientes" en el hub (hasta 4); botón "⬇ Descargar
      MP4" en la pantalla de resultado; "Nueva película" ahora vuelve a
      /crear.html (no al hub).
- [x] Pantalla de error: explica que un fallo nuestro devuelve los créditos
      solos (con el saldo actual) y el botón de reintento muestra el costo
      ANTES de cobrar de nuevo ("Reintentar → 90 créditos (se cobran de
      nuevo)").
- [x] Idempotencia de clic (deuda C5-4 CERRADA): `db.reclamar_produccion` =
      UPDATE condicionado atómico de la columna estado ANTES de cobrar — el
      segundo clic recibe 409 sin cobro; el 402 y el fallo de lanzamiento
      revierten el claim (`liberar_produccion`). Solo aplica con
      STATE_BACKEND=postgres (dev local json sin carrera, sin cambio).

Requiere: 1 `cdk deploy` del usuario tras la imagen del CI (cambia static/ y
server/). Tests: 8 nuevos en tests/test_m5_proteger.py (187 en total, verdes);
smoke en navegador (autoguardado end-to-end real, listas, editor sano).

## Fase M6 — Dashboard de costes (admin) ✅ CÓDIGO LISTO (2026-09-04, falta deploy)

Página `static/admin.html` + `GET /api/admin/resumen`, visibles solo para el
grupo `admin` de Cognito (por eso va después de M2):

- [x] **Gate por grupo**: `cognito.CfnUserPoolGroup` "admin" en el stack;
      auth.py guarda `cognito:groups` del id_token en un contextvar y
      `es_admin()` lo exige (dev local sin Cognito = admin, pero el dashboard
      responde 503 explicado sin Postgres). Alta de admins:
      `tools/usuarios.py admin <correo>` (+ re-login para refrescar el token).
- [x] **Por usuario** (`GET /api/admin/resumen`, `server/admin_api.py`):
      saldo/cortesía/comprados/quemados netos (cargos − devoluciones) del
      libro mayor, nº de películas, S3 por prefijo work/{user}/, costo IA en
      dólares (tabla `costes`) y **margen** = quemados × piso de venta
      (tarifas.json, expuesto como `creditos.PISO_VENTA_USD`) − costo IA.
- [x] **Por corrida** (`GET /api/admin/usuarios/{id}`): cada proyecto con sus
      créditos netos (split_part de la referencia del movimiento), costo real
      y trazas enlazadas a Langfuse ({base}/trace/{id}). El insumo de los
      focus groups.
- [x] **Sync programado**: EventBridge diario 06:00 UTC → worker Lambda con
      `{"tipo":"sync_costes","dias":3}` (tools/costes.py refactorizado a
      `sincronizar()` importable, idempotente por trace id) + botón
      "Sincronizar costes (7 días)" en la página (POST /api/admin/costes/sync).
- [x] **General**: KPIs de totales (costo, margen, créditos, películas) y la
      tabla ordenada por costo (top usuarios). La curva de gasto queda para
      cuando haya más de un puñado de puntos.
- [x] **Infra AWS** (M6.1, pedido del usuario 2026-09-04): línea estimada de
      cómputo por corrida en la tabla `costes` — `pipeline/costes_infra.py`
      calcula segundos reales × tarifas de `pricing.json` §aws_infra
      (Fargate 4 vCPU/8 GB ≈ $0.02 por producción; Lambda 3 GB ≈ $0.007 por
      preparar) y los ejecutores la registran al terminar (proveedor 'aws',
      también en corridas fallidas — la infra se gastó igual; jamás tumba una
      corrida). El dashboard la suma solo: la columna pasó de "costo IA" a
      "costo directo". Lo que sigue compartido y sin atribuir (Aurora,
      CloudFront, API GW — centavos): presupuesto de $50/mes y Cost Explorer,
      enlazados desde la página. S3 ya sale aparte por prefijo.
- [x] **Tiempo de Fargate visible** (M6.3, pedido del usuario 2026-09-04): el
      costo de infra es función lineal del tiempo, así que el dashboard lo
      deshace (`costes_infra.segundos_estimados`: costo ÷ tarifa, ±2 s por el
      redondeo a $0.0001) — sin columna nueva y retroactivo a lo ya registrado.
      Columna "Fargate" por usuario (suma de infra-producir + infra-render) y
      "~N s de cómputo" en cada línea de infra del drill-down (Lambda incluida).
- [ ] Si el volumen crece y la página se queda corta: evaluar QuickSight o
      Metabase (requeriría abrir acceso a Aurora — hoy no lo vale).

Post-deploy del usuario: `tools/usuarios.py admin ivenaccip@gmail.com` +
cerrar sesión y volver a entrar; deploy = imagen del CI + `cdk deploy
aws-media-api aws-media-jobs` (jobs cambia por la regla de EventBridge).
Tests: 11 nuevos en tests/test_m6_admin.py (198 en total, verdes); synth
verificado (grupo admin + cron) y smoke del dashboard en navegador.

## Fase M7 — Editor de cortes en la nube (deuda C4)

Cómo funciona hoy: el editor (`tools/editor/index.html`) lo sirve el FastAPI
**local** leyendo del disco (proxy MP4, `cuts.json`, transcript), y el chat
editorial es Claude Code corriendo en la máquina del usuario. En la nube:

- [x] **Artefactos a S3**: proxy MP4 y waveform por CloudFront (302 desde
      `/editor/{n}/media/*`; la cookie de M2 autentica la página); `cuts.json`
      versionado en Postgres — tabla `cortes_versiones`, la v1 se siembra desde
      S3 en la primera apertura y las versiones jamás se borran. Las
      correcciones de palabras reescriben el canónico en S3 con respaldo previo.
- [x] **UI servida por la API Lambda**: el router `/editor/{name}/` ya viajaba
      en la imagen; ahora todos sus endpoints tienen rama nube (gate
      `db.backend() == "postgres"`, dev local intacto). e1 enciende "Abrir
      editor" cuando el puente dejó cuts.json en S3.
- [x] **Save con control de concurrencia**: la UI manda `base` (la versión que
      abrió) y el server inserta base+1 SOLO si sigue siendo la última (el
      PRIMARY KEY corta la carrera); si no, 409 y la UI pide recargar (resuelve
      el P1 "Claude vs usuario" de la auditoría).
- [x] **Render del corte = job**: reusa la state machine de producción con otro
      comando (`worker/render_task.py` — cero infra nueva): baja videos/<n>/ de
      S3, pisa cuts.json con la última versión de Postgres, corre render_cuts
      preview en Fargate y sube el MP4 + segments.json; estado por
      `proyectos_editor.doc.render` (candado con caducidad de 2 h = timeout de
      la SM), la UI hace poll y al final muestra el enlace CDN. Línea
      "infra-render" de M6.1 registrada aunque falle. Nada corre en la Lambda.
- [ ] **El chat editorial en nube** es la pieza nueva de verdad y va DESPUÉS
      (decisión 2026-09-03): el editor salió sin chat (cortar/guardar/render) y
      el panel en nube lo dice tal cual: el chat vive en Claude Code local.
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
      NOTA M7: los proyectos gen-* ya traen canónico del puente, así que el
      editor en nube NO cobra créditos hoy; la tarifa de transcripción aplica
      al metraje subido (se enciende con M8).

Hecho 2026-09-04 (M7, sin chat): tabla `cortes_versiones` + `guardar_cortes`/
`cortes_ultima` (candado por PK), rama nube en TODOS los endpoints de
server/editor.py, `jobs.lanzar_render` por la SM existente,
`worker/render_task.py`, `editor_listo` real en e1, UI con `base`/409 y enlace
CDN del preview. Deploy: `python tools/db_migrate.py` (tabla nueva) + imagen
del CI + `cdk deploy aws-media-api aws-media-jobs` (ambos fijan el digest).
Tests: 18 nuevos en tests/test_m7_editor_nube.py (225 en total, verdes);
smoke local del editor con gen-tesla (sin regresiones).

## Fase M8 — Shorts en la web

Hoy shorts es solo terminal (`/shorts`: transcribe → Claude puntúa candidatos →
el usuario elige → Remotion quema captions → export 9:16). La versión web
reutiliza las piezas de C3/C4:

- [x] **Job de análisis** (`worker/shorts_analizar.py`, cola SQS): si el
      proyecto no trae canónico, extrae el audio del CDN con ffmpeg (16 kHz
      mono — nunca baja el video al /tmp de la Lambda) y transcribe con
      AssemblyAI (asr_backend, con preview de costo y traza Langfuse); el
      canónico se sube a S3. Los **candidatos** los puntúa el LLM
      (`prompts/shorts_candidatos_system.md`, ponderación de la rúbrica:
      hook 0.30 / coherencia 0.25 / emoción 0.20 / densidad 0.15 / payoff
      0.10; el code-switching no se penaliza) y quedan saneados (15–55 s,
      dentro del video) en `proyectos_editor.doc.shorts`. Tope 90 min.
- [x] **UI de selección** (`static/shorts.html`, enlazada desde la columna de
      shorts de e1): candidatos con score/razón/gancho editables, ajustar
      inicio/fin, estilo (bold/bounce/clean), plataforma y tipo de contenido;
      polling de análisis y render; salidas con enlace CDN.
- [x] **Render en Fargate** (`worker/shorts_task.py`, la MISMA state machine
      con otro comando — cero infra nueva): snap_boundaries → extract con
      STREAM COPY (regla dura) → compute_reframe → Remotion con el Chromium
      del sistema (render.mjs ahora respeta CHROMIUM_PATH) → `export.sh`
      (la única pasada de loudnorm) → `validate.sh` → S3
      `videos/<n>/output/shorts/`. Línea "infra-shorts" de M6.1; fallo
      devuelve créditos.
- [x] **Tarifas** en `tools/tarifas.json` §shorts (con pricing.json):
      transcripción 2 cr por cada 5 min empezados (AssemblyAI $0.21
      dólares/hora), análisis 2 cr (LLM), render 2 cr por short (Fargate).
      Cobro ANTES de encolar/lanzar con preview en la UI; los gen-* ya traen
      canónico → su transcripción es 0.
- [x] Mientras M8 no llegue: la columna de shorts en e1 dice la verdad ("se
      edita desde Claude Code con /shorts" + botón copiar comando) — hecho en
      M3; ahora esa fila queda solo para proyectos locales sin flujo web.
- [x] Publicar vía Blotato desde la web — M23 C2 (2026-09-16).
- [ ] Deuda M8-1: la limpieza LLM de muletillas en captions (paso 4 del skill)
      no viaja a la web — los captions salen del transcript crudo.

Hecho 2026-09-04 (M8): `server/shorts_api.py` (estado/costo/analizar/render,
409 con caducidad, 402 humano, devolución si no se pudo encolar/lanzar),
despacho `shorts_analizar` en lambda_worker, `jobs.encolar_shorts_analizar` +
`jobs.lanzar_shorts_render`, conceptos infra-shorts[-analizar] en el dashboard.
Sin migración de DB (todo vive en doc jsonb). Deploy: imagen del CI +
`cdk deploy aws-media-api aws-media-jobs`. ASSEMBLYAI_API_KEY ya está en
`.env` Y en SSM (verificado 2026-09-04): la transcripción de subidas queda
activa desde el primer deploy; si algún día falta, la UI lo avisa y no cobra.
Tests: 21 nuevos en tests/test_m8_shorts.py (248 en total, verdes); smoke
local de e1 y shorts.html.

## Fase M9 — Automatización de membresías (Skool → Zapier → alta)

> **Pretrabajo obligatorio: M26 (entregabilidad del correo).** Cada alta que
> haga el bot dispara un correo de Cognito. Hoy salen del remitente compartido
> de AWS y caen en spam, así que el bot mandaría invitaciones que nadie ve, al
> ritmo que entren los miembros y sin nadie mirando la tasa de rebote. Con SES
> configurado el bot además deja de chocar con el límite de 50 correos al día.

**Plataforma decidida (2026-09-13): Skool.** Cierra la pregunta abierta que
tenía esta fase. No hace falta raspar la lista de miembros: Skool expone las
altas hacia Zapier, y de ahí salen a un CRM.

**Ruta de alta (evento, en el momento):**

```
Skool (alguien se suscribe) → Zapier → CRM → señal a nuestro endpoint → usuarios.py alta
```

**Ruta de churn y renovación (cron, cada X):** un programado compara la lista
viva contra Cognito y, por diferencia, suspende a quien se dio de baja y
reactiva a quien renovó. Va por cron y no por evento a propósito: una baja que
se procesa una hora tarde no rompe nada, y un webhook perdido sí dejaría a
alguien con acceso pagado por otro.

- [ ] **M26 cerrada antes de encender el bot** (SES en producción, rebotes y
      quejas vigilados).
- [ ] Endpoint que recibe la señal y llama a `usuarios.py alta`.
- [ ] **Secreto compartido en ese endpoint.** Sin él, quien descubra la URL se
      da de alta solo — y el alta regala los créditos de cortesía (`cortesia()`
      en `tools/usuarios.py`). Es una puerta al dinero, no solo al acceso.
- [ ] **Idempotencia por correo.** Zapier reintenta ante cualquier error, así
      que la misma alta puede llegar dos o tres veces; la segunda no puede
      volver a abonar cortesía. Misma regla que el webhook de Stripe (M4).
- [ ] Cron de churn/renovación. Decidir la frecuencia — diaria basta si la
      suscripción es mensual.
- [ ] Política de gracia para churn (no borrar: suspender; los créditos
      comprados no caducan — regla de ECONOMIA.md).
- [ ] **Pendiente de decidir**: qué CRM, y si el cron vive como EventBridge
      programado (ya hay cuenta y CDK) o fuera.

**Por qué importa para el lanzamiento:** con 161 altas previstas, hacerlas a
mano no es opción — ni por el tiempo ni porque cada alta mueve créditos.

## Fase M10 — Prompts gestionados en Langfuse

Objetivo: el dueño edita los prompts en la UI de Langfuse (Prompt Management,
versionado con label `production`) sin tocar código ni redesplegar; el pipeline
los toma al hacer la llamada. La arquitectura ayuda: los ~10 prompts ya son
`.md` cargados por nombre vía `pipeline/config.py::load_prompt`, y todas las
llamadas LLM pasan por `pipeline/llm.py::chat_json(name, system, user)`.

- [x] `tools/prompts_sync.py`: siembra idempotente de los 24 `.md` en Langfuse
      (mismo nombre que `load_prompt`, label `production`, `--dry`/`--solo`).
      SEMBRADO 2026-09-04: 24/24 versiones v1; segunda pasada = 0 cambios.
- [x] `load_prompt` intenta Langfuse primero (`get_prompt(label="production")`,
      caché con TTL del SDK, `fetch_timeout_seconds=3`, `max_retries=1`) con
      fallback al `.md` local — gate por env `LANGFUSE_PROMPTS=1` (lo cablean
      los dos stacks; dev local y tests siguen leyendo los .md del repo) y
      cualquier excepción cae al .md: el pipeline jamás se cae por un prompt.
- [x] Templating intacto: se trae el texto crudo y el `.format(**datos)` de
      Python sigue local — los placeholders `{var}` no cambian.
- [x] Enlace versión×generation: `load_prompt` devuelve `PromptTexto` (str que
      carga el objeto del prompt y lo conserva tras `.format()`) y `chat_json`
      pasa `langfuse_prompt=` cuando existe — Langfuse cruza versión × costo ×
      calidad sin tocar ningún call site. (Las 2 llamadas directas fuera de
      chat_json —qc y describir_referencia— quedan sin enlace por ahora.)
- [x] Riesgo documentado en prompts_sync: los tests corren contra los `.md`
      del repo y el label `production` solo se mueve a mano en Langfuse —
      flujo "editar en la UI → probar en una película propia → promover".

Hecho 2026-09-04 (M10): verificado en vivo (load_prompt sirvió la v1 remota
con el enlace intacto tras .format). Deploy: imagen del CI + `cdk deploy
aws-media-api aws-media-jobs` (solo por la env LANGFUSE_PROMPTS=1). Tests:
10 nuevos en tests/test_m10_prompts.py (258 en total, verdes).

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

- [x] Validación: el A/B formal no se corrió — el 2026-09-07 el dueño decidió
      por calidad visible del texto (las cajitas producían prosa telegráfica)
      y «narracion» pasó a ser el DEFAULT de la web (rama
      m11-narracion-default). La primera película real por esta ruta sirve de
      validación en producción.
- [x] Cobro: sin cambio (3 cr/s por duración objetivo); la duración real
      medida tras el TTS abre la puerta a cobrar exacto más adelante.
- [x] Riesgos acotados con el flag POR PROYECTO: `Proyecto.pipeline`
      ("escenas" | "narracion"); el camino de siempre no se tocó — solo
      branches en flow._preparar/_producir. Desde 2026-09-07 la web crea con
      "narracion" por default; el camino de cajitas sigue vivo vía
      `?pipeline=escenas` o env PIPELINE_DEFAULT=escenas.
- [ ] Orden recomendado: después de M1-AWS y M2, ANTES de los focus groups —
      cambia la calidad de lo que la gente va a evaluar.

Hecho 2026-09-04 (M11, código): `writer.escribir_narracion` (prompt narrador,
presupuesto 1.9 pal/s de habla pura), `pipeline/narracion.py` = TTS único →
alineado faster-whisper (ALINEADOR_MODEL=small) → `planear_ventanas`
(n=ceil(dur/8), clip Veo 4/6/8 ≥ ventana+0.5) → `director_ventanas` (una
escena por ventana, cortes sin atarse a fin de oración) → cadenas de
media.py sin mux por escena → ensamblaje pista única (ffmpeg.recortar_video/
concat_video/mux_pista_unica, -shortest). Sin gate A3 ni splitter en esta
ruta. Revisión = un textarea de texto corrido (P2 de la auditoría);
PUT guion acepta `narracion`; barra de progreso monotónica. Prompts nuevos
sembrados en Langfuse (M10). Deploy: imagen del CI + `cdk deploy
aws-media-api aws-media-jobs`. Tests: 12 nuevos en
tests/test_m11_narracion.py (270 en total, verdes); smoke local de la
revisión narración.

## Fase M12 — Hub tipo LLM, slots de proyectos y archivo a Glacier

Decisiones del usuario 2026-09-05 (mock en Miro de "Irremplazables App"):

1. **La página de inicio se rediseña como hub tipo LLM**: prompt central
   "¿Qué vamos a crear hoy?" con botones "Investigación" / "Tengo una idea",
   sidebar de secciones (navega O crea directo — no compiten) y el grid
   "Mis Proyectos". Créditos + Recargar arriba a la derecha (ya existe:
   `monedero.js`).
2. **Semántica del sidebar**: *Reels* = crear un video desde cero (pipeline de
   crear.html); *Shorts* = destilar los mejores momentos de un video que ya
   existe (flujo M8). Cada card lo dice en una línea ("Reels — crea un video
   desde una idea" / "Shorts — saca los mejores momentos de tu video").
   Lo que aún no existe (*Investiga tu competencia*, *Crear imágenes*, *Ver
   mis métricas*) va en gris con "próximamente" — un botón muerto es peor que
   uno gris. Esas tres son el mapa de milestones futuros.
3. **Máximo 6 proyectos ACTIVOS por perfil** (encaja con el grid 2×3 — la
   página nunca scrollea). No hay plan free; el plan **anual incluye slots
   ilimitados** = 6 calientes + archivo congelado sin límite. El tope vive
   como columna por usuario (no constante) para dejar esa palanca abierta.
4. **Liberar slot = archivar, no borrar** (borrar es irreversible y va a
   doler): el doc en Postgres —guion, personaje, historial— se conserva
   siempre (centavos); los binarios de S3 se congelan. La regla del repo
   "las versiones de clips nunca se borran" aplica dentro del proyecto vivo
   y no se contradice.
5. **Frío automático a los 10 días**: lifecycle rule del bucket → S3 Glacier
   Instant Retrieval, SOLO objetos grandes (>1 MB: MP4/WAV — GIR factura
   mínimo 128 KB/objeto y encarecería los jsons chicos). GIR se sirve
   instantáneo por el CDN: **cero cambio de UX**, guardar cuesta ~6× menos
   (~$0.004 vs $0.023 dólares/GB-mes) y cada lectura ~$0.03/GB. Matiz
   aceptado: la regla cuenta días desde la SUBIDA del objeto, no desde el
   último uso — un proyecto aún en edición paga la lectura GIR, tolerable.
   La página de "descongelando" NO hace falta en esta etapa (eso es
   Flexible/Deep, no GIR).

- [x] **index.html como hub**: prompt central que precarga la idea en
      crear.html (`?brief=` + `?modo=` — los botones del prompt SON los modos
      que ya existían: "Investigación"/"Tengo una idea"); sidebar con lo real
      (Reels y Crear contenido → crear.html, Shorts → e1.html) y
      "próximamente" en gris; grid de proyectos con contador "N de X slots"
      (o "N activos · slots ilimitados"), card "＋ Nueva película" solo con
      slot libre, y sección plegable de archivados con "Restaurar".
- [x] **Slots**: columna `slots` en `usuarios` (default 6; NULL = ilimitado
      — `alta --plan anual` lo fija solo, y `usuarios.py slots correo
      N|ilimitado` lo cambia), gate en el POST de crear ANTES de cobrar o
      investigar (409 con aviso humano + CTA de archivar; crear.html lo
      distingue del 409 del balanceador — forzar no aplica). El candado vive
      solo en la nube (postgres), como los de M5/M7: dev local sin límite.
- [x] **Archivar/desarchivar**: `POST /api/proyectos/{id}/archivar` (409 si
      hay tarea en curso) y `/desarchivar` (409 sin slot libre); el flag
      viaja en el doc del Proyecto (`archivado`) — sin migración de tabla
      nueva. Confirmación en UI aunque sea reversible.
- [x] **Lifecycle en CDK**: transición a GLACIER_IR a los 10 días con filtro
      `object_size_greater_than=1_000_000` en el bucket de media (synth
      verificado: `GLACIER_IR / TransitionInDays: 10`).
- [ ] Verificar los precios de lista S3 en la calculadora AWS y asentarlos
      en `pricing.json` §aws_infra antes de citarlos en ECONOMIA.md.
- [ ] **Etapa 2 (cuando el archivo acumulado pese)**: proyectos archivados
      viejos → Deep Archive (~23× más barato que Standard) + botón
      "Restaurar proyecto" → restore + página "Descongelando tu proyecto, te
      avisamos en unas horas" con polling (mismo patrón de estado que el
      render de M7). Ojo mínimos de permanencia: GIR/Flexible 90 días, Deep
      180 — archivar/desarchivar el mismo mes no ahorra.

Referencia de costos (lista us-east-1, POR VERIFICAR antes de pricing.json):
proyecto típico ~1–2 GB → Standard ~$0.046/mes, GIR ~$0.008, Deep ~$0.002.
Con GIR a los 10 días la factura S3 de proyectos viejos baja ~80% y "slots
ilimitados" del anual cuesta prácticamente nada.

Hecho 2026-09-05 (M12 etapa 1): hub nuevo en static/index.html, columna
`slots` (ALTER idempotente en el ESQUEMA — correr `tools/db_migrate.py`),
gate + `GET /api/slots` + archivar/desarchivar en server/app.py, prefill
`?brief=`/`?modo=` y 409-slots en crear.html, `usuarios.py` (anual →
ilimitado, comando `slots`), lifecycle GIR en infra/stacks/media.py.
Deuda M12-1: el tope cuenta solo proyectos de crear (proyectos_gen); las
subidas del editor (proyectos_editor) no tienen slot ni archivado aún.
Deploy: `tools/db_migrate.py` + imagen del CI + `cdk deploy aws-media-media
aws-media-api`. Tests: 12 nuevos en tests/test_m12_hub.py (284 en total,
verdes); smoke en navegador (hub, prefill, archivar/restaurar end-to-end).

### Refinando detalles

Iteraciones sobre feedback del dueño (mocks de Miro y screenshots de la URL
desplegada), todas el 2026-09-07. Cada punto sigue el formato de la etapa 1.

- [ ] **Plan del editor en nube (feedback 2026-09-08)** — pasos en orden:
      - [x] Paso 0 (dueño, 2026-09-08): deploy hecho (api 19:24 UTC, jobs
            19:23) + prompts_sync. Verificado: las rutas de chat/subtítulos/
            overlays responden 401 sin auth (existen — antes 404) y CloudWatch
            sin errores. La hipótesis de la imagen vieja era correcta.
      - [ ] Paso 1: si los 404/500 de subtítulos sobreviven al deploy,
            diagnóstico por CloudWatch.
      - [x] Paso 2 (PR #49, 2026-09-08): envío optimista + «Claude está
            escribiendo…» en el chat del editor; streaming/poll solo si tras
            probarlo sigue sintiéndose lento.
      - [ ] Paso 3: verificar conexión de Claude tras el deploy
            (SinClave/429/timeout).
      - [ ] Paso 4: rediseñar la UI del editor alineada al hub (pendiente:
            ¿mock de Miro o me baso en el hub?).
      - [ ] Paso 5: placas numeradas («Número 1/2/3») manuales hoy; iteración
            futura: el chat dispara la generación de b-roll.
- [ ] **Economía de tokens del chat editorial** (decidido 2026-09-08 — Claude
      es hoy 0.3% del gasto pero es lo único que escala por turno de usuario;
      optimizar ANTES de abrir a 50-100):
      - [ ] Fix de caché: `cache_control` está en el bloque del system y el
            CONTEXTO (transcript, miles de tokens) va después SIN marcador —
            moverlo al bloque del contexto cachea system + transcript
            (cache read = 10% del input). `pipeline/chat_nube.py`.
      - [ ] Tope de historial: mandar solo los últimos ~20 turnos para poner
            techo al input en sesiones largas.
      - [x] Eval 1 Opus 5 vs Sonnet 5 (2026-09-08): re-corridos los 3 turnos
            reales de gen-ee202e1a con Sonnet — ancla igual de bien
            (8.5/17.8/23.5s, pista 2, B-roll IA) a $0.0053 vs $0.0166 por
            turno (~68% menos); Opus solo aporta matices finos. DECISIÓN del
            dueño: Opus sigue de default durante las pruebas, trackeando
            usage/caché en Langfuse.
      - [ ] Eval 2 con evaluador (LLM juez) sobre más turnos acumulados de
            pruebas reales: si sale similar, cambiar CHAT_MODEL a
            claude-sonnet-5 (revertible por env).
      - Descartado a este tamaño: cascada con Haiku, batching, caché
        semántica (chat interactivo y personalizado); thinking ya va en
        effort low y max_tokens=1500 ya acota la salida.
- [x] **M17 — Shorts desde fuera** (COMPLETO 2026-09-08). Apify entra al
      backend por API REST con `APIFY_TOKEN` en .env/SSM (clave del dueño).
      OJO ToS: descargar de YT/IG/TikTok va contra los términos de esas
      plataformas — riesgo aceptado por el dueño.
      - [x] **Ruta A — liga de YouTube** (PR #51): en shorts.html se pega la
            liga → Cotizar (actor `thenetaji/youtube-video-details-scraper`,
            preview ANTES de cobrar) → Importar (2 cr/min empezado,
            tarifas.json §shorts) → worker: descarga `thenetaji/
            youtube-video-downloader` (720p, ~$0.02 dólares/min) directo a S3
            + transcript de los captions de YT (actor topaz, $0.01 — Analizar
            no re-transcribe: transcripción 0 cr) → tubería M8 sin cambios.
            Tope 90 min. `marielise.dev` DESCARTADO (LOGIN_REQUIRED; fallback
            residencial $0.05/MB — pricing.json §apify).
      - [x] **Ruta B — descartada como tal** (aclarado 2026-09-08): lo que el
            dueño quería era «subo mi .mp4 y la IA transcribe y propone» — eso
            ES el flujo M8 de siempre. PR #52 le quita la vuelta por e1: botón
            «Subir un video» en la propia página de Shorts (misma subida
            prefirmada C3). Subir .srt/.txt sueltos no lo quiere nadie: fuera.
      - Quedó: dos entradas (subir .mp4 / liga de YT). Si los cortes de
        importados salen mordidos (captions por segmento), plan B declarado:
        re-transcribir con AssemblyAI.
- [x] **M18 — Copiadora de estilos** (fase 1, 2026-09-08): página
      `estilos.html` (sidebar activado) → pegas liga de IG o TikTok → 3 cr
      fijos (tarifas.json §estilos) → worker Lambda: Apify trae el MP4 (IG:
      `apify/instagram-scraper` oficial ~$0.003/resultado con videoUrl;
      TikTok: `clockworks/tiktok-scraper` con add-on de descarga ~$0.005) →
      ffmpeg saca 8 frames + cuenta cortes de escena → capa determinística
      gratis (paleta por cuantización Pillow, aspecto, duración, cadencia) +
      gpt-5-mini visión (`prompts/estilo_perfil_system`: tipografía, captions,
      iluminación, estética, tono, prompt_estilo en inglés) → perfil JSON por
      usuario en S3 (`usuarios/<user>/estilos/<id>.json`, API `/api/estilo` —
      /api/estilos ya era de los estilos de imagen) + tarjeta con botón
      «copiar» del prompt. Copiar estilo, nunca clonar contenido.
      - [ ] Fase 2: que el perfil alimente SOLO los prompts de Crear
            imágenes/Crear contenido (selector de estilo guardado) y los
            estilos de subtítulos de shorts — hoy el usuario pega el
            prompt_estilo a mano.
- [x] **M15 — Editor de imágenes (inpainting) + sidebar reordenado** (PR #45,
      2026-09-08): «Editor de imágenes» ya no apunta a crear-imagenes.html —
      página propia `editor-imagenes.html` (subes tu imagen, pintas la zona
      con pincel y describes el cambio) contra `POST /api/imagenes/editar`
      (Nano Banana edit: original + copia con la zona resaltada en rosa —
      el resultado de Flux Fill no convenció al dueño; misma tarifa de
      imagen, cobro antes + devolución en fallo). Sidebar en el orden pedido, con
      «Copiadora de estilos» y «Agenda tus publicaciones» (Blotato) como
      próximamente.
- [x] **Plan de escalamiento + Claude como base de plataforma** (PR #44,
      2026-09-08): `docs/ESCALAMIENTO.md` — el runbook de 6 testers →
      50-100 activos/día: Fase 1 antes de abrir (Aurora min 0.5 ACU, retry
      ante rate limits en fal.llamar + semáforo por-proceso documentado,
      candado g2 a Postgres), Fase 2 con datos (cold starts medidos, sync de
      costes cada 4-6 h, tarifar el chat con la medición de Langfuse),
      operativo (alarmas de presupuesto y 5xx) y lo que NO se toca.
      `CLAUDE_API_KEY` entró a CLAVES de plataforma en ssm_env.py y quedó
      SUBIDA a /media-ivenaccip/env/ — todos los usuarios tienen el chat
      configurado de fábrica; una clave por-usuario (D4) la pisa. El tope
      CHAT_TURNOS_DIA=40 acota el gasto mientras el chat es 0 cr.
- [x] **Costos IA por vendor en el admin** (PR #43, 2026-09-08): la pestaña
      2·Costos divide la IA en OpenAI / fal / Claude. El sync
      (`tools/costes.py`) abre cada traza NUEVA y reparte su costo por el
      modelo de sus observations (`proveedor_de_modelo`: gpt→openai,
      claude→claude, resto→fal), insertando una fila por vendor en `costes`
      (misma columna `proveedor`; sin detalle cae a la fila única 'langfuse'
      de siempre). `/api/admin/resumen` agrega `costo_ia_prov` por usuario y
      en totales; el front pinta 3 KPIs y 3 columnas nuevas. Lo sincronizado
      ANTES del cambio no trae vendor y solo aparece en «IA total» (nota en
      la UI: borrar esas filas y re-sincronizar el periodo lo desglosa).
      7 tests (test_m16_costos_proveedor.py) + el de idempotencia adaptado.
- [x] **M16.1 Subtítulos del editor en la nube** (PR #39, 2026-09-08): rama
      nube en los 3 endpoints b1 de overlays_api. La MUESTRA (1 frame) corre
      en la Lambda contenedor bajando solo pelicula.mp4 +
      edited-transcript.json de S3 (`media_sync.bajar_archivo` nuevo) y sube
      el PNG; `/editor/{n}/archivo/…` en nube redirige al CDN. El QUEMADO va
      a Fargate por la state machine de siempre
      (`worker/subtitulos_task.py`: bajar gen-* → make_subs --mode final
      sobre pelicula.mp4 → subir pelicula-subtitulado.mp4 + subs.srt/.ass →
      `doc.subtitulos` vía `db.fijar_subtitulos_editor`, con candado de
      caducidad 2 h como el render). Tarifa 0 cr (no quema vendors);
      registra `infra-subtitulos` en costes. La UI reproduce el resultado
      por la URL de CDN que trae el estado. 12 tests
      (test_m16_subtitulos_nube.py); fuente en el contenedor:
      fonts-liberation sustituye a Arial vía fontconfig.
- [x] **El cuadro del hub ES la entrada** (PR #19): crear.html con `?brief=`
      pliega brief/modos a un resumen «💡 Tu idea · modo X» con «✏️ Editar»
      y no repite "Tus películas"; sin query, formulario completo. El hub
      exige texto antes de navegar. Campo `descripcion` por estilo en
      pipeline/styles.py → /api/estilos → ejemplo bajo los chips. Fix: el
      toggle de estilo barría todos los .chip y apagaba el del modo.
      Tests: 285 verdes; smoke plegado/editar/prefill.
- [x] **Mock v2 del formulario + fix del 500** (PR #20): retry de
      db.ejecutar también con DatabaseUnavailableException (Aurora
      despertando responde con mensaje VACÍO — filtrar por el nombre de la
      clase); chips de estilo VERTICALES en español (Cinemático/Animado/
      Monocromático/Experimental/Artístico/Personalizado, ids intactos) con
      muestra grande de `/estilos/<id>.jpg` y fallback a texto; campo
      «Información extra» end-to-end (`Proyecto.personaje_extra` → 
      `flow._con_extra` → guionista y prompts de opciones, tope 500 chars).
      HALLAZGO: el 500 de producción era Aurora pausada + la migración de
      `slots` sin correr (el clasificador me bloquea db_migrate — la corre
      el dueño con los ARNs del stack aws-media-db). 287 tests.
- [x] **Config ancha + cards-obra + admin 3 partes** (PR #21): vista de
      configuración a lo ancho (main.wide) con el costo PRIMERO en el botón;
      cards del hub como obras (miniatura del personaje elegido vía campo
      `miniatura` en GET /api/proyectos, título en pie, ✕ = archivar);
      admin con 3 KPIs. 288 tests.
- [x] **Imágenes de ejemplo de estilos** (PR #22): las 5 generadas con nano
      banana en fal ($0.20 dólares, gasto confirmado) — la MISMA escena
      (zorro camino a un faro al atardecer) en los 5 estilos; 1200px, ~1 MB
      total en static/estilos/.
- [x] **Admin en 3 VISTAS de verdad** (PR #23 — los 3 KPIs no bastaban):
      pestañas «1 · Ingresos» (quemados × piso, comprados, cortesía),
      «2 · Costos» con IA (Langfuse) SEPARADA de infra AWS (admin_api
      desglosa costo_ia_usd/costo_aws_usd por el prefijo "infra-" +
      ingresos_usd; el sync y el drill-down viven aquí) y «3 · Flujo»
      (ingresos − costos). Front con fallbacks si el server viejo no manda
      el desglose. 289 tests.
- [x] **Portada real + Modificar + Crear imágenes** (rama
      m12-portada-imagenes): `ffmpeg.portada` extrae un frame (t≈1 s,
      640px) al terminar producir (no fatal) y `_miniatura` lo usa para
      películas listas (onerror → placeholder en cards viejas); resultado
      según el mock (← volver, video con poster, Descargar | Modificar —
      `POST /reabrir` regresa listo→revision gratis, producir recobra);
      sidebar: fuera el «Crear contenido» duplicado, «Reels» se llama
      «Crear contenido», y «Crear imágenes» ACTIVO → crear-imagenes.html
      (estilo a la izquierda + prompt libre a la derecha) sobre
      `POST /api/imagenes` (cobra la tarifa `imagen` de tarifas.json,
      nano banana, guarda en `_imagenes/` local o `imagenes/{user}/` en
      S3, sirve por `GET /api/imagenes/{nombre}` con redirect al CDN;
      devuelve créditos si falla). Tests: 5 nuevos (293 verdes).
- [x] **Miniatura con respaldo + costo por duración + 503 amable** (rama
      m12-pulido): el listado manda `miniatura` Y `miniatura_alt` — película
      lista sin portada.jpg (anterior al frame) cae al personaje elegido en
      la card, y solo al final al placeholder; viniendo del hub ya NO hay
      card «Tu idea» (para cambiar la idea se vuelve al inicio); bajo el
      slider de Duración el costo de producir se re-pinta en vivo
      («≈ N créditos (3 por segundo)» de las tarifas del monedero — el
      botón sigue cobrando solo preparar). HALLAZGO del 500: Aurora tarda
      a veces MÁS que la ventana de retry (24 s, tope API Gateway 29 s) →
      `db.DespertandoError` + handler 503 con Retry-After 10 (monedero ya
      reintenta con backoff); la otra causa sigue siendo la migración de
      `slots` pendiente (la corre el dueño). Tests: 294 verdes.
- [x] **Sidebar en dos grupos** (rama m12-sidebar-grupos): «Estudio de
      Contenido» (Crear imágenes / Crear contenido / Shorts) y «Blotato»
      con botón «+» — el futuro punto para conectar las credenciales de
      Blotato del usuario (por diseñar; hoy avisa «muy pronto») — con
      Investiga tu competencia y Ver mis métricas (próximamente) debajo.
- [x] **Guardrails del brief + migración de slots corrida** (rama
      m13-guardrails): `pipeline/moderacion.py` (`revisar` → chat_json con
      prompts/moderar_system.md; falla ABIERTO si el LLM no responde) +
      `POST /api/moderar` gratis; static/guardrail.js muestra el popup
      «🛑 Revisa tu texto» con el motivo del LLM y NO manda la petición
      que cobra — cableado en crear.html (brief + Información extra, se
      salta al reintentar con `forzar`) y crear-imagenes.html (prompt).
      La migración de `usuarios.slots` YA corrió contra Aurora (esta vez
      el comando pasó desde el chat): `/api/slots` deja de dar 500.
      HALLAZGO del pago sin abonar: el webhook de Stripe NUNCA llegó al
      API (cero requests en CloudWatch) — el pago fue en modo TEST y el
      endpoint de webhook de test no existe o apunta mal; se configura en
      el dashboard de Stripe (Developers → Webhooks, modo test, evento
      checkout.session.completed → /api/pagos/stripe). Tests: 5 nuevos
      (299 verdes); smoke real del filtro en local (bloquea gore, permite
      texto sano).
- [x] **Login con la marca del producto** (rama m13-login-branding, PR #28):
      dominio Cognito subido a Managed Login v2 EN VIVO (update-user-pool-domain
      + create-managed-login-branding, paleta del hub, colorSchemeMode DARK);
      infra fija managed_login_version=NEWER (synth = no-op contra lo
      desplegado); auth.js manda `&lang=es` (¡el parámetro existe en Managed
      Login!) → login y cambio de contraseña de primera vez en español,
      verificado en vivo. El branding vive FUERA de CFN: se retoca en el
      editor visual de la consola de Cognito.
- [x] **Balanceador de formato del guionista + cuadro del hub** (rama
      m14-editar-web): «3 curiosidades de los flamencos» salía como cuento de
      un polluelo (el guionista forzaba protagonista+arco a TODO brief) → el
      clasificador ahora también elige `formato` (cuento | lista | explicador,
      respetando lo que PIDIÓ el usuario) y `{formato_reglas}` entra al system
      del guionista Y del narrador (M11); el clasificador corre siempre (el
      modo forzado de la UI solo pisa el tipo). En el hub, «Investigación» y
      «Tengo una idea» son CHIPS de selección (segundo clic = deseleccionar,
      sin elegir = detectar solo) y el envío es un botón redondo ↑ con el
      acento del producto, como el de Claude.
- [x] **Sidebar**: entra «Editar» (metraje propio → corte con IA), «Shorts»
      apunta a shorts.html («Sube un video largo y te daremos los mejores
      momentos») y shorts.html sin `?p` ofrece elegir el proyecto (antes
      vivía en las cards de e1).
- [x] **Narración primero como default de la web** (rama
      m11-narracion-default): el dueño vio otro guion en cajitas (Kusi la
      cría, 5 escenas de ~11 palabras, prosa telegráfica) y preguntó por qué
      el guionista no escribía libre para partir escenas DESPUÉS — eso es
      exactamente M11, que seguía apagado esperando el A/B. Decisión: se
      enciende como default (`PIPELINE_DEFAULT` cae a "narracion" en
      server/app.py; escape `?pipeline=escenas` o la env). El alineador
      faster-whisper "small" ahora viaja HORNEADO en el Dockerfile (antes
      cada tarea Fargate habría bajado ~460 MB de HuggingFace al vuelo).
      El A/B formal de M11 queda sin correr: el default se decidió por
      calidad visible del texto. Tests: 310 verdes (uno nuevo del escape).
- [x] **La llama «Fluffy» — prompts de Langfuse desincronizados** (rama
      m10-siembra-prompts): «3 curiosidades sobre las llamas» volvió a salir
      como cuento con protagonista bautizado A PESAR del balanceador ya
      desplegado. Causa: en la nube LANGFUSE_PROMPTS=1 sirve el label
      `production` de Langfuse (M10), y la siembra nunca corrió tras el PR
      #29 — guionista/narrador/clasificar seguían en la versión vieja con
      «elige un protagonista concreto» hardcodeado (y cortes/moderar de
      M13-M14 ni existían allá). Arreglo: `tools/prompts_sync.py` corrido
      2026-09-07 (5 sembrados, verificado --dry = 0 pendientes; surte efecto
      sin deploy por el TTL del SDK). **REGLA NUEVA de deploy: todo PR que
      toque `prompts/*.md` termina con `python tools/prompts_sync.py` tras
      el merge — sin eso producción sigue sirviendo el prompt viejo.**
- [x] **Caché de las imágenes de estilo** (rama cache-estilos): en producción
      cada clic de estilo re-descargaba la muestra (hasta ~370 KB) por
      Lambda + API Gateway — StaticFiles no manda Cache-Control. Ahora las
      respuestas image/* de static llevan `public, max-age=86400` (cambian
      solo con deploy; el ETag revalida al vencer); HTML/JS quedan con
      revalidación por ETag para que los fixes de UI lleguen solos.
- [x] **Puente al editor roto en la ruta narración** (rama puente-narracion):
      la primera película M11 en producción (canguro ee202e1a) salió con el
      botón «Editor» deshabilitado — `progreso.editor_error: «escena 1: falta
      audio_1.mp3»`: el puente F1.3 asumía audio POR ESCENA y la ruta
      narración tiene UNA pista (narracion.mp3). Fix: la producción persiste
      el alineado (workdir/alineado.json) y generated_to_canonical lo usa
      directo (gratis, sin re-transcribir; fallback: transcribir
      narracion.mp3 completo); la pista 2 de overlays se salta con aviso (no
      aplica sin audio por escena). ee202e1a REPARADO a mano con el mismo
      flujo ($0, whisper local): gen-ee202e1a en S3 + proyectos_editor +
      progreso.editor — su botón ya abre. 312 tests (2 nuevos del puente).
- [x] **Hub: tooltips en los modos + prompt alineado** (rama hub-tooltips):
      la nota fija bajo los chips se retira — cada botón (Investigación /
      Tengo una idea / enviar ↑) explica lo suyo en un tooltip `data-tip`
      al pasar el cursor o con foco, ANTES de hacer click; y el cuadro
      «¿Qué vamos a crear hoy?» baja 82px para arrancar a la altura de la
      card «Crear imágenes» del sidebar (mock con línea roja del dueño;
      en columna única el margen se quita).
- [x] **Resultado con 3 botones: Descargar · Editor · Rehacer** (rama
      resultado-3-botones): el dueño quería pasar la película terminada al
      editor de cortes SIN pasar por e1 a «subir metraje» — el botón «Editor»
      del resultado abre `/editor/<gen-id>/` leyendo `progreso.editor` (el
      puente F1.3 que producir ya registra); si el puente falló o sigue
      corriendo, el botón se atenúa y lo explica. «Modificar» se renombra
      «Rehacer» (mismo POST /reabrir gratis). Smoke: click en Editor abre
      gen-a44db907 con su transcript.

---

## Fase M14 — Editar en la web (el flujo local de /clean-cut, con botones)

Pedido del dueño 2026-09-07: subir metraje propio, que la IA proponga el corte
(«una corrida en el que salgan las sugerencias de cómo lo editaría la IA») y
aceptar/rechazar en el editor — como era el proyecto local. Las cards de listas
de e1 se van: «Mis ediciones» vive en el hub.

Hecho 2026-09-07 (rama m14-editar-web):
- [x] **Worker de sugerencias en Fargate** (`worker/editar_task.py`, misma
      state machine con otro comando — cero infra nueva): baja el metraje de
      S3 → canónico con AssemblyAI si falta → el LLM propone el corte con
      `prompts/cortes_system.md` (la política de /clean-cut: corta muletillas/
      retakes/aire muerto, SUGIERE fluff, marca dudas en flags; code-switching
      no es error) → `construir_cuts` arma cuts.json donde los keeps son el
      COMPLEMENTO de los cortes (el material jamás se pierde; LLM que corta
      todo = se conserva completo) → `tools/make_proxy.py` genera proxy/
      manifest/waveform → todo a S3, flags cuts/canonico → editor_listo (el
      editor de M7 siembra cortes_versiones v1 y el usuario audita).
- [x] **API** `server/editar_api.py` (calcada de shorts_api): GET estado,
      GET costo (preview ANTES de cobrar), POST sugerir (409 si corre, 413
      >90 min, cobrar antes de lanzar, devolver si no lanza o si el worker
      falla). Tarifa nueva §editar en tarifas.json: sugerencias 2 cr +
      transcripción a la tarifa de shorts si el metraje no trae canónico.
      Concepto `infra-editar` en CONCEPTOS_FARGATE (drill-down del admin).
- [x] **UI**: e1.html = subir (C3, igual) + sección «Corte con IA» del
      proyecto actual (?p=, costo → botón con créditos → poll → Abrir editor /
      Sacar shorts); el hub gana la sección «Mis ediciones» (cards 🎞 con
      estado, click → e1.html?p=). En dev local el corte sigue siendo
      /clean-cut (503 amable).
- [ ] Deploy: imagen del CI + `cdk deploy aws-media-api aws-media-jobs` y
      probar la corrida con un metraje real (gasto: transcripción según
      duración + ~$0.02 dólares del LLM — pedir confirmación).
- [ ] Pendiente de diseño: cuando el corte se apruebe y renderice, el paso a
      subtítulos/publicar desde la web (hoy termina en el preview del editor).

## Fase M15 — Editor de imágenes con FLUX Fill (Crear imágenes v2)

Decisión del usuario 2026-09-08 (revisada el mismo día): **FLUX Fill con
máscara real, para experimentar** — aunque el benchmark favorece al nano
banana en edición por instrucción (Artificial Analysis: nano 981 vs Kontext
pro 876), Fill es inpainting quirúrgico con máscara y el dueño quiere probar
esa experiencia. La anotación con nano banana queda como plan B si la calidad
de Fill decepciona (los dos comparten la UI de señalar).

1. - [ ] `tools/pricing.json`: asentar `fal-ai/flux-pro/v1/fill` $0.05
         dólares/megapixel, facturado redondeando el MP hacia arriba
         (verificado en vivo 2026-09-08 → imagen 1024×1024 = 2 MP = $0.10).
         Tarifa: la edición cobra `imagen_pro` (10 cr) de tarifas.json —
         cubre el peor caso con margen sobre el piso de $0.015/cr.
2. - [ ] `pipeline/media_fal.py`: `imagen_fill(imagen, mascara, prompt)` →
         flux-pro/v1/fill (imagen + máscara binaria PNG + prompt).
3. - [ ] API `POST /api/imagenes/{nombre}/editar` {prompt, mascara_b64}:
         cobra 10 cr, guardrail del prompt, devuelve en fallo, y la versión
         nueva SE AGREGA (regla: versiones jamás se pisan) —
         `_imagenes/<base>-v2.jpg`… con lista de versiones en el GET.
4. - [ ] UI crear-imagenes.html: bajo «Tu imagen» entra «✏️ Modificar» —
         canvas de PINCEL sobre la imagen (pintas la zona a cambiar; grosor
         + deshacer + borrar), la máscara se exporta a la RESOLUCIÓN REAL de
         la imagen (mapeo CSS→píxeles, el punto delicado), prompt del cambio
         y costo en el botón. Tirita de versiones para volver a cualquiera.
5. - [ ] Tests + smoke navegador + deploy `aws-media-api`. Primera edición
         real ~$0.10 dólares — pedir confirmación de gasto.
6. - [ ] Evaluación del experimento: 3-5 ediciones reales comparando Fill
         vs el mismo cambio por instrucción (nano banana) antes de decidir
         el default definitivo.

## Fase M16 — Editor en la nube COMPLETO (hallazgos de gen-ee202e1a, 2026-09-08)

Los 4 síntomas del dueño comparten raíz: `overlays_api`/`broll_api` resuelven
el proyecto con `ruta_proyecto()` (disco local) y corren
`make_subs.py`/ffmpeg como subproceso — en Lambda no hay proyecto ni deben
correr renders (regla C4: renders largos por Fargate). El chat está bloqueado
a propósito desde M7; el dueño ya tiene API key de Claude para habilitarlo.

1. - [x] **Subtítulos en nube** (PR #39): rama nube en overlays_api — la
         MUESTRA (1 frame) corre en la Lambda contenedor bajando solo
         pelicula.mp4 + edited-transcript.json (`media_sync.bajar_archivo`);
         `/archivo/…` en nube redirige al CDN; el QUEMADO va a Fargate por la
         SM de siempre (`worker/subtitulos_task.py` → pelicula-subtitulado
         + .srt/.ass a S3 → `doc.subtitulos` con candado de 2 h). Tarifa
         0 cr; registra `infra-subtitulos`. 12 tests.
2. - [x] **Recursos IA de la ruta narración** (PR #40): narracion.py persiste
         `estado.json` (prompts reales por ventana, como la ruta escenas) y
         el puente registra los `final_N.mp4` como pista 2 con
         `pista_unica=True` (variante de `crear_desde_produccion`: sin
         audio.mp3 por overlay, la voz continua se copia a
         `work/overlays/narracion.mp3`). Regenerar una ventana usa
         `recorte_reemplazo` (video-only) y `rearmar_pelicula` concatena
         video y muxea la narración encima (-shortest) — la voz se conserva.
         `GET /api/overlays` gana rama nube (lee overlays.json de S3), así
         el editor pinta los recursos; los modales g1/g2 en nube muestran
         versiones pero regenerar sigue local hasta M16.3. 8 tests.
3. - [x] **B-roll IA + regeneración en nube** (PR #41): sugerir lee
         transcript/manifest/overlays de S3, cobra `editar.broll_sugerencias`
         (2 cr, tarifas.json nuevo) con devolución si el LLM falla y guarda
         las propuestas en el overlays.json de S3. Candidatos de imagen (g2
         paso 1) corren en la Lambda: referencia de S3 (imagen base activa o
         frame del clip), 2 × nano banana → S3, tarifa `imagen`×2 = 4 cr con
         devolución en fallo del vendor. Animar con Veo y activar versión
         van a Fargate (`worker/overlay_task.py`, params por
         `doc.overlay_job`, campo nuevo del jsonb_set): Veo → recorte (pista
         única) o mux (escenas) → versión nueva → `rearmar_pelicula` con
         proxy → subir proyecto; tarifa = `video.por_segundo` × segundos de
         Veo (12/18/24 cr — la regla «re-generar una escena» de tarifas.json)
         cobrada al lanzar y DEVUELTA por el worker si el job falla; activar
         = 0 cr. `/precios` en nube agrega `creditos` y la UI muestra
         créditos en vez de USD; g1 hace poll de `/api/overlays/job`;
         `infra-overlay` en costes. 20 tests (test_m16_broll_nube.py).
4. - [x] **Chat editorial en nube** (PR #42): CONSEJERO con la API de Claude
         (SDK `anthropic==1.4.0` pinado, modelo `claude-opus-5` con effort
         low + fallback de refusal en la misma llamada) —
         `pipeline/chat_nube.py`: clave por-usuario D4 en SSM
         `/media-ivenaccip/usuarios/<id>/CLAUDE_API_KEY` (nueva en
         CLAVES_USUARIO de ssm_env.py; pisa a la de plataforma, fallback al
         entorno), system = `prompts/chat_editor_system.md` (sembrable M10,
         con cache_control) + transcript condensado de S3, historial en
         `doc.chat` (campo nuevo), CADA turno trazado como generation en
         Langfuse con user_id y tokens. Tarifa 0 cr con tope
         `CHAT_TURNOS_DIA` (40) — medir gasto real en Langfuse antes de
         tarifar. Smoke real: 1 turno ≈ $0.01 dólares (543 in / 287 out).
         La v1 aconseja anclada en segundos y NO edita cuts.json (eso sigue
         en el chat local con claude-agent-sdk; darle herramientas es la
         siguiente iteración si el dueño la quiere). 10 tests
         (test_m16_chat_nube.py).
5. - [ ] Orden sugerido: 1 (subtítulos: lo que el dueño intentó y falló) →
         2 (recursos) → 3 (b-roll) → 4 (chat). Deploy por iteración:
         imagen del CI + `cdk deploy aws-media-api aws-media-jobs`.

## Capacidad y escalado (medido 2026-09-13)

Medición real de la infra con 5 testers, antes de abrir a 161 personas más:

| qué | medido |
|---|---|
| Aurora, ACU consumidos | media diaria 0.01–0.19; picos que tocan el techo de 1.0 |
| Conexiones a la base | media ~1, máximo 7 |
| CPU de Aurora | media 1.5–8.8%, con picos sobre 400% |
| Gasto AWS, 30 días | menos de un centavo (free tier salvo Fargate y Lambda) |

Lectura: la base está dormida casi todo el tiempo y se queda corta un instante
cuando despierta. No está ahogada; roza el techo.

**Decisión del dueño (2026-09-13):** la configuración actual se queda así para
esta tanda. De los 166 no todos usarán el producto, y menos a la vez —
dimensionar para 166 simultáneos sería pagar por un pico que no va a ocurrir.

**Antes del 23 de septiembre de 2026**, subir:

- `serverless_v2_max_capacity` de 1 a 4 — `infra/stacks/db.py:31`
- `max_concurrency` de Fargate de 2 a 4 — `infra/stacks/jobs.py:97`

Y de ahí en adelante, escalar con la medición, no con la intuición: repetir
esta tabla y mover los topes según lo que diga.

**El techo de Aurora no es una reserva.** Serverless v2 cobra por ACU-hora
consumido, así que subir el máximo de 1 a 4 no multiplica la factura — solo
levanta el límite al que puede llegar si hace falta. Si la carga no sube, la
factura tampoco. Lo mismo con `max_concurrency`: es un tope de paralelismo, y
las tareas de Fargate se pagan por el tiempo que corren, no por el permiso.

## Arranque en frío y el tamaño de la imagen (medido 2026-09-13/14)

Buscando qué endpoint se comía los 29 s del timeout apareció otra cosa: **los 70
intentos de init de los últimos 7 días terminaron en `Status: timeout`. Los 70.**

```
INIT_REPORT  Init Duration: 10000.00 ms   Phase: init   Status: timeout
```

Lambda concede 10 segundos para inicializar. Cuando no alcanzan, aborta y repite
la inicialización *dentro* de la invocación — y esa sí se factura. Medido contra
producción con un `GET /api/auth/config`:

| | |
|---|---|
| lo que esperó el cliente | **22,15 s** |
| lo que midió el middleware (el handler) | **47 ms** |
| lo que facturó Lambda | 11.183 ms |

Un endpoint de 47 milisegundos. El resto era arrancar. Con 5 testers eso pasa
inadvertido; con 166 y contenedores nuevos a la vez, no.

**La métrica engaña, y por eso no se había visto.** `Init Duration` en el REPORT
solo aparece cuando el init *cabe*; los que revientan salen aparte, en
`INIT_REPORT`. La media de 3.807 ms que reporta CloudWatch es la de los que
sobrevivieron — el peor caso no estaba en ninguna gráfica.

### Lo que ya se arregló (PR #73)

El culpable no era ffmpeg ni Chromium: era una línea de Python.

```
server/app.py:19  →  pipeline/character.py:15  →  pipeline/llm.py
                                                  from langfuse.openai import AsyncOpenAI
```
(la línea del import, tal como estaba antes del #73)

Ese import arrastra el SDK de OpenAI entero en cada arranque, en una Lambda
donde la inmensa mayoría de las peticiones no llaman a ningún LLM. `client()` ya
era perezoso; el import no.

```
import server.app     4.745 ms  →  1.211 ms   (-74%)
módulos cargados      2.342     →    998      (-57%)
```

Lo que queda del arranque ya es irreducible sin romper la instrumentación:
langfuse core 514 ms, fastapi 389 ms. `tests/test_arranque.py` lo vigila desde
un intérprete nuevo — `sys.modules` contaminado por otros tests mentiría.

### Lo que queda: separar la imagen

Una sola imagen sirve a los tres runtimes (`Dockerfile`), y pesa **1.664 MB
comprimida en 17 capas**. Cuatro se llevan el 88%:

| capa | comprimido | qué |
|---|---|---|
| 1 | 467,6 MB | `pip install -r requirements.txt` |
| 2 | 445,9 MB | modelo faster-whisper `small` horneado (`Dockerfile:64`) |
| 3 | 354,1 MB | apt: ffmpeg + Chromium + fuentes |
| 4 | 199,7 MB | Node 20 + los dos `npm ci` de Remotion |

Coste hoy: el init facturado son **1.294,6 s de los 5.756,8** de Lambda en 7
días — el **22,5%**. Poco dinero en absoluto ($0.03 dólares), pero escala con
los usuarios.

Bloques que la Lambda del API no usa y que son candidatos claros:

- **El modelo faster-whisper está doblemente muerto en el API**: se hornea como
  root (cache en `/root/.cache`) pero `infra/stacks/api.py:50` fija `HOME=/tmp`,
  así que ni por accidente lo encontraría.
- **`remotion-longform/` es peso muerto puro en la nube**: cero invocaciones
  desde `worker/`, `server/` o `pipeline/` — solo lo usan `tools/bake.py` y
  `tools/update.py`, que son herramienta local.
- **`claude-agent-sdk`** son 275 MB (`requirements.txt:34`), de los que 274 son
  un binario CLI embebido.

### Lo que hay que saber ANTES de separarla

Verificado con evidencia; cada punto habría roto producción si se hubiera hecho
a ciegas.

**1. El API sí ejecuta ffmpeg — en cuatro rutas, no en una.**

| dónde | qué corre |
|---|---|
| `server/shorts_api.py:75` | `ffprobe` contra el CDN para el preview de costo |
| `server/overlays_api.py:159` | `ffmpeg` |
| `server/overlays_api.py:199` | `ffmpeg -ss` — extrae un frame de referencia |
| `server/importar_api.py:59` | `ffmpeg` para la miniatura de un MP4 suelto |

La de `shorts_api` es innegociable: sostiene el preview de costo, y *corrida en
nube sin preview de costo = bug* es regla dura del repo.

**2. Esos tres sitios hardcodean el nombre del binario e ignoran `FFMPEG_BIN`.**
Solo `pipeline/` respeta la variable (`pipeline/config.py:28`). Instalar un
ffmpeg estático y apuntar la variable **no serviría**. Y no hay comprobación al
arrancar: el fallo saldría en la primera petición de un tester, no en el deploy.

**3. Ningún test lo detectaría.** Los 38 archivos de `tests/` mockean el
subproceso sistemáticamente. La separación necesita gates **nuevos** que corran
dentro de la imagen construida: `ffprobe -version`, `ffmpeg -filters | grep ass`,
`fc-match Arial`, `python -c "import server.lambda_handler"` y un segundo que
fuerce los imports perezosos (`jwt`, `cryptography`, `anthropic`, `boto3`).

**4. Las fuentes fallan en silencio.** `tools/make_subs.py:166` usa `Arial` por
defecto y `:130` lo escribe literal en el `.ass`. Debian slim no lo trae: existe
solo como alias de fontconfig que aporta `fonts-liberation` (`Dockerfile:13`).
Sin esa fuente, ffmpeg devuelve **returncode 0** y sube un PNG mal renderizado —
un smoke test que compruebe HTTP 200 lo da por bueno.

**5. Hay dos variables que deciden "estoy en la nube", no una.**
`STATE_BACKEND=postgres` (`infra/stacks/api.py:53`) gobierna `_nube()` en
shorts/editar/editor, pero `server/app.py:452-458` y `:704-710` gatean con
`JOBS_BACKEND` (`api.py:62`), cuyo default es **`local`** (`pipeline/jobs.py:21-22`).
Si la imagen ligera se queda sin `JOBS_BACKEND`, el `else` ejecuta el pipeline
**dentro** del proceso Lambda, arrastrando ffmpeg y el `from faster_whisper
import WhisperModel` perezoso de `pipeline/narracion.py:86`. Hay que cablear las
dos.

**6. La imagen ligera no puede ser solo `server/` + `pipeline/`.** Necesita
además `worker/env_ssm.py` (`server/lambda_handler.py:11`), `tools/editor/`
(`server/editor.py:29-30`), `tools/make_subs.py`, `tools/hwenc.py`,
`tools/costes.py` (`server/admin_api.py:245`), `static/` (`server/app.py:764`) y
el `mkdir -p /data/videos /data/work` de `Dockerfile:74`, sin el cual
`videos_root()` deja de existir.

**7. `requirements.txt` es monolítico** (líneas 13-57: núcleo + shorts + longform
+ server + tests). Sin partirlo, la imagen ligera repite los **56,2 s de `pip`**
que son un tercio de los 162 s del build, y buena parte del tamaño.

### Cómo hacerla, cuando toque

**Dos tags en el mismo repositorio ECR, no dos repositorios.** ECR deduplica las
capas comunes dentro del repo, `docker push --all-tags`
(`.github/workflows/docker.yml:90`) no necesita cambios, y se evita crear el repo
a mano, ampliar el `grant_push` (`infra/stacks/base.py:36-37`) y tocar el IAM de
pull de Fargate.

Trampas del CDK, verificadas:

- `_digest_latest()` (`infra/app.py:38-51`) tiene el nombre del repositorio
  **cableado** en `:46` y un `except Exception` en `:48` que devuelve la cadena
  `"latest"` con un aviso por stderr. Un tag mal escrito **no rompe el synth**:
  degrada en silencio a `repo:latest`, que es justo el fallo que CloudFormation
  no detecta porque la cadena no cambia.
- `image_ref: str = "latest"` es valor **por defecto** en las dos firmas
  (`api.py:29`, `jobs.py:43`). Un segundo parámetro con el mismo default se
  desplegaría en verde apuntando a la imagen equivocada.
- Mientras se conserven los construct ids `"Api"` y `"Worker"`, cambiar la
  ImageUri es una actualización, no un reemplazo.
- El push de las dos imágenes **no es atómico**: si una pasa y la otra falla, los
  runtimes quedan en builds distintos y el `cdk deploy` los cablea sin quejarse.

Y el CI: `tests/test_flujo_ramas.py` indexa los **nombres exactos** de los pasos
del workflow (`_paso`, líneas 32-36), así que desdoblar «Build de la imagen» o
«Suite de tests dentro del contenedor» rompe esos tests a propósito — hay que
actualizarlos en el mismo PR.

### Decisión pendiente

Con el #73 desplegado, la pregunta que contesta el próximo `INIT_REPORT`:

- **si pasa a `Status: success`** → la separación es optimización de coste y
  espera a después del 23 de septiembre;
- **si sigue en `timeout`** → hay que separarla antes de abrir a 161 personas.

## Fase M22 — Lo que reportaron los testers (2026-09-14)

Diez reportes de la primera tanda, a nueve días de abrir a 166 usuarios. El
orden de abajo no es el orden en que llegaron: primero va lo que cobra mal o
impide usar algo ya pagado, luego lo que falta, y al final lo que es producto
nuevo. Cada punto se verificó contra el código o contra la base ANTES de
clasificarlo — varios no eran lo que parecían.

### Clasificación

| # | Lo que reportaron | Qué es en realidad | Prio |
|---|---|---|---|
| 10.2 | «Solo me devolvió la mitad de los créditos» | Cierto y medido. Un video de **6 segundos**: se cobraron 4 cr de `editar-sugerir` + 4 de `shorts-analizar`; shorts falló y devolvió, editar terminó «listo» con 0 cortes y se quedó el cobro. Hay tope de 90 min y **ningún piso** | **P0** |
| 10.1 | «Shorts no procesó la liga de YouTube» | El campo de la liga solo existe sin proyecto abierto: `sec-importar` se revela únicamente dentro de `elegirProyecto()`, que solo corre si la URL no trae `?p=` | **P0** |
| 1 | «El editor solo edita sobre lo pintado» | El prompt se lo prohíbe explícitamente: «Keep every other part of the original pixel-identical». Y la máscara es obligatoria en el endpoint | **P0** |
| 4 | «No hay botón de descargar en algunos casos» | Faltan en tres sitios, y donde hay enlace al CDN el atributo `download` es **ignorado por el navegador** (cross-origin): hace falta `Content-Disposition` | **P0** |
| 3 | «Los prompts de Grok salen en inglés» | El prompt en inglés es correcto (da mejores imágenes); el error es enseñárselo crudo al usuario y precargar con él el campo que edita | **P1** |
| 2 | «No hay formato vertical» | 16:9 cableado en cuatro sitios del pipeline. Remotion ya está resuelto: shorts es 1080x1920 y longform es parametrizable | **P1** |
| 5 | Paso intermedio imagen → video, auto/manual | Hoy `producir` genera imagen y video de golpe. Cambia la máquina de estados de producción, la UI y el cobro | **P2** |
| 8 | Voces por personaje (máximo 2) | Hoy es una decisión de diseño explícita: «Una sola voz narrará TODO el guion». Toca casting, narración, TTS y UI | **P2** |
| 6 | Efectos de sonido | No existe nada en el servicio. Existe en el flujo local (`tools/gen_sfx.py` + catálogo) sin portar | **P2** |
| 9 | Sonido ambiente por liga de YouTube | No existe, y antes de construirlo hay que resolver de quién es esa música | **P2** |
| 7 | ¿Cuánto cuesta una canción con Lira? | Solo investigación. Hoy la música local sale por ElevenLabs Music | **Aparte** |

### P0 — antes del 23 (cobran mal o impiden usar lo pagado)

**A · Piso de duración y la devolución que falta.** ✅ CÓDIGO LISTO (2026-09-14,
falta deploy). Queda reparar a la usuaria: 4 créditos de ajuste, comando del
dueño. `MAX_DURACION_S` tiene pareja:
un mínimo por debajo del cual el análisis no puede dar nada. Shorts necesita
metraje para recortar (un short dura 5-90 s, un video de 6 s no da ninguno) y
las sugerencias de corte necesitan material del que sobre algo. El cobro se
rechaza ANTES, en el preview de costo y en el POST, con un mensaje que diga la
duración real y la mínima. Y la otra mitad: una corrida que termina sin
entregar nada (0 cortes, 0 candidatos) devuelve los créditos — hoy solo
devuelve si lanza excepción.

**B · La liga de YouTube, visible siempre.** ✅ CÓDIGO LISTO (2026-09-14, falta
deploy). El `hidden = false` de `sec-importar` sale de `elegirProyecto()`: la
sección aparece también con un proyecto abierto, y se esconde solo mientras ESE
proyecto se está descargando.

**C · El editor de imágenes, con dos modos.** ✅ CÓDIGO LISTO (2026-09-14,
falta deploy). «Transformar toda la imagen» junto al pincel: instrucción propia
sin la cláusula pixel-identical y sin exigir máscara. El modo pincel se queda
igual — es el que funciona bien. Misma tarifa: una llamada a Nano Banana es una
llamada.

**D · Descargas de verdad.** ✅ CÓDIGO LISTO (2026-09-14, falta deploy). Los
tres huecos (imágenes candidatas del editor, preview de render, shorts) más el
arreglo de fondo —`Content-Disposition: attachment` firmado por S3, porque
`download` no cruza orígenes— y uno que no estaba en la lista y era el peor:
**en el servicio, el modal de Publicar no enseñaba nada**. `descargables()` lee
el disco del proyecto, que en la Lambda no existe, así que la película estaba
hecha en S3 y no había forma de bajarla. Ahora se lista desde S3.

Lo que quedó pendiente ahí (sugerir títulos y agendar en Blotato también
leían ese disco) se resolvió en M23 C2.

### P1 — antes del 23 si el tiempo aguanta

**E · El prompt, en español para el usuario.** Enseñar y editar en español,
traducir a inglés al mandarlo al modelo, y guardar las dos versiones (el
usuario vuelve a abrir y tiene que leer lo suyo, no lo del modelo).

**F · Formato vertical.** ✅ CÓDIGO LISTO (2026-09-14, falta deploy). El aspecto
deja de ser una constante y pasa a ser un campo del proyecto, elegido al
crearlo y fijo desde entonces (media.py pide el aspecto en cada llamada: una
película a medias con dos aspectos no concatena). Los cuatro sitios cableados a
16:9 —Grok, Veo, el Veo del editor y el lienzo del clip de respaldo— leen ahora
una sola tabla en `pipeline/models.py`.

Los dos valores se verificaron contra el schema de fal antes de construir nada:
Veo 3.1 lite acepta exactamente `auto`, `16:9` y `9:16`.

El b-roll del editor **no** elige: hereda. Su imagen ya se generaba desde un
frame del video base, y ahora Veo deduce el aspecto de esa imagen en vez de
pedir 16:9 a ciegas. Remotion estaba resuelto por los dos lados (shorts ya es
1080x1920; el longform toma las medidas del timeline y es del flujo local).

Esto responde la pregunta abierta 5 de este plan: «Reels» y «Crear contenido»
son el mismo flujo con un formato distinto, no dos secciones.

### P2 — después del 23

**G · Imagen aprobada antes de animar (auto/manual).** ✅ CÓDIGO LISTO
(2026-09-14, falta deploy). El argumento no es solo
de UX: la imagen cuesta $0.02 dólares y animarla ocho segundos cuesta $0.24
dólares. Aprobar antes de animar es doce veces más barato que rehacer después,
y es lo que convierte «no me gustó» en algo que el usuario arregla sin pagar
otra producción entera.

Cómo quedó: la producción se parte en DOS tareas —una llega hasta las imágenes
y termina, la otra la retoma— en vez de pausar el contenedor. Un Fargate de 4
vCPU parado esperando a una persona cuesta $0.198 la hora y muere a las 2 h de
timeout; una tarea que acaba no cuesta nada, y el usuario puede tardar lo que
quiera. La fase viaja como un argumento más del comando, así que **no toca la
state machine ni el task definition: no pide deploy de CDK**.

Lo que se aprueba son las CABEZAS de cadena, no todas las escenas: una escena
«continua» arranca del último frame del clip anterior, que no existe hasta
animar. Cinco escenas con dos cortes = dos imágenes. La pantalla lo dice («esta
imagen manda en 3 planos»), porque prometer control sobre las otras sería
mentir.

El dinero: producir cobra igual (la película entera, por adelantado); animar no
cobra nada; pedir otra imagen cuesta la tarifa de imagen con gate 428 antes; y
cancelar devuelve lo que no se gastó —la producción menos las imágenes
quemadas—, que es la otra mitad de la regla de A: nadie paga por lo que no
recibió.

Hay que mirar una línea en `worker/producir_task.py`: la devolución disparaba
con `estado != "listo"`, así que una película parada a enseñar imágenes habría
devuelto el importe completo mientras el trabajo seguía vivo. Ahora devuelve el
FALLO, que es `"error"`.

**H · Dos voces.** ⏸️ **APLAZADO (decisión del dueño, 2026-09-14): no entra en
este ciclo.** Queda documentado aquí para no volver a mapearlo desde cero.

Empezar por el máximo que pidió el usuario: dos personajes. Es más grande de lo
que parece, y esa es la razón del aplazamiento.

Media pieza ya está hecha: `Scene.voz` existe y `tts.py` la respeta
(`e.voz or VOZ_DEFAULT`), así que el pipeline de **escenas** está a un
`model_copy` de soportar dos voces — hoy `flow.py` pisa todas las escenas con
la misma `p.voz`. Lo que falta no es eso:

- **El pipeline por defecto es narración, y su premisa es UNA llamada de TTS**
  con el texto completo. De ahí salen la prosodia continua y la duración real
  medida que hicieron innecesario el gate de palabras/segundo (es el motivo de
  ser de M11). Repartir turnos obliga a concatenar audio —no hay helper en
  `ffmpeg.py`—, a correr todos los tiempos del alineado por offset acumulado, y
  devuelve el problema de entonación que M11 resolvió.
- **No existe la materia prima.** Los dos guionistas tienen el diálogo prohibido
  por prompt: «Sin diálogos entre comillas; si un personaje habla, nárralo». No
  hay turnos que repartir hasta que eso cambie.
- **`Scene.personajes` significa quién APARECE, no quién habla**, y solo lo
  consumen las referencias de imagen y la validación de transiciones. Si se
  reusa para marcar hablantes, `ordenar_cola` degrada «continua» a «corte»: más
  cadenas, más clips de Veo, más dinero.
- **Dos voces implican dos caras.** `Proyecto.personaje` es singular y la UI
  ofrece un solo juego de opciones. Entregar solo la voz da un segundo
  personaje que habla y no tiene aspecto consistente.

El dinero no es el problema: el TTS se cobra por caracteres (~$0.05 dólares en
una narración de 45 s) y `costo_producir` va por duración objetivo, así que dos
voces no mueven ni un crédito.

De ese mapeo salió un bug vivo, arreglado aparte: `armar_sub_escenas` no
copiaba `voz` ni `formato`, así que una escena partida por duración se narraba
con la voz por defecto y —desde M22 · F— salía apaisada dentro de una película
vertical, sin excepción ni devolución.

**Cuando se retome, el orden es este** (cada paso se puede parar y sigue
dejando el producto entero):

1. **Permitir el diálogo en los guionistas.** Hoy está prohibido por prompt en
   `guionista_system.md` y `narrador_system.md`. Sin turnos escritos no hay nada
   que repartir, así que este paso va primero aunque se siga con una sola voz —
   y solo cambiando eso ya se ve si el guion mejora o empeora.
2. **Marcar quién habla, en un campo NUEVO.** No reusar `Scene.personajes`: hoy
   significa «quién aparece en el plano» y `ordenar_cola` degrada las
   transiciones «continua» cuando cambia — más cadenas, más clips de Veo, más
   dinero por un cambio que era de audio.
3. **Bajar las voces del proyecto a las escenas en UN solo sitio**, con un
   `con_voces()` calcado de `con_formato()` (misma razón: si una escena se
   queda sin ella, cae a la voz por defecto y nadie se entera). El pipeline de
   **escenas** termina aquí: `Scene.voz` ya existe y `tts.py` ya la respeta.
4. **Solo entonces, narración.** Es el trabajo grande: concatenar audio (no hay
   helper en `ffmpeg.py`), correr todos los tiempos del alineado por offset
   acumulado y seguir dejando `narracion.mp3` + `alineado.json` como los espera
   el puente al editor. Aquí se paga el precio de M11: se pierde la prosodia
   continua y vuelve el gate de palabras/segundo.
5. **La segunda cara.** `Proyecto.personaje` es singular; sin esto el segundo
   personaje habla y no tiene aspecto consistente entre planos.

Compatibilidad: `Proyecto.voz` es un `str` persistido en Aurora y en
`proyecto.json`. Convertirlo en lista rompe la carga de todos los documentos
existentes — el camino seguro es un campo NUEVO con default, como se hizo con
`formato` en M22 · F, y su test de regresión.

**I · Efectos de sonido**, portando lo que ya existe en local. ⏸️ **APLAZADO
(decisión del dueño, 2026-09-14): de momento no se construye con Lyria.**
Mapeado el mismo día: **portar no es copiar, y ahí está el bloqueo.**

Lo local es un subsistema completo (skill que elige los cues leyendo el
timeline, `tools/gen_sfx.py` contra ElevenLabs, catálogo con procedencia por
clip, `tools/mix_sfx.py` con duck y limitador). Pero la **decisión D2** ya
declaró esa librería *descartada del producto* y el Dockerfile no la copia: los
33 clips están licenciados «commercial use per the account's ElevenLabs plan»
—la cuenta del autor upstream—, y 4 de ellos traen `license: null`. Servirlos a
166 usuarios es exactamente lo que D2 prohibió.

Así que quedan dos caminos, y son **la misma decisión que J**: generar por
proyecto (cada cue cuesta dinero: tarifa nueva, endpoint de fal cuyo precio no
está en `pricing.json`, preview antes de cobrar) o construir una biblioteca
propia con licencia en S3, servida como ya se sirven las muestras de voz.

Lo técnico ya está resuelto por lo local y hay que respetarlo: mezcla por gain
relativo + `alimiter`, **nunca `loudnorm`** (el master alimenta a shorts, que sí
normaliza). Y ojo con `rearmar_pelicula`: reconstruye la película cada vez que
el usuario activa otra versión de b-roll —gratis, o sea a menudo— y borraría la
pista de efectos en silencio.

**J · Sonido ambiente.** ⏸️ **APLAZADO junto con I (2026-09-14): es la misma
decisión de fuente, y de momento no se construye con Lyria.** Antes de
diseñarlo hay que decidir de dónde sale el audio: una
liga de YouTube mete música de terceros en videos que los usuarios van a
publicar. Una biblioteca con licencia propia evita ese problema entero.

Mapeado el 2026-09-14. Tres cosas que cambian el diseño:

- **La liga de YouTube no está a mano.** No hay `yt_dlp` en el repo: M17 baja
  video con un actor de Apify. Extraer el audio de una canción es otro producto
  —y el reclamo de Content ID caería sobre el usuario, con nuestro botón en
  medio.
- **La película del servicio es la FUENTE de otros cuatro flujos.** Una cama
  continua horneada ahí rompe el detector de silencios del editor (el piso de
  ruido sale del wav de la película), ensucia el ASR de `verify_cut`,
  desincroniza los subtítulos y llega a `export.sh` de shorts, que normaliza
  otra vez.
- **La biblioteca local no es reutilizable**, por lo mismo que I: seis camas
  licenciadas a la cuenta del autor upstream, excluidas por D2.

### Investigación aparte

**K · Lira.** ✅ INVESTIGADO (2026-09-14). «Lira» es **Lyria**, de Google
DeepMind. Lo que hay que saber:

| | Lyria 3 Pro | ElevenLabs Music (lo de hoy) |
|---|---|---|
| Precio | $0.08 dólares **por pista** | $0.15 dólares **por minuto** |
| Duración | 3 min tope, **sin parámetro** | hasta 5-10 min, exacto por `music_length_ms` |
| Instrumental | por prompt, sin garantía | `force_instrumental: true`, garantizado |
| Watermark | **SynthID + C2PA, siempre** | ninguno documentado |
| Stems | no | no |

Una pista de 3 minutos: **$0.08 con Lyria contra $0.45 con ElevenLabs
directo** — y **$1.80 si se pide por fal**, que le carga 4× a ElevenLabs Music
(a Lyria no le carga nada: cobra lo mismo que Google). Regenerar las seis camas
de la paleta pasa de ~$2.70 a ~$0.48.

Los precios son de las páginas de los proveedores, verificados el 2026-09-14.
**No están en `tools/pricing.json` y ninguna línea de código puede usarlos
hasta que se añadan ahí**, que es donde vive el precio en dólares.

Lo que decide entre una y otra no es el precio:

- Para **stingers, intros, transiciones y camas de shorts** (todo por debajo de
  un minuto), Lyria gana sin discusión: es 5.6× más barato y entra por fal, que
  ya tiene cliente, semáforo, timeout y traza.
- Para **la cama continua de un longform**, ElevenLabs sigue ganando: Lyria no
  llega a los 3 minutos ni tiene parámetro de duración —el largo se sugiere con
  timestamps en el prompt— y `force_instrumental` importa mucho cuando la
  música va DEBAJO de una voz.
- El **SynthID no se puede apagar**. Es inaudible, pero marca la pista como
  generada por IA de Google: si YouTube o TikTok leen esa firma, el video puede
  quedar etiquetado solo. Ese es el costo real de Lyria y no se paga en dólares.

Y una conclusión que vale aunque no se toque Lyria: si se queda ElevenLabs, que
sea por su API directa y **no por fal**, donde hay 4× tirado.

Sin confirmar: si Lyria entra en la indemnización de propiedad intelectual de
Google Cloud, qué hace exactamente cada plataforma con SynthID/C2PA, y cuánto
tarda una pista de 3 minutos (hace falta para elegir el timeout).

**Decisión (2026-09-14): de momento NO se construye.** La investigación queda
aquí para cuando toque; lo único que se aprovecha desde ya es el dato de que
ElevenLabs Music por fal cuesta 4× lo que cuesta directo — si algún día se usa
música en el servicio, no se pide por ahí.

## Fase M23 — Imágenes en una sola herramienta, Blotato por usuario y MIX (2026-09-16)

Petición del dueño: unir el creador y el editor de imágenes (la diferencia real
es si hay imagen), añadir horizontal/vertical, una UI que quepa en la pantalla,
conectar la clave de Blotato para las tres secciones «próximamente» y una
función **MIX** que produzca y publique sola a la hora que se elija. El análisis
de factibilidad (25 agentes, con verificación cruzada) dijo que todo se puede;
estas son las decisiones que tomó el dueño y el orden que sale de ellas.

### A · Imágenes en una sola herramienta ✅ CÓDIGO LISTO (2026-09-16)

Decisión: empezar ya, con el modelo actual, en una página NUEVA que convive con
las dos viejas y que **no se enlaza en el menú hasta validarla**.

- `static/imagenes.html`: sin imagen = crear (estilo + **formato** horizontal,
  vertical o cuadrado); con imagen = «Cambiar una zona» (pincel) o
  «Transformar toda» (con el estilo como destino, **solo si el usuario lo
  elige**: el «Animado» marcado por defecto contaminaba «pásala a acuarela»).
  «Seguir editando», paleta «/», pegar y arrastrar. Cabe sin scroll en
  1366×768 y se apila en el teléfono.
- Backend compatible: `formato` en `POST /api/imagenes` (tabla propia, no
  `FORMATOS`: Veo no acepta 1:1), `estilo` en `/editar` (solo modo `todo`) y
  `GET /api/imagenes/{nombre}/archivo` (bytes desde nuestro origen: el CDN no
  manda CORS y ensucia el canvas).
- **Corrección de seguridad de paso:** en la nube, `/tmp/work/_imagenes` lo
  comparten todos los usuarios del contenedor caliente, y `ver_imagen` servía
  de ahí sin mirar el dueño. Ahora en la nube la copia local se borra tras
  subirla y nada se sirve del disco.
- [x] Validar en producción entrando directo a `/imagenes.html` (el dueño la
      aprobó y pidió el rediseño de abajo).
- [x] Una sola entrada en el menú («Crear imágenes» → `/imagenes.html`) y
      las dos páginas viejas se quitaron: sus URLs redirigen (302) a la
      nueva, la del editor con `?editar=1`.

**A2 · La pantalla de «Crea tu video» (2026-09-16).** Petición del dueño tras
ver la cuadrícula de crear video:

- Misma cuadrícula: estilo (1) + texto (2) arriba y, en lugar de la
  duración, los **tres formatos** abajo (horizontal, vertical y cuadrado).
- Título centrado y más grande, también en «Crea tu video». En imágenes la
  primera palabra gira: **Crea / Edita / Bocetea** (quieto si el sistema pide
  menos movimiento).
- **Editar sin página aparte.** Si el texto pide editar («edítala», «mi
  foto», «retoca»…), al subir o pegar una imagen, o al terminar de crear una,
  la cuadrícula pasa a editar: la imagen grande (2 × 2) con el pincel y a la
  derecha «¿Qué cambiamos?» con dos botones (cambiar una zona / transformar
  toda) y el texto. Pedir editar sin imagen nunca crea una imagen nueva.
- **«Mis imágenes»** en el inicio, entre «Mis proyectos» y «Mis ediciones»:
  las 5 más nuevas + «Ver todas», y cada una se abre para seguir editándola
  (`/imagenes.html?img=<nombre>`). `GET /api/imagenes` lista la carpeta del
  usuario del token en S3 (en local, el disco). Las imágenes creadas antes de
  este cambio también aparecen.

### B · Modelos a elegir, con su costo en créditos (después)

Decisión: de momento se queda Nano Banana; después, que el usuario elija entre
varios modelos viendo cuánto cuesta cada uno en créditos.

**Fecha dura:** Google apaga `gemini-2.5-flash-image` el **2026-10-02**
(tabla oficial de deprecaciones, verificada el 16-sep), y `fal-ai/nano-banana`
es ese modelo. Dependen de él: crear y editar imágenes, las opciones de
personaje de M1, los candidatos de b-roll (g2) y `GEMINI_IMAGE_MODEL`. Así que
el selector, o al menos el cambio de modelo, tiene que estar antes de esa fecha.

- **Tarifa por modelo** en `tools/tarifas.json`, no fija. Hoy la imagen se
  cobra a 2 créditos y cuesta $0.04 dólares (`pricing.json`): en el pack de
  1200 se vende a $0.03 — **se pierde dinero en cada imagen**.
- **Trampa conocida:** `pipeline/pricing.py` reconoce el modelo con
  `"nano-banana" in app`, y eso también casa con `nano-banana-2` y
  `nano-banana-2-lite`: registraría mal el costo. Cada modelo necesita su clave.
- Candidatos: Nano Banana 2 Lite para crear (público en fal; su `/edit` estaba
  oculto y sin precio el 16-sep), Nano Banana 2, Grok edit (ya integrado,
  `pricing.json`). Para editar hace falta un A/B pagado (pedir permiso).

### C · Blotato: cada usuario trae su clave (después del 23)

Decisión: cada usuario conecta SU clave (y paga su plan de Blotato).

**Sin clave, el grupo del menú se apaga entero** (decisión del dueño, 18-sep).
El día del lanzamiento casi ninguno de los 182 va a tener clave, así que tres
entradas del menú serían callejón sin salida: se ven apagadas, dicen por qué y
el clic abre el diálogo de conectar en vez de llevar a una pantalla que solo
sabe responder «conéctala». **No se esconden**: escondidas, nadie descubre que
el producto sabe agendar y medir.

Dos cosas que se decidieron a sabiendas y no hay que «arreglar»:

- **«Investiga tu competencia» se apaga con las otras dos aunque NO use
  Blotato** — corre con Apify y funcionaría sin ninguna clave. Se eligió que el
  grupo se comporte como un bloque antes que tener una entrada portándose
  distinta que sus vecinas. Un test lo fija para que nadie le quite el atributo
  creyendo que es un error.
- **Si `/api/blotato` falla, no se apaga nada.** Dejar sin sus herramientas a
  quien sí pagó, porque un fetch no respondió, es peor que dejar entrar a quien
  no: el backend responde 409 igual.

Va en entregas, cada una con su PR:

- [x] **C1 · Conectar la clave** (2026-09-16, rama `blotato-clave-usuario`):
      almacén por usuario (`pipeline/claves_usuario.py`), `GET/POST/DELETE
      /api/blotato`, el «+» del inicio abre el modal con el aviso del cobro
      (precio desde `pricing.json` §`blotato_suscripcion`), `pipeline/blotato.py`
      recibe la clave en cada llamada, el permiso de escritura en la IAM de la
      API y el arreglo de la fuga de claves entre usuarios en los workers. El
      editor manda a conectar y, en el servicio, dice que programar llega
      pronto en vez de enseñar un formulario que da 503. Sale con el deploy de
      siempre (`aws-media-api` lleva el permiso nuevo).
- [x] **C2 · Publicar en la nube** (2026-09-16, rama `publicar-en-nube`):
      decisiones del dueño: «Sugerir títulos» es gratis; la casilla «Hecho con
      IA» (TikTok `isAiGenerated`, YouTube `containsSyntheticMedia`) va marcada
      por defecto; la privacidad de TikTok y YouTube no trae valor
      preseleccionado (sin elegirla no se envía).
      - **Títulos** en la Lambda de la API (una llamada, tope de 20 s): leen el
        transcript editado de S3 y, si el video aún no se renderizó, el
        canónico. Trazados en Langfuse con el usuario.
      - **Agendar** deja la publicación en `pendiente`
        (`pipeline/publicaciones.py`, S3 `usuarios/<sub>/publicaciones/…`) y la
        encola; `worker/publicar_task.py` la sube a Blotato **en streaming**
        desde S3 (sin /tmp ni memoria) y crea el post con los campos de cada
        red (`blotato.REDES` / `target_de`). En local corre lo mismo en
        segundo plano.
      - **Sin posts dobles:** la cola reintenta, así que el worker reclama la
        publicación con If-Match, renueva el registro cada minuto mientras
        sube (latido), no publica una subida que la pantalla ya pudo dar por
        muerta, marca `creando` antes del POST y nunca relanza después de
        reclamar. Un timeout o un 5xx al crear queda como «No sabemos si
        llegó» (revisar el calendario antes de reintentar); un 4xx, como error
        reintentable. Dos envíos iguales (video + cuenta + red) chocan en un
        candado con If-None-Match, no en una lectura.
      - **Abuso y cupo:** la cuenta se verifica contra Blotato antes de
        encolar (y otra vez en el worker), máximo 3 publicaciones subiéndose
        por usuario, y la lista de redes de «Sugerir títulos» tiene tope.
      - **Reglas que fallarían tarde:** descripción de YouTube sin `<`/`>` y
        en 5000 bytes, máximo 5 hashtags en Instagram, aviso de los 400 MB del
        plan Starter (un rechazo del PUT ya no se explica como «clave
        inválida»). La URL firmada de subida no llega al log (httpx en INFO).
      - **El resultado:** «publicar ahora» espera ~45 s la respuesta de
        Blotato; después la pregunta la pantalla (`/publicaciones`, 3 por
        petición; con id de post nunca se deja de preguntar, pasadas 6 h solo
        cada 10 min). Se guarda el id del post (sirve para Meta Ads y C3).
      - **El video por defecto** es la película final (`final` en el estado:
        el render del último estilo, o la película generada; con subtítulos
        solo si se quemaron después de ese render), y el confirm lo nombra.
      - En local no hay tope de publicaciones a la vez (sube la máquina del
        dueño), y `agendar` no espera a Blotato si ya no le alcanzan los 29 s.
      - **Antes de subir:** tope de 1 GB y por red (X 512 MB/2:20 min,
        Instagram 300 MB, LinkedIn 500 MB…); Instagram y Facebook solo
        vertical (ffprobe sobre la URL firmada, respeta la rotación).
      - Modal: páginas de Facebook/LinkedIn y tableros de Pinterest, título de
        YouTube, contador por red, textos escapados (antes los títulos del LLM
        y los nombres de las cuentas entraban crudos por innerHTML).
      - Sin cambios de infra: el worker ya podía leer la clave del usuario y
        escribir en S3. Se despliegan `aws-media-jobs` (tipo nuevo) y
        `aws-media-api`; CDK pone jobs primero.
      - Pendiente: la película horizontal no tiene salida vertical para
        Instagram/Facebook; el texto del post no pasa por moderación.
- [x] **C3 · Agenda** (2026-09-17, rama `agenda-blotato`): pantalla propia
      (`static/agenda.html`, el menú deja de decir «próximamente») con lo que
      Blotato todavía no ha publicado — también lo programado desde blotato.com.
      Decisiones del dueño: solo **cambiar la hora** y **cancelar**; al cancelar,
      el proyecto dice «Cancelada»; nada de publicado ni fallido (eso es C4).
      - **La fuente de verdad es Blotato:** `GET /v2/schedules` trae el id del
        programado, que es el que viaja al PATCH y al DELETE. Crear el post NO
        devuelve ese id, así que la Agenda no depende de nuestros registros.
      - **El PATCH manda solo la hora.** Blotato no fusiona: un `draft` parcial
        borraría el video y el usuario se enteraría cuando saliera el post.
      - **Cancelar no se deshace:** exige confirmar antes de tocar nada, lee la
        publicación antes de borrarla (después ya no hay de dónde sacar la URL
        del video) y la tarjeta dice a qué página o tablero va, para que dos
        publicaciones de la misma cuenta no se confundan.
      - **El puente con nuestros registros** es la URL que Blotato acuña al
        subir: el worker la guarda y deja un índice mínimo
        (`usuarios/<sub>/agenda/<sha256>.json`) con el proyecto y la publicación.
        Antes de escribir se corrobora la red y la cuenta, y solo se toca un
        registro que la pantalla vea como «programado». Lo de antes de C3 no
        tiene índice: se cancela igual, pero el modal dirá «No sabemos si llegó».
      - **Blotato caído no es una agenda vacía:** la lista conserva lo que ya
        estaba y avisa; sin poll, una llamada por carga (el límite es 60/min y
        el modal de Publicar ya gasta 3).
      - Sin cambios de infra ni migración. Pendiente: no se puede editar el
        texto desde la Agenda, ni programar desde ahí (eso sigue en el editor).
- [x] **C4 · Métricas** (2026-09-17, rama `metricas-blotato`): pantalla propia
      (`static/metricas.html`; en el menú ya solo queda «próximamente» en
      Competencia) con lo que YA salió, lo que NO pudo salir y cómo rinde.
      Decisiones del dueño: publicado **y** fallido en la misma lista, más una
      vista «Las más vistas»; cuatro números en la tarjeta y el resto al
      abrirla; ventana de 30 días con «Ver más» hacia atrás.
      - **Verificado contra la API real el 17-sep**, no solo contra la doc:
        `GET /v2/posts` (qué hay: es la única con las fallidas y con cursor) y
        `GET /v2/analytics` (cuánto rinde: trae los números y su historial
        pegados, y sin cursor). Se juntan por `id` — que es el de Blotato y
        **no** el `postSubmissionId` que guarda el worker: ese no sirve aquí.
      - **Dos llamadas por carga y ninguna más.** Van con presupuesto común
        (18 s de los 29 de la Lambda), `/v2/posts` primero: si el tiempo se
        acaba, la pantalla degrada a «tus publicaciones, sin números» y no a
        una pantalla en blanco. «Las más vistas» es la misma respuesta sin
        reordenar: cambiar de vista cuesta cero.
      - **«Sin números» son CUATRO cosas distintas** y confundirlas es el peor
        error posible aquí: la publicación falló (nunca los tendrá), es de
        LinkedIn (Blotato aún no recoge de esa red), Blotato respondió por todo
        el tramo y no la tenía (no guardó nada), o **no lo sabemos** —la
        respuesta vino recortada o no vino—, que es el único caso con botón.
        Ese botón cuesta una llamada y resuelve los tres restantes: 200 con
        `metrics:null` («aún no la ha medido»), 404 («no guardó nada») y
        `lastError` («la red no se los dio»). El 404 sale como 200: no es una
        avería, es la respuesta.
      - **Ningún endpoint fuerza una medición nueva.** Blotato mide por tandas,
        desde ~2 h después de publicar hasta los 90 días. Por eso el botón dice
        «Ver números» y no «Actualizar», y por eso no hay sondeo.
      - Los contadores llegan en texto (para no perder precisión) y salen en
        entero; lo que no se puede convertir viaja como `null` y **nunca** como
        0: un cero inventado le diría al usuario que no gustó a nadie. Una
        bajada entre dos mediciones se conserva tal cual — las redes corrigen.
      - Sin cambios de infra, sin migración, sin caché y **sin tarifa**: leer
        números no cuesta créditos. Cero lecturas de S3 y cero Postgres.
      - Pendiente: no enlaza cada publicación con el proyecto que la produjo
        (se podría con el índice `sha256(media_url)` de C3, pero cuesta una
        lectura de S3 por tarjeta y solo lo tiene lo publicado desde el 17-sep);
        sin seguidores, sin comparar redes entre sí y sin exportar.
- [x] **C5 · Competencia** (2026-09-17, rama `competencia-apify`): pantalla
      propia (`static/competencia.html`; con esto **no queda ninguna sección en
      «próximamente»**) con lo que le está funcionando a las cuentas que el
      usuario vigila. Decisiones del dueño: **cuentas concretas** que él elige
      (no un rubro o un hashtag), las **tres redes** (Instagram, TikTok y
      YouTube), lista **más lectura con IA**, **3 créditos por cuenta** y las
      **10 últimas** publicaciones de cada una.
      - **Los tres actores se eligieron corriéndolos**, no leyendo su ficha
        ($0.14 dólares de verificación el 17-sep): Instagram con el oficial que
        ya usa la copiadora de estilos ($0.0027 por publicación), TikTok con
        `apidojo/tiktok-profile-scraper` ($0.0003 — diez veces más barato que
        el de clockworks y con los mismos datos) y YouTube con
        `grow_media/youtube-channel-video-scraper` ($0.001, el único que da la
        fecha exacta, las vistas sin redondear y los me gusta).
      - **Dos cosas que solo se ven pagando** y quedan escritas en
        `pricing.json`: el `usageTotalUsd` de una corrida **no es definitivo al
        terminar** (un actor marcaba $0.00005 y acabó en $0.01005), y hay
        actores que **cobran por lo que raspan y no por lo que entregan** (uno
        cobró 24 publicaciones para devolver 10 — descartado).
      - **El orden es el producto.** Ordenar por vistas habría puesto arriba a
        la cuenta más grande siempre, que no enseña nada. Cada publicación
        lleva un `indice` = sus vistas ÷ **la mediana de su propia cuenta**, y
        la lista va por ahí: así un éxito real de una cuenta chica le gana a un
        día normal de una grande. Con menos de 3 publicaciones medidas no hay
        mediana y el índice **no se calcula** en vez de inventarse.
      - **Una cuenta caída no tumba el informe:** se cobró por cuenta, así que
        la que no trajo nada **devuelve sus 3 créditos** y el informe sale con
        las demás diciendo cuál faltó y por qué (privada, vacía o renombrada).
        Si no llega ninguna, es error y se devuelve todo. Un fallo del LLM
        tampoco devuelve: los números son lo que se pagó, la lectura es el extra.
      - **El LLM tiene prohibido rellenar:** un patrón necesita al menos dos
        publicaciones que lo sostengan y que rindan por encima de su cuenta, y
        cada afirmación tiene que poder señalarlas por id. Puede devolver cero
        patrones y decir en `advertencia` qué no se puede concluir.
      - **Freno de gasto nuevo en `pipeline/apify.py`:** `correr()` acepta
        `tope_usd` (el `maxTotalChargeUsd` de Apify) y competencia lo usa en
        cada corrida. Hasta ahora nada limitaba lo que podía cobrar un actor de
        un tercero corriendo por cuenta de un usuario.
      - Sin cambios de infra, sin migración y sin permisos nuevos:
        `APIFY_TOKEN` ya llega al worker por SSM desde M17.
      - Pendiente: no enlaza cada publicación con la copiadora de estilos
        (el dato está —`enlace` es justo lo que `/api/estilo` sabe analizar—,
        falta el botón); sin seguidores, sin hashtags ni rubro, y las cuentas
        vigiladas no se comparan con las del propio usuario.

Lo que pedía el análisis:

- **Guardar:** SSM SecureString en `/media-ivenaccip/usuarios/<sub>/BLOTATO_API_KEY`
  (el patrón D4 que ya usa `CLAUDE_API_KEY`). **Cambio de CDK:** la Lambda de la
  API solo tiene `ssm:GetParameter*`; necesita `ssm:PutParameter` y
  `ssm:DeleteParameter` restringidos a `usuarios/*/BLOTATO_API_KEY`. El `<sub>`
  sale SIEMPRE del token, nunca del cuerpo.
- **Endpoints:** conectar (valida con `GET /v2/users/me/accounts` antes de
  guardar), estado (conectado sí/no y redes; jamás devuelve la clave) y
  desconectar.
- **Refactor:** `pipeline/blotato.py` lee `settings.blotato_api_key`, que se
  congela al importar: cada función tiene que recibir la clave. Una
  `clave_blotato(user_id)` que **nunca** caiga a una clave de la plataforma
  (publicaría en la cuenta equivocada). Ojo: `cargar_env_usuario` pisa el
  entorno del worker sin limpiarlo, así que un worker reutilizado podría
  arrastrar la clave del usuario anterior.
- **Avisar antes de mandar a Blotato:** generar la clave termina su prueba
  gratis y activa el plan de pago (Starter $29 al mes, externo, por verificar).
- **Publicar en la nube** (hoy `agendar` y `titulos` responden 503): subir el
  video desde un worker y mandar los campos que exige cada red (TikTok:
  `privacyLevel`, `isAiGenerated`…; YouTube: `title`, `privacyStatus`…).
- Las tres secciones:
  - **Agenda:** la API REST v2 la cubre (crear, listar, reprogramar, borrar).
  - **Métricas:** solo por publicación, solo de lo publicado vía Blotato,
    8 redes sin LinkedIn, sin seguidores. (Confirmado en C4 contra la API real:
    lo de LinkedIn sigue siendo cierto, y lo que el análisis no vio es que
    Blotato mide por tandas y no se le puede pedir una medición nueva.)
  - **Competencia:** Blotato no la tiene. Se hace con Apify (ya integrado) y
    necesita tarifa nueva en `tarifas.json`; no depende de la clave.
    (Hecho en C5, y lo de «no depende de la clave» resultó ser lo importante:
    es la única sección de Blotato que funciona sin haberla conectado.)

### D · MIX (después del 23)

Decisión: **cada usuario elige su hora**; si varias corridas coinciden, **se
encolan** (la capacidad se amplía después). **Una sola automatización por
usuario** para las pruebas; en el plan anual quizá dos (por evaluar).

- **Requisitos previos** (sirven también sin MIX):
  - delante de Fargate no hay cola: la cuota es de 30 vCPU = 7 tareas de 4
    vCPU, compartidas con todo; una octava probablemente falla;
  - la state machine no tiene `Retry` ni `Catch`, y la devolución de créditos
    solo ocurre dentro del contenedor: falta un barredor de ejecuciones
    fallidas con devolución idempotente;
  - C (clave de Blotato), si MIX publica.
- **Arquitectura propuesta:** tabla de programaciones (una por usuario) →
  disparo a la hora elegida → cola SQS → despachador que lanza como mucho
  5 a la vez (deja sitio al uso interactivo) → una tarea que prepara, decide
  lo que hoy decide el usuario (tema de su lista, personaje y voz fijos,
  formato vertical), produce, subtitula y deja **borrador** o agenda en
  Blotato. Cobro antes de lanzar; sin saldo, la corrida se omite y se avisa.
  Ojo: un barrido de Aurora cada pocos minutos le impide pausarse.
- **Costo medido** (6 producciones reales, Langfuse + AWS): de $0.64 a $1.34
  dólares por película de 30 s (mediana $1.09) contra 100 créditos. Hallazgo:
  en 3 de 4 películas de 30 s la narración quedó en 15–20 s, y se cobró la
  duración objetivo.
- Empezar en **borrador** (el usuario aprueba con un clic) y pasar a publicar
  directo cuando haya confianza.

### Hallazgos del análisis que no esperan a M23

- **Publicar en la nube respondía 500** (`publicar_api.estado`): PR #89.
- **Token de Apify en la URL** (`pipeline/apify.py`): ya va en la cabecera
  `Authorization`, y los errores se guardan, registran y muestran tachados
  (`apify.tachar`). El token que se filtró el 2026-09-13 ya está muerto.
- **Cognito:** la contraseña provisional dura 7 días; con el tope de 50
  correos al día hay que escalonar las invitaciones antes del 23.
- **Cuota de concurrencia de Lambda:** ya es 1000 (antes 10).
- **Proyectos del editor compartidos entre cuentas** (P0, PR #96). En S3
  viven en `videos/<nombre>/`, sin el usuario. Dos cuentas con el mismo nombre
  («video-1») o que importaban el mismo video de YouTube (`yt-<id>`) se veían,
  se descargaban y se pisaban el trabajo. Ahora el nombre es único entre
  cuentas:
  - la tabla `nombres_editor` hace de reserva atómica;
  - pedir la subida con un nombre de otra cuenta da 409, antes de subir nada;
  - los importados se llaman `yt-<id>-<4hex>`, con un sufijo distinto por
    cuenta.

  El 2026-09-16 no había ningún nombre repetido en producción (17 proyectos,
  4 cuentas). **Antes del deploy:** correr `tools/db_migrate.py`. Meter el
  usuario en el prefijo (`videos/<sub>/<nombre>/`) queda para después del 23.

### Meta Ads

Extra para después. Blotato no expone anuncios: haría falta una integración
propia con la Marketing API de Meta. Guardar desde ya el id de cada
publicación facilitaría promocionarla más adelante.

## Fase M24 — Ver los servicios en un solo lugar (2026-09-17)

Petición del dueño: un tablero tipo Langfuse donde se vea todo en una sola
plataforma — qué está corriendo, qué se está gastando y cómo van los recursos.
Al mapear lo que hay salió que **la arquitectura ya decidió casi todo**, así que
esta fase documenta las opciones reales y por qué se descartan las obvias.

### El dato que manda

Aurora vive en subredes `PRIVATE_ISOLATED` con **cero NAT Gateways**, y la
Lambda le habla por el **Data API** (HTTPS de `rds-data`), no por conexión
Postgres. Es una decisión deliberada y está escrita en `infra/stacks/db.py:1-4`.

Consecuencia: **nada de fuera puede abrir una conexión Postgres a la base.**
Eso descarta de golpe a Grafana Cloud, Metabase, Retool y Superset — todos
hablan el protocolo de Postgres y ninguno habla Data API. No es una limitación
de esas herramientas: es que la base no está donde ellas pueden verla.

Lo que sí hay, y juega a favor:

- **Ya existe medio tablero**: `static/admin.html` + `server/admin_api.py`
  (M6) — margen por usuario y costo por corrida. Funciona *precisamente*
  porque corre dentro de la Lambda del API, que es lo único que llega a la base.
- **La Lambda del API ya puede leer métricas**: `cloudwatch:GetMetricStatistics`
  en `infra/stacks/api.py:101`. El panel de infraestructura no necesita
  permisos nuevos ni red nueva.
- **Postgres ya es el punto de unión de los tres mundos**: el trabajo
  `sync_costes` baja los costos de Langfuse a la tabla `costes`, donde ya
  están los de infra y los movimientos de créditos. Cualquier tablero que se
  elija se apunta ahí primero.

Los tres mundos y dónde viven hoy: **LLM** → Langfuse (`@observe`);
**infraestructura** → CloudWatch (las ocho alarmas de `infra/stacks/alertas.py`);
**negocio** → Postgres (`costes`, `monedero_movimientos`).

### A · Extender `admin.html` — recomendado

Un panel de infraestructura dentro de la página que ya existe, leyendo
CloudWatch desde `admin_api.py` con boto3. Cero cambios de red, cero
proveedores nuevos, y queda **una sola pantalla de verdad**: créditos, margen
y salud del sistema en la misma vista.

- `GetMetricStatistics` ya está concedido; `GetMetricData` (una llamada para
  varias métricas, en vez de una por métrica) sería una línea más de IAM.
- Si más adelante se quiere Grafana igual: exponer `/api/admin/metricas` en
  JSON y apuntar ahí el plugin **Infinity** de Grafana, que lee HTTP en vez de
  Postgres. La red sigue sin tocarse.
- **Lo que se pierde: SQL libre.** Se consulta lo que los endpoints expongan,
  no lo que se le ocurra a uno a media noche. Para un tablero fijo da igual;
  para explorar «¿por qué este usuario gastó tanto el martes?» se queda corto.
  Si eso pasa dos o tres veces al mes, vale la pena; si pasa dos veces por
  semana, la opción C empieza a tener sentido.

### B · Dashboard de CloudWatch en el CDK

Un `cw.Dashboard` junto a las alarmas de `infra/stacks/alertas.py`: las ocho
métricas que ya se vigilan, ahora dibujadas. Se despliega con el `cdk deploy`
de siempre y no agrega proveedores.

Es la mitad de infraestructura sola, en pantalla aparte. Sirve como paso
intermedio si A se retrasa. **Antes de hacerlo:** verificar el precio por
tablero y anotarlo en `tools/pricing.json` con su `verified_on`.

### C · Abrir la red a Aurora — NO ahora

La única opción que da «una plataforma» de verdad, y la que revierte una
decisión documentada. Se deja escrita para cuando toque.

**Consecuencia económica — no es el monto, es el piso.** El sistema hoy no
cuesta nada en reposo: Aurora se autopausa a 0 ACU, las Lambdas cobran solo
mientras ejecutan, Fargate solo mientras corre una tarea. NAT Gateway y los
endpoints de interfaz de VPC son la línea contraria: **cobran por hora estén o
no en uso**, más un cargo por GB procesado. Se convertiría un sistema con piso
cercano a cero en uno con renta fija mensual, para mirar un tablero.

**Esos precios NO están en `pricing.json`.** Verificarlos y anotarlos ahí es el
primer paso de cualquier evaluación de C; sin eso la decisión se toma a ciegas.

**Consecuencia de infraestructura — esa sí es grande.** Hoy no existe ruta
desde internet hasta la base. Eso no es una configuración que se pueda
equivocar: es una ausencia. Abrirla agrega, todas a la vez, una ruta, un grupo
de seguridad que mantener bien, algo que guarda credenciales y algo que
parchar. Y como dice el docstring de `db.py`: «Aquí viven los datos de los
usuarios: proyectos, saldos y movimientos de créditos. **No hay otra copia.**»

También cambian los modos de falla. Hoy todos viven dentro de servicios
administrados de AWS; un NAT agrega uno propio, y si cae su zona el tablero
deja de ver la base — de madrugada, que es cuando uno no quiere estar
averiguando si el problema es la base o la ruta a la base.

**Cuándo sí:** cuando varias personas necesiten el tablero sin pasar por el
API. Ese día llega al contratar a alguien, no antes.

**Lo que no se hace nunca:** `publiclyAccessible=true` en el clúster. Es el
camino más barato en dólares y el más caro en todo lo demás.

Variante intermedia, si algún día se quiere SQL a mano sin renta permanente:
tres endpoints de interfaz (`ssm`, `ssmmessages`, `ec2messages`) más un bastión
chico, **creados y borrados cuando se ocupan**. Sin NAT y sin endpoints no hay
forma de que una máquina de la VPC hable con SSM, así que este camino también
tiene reloj — pero la red queda cerrada el resto del tiempo.

### Lo que no entra

- **Datadog / New Relic**: agentes en el API y en el worker, más tarifa por
  host. A 166 usuarios se paga por lo que no se usa.
- **Langfuse se queda donde está**, haciendo lo que hace bien: las llamadas al
  LLM, traza por traza. No sabe de colas ni de ACUs y no tiene por qué.

### Decisión (2026-09-17)

**A primero**, después del 23. B si se quiere el detalle crudo de CloudWatch en
pantalla aparte. C queda documentada como la conversación de otro día.

- [ ] Panel de infraestructura en `admin.html` (cola, Lambdas, Aurora, Step
      Functions) leyendo CloudWatch desde `admin_api.py`.
- [ ] Decidir si se agrega `cloudwatch:GetMetricData` al rol del API.
- [ ] Si algún día se evalúa C: precios de NAT Gateway y de endpoints de
      interfaz verificados y anotados en `tools/pricing.json`.

## Fase M25 — La entrada: imágenes, clip y las dos historias (2026-09-17)

Petición del dueño, salida de ver a usuarios reales: la interfaz está armada
para historias y con todo el flujo detrás, pero **hay gente que quiere una
petición sencilla** — sube imágenes y que le entreguen un video. Esta fase
separa esa petición del flujo largo sin construir un segundo producto.

La idea inicial era un balanceador que adivinara qué quiere el usuario. Se
descartó como puerta: en el momento de crear se puede **preguntar**, que es
gratis y acierta siempre, y equivocarse cuesta una película cobrada. El
clasificador se queda para sugerir, nunca para enrutar — que es justo la forma
que ya tiene el balanceador de rubro (`server/app.py:555`).

### A · El clip de 8 segundos

Decisión del dueño (17-sep): **un solo video de 8 segundos, con audio**,
llamando a fal con el contexto y la imagen del usuario. Sin guionista, sin TTS
y sin whisper.

Ocho segundos no es un recorte arbitrario: es el slot máximo de Veo
(`OPCIONES = (4, 6, 8)` en `pipeline/tts.py:18`), así que **un clip es una sola
llamada**. Con eso desaparecen guionista, TTS, alineado, `planear_ventanas`,
director, casting, personaje, `concat`, `mux`, el gate de duración, la pantalla
de revisión y el mínimo de 2 escenas de `pipeline/narracion.py:44`.

- **Dónde vive: un tipo de trabajo nuevo en la cola SQS**, hermano de
  `competencia` y `estilo_analizar` (`worker/lambda_worker.py:105`), **no** una
  producción de Fargate. Así no consume slot de proyecto (nadie se topa con el
  409 de `server/app.py:546` por pedir un clip), no hay estado `revision` ni
  Step Functions, y el cobro y la devolución son uno solo.
- **Timeout propio, obligatorio.** La Lambda del worker tiene 15 minutos duros
  (`infra/stacks/jobs.py:89`) y la configuración de Veo de la película permite
  720 s × 2 intentos (`pipeline/config.py:33-34`) = hasta 24 minutos. Heredar
  esos números manda clips sanos a la DLQ. Un clip de 8 s sale en un par de
  minutos.
- **NO reusar `prompt_veo` ni `VEO_NEGATIVE`** (`pipeline/scenes.py:98-113`).
  Están hechos para el producto de cortos animados y prohíben explícitamente
  `photorealistic, humans, people, person, face`: con la foto de un producto,
  de un perro o de una cara, el prompt negativo le pelea al modelo. El clip
  necesita su propia construcción, casi vacía.
- **Un prompt nuevo y chico**: contexto del usuario → prompt de Veo, traducido
  y ordenado (sujeto, acción, cámara). Todo el pipeline le habla a Veo en
  inglés y estructurado; los usuarios van a escribir en español y suelto.
  Cuesta ~$0.001 dólares. **Medirlo contra pasar el texto crudo** antes de
  darlo por bueno.
- La fontanería ya existe: `image_url` recibe `start_image_url`, que ya viaja
  como data URI para el frame previo (`pipeline/media.py:21`). Lo que no existe
  es una ruta por la que la imagen **del usuario** llegue ahí: `imagen_inicio`
  solo tiene dos ramas, frame previo o Grok (`pipeline/media.py:33`). Y no hay
  subida de imágenes: el presignado solo acepta `.mp4/.mov/.m4v`
  (`server/media_api.py:32`).

**Tarifa: 30 créditos** (decisión del dueño, 17-sep), más 2 si hay que
componer varias imágenes — ver el bloque F. El número sale de la
economía, no del gusto: 8 s con audio son **$0.40 dólares** de Veo
(`pricing.json`: 720p con audio a $0.05 por segundo, contra $0.03 sin audio), y
el piso de venta es **$0.015 dólares por crédito** (`tarifas.json §economia`).
A 20 créditos se vendería en $0.30 y se perdería $0.10 por clip; a 30 se vende
en $0.45. Con la razón interna de hoy ($0.0135 por crédito cobrado) el cálculo
da 30 con audio y 18 sin él — **20 créditos habría sido el precio correcto del
clip mudo**, y es la salida si algún día se quiere ese número.

Dos cosas a tener presentes al fijarlo:

- **Por segundo entregado el clip es más caro que la película** ($0.05 contra
  $0.045): amortiza nada. «Es más sencillo, cobremos menos» no aplica.
- **La cortesía son 100 créditos al mes.** A 30 por clip cada usuario puede
  quemar $1.20 dólares gratis; con 166 usuarios eso es ~$200 al mes en el peor
  caso.
- El audio de Veo es **generado por el modelo** (ambiente, efectos, a veces
  voces): no es un narrador que lea el texto del usuario. Hoy está cableado en
  `generate_audio: False` (`pipeline/media.py:121`), así que esa tarifa nunca
  se ha pagado. **Generar dos o tres clips de prueba y oírlos** antes de
  prometer «con sonido».

### B · La entrada: dos botones y un desplegable

Decisión del dueño (17-sep): un control segmentado con **dos posiciones,
Imágenes y Videos** —como el Chat/Cowork de Claude— y dentro, un desplegable
con las opciones. Así el clic de arriba y la selección de abajo son dos señales
separadas en vez de una revuelta.

La lista de hoy («video sencillo, cuento, tengo una idea») mezclaba dos ejes:
qué te llevas y cómo se investiga. Se separan: el desplegable dice **qué**, y
las fichas de investigación viven dentro de la opción que las necesita.

- «Imágenes» le da por fin una puerta a `static/imagenes.html`, que hoy solo se
  alcanza desde una lista del inicio (`static/index.html:514`).
- **El valor por defecto del desplegable decide la calidad del dato.** Lo que
  arranque seleccionado se lo lleva todo el que no lo abra, y eso contamina
  justo el conjunto que se quiere recoger. Arrancar en el clip —lo más barato,
  el menor daño si se equivocan— y **registrar aparte si lo abrieron**: esa
  diferencia separa «eligió» de «no le importó».

### C · Las dos historias y los prompts

Nombres que eligió el dueño (17-sep): **«Creador de cuentos»** para la
investigada y **«Crea tu historia»** para la que trae el usuario.

El reparto ya existe en el código, con etiquetas que suenan al revés de lo que
hacen (`pipeline/flow.py:66`):

| Ficha en pantalla | `tipo` interno | ¿Corre research? |
|---|---|---|
| Investigación → «Creador de cuentos» | `idea` | **sí** |
| Tengo una idea → «Crea tu historia» | `historia` | no, usa el brief tal cual |

Nota de nomenclatura: `cuento` **ya es un valor de `FORMATOS`**
(`pipeline/research.py:43`, junto a `lista` y `explicador`), así que el nombre
interno de la puerta no debe reusar esa palabra aunque el rótulo visible sí la
use.

**El hueco real no es `formato`, es `tipo`.** Hoy el tipo entra al prompt como
una palabra suelta dentro de una etiqueta (`MATERIAL ({tipo}):` en
`prompts/narrador_user.md`) y `narrador_system.md` da **las mismas
instrucciones para los dos casos**: gancho, cadena causal, prosa de corrido. O
sea que cuando alguien pega su historia completa, **el narrador se la
reescribe**. Son dos trabajos distintos compartiendo un prompt:

- **Escribir desde cero** (dossier → narración): inventa estructura, elige el
  gancho, decide qué queda fuera.
- **Adaptar lo que trajeron** (su texto → 30 s): preserva su voz, sus nombres,
  sus datos y su orden; solo condensa.

Solución: un slot `{reglas_material}` en `narrador_system.md`, inyectado desde
Python igual que el `{formato_reglas}` que ya existe (`pipeline/writer.py:95`).
Mismo patrón, ya probado, sin cambiar la forma del prompt.

**`formato` solo en la investigada** (decisión del dueño, 17-sep). El material
ya *es* la forma: en investigación el dossier son datos crudos y alguien tiene
que elegirla; en «Crea tu historia» la forma está literalmente dentro del
prompt, y poner encima la adivinanza de un clasificador solo agrega una manera
de equivocarse. En el clip no aplica: no hay guionista.

> **Trampa al implementarlo.** `escribir_narracion(..., formato: str =
> "cuento")` y `FORMATO_REGLAS.get(formato, FORMATO_REGLAS["cuento"])`
> (`pipeline/writer.py:83` y `:95`) caen **dos veces** a `cuento`. «Dejar de
> pasar el formato» da reglas de cuento en silencio — el bug exacto que se
> quiere evitar. El slot tiene que recibir el bloque de adaptación de forma
> explícita. Y `clasificar` sigue corriendo igual, porque de ahí sale el `tipo`
> que alimenta el aviso de D.

### D · El aviso que ofrece cambiar de puerta

Petición del dueño: una nota abajo a la derecha que diga qué está mal y cómo
arreglarlo. Ejemplo suyo: *«"3 curiosidades de los pulpos" se ajusta a Creador
de cuentos. ¿Quieres moverlo?»* [aceptar] [cancelar].

**La señal ya se calcula y se tira.** En `pipeline/flow.py:73`,
`tipo = forzado or tipo_llm`: el clasificador siempre opina, pero en cuanto el
usuario eligió puerta su opinión se descarta en silencio. Ese desacuerdo **es**
el aviso.

- **Problema de momento**: `clasificar` corre dentro de `preparar`, o sea
  después de cobrar los 10 créditos y encolar. El aviso tiene que salir antes,
  y para eso está el molde del balanceador de rubro (`server/app.py:555`):
  corre antes de crear nada, devuelve 409 con el motivo y acepta `forzar=true`.
  El [aceptar]/[cancelar] es literalmente ese `forzar`.
- **En los dos sentidos.** El error contrario cuesta más: pegar un cuento
  terminado de 600 palabras en la puerta de investigación paga research para
  investigar algo ya escrito, y luego se lo reescribe encima.
- **El detector no es el formato, es si trae material.** «3 curiosidades de los
  pulpos» no está mal puesto por ser lista, sino porque seis palabras no son un
  texto; una lista pegada de 400 palabras pertenece a «Crea tu historia» y ahí
  se queda. La heurística de respaldo ya lo dice así: más de 120 palabras es
  material (`pipeline/research.py:29`).
- **Cambiar de puerta no cambia el precio** (`preparar` son 10 fijos y
  `producir` depende solo de la duración), así que puede ser un aviso chico y
  no una pantalla de confirmación.

### E · Registrar los clics — va en el mismo PR que las puertas

Idea del dueño: recoger primero los prompts que la gente escribe en cada
puerta, y **solo después** ajustar el balanceador. Es el orden correcto: cada
clic deja un par `(texto, puerta elegida)` — un conjunto etiquetado, gratis,
escrito por los usuarios, con el que evaluar el clasificador antes de dejarlo
decidir.

- Las filas que más van a servir son las contradicciones: quien elige «clip» y
  escribe 400 palabras, y quien elige «Creador de cuentos» y escribe seis.
- **Tabla propia** (la décima, junto a las nueve de `pipeline/db.py`), escrita
  al mandar el formulario, no al terminar el trabajo: `usuario · cuándo · puerta
  · opción del desplegable · si lo abrió · texto · palabras · si llegó a pagar ·
  qué se cobró`.
- **No sirve `p.modo`**: el clip no crea proyecto, así que no hay fila de
  proyecto que leer después. Sin la tabla, el dato simplemente no existe.
- Descartado **OTEL** para esto: es telemetría de operación —muestreada, con
  caducidad, consultada en agregado—, y esto es un conjunto de producto que se
  va a leer fila por fila meses después. Además el texto del brief es contenido
  del usuario: una tubería de telemetría es otra postura de privacidad.

### F · Las imágenes del clip: de 0 a 3, compuestas antes de animar (2026-09-18)

Decisiones del dueño: el clip **acepta de 0 a 3 imágenes**, **ninguna es
obligatoria**, y **el formato lo sigue eligiendo el usuario** (no se deriva de
la foto).

Verificado en fal el 18-sep — los precios de Veo coinciden con `pricing.json`,
así que su `verified_on` aguanta:

- `veo3.1/lite/image-to-video` recibe **UNA** imagen, y ahí es obligatoria. El
  límite de 3 no es implementable en ese endpoint tal cual.
- **La misma familia hace text-to-video**, así que el caso «sin imagen» es un
  endpoint hermano y no otro proveedor. Falta configurarlo y anotar su precio.
- Acepta `jpg, png, webp, gif, avif, heic, heif`. **El `heic` importa**: es el
  formato con el que salen las fotos de iPhone, y un validador de subidas que
  no lo contemple rechaza fotos perfectamente buenas.
- Sí existen modelos multi-imagen —`bytedance/seedance-2.0/us/reference-to-video`
  acepta hasta 9 con audio nativo— pero a ~$0.37 dólares por segundo a 720p un
  clip de 8 s costaría $2.96 contra los $0.45 que deja la tarifa. Fuera de
  presupuesto: sería otro producto, no el clip sencillo. (Precio leído en la
  página de fal el 18-sep; **no está en `pricing.json`** y no debe usarse hasta
  anotarlo ahí.)

**La solución (idea del dueño): componer antes de animar.** Las 2 o 3 imágenes
se juntan en una sola con Grok —que decide cómo colocar a cada sujeto— y esa
composición es el cuadro inicial de Veo.

**La máquina ya existe, en las dos mitades:**

- `_grok` recibe `image_urls` en **plural** (`pipeline/media.py:49`): componer
  varias referencias en una imagen es lo que esa llamada ya hace.
- Para las historias, la separación por escena también está construida:
  `resolver_referencias` (`pipeline/scenes.py:71`) decide **por escena** qué
  personajes aparecen, junta sus referencias —con tope `[:4]`, así que 3 cabe
  sin tocar nada— y se lo dice a Grok en el prompt. El LLM que hace esa
  separación es `hacer_casting` (`pipeline/casting.py:71`), en producción desde
  hace meses.

**Tarifa: 30 el clip, +2 si subió 2 o 3 imágenes.** Componer solo corre cuando
hay más de una: con cero es text-to-video y con una se anima directo, y en
ninguno de esos casos se paga Grok. La llamada extra aparece solo cuando el
usuario usa la función. Grok cuesta $0.02 dólares de salida más $0.002 por
imagen de referencia (`pricing.json §generacion.grok_edit`) = **$0.026**
componiendo tres, y la tarifa `video.imagen` que ya existe son 2 créditos
($0.03 al piso), que lo cubre casi exacto.

| Caso | Costo real | Cobro | Margen |
|---|---|---|---|
| Sin imagen (text-to-video) | $0.40 | 30 cr = $0.45 | 11 % |
| Una imagen | $0.40 | 30 cr = $0.45 | 11 % |
| Dos o tres (con Grok) | $0.426 | 32 cr = $0.48 | 11 % |

Sin el +2, el caso de tres imágenes cae a 5 % de margen. Cobrarlo con una
tarifa que ya existe deja los tres casos parejos y al usuario pagando solo lo
que usa.

**Por probar, no por suponer:** que Grok componga bien **fotografía real**.
Tres fotos de un producto desde ángulos distintos casi seguro salen; un perro,
un gato y una sala pueden salir en collage. Grok está afinado para el estilo
animado del corto, no para foto. Se resuelve como se resolvieron los actores de
Apify: corriéndolo con fotos de verdad, no leyendo la ficha.

**Tampoco se reusan los prompts del corto animado.** `resolver_referencias`
cuelga `ESTILO_SUFIJO`, «Keep EXACTLY the same character design» y el estilo
visual del proyecto (`pipeline/scenes.py:80-91`). Para el clip estorban igual
que `VEO_NEGATIVE`: la composición necesita su propio prompt, corto y sin
estilo impuesto.

### Lo construido (2026-09-18) — bloques A, F y B

No toca el flujo de la película ni `crear.html`: lo nuevo es el clip entero y
la caja del inicio que reparte. Quedan fuera **D** (el aviso que ofrece cambiar
de puerta), **E** (el registro de clics) y **C** (los prompts de las dos
historias), que va en su propio PR porque sí edita al narrador en producción.

| Pieza | Dónde |
|---|---|
| Tarifa 30 + 2 | `tools/tarifas.json §clip` → `creditos.costo_clip(n)` |
| Los tres caminos | `pipeline/clip.py` |
| El prompt | `prompts/clip_system.md` (español suelto → inglés ordenado) |
| El trabajo | `worker/clip_generar.py` + rama `clip` del despachador |
| La API | `server/clip_api.py` (`/api/clip/*`) |
| La pantalla del clip | `static/clip.html` |
| La entrada | `static/index.html` (segmentado + desplegable + rutas) |
| Tests | `tests/test_m25_clip.py` (30) · `tests/test_m25_entrada.py` (13) |

**Los rótulos, que eran la pregunta abierta 1** (decisión del dueño, 18-sep):
el clip se llama **«Un video corto»** — no promete imágenes, que son
opcionales, y va en el mismo tono de sustantivo que los otros dos.

**Y los precios: sí, los cinco, escritos y no calculados.** El dueño preguntó
si convenía correr el balanceador antes de generar y enseñar una ruedita
mientras calcula el precio. No hace falta, y el balanceador tampoco es la pieza
que responde eso: **los tres precios se saben sin llamar a nada.** El clip es
plano (30) y las historias dependen de la duración que el usuario elige
*después*, en `crear.html` — o sea del rango completo de `§video.por_duracion`,
**55–190**. Pedirle el número a un clasificador sería pagar una llamada y hacer
esperar al usuario por algo que ya está en `tarifas.json`, y además el
clasificador responde otra pregunta: *qué puerta*, no *cuánto*. Esa respuesta
suya sí tiene dónde ir, y es el bloque D.

El desplegable enseña un rango y no un número exacto a propósito: prometer
«145» cuando el usuario todavía no eligió duración sería inventarlo. Un test
ata los cinco precios a `tarifas.json`, porque un desplegable que promete 30 y
cobra 35 es peor que uno sin precios.

**El clip no va en la lista de la izquierda** (decisión del dueño, 18-sep): su
puerta es el desplegable. Tenerlo en los dos sitios repetía la misma entrada y
le quitaba el sentido a haber hecho la caja — que existe justo para que no haya
que buscar la herramienta en un menú. `/clip.html` sigue siendo una página
normal, con su dirección, para quien la guarde o llegue por un enlace.

Decisiones que se tomaron al construir, y por qué:

- **El text-to-video es `fal-ai/veo3.1/lite`** —la base, sin sufijo— y cobra
  **exactamente igual** que el de imagen. Verificado en fal el 18-sep: los
  cuatro números de `veo31_lite_usd_por_segundo` no habían cambiado. Por eso
  `pricing.json` no necesitó entrada nueva (`costo_fal` casa por «veo3.1»), y
  lo que se anotó ahí fue la nota que explica que la tabla sirve para los dos.
- **Las imágenes suben prefirmadas a S3**, no por el formulario: tres fotos de
  teléfono pasan de los 10 MB de payload que admite API Gateway. La subida
  tiene prefijo propio por usuario y el servidor rechaza una key ajena — sin
  eso, cualquiera animaría (y pagaría) las fotos de otra cuenta.
- **El `.heic` tiene una trampa de más**: muchos navegadores mandan `file.type`
  vacío para ese formato, así que la página deriva el tipo de la extensión. Si
  no, la firma se pide con un tipo que no coincide con el del PUT y S3 responde
  403 sin explicar nada.
- **El worker atrapa TODO y nunca relanza.** Un reintento de la cola generaría
  un segundo video —otros $0.40 dólares— que nadie pidió y que el usuario no
  vería. El error genérico tampoco se le enseña crudo: lo que necesita saber es
  que no se le cobró.
- **Tope de 3 clips en marcha por usuario.** No es una regla de producto: es
  que un bug de la UI no pueda encolar veinte videos cobrados.

### G · La tercera familia y el sitio de los controles (hablado el 18-sep, sin construir)

Idea del dueño: una tercera posición, **Edición**, junto a Imágenes y Videos, y
meter dentro «De videos a Shorts» y «Copiadora de estilos».

**La objeción, y cómo la resolvió el dueño.** Imágenes y Videos dicen *qué te
llevas*; Edición dice *qué traes tú*. Son dos ejes distintos en un mismo
control — el error exacto que se quitó al jubilar «Investigación» y «Tengo una
idea». La prueba que lo enseña sin discutir de teoría es si **escribir en la
caja hace algo**: en imágenes y video, el texto ES la petición; en el editor se
sube un archivo y en la copiadora se pega una liga, y ahí el texto sobra o es
otra cosa.

La salida del dueño (18-sep) parte el problema por donde hay que partirlo:
**el balanceador solo corre para imagen y video; en Edición no interviene.** No
es una excepción de conveniencia, es la consecuencia de lo anterior — el
balanceador lee TEXTO para adivinar la intención, y en Edición no hay texto que
leer: hay un archivo o una liga, y eso ya dice qué quieres sin ambigüedad. Una
puerta donde no se puede uno equivocar no necesita quien la vigile.

Con eso, la caja tiene dos mitades con reglas distintas:

| | Entrada | Balanceador | Aviso de D |
|---|---|---|---|
| Imágenes · Videos | texto | **sí** | sí |
| Edición | archivo o liga | **no** | no aplica |

Queda **la copiadora de estilos como el caso raro**, y no por el eje sino por lo
que entrega: no sale un video, sale un *estilo* que luego se usa en otra
herramienta. Su sitio natural es junto al selector de estilo de `crear.html` —
donde sirve— y no como puerta de creación.

**Dónde van los controles.** El dueño propone pegarlos a la flecha, como
ChatGPT y Claude. Las dos referencias que enseñó usan convenciones distintas: el
modelo («Opus 5 Máx») va a la izquierda porque es un ajuste permanente, y
«Pensar» va pegado al enviar porque modifica ESTE mensaje. Lo nuestro es lo
segundo. Pero la razón buena es otra: **nuestro chip lleva precio**, y «✦ 30»
pegado a la flecha se lee como *esto es lo que cuesta apretar* — a la izquierda
es información, pegado al botón es advertencia, y es el sitio honesto.

El costo es el ancho. A 390 px la fila ya se parte con **dos** controles (visto
el 18-sep); con tres familias, el desplegable y la flecha todos a la derecha no
cabe. Las dos salidas:

1. Las familias como iconos en pantalla angosta y con rótulo en escritorio.
2. **Un solo desplegable** con las familias como encabezados de sección.

La segunda cabe siempre, pero **cuesta el diseño de dos señales**: las dos
posiciones existen para que el clic de arriba y la elección de abajo sean datos
separados, que es lo que el bloque E iba a recoger. Con un solo menú se sigue
sabiendo de qué sección eligieron, pero se pierde la diferencia entre «eligió» y
«ni lo abrió». Con dos familias no valía la pena pagarlo; con tres y pegado a la
flecha, probablemente sí.

### Preguntas abiertas de M25

1. **Las dos pruebas que no se pueden leer en una ficha** — y que cuestan
   dinero, así que las corre el dueño:
   - **Oír el audio.** `generate_audio` nunca se ha pagado (la película lo
     lleva en `False`), y «con sonido» es la mitad de lo que se promete. Dos o
     tres clips y oírlos, antes de prometerlo en la pantalla.
   - **Grok componiendo fotografía real.** Tres fotos de un producto casi
     seguro salen; un perro, un gato y una sala pueden salir en collage. Grok
     está afinado para el estilo animado del corto.

## Fase M26 — Que la invitación llegue a la bandeja (2026-09-17)

**Pretrabajo obligatorio de M9.** El bot de membresías da de alta solo, y cada
alta dispara un correo de Cognito: si la entregabilidad no está resuelta, el
bot manda invitaciones que nadie ve, de forma automática, al ritmo que entren
los miembros y **sin nadie mirando la tasa de rebote**. Lo que hoy es una
molestia (alguien revisa spam) con el bot se vuelve invisible.

Reportado por el dueño: la invitación llega de un `no-reply` y cae en spam.

### Por qué cae en spam

El `UserPool` no tiene configuración de correo (`infra/stacks/api.py:109`).
Sin el parámetro `email`, Cognito usa su remitente por defecto: las
invitaciones salen de **`no-reply@verificationemail.com`**, un dominio de AWS
compartido por todos los user pools del mundo, incluidos los que se usan para
abusar. SES no aparece en el repo.

Cinco señales, y están las cinco:

1. **El dominio remitente no es nuestro** — ninguna reputación asociada.
2. **No hay alineación DMARC con nuestra marca**: SPF y DKIM pasan, pero para
   `verificationemail.com`.
3. **El enlace es una URL cruda de API Gateway** (`infra/stacks/api.py:120`) —
   patrón clásico de phishing.
4. **Hay una contraseña provisional en el cuerpo** — señal fuerte para los
   filtros de contenido.
5. **Envío frío** a direcciones que nunca pidieron nada, sin historial.

De paso: el límite de 50 correos al día que obliga a escalonar es justo el del
remitente por defecto de Cognito. Con SES desaparece.

### Estado de la cuenta (verificado 2026-09-17, us-east-1)

| | |
|---|---|
| Acceso de producción de SES | **No** — sandbox |
| Cuota | 200 al día, 1 por segundo |
| Identidades verificadas | **ninguna** |
| Reputación | `HEALTHY` — hoja limpia, nada que reparar |

**Trampa de orden:** cambiar Cognito a SES estando en sandbox no manda los
correos a spam — **no los entrega**, porque el sandbox solo llega a direcciones
verificadas una por una. Es peor que el problema original.

### El orden

1. **Verificar el dominio en SES**, en us-east-1 (misma región del pool). Se
   hace antes de pedir producción: AWS revisa mejor una cuenta ya configurada.
   El dueño tiene dominio propio, con el **DNS fuera de Route 53**, así que los
   registros se pegan a mano en su panel.
2. **DNS**: los tres CNAME de DKIM que genera SES, un TXT de SPF
   (`v=spf1 include:amazonses.com ~all` — **fusionado** con el SPF existente si
   lo hay, porque solo puede haber uno) y un TXT de DMARC en `_dmarc`
   (`p=none` al principio, para observar sin rechazar).
3. **Pedir acceso de producción** — ticket de soporte, ~24 h y a veces más.
   **Es el paso largo y solo lo puede abrir el dueño.** Describir el caso como
   transaccional: invitaciones y recuperación de contraseña, lista cerrada de
   una comunidad de pago, sin marketing, con manejo de rebotes y quejas.
4. **Cuando lo concedan**: `cognito.UserPoolEmail.with_ses(...)` en el
   `UserPool` y `cdk deploy`. Es actualización en sitio, no reemplaza el pool
   ni toca a los usuarios existentes — confirmar igual con `cdk diff`.
5. **Cambiar el enlace** del correo por uno del dominio propio, no el de API
   Gateway.

**Extra que sí vale la pena:** un MAIL FROM propio (`mail.<dominio>`, con su MX
y su SPF). Sin él, SPF alinea con `amazonses.com`; con él alinea con nuestro
dominio, que es lo que DMARC realmente mira.

### El escalonado, y por qué

Pregunta del dueño: ¿182 el primer día no es demasiado para la reputación? Sí,
pero el riesgo que importa no es el volumen. En orden de lo que puede tumbar la
cuenta:

1. **Rebotes duros.** SES pone la cuenta bajo revisión por encima de ~5%. Con
   182 direcciones, **diez malas son 5.5%**. No hay forma de saberlo antes de
   mandar: por eso se manda por tandas y se mira entre una y otra.
2. **Quejas.** El umbral sano es 0.1%. Con 182 envíos, **una sola marca de
   spam es 0.55%** — cinco veces por encima. En volúmenes chicos no hay de
   dónde diluir; de ahí que avisarles antes pese tanto.
3. **El pico de volumen.** Real pero el menor: 182 es minúsculo en absoluto, y
   lo que incomoda es la razón (cero → 182), no el número. A favor: una
   invitación que la gente espera es el mejor tráfico de calentamiento que
   existe — abren, hacen clic y entran.

Plan: cuatro tandas de ~20, ~40, ~60 y el resto. **La condición no es el
calendario, es el semáforo**: no sale la siguiente hasta ver la anterior. La
primera va a testers conocidos y a la gente más activa — siembra señal buena y
destapa problemas con el radio de explosión chico.

(El número creció: M9 se escribió con 161 altas previstas, hoy son 182.)

Tener cuota grande no es tener el dominio caliente. Cuando AWS conceda
producción va a dar decenas de miles al día, y eso no protege de nada de lo
anterior.

### Antes de mandar el primero

- **Vigilancia de rebotes y quejas.** Hoy no hay ninguna: nos enteraríamos
  cuando SES pause la cuenta. Un configuration set con destino de eventos
  (`BOUNCE`, `COMPLAINT`, `DELIVERY`, `REJECT`) y sus alarmas, con el estilo
  del helper `alarma()` de `infra/stacks/alertas.py`. **Se puede montar ya, sin
  esperar el acceso de producción.**
- **Validar la lista.** `tools/usuarios.py` da de alta una dirección por
  corrida y no valida nada. Una revisión de sintaxis y de dominios mal escritos
  (`gmial.com`, `hotmial.com`, `outlok.com`) quita buena parte de los rebotes
  antes de que existan.

### La señal que ya tenemos en casa

En el pool hay **7 usuarios: 5 confirmados y 2 en `FORCE_CHANGE_PASSWORD`** —
invitados que nunca entraron (29% de no activación con la configuración de
hoy). Puede ser desinterés o puede ser que el correo nunca se viera.
**Preguntarles**: es la única muestra real antes de multiplicar por 26.

### Checklist

- [ ] **Ticket de acceso de producción de SES** — lo abre el dueño, es el paso
      largo, va primero.
- [ ] Identidad de dominio verificada en SES us-east-1.
- [ ] DKIM (3 CNAME), SPF fusionado y DMARC `p=none` en el DNS del dueño.
- [ ] MAIL FROM propio con su MX.
- [ ] Configuration set + eventos de rebote/queja + alarmas.
- [ ] Validador de direcciones en `tools/`.
- [ ] `UserPoolEmail.with_ses(...)` — **preparado pero sin desplegar** hasta que
      llegue el acceso de producción.
- [ ] Enlace del correo apuntando al dominio propio.
- [ ] Preguntar a los 2 invitados que nunca entraron si vieron el correo.

## Orden y dependencias

```
M1 (dinero) ──► M2 (login) ──► M4 (Stripe)   M6 (dashboard, tras M2)
                 │
M3 (quick wins, en paralelo con todo)
M5 (proteger trabajo, tras M1)
M7 (cortes nube, sin chat → medir → chat) y M8 (shorts web): tras el núcleo M1–M5
M26 (entregabilidad) ──► M9 (bot membresías): el bot no se enciende con el
    correo cayendo en spam; M26 corre ya, antes del 23
M10 (prompts en Langfuse): independiente — puede ir en cualquier hueco tras M1
M11 (narración primero): tras M1-AWS y M2, ANTES de los focus groups
M12 (hub + slots + Glacier): la lifecycle puede salir sola cuando sea; el hub
    y los slots, tras M8 (necesita los flujos Reels/Shorts ya en la web)
M23: A (imágenes) ya · B (modelos) antes del 2-oct · C (Blotato) ──► D (MIX),
    y D además tras la cola delante de Fargate y el barredor de fallos
M24 (ver los servicios): tras el 23. A no depende de nada; C es una decisión
    de red que revierte el aislamiento de Aurora
M25 (la entrada): tras el 23. A (clip) es independiente; B (dos botones) ──►
    E (registro de clics), que va en el MISMO PR; C (prompts) y D (aviso) se
    apoyan en el clasificador que ya corre

```

Lo que corre el usuario: `cdk deploy` (M2, M4, M6, M7, M8, M12), claves Stripe
(M4), cuenta/secretos del VPS (M9), y toda confirmación de gasto.

## Preguntas abiertas

1. Plataforma de la comunidad y su API (define M9).
2. ¿El pipeline produce bien con las opciones generadas sin referencia? Se
   valida con la llamada barata de M1 antes de dar por cerrado el P0.
3. Ajuste del pack grande ($19.99 vs piso $0.0165) — se decide en M4 con
   comisiones reales.
4. Chat editorial en la nube (Agent SDK): ¿se cobra en créditos por turno? Se
   diseña al abrir M7.
5. ~~M12: ¿"Reels" y "Crear contenido" del sidebar son el mismo flujo con
   formato distinto (9:16 vs película) o secciones separadas?~~ **RESUELTA en
   M22 · F (2026-09-14): el mismo flujo.** El formato es un campo del proyecto
   que se elige al crearlo, no una sección aparte. ¿Y qué hace
   exactamente el botón "Investigación" del prompt central? Se decide al
   maquetar el hub.
