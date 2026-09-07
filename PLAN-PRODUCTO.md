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
- [ ] Publicar vía Blotato desde la web (hoy: descargar por CDN y publicar
      desde el editor local o a mano).
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

- [ ] Validación: misma historia por ambos pipelines (2 películas de 15 s,
      ~$0.70 dólares c/u, con confirmación de gasto), comparación de guion,
      duración y costo en Langfuse. PENDIENTE tras el deploy.
- [x] Cobro: sin cambio (3 cr/s por duración objetivo); la duración real
      medida tras el TTS abre la puerta a cobrar exacto más adelante.
- [x] Riesgos acotados con el flag POR PROYECTO: `Proyecto.pipeline`
      ("escenas" default | "narracion"); el camino de siempre no se tocó —
      solo branches en flow._preparar/_producir. El A/B se activa con
      `?pipeline=narracion` en crear.html (o env PIPELINE_DEFAULT).
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

Hecho 2026-09-07 (M12, iteración de UI sobre el mismo PR #18): el cuadro del
hub ES la entrada del flujo — si llegas a crear.html desde el hub
(`?brief=`), las cards de brief/modos se pliegan a un resumen «💡 Tu idea ·
modo X» con «✏️ Editar» (y la lista "Tus películas" no se repite); entrar
por «Reels»/«Crear contenido» (sin query) muestra el formulario completo.
El hub exige texto antes de navegar. Configuración compactada a una
pantalla: Estilo visual (izquierda, con ejemplo en palabras del estilo
elegido — campo `descripcion` en pipeline/styles.py, viaja por
/api/estilos) + Referencia del personaje (derecha) y Duración abajo.
De paso: elegir estilo ya no des-selecciona visualmente el chip del modo
(el toggle barría todos los .chip de la página). Ejemplos con imagen real
por estilo quedan para cuando haya assets (generarlos costaría dinero).

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
M12 (hub + slots + Glacier): la lifecycle puede salir sola cuando sea; el hub
    y los slots, tras M8 (necesita los flujos Reels/Shorts ya en la web)

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
5. M12: ¿"Reels" y "Crear contenido" del sidebar son el mismo flujo con
   formato distinto (9:16 vs película) o secciones separadas? ¿Y qué hace
   exactamente el botón "Investigación" del prompt central? Se decide al
   maquetar el hub.
