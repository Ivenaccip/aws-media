# ESCALAMIENTO — de 6 testers a 50–100 usuarios activos/día

Plan escrito el 2026-09-08. Fase actual: **~6 usuarios de testing**; la semana
siguiente se abre a **50–100 activos/día**. La arquitectura de fondo (Lambda +
SQS + Step Functions/Fargate + S3/CloudFront + Aurora Data API) aguanta esa
escala sin rediseño: todo lo pesado corre fuera del request y el gate
económico ya existe (sin créditos no hay producción). Lo que sigue es la lista
de cambios puntuales, en orden, con su disparador.

## Fase 0 — ya hecho (base para todos)

- [x] `CLAUDE_API_KEY` como clave de PLATAFORMA (además de por-usuario): todos
      los usuarios tienen el chat editorial configurado de fábrica; quien suba
      la suya con `ssm_env.py --usuario <sub>` la pisa (esquema D4). El tope
      `CHAT_TURNOS_DIA` (40/día por usuario) acota el gasto mientras el chat
      es de 0 créditos.

## Fase 1 — ANTES de abrir a 50–100 (los tres que se notan)

1. **Aurora siempre activa** — `infra/stacks/db.py`:
   `serverless_v2_min_capacity` de `0` → `0.5`. Elimina la clase entera de
   503 «despertando» que hoy pega al primer usuario del valle. Costo fijo:
   ~$44 dólares/mes (0.5 ACU × $0.12/h). Deploy: `cdk deploy aws-media-db`.
2. **Reintentos ante rate limits de fal** — `pipeline/fal.py::llamar` no
   reintenta: un 429 truena la escena. Además `FAL_CONCURRENCY` es POR
   PROCESO: 10 producciones simultáneas en Fargate = 10 semáforos = hasta 10×
   el límite pensado contra la cuenta de fal. Cambio: backoff con 2-3
   reintentos para errores de rate limit (NO para timeouts de Veo, que ya
   tienen su lógica). Es el cambio que más «películas fallidas en hora pico»
   evita.
3. **Candado de imagen g2 a Postgres** — `_ocupado`/`_subs`/`_render` en la
   Lambda API viven en memoria POR INSTANCIA: dos clics simultáneos en
   instancias distintas se cuelan (p. ej. candidatos duplicados = doble cobro
   de 4 cr). Los flujos M16 nuevos ya usan candados en el doc
   (`doc.subtitulos`, `doc.overlay_job`); dar el mismo trato al de imagen g2.

## Fase 2 — con los primeros datos reales (primeras 1-2 semanas abiertos)

4. **Cold starts de la Lambda API**: la imagen trae ffmpeg + whisper → el
   primer request de una instancia fría tarda varios segundos. NO comprar
   provisioned concurrency de entrada: medir p95 de latencia en CloudWatch
   con tráfico real y decidir con datos.
5. **Sync de costes más frecuente**: desde el desglose por vendor (PR #43) el
   sync hace un GET a Langfuse por traza nueva; con cientos de trazas/día el
   sync diario en Lambda (tope 15 min) puede quedar corto. Mitigación: correr
   la regla de EventBridge cada 4-6 h (ventana chica; es idempotente por
   traza, el solape no duplica).
6. **Tarifar el chat**: hoy es la única puerta sin tarifa (peor caso teórico
   100 usuarios × 40 turnos × ~$0.01 = ~$40 dólares/día). La medición ya
   está: columna «Claude» en el admin (PR #43) + generations `chat_editor`
   en Langfuse con tokens por turno. Con $0.0099/turno medido, 1 crédito por
   turno ya cubre con margen (la estimación M7 era 2-7 cr/turno; decidir con
   una semana de datos).

## Operativo (cuando se abra)

- **Alarma de presupuesto** en AWS Billing (p. ej. aviso a 50% y 80% de un
  tope mensual) + **alarma de 5xx** del API Gateway → enterarse antes que los
  usuarios.
- Altas de los testers: `docs/OPERACION.md` (usuarios.py alta + créditos de
  cortesía por correo).

## Lo que NO hay que tocar

SQS/Step Functions/Fargate (quotas de sobra para ~20-60 producciones/día),
Cognito, API Gateway, el esquema de S3/CloudFront, el versionado de cortes
(las versiones jamás se pisan) y el flujo de créditos: el monedero ya es el
gate natural contra el gasto descontrolado de vendors.

## Números de referencia (2026-09-08)

- Costo interno medido: película 30 s ≈ $1.35 dólares (E2E C4).
- Chat editorial: ~$0.0099 dólares/turno (543 in / 287 out, claude-opus-5).
- 50-100 activos/día ≈ picos de 5-15 requests simultáneos en la API y
  ~20-60 producciones/día — dentro de quotas por defecto de AWS.
