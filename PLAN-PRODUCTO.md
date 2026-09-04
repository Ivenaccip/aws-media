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

## Fase M1 — Dinero y desbloqueo (P0 de la auditoría)

Lo único que hoy cobra créditos y puede dejar al usuario sin nada a cambio.

- [ ] **Personaje sin referencia** (`pipeline/flow.py`, `pipeline/character.py`):
      en `_preparar`, cuando no hay referencias, derivar nombre + descripción del
      protagonista desde el guion (LLM) y generar **2 opciones de imagen**
      (mismo modelo del pipeline). Entra en los 10 cr de preparar ya cobrados.
- [ ] **Modificar opción** en revisión (`crear.html` + endpoint nuevo): caja de
      texto "cámbiale X" → modelo de edición de imagen sobre la opción elegida.
      Tarifa: imagen estándar (2 cr) desde `tools/tarifas.json`.
- [ ] **Reparar los proyectos varados** (fcab9e66, 19fde9f1): con el punto 1,
      re-lanzar solo la etapa de personaje sin volver a cobrar.
- [ ] **Monedero visible**: cabecera compartida en hub/crear/e1 con saldo de
      `GET /api/creditos`, refrescada tras cada acción con costo y al recuperar
      el foco de la pestaña.
- [ ] **Costo encima de cada botón que cobra** ("Escribir el guion · 10
      créditos", "Producir · 90 créditos"), deshabilitado con "te faltan N
      créditos" si el saldo no alcanza. Una sola moneda de cara al usuario
      (créditos; dólares en secundario con la palabra "dólares").
- [ ] **402 humano**: mensaje con saldo, costo y CTA de recarga (concierge
      "escríbenos" hasta M4).
- [ ] **Muestra de voz cacheada** (`server/app.py::muestra_voz`): texto fijo
      "Hola, mi nombre es {nombre} y seré tu locutor.", caché global por voz en
      S3/`media/voces/` (hoy es por proyecto en `work/<id>/voces/`). Generación
      inicial: una corrida por las voces del catálogo (~$0.01 c/u, una vez).
      Botón visible "▶ Escuchar" ya sin costo.

Validación: 1 llamada barata (personaje sin referencia sobre 19fde9f1) + tests.

## Fase M2 — Acceso: login y altas (cierra deuda C1)

- [ ] **`tools/usuarios.py`** (espejo de `tools/creditos.py`):
      `alta correo --plan mensual|anual` → `admin_create_user` en Cognito
      (correo = username, contraseña provisional que Cognito envía por email,
      cambio forzado al primer login) + fila en `usuarios` + abono de cortesía
      100/200 en el mismo comando. `suspender correo` para bajas/churn.
- [ ] **Exigir JWT** del pool `us-east-1_WyPvxnj1V` en API Gateway (authorizer
      en `infra/stacks/api.py`) + Hosted UI con Authorization Code + PKCE.
      Self-signup deshabilitado en el pool.
- [ ] **Helper de fetch** en la web: adjunta el token, 401 → redirige a login
      conservando `?p=`, 403 → "no tienes acceso a este proyecto" (lo pide la
      auditoría antes de encender Cognito).
- [ ] **user_id real** end-to-end: del token al monedero, trazas Langfuse y
      claves SSM por usuario (la plomería de C5/C6 ya está indexada así; cae el
      `piloto` fijo).
- [ ] Con el login exigido, **ya se puede compartir la URL**.

Requiere: 1 `cdk deploy` del usuario al final.

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
