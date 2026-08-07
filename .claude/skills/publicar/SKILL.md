---
name: publicar
description: Cierre del flujo — publicar o agendar el video terminado en las redes del usuario vía Blotato. Úsala cuando el usuario quiera "publicar", "subir a redes", "postear el video", "agendar la publicación", o al terminar el camino de edición o de shorts. Cubre verificar el MCP de Blotato, listar las redes REALMENTE conectadas del usuario, elegir qué publicar y dónde, el copy por plataforma, y el GATE duro de confirmación antes de publicar nada. Requiere el MCP de Blotato conectado.
---

# publicar — el cierre del flujo

Toma un entregable terminado (master subtitulado, con b-roll, o los shorts
exportados) y lo publica o agenda en las redes del usuario vía Blotato. **Nada se
publica sin el gate de confirmación** — publicar es irreversible y de cara al mundo.

## Etapa 0 — ¿Está Blotato?

Intenta listar las cuentas (`blotato_list_accounts`; si las tools no están en
contexto, búscalas primero con ToolSearch).

- **Sin MCP de Blotato** → detente con este mensaje: "Para publicar necesitas
  conectar Blotato. Aquí te explico cómo: **[PENDIENTE-LIGA-VIDEO: tutorial de
  conexión de Blotato]**. Cuando esté conectado, vuelve a escribir lo que
  necesitas." No improvises otra vía de publicación.
- **Con MCP pero cero cuentas conectadas** → "Blotato está conectado pero no tiene
  redes vinculadas — vincúlalas en tu dashboard de Blotato y regresa."

## Etapa 1 — Qué publicar

Detecta los entregables del proyecto y confirma con el usuario:

- Camino edición → el mp4 más reciente de `output/` (típicamente
  `*-subtitulado.mp4` o `*-broll*.mp4`).
- Camino shorts → los archivos de `output/shorts/` que pasaron `validate.sh`
  (nunca ofrecer un short que no pasó validación).

## Etapa 2 — Dónde (con las redes REALES del usuario)

`blotato_list_accounts` devuelve sus cuentas conectadas Y los campos obligatorios
de cada plataforma. Con eso:

1. Presenta el selector con SUS redes (multiselección) — nunca una lista genérica
   de plataformas que quizá no tiene.
2. Por cada red elegida, pide/resuelve solo sus campos obligatorios
   (`requiredFields`): Instagram → story o reel; YouTube → título y privacidad;
   TikTok → privacidad y flags; Facebook/LinkedIn → página/subcuenta; etc.
3. Sentido común de formato: un short 9:16 → reel/TikTok/Shorts; un longform 16:9
   NO va como reel. Si el formato no cuadra con la red elegida, dilo antes del gate.

## Etapa 3 — El copy

Redacta por plataforma (no un copy único clonado): gancho primero (sale del
transcript — la frase más fuerte del video, no un resumen), longitud y tono según
la red (X corto y directo; Instagram con línea de aire y hashtags moderados;
YouTube título + descripción). Muéstralo y deja que lo edite. Si el usuario tiene
skills de copywriting instaladas (p.ej. post-writer / viral-hooks), úsalas.

## Etapa 4 — ¿Ahora o agendado?

Pregunta: publicar ya, o agendar (fecha/hora local del usuario). Para agendar usa
el scheduling de Blotato (`scheduledTime` en el post) — no inventes crons locales.

## Etapa 5 — GATE DURO y publicación

Presenta la tabla final: red → cuenta (@usuario) → archivo → copy → cuándo.
**Espera el "sí" explícito del usuario. Sin excepciones, aunque lo haya pedido
"rápido".** Después:

1. Sube el video (`blotato_create_presigned_upload_url` → subir el archivo →
   media URL).
2. `blotato_create_post` por cada red con sus campos obligatorios.
3. Verifica con `blotato_get_post_status` y reporta: red, estado, y liga si la hay.
4. Si una red falla, reporta el error tal cual y NO reintentes en silencio ni
   publiques "mientras tanto" en las demás sin avisar.

## Reglas

- **Publicar sin el gate de la Etapa 5 = bug.** Igual de grave que generar sin
  preview de costo.
- Las cuentas se listan EN VIVO cada vez (pueden haber conectado/quitado redes).
- Un archivo que no pasó su validación (validate.sh / gate de duración) no se
  ofrece para publicar.
- Costos: publicar consume créditos de Blotato en algunos casos — si la operación
  los consume, aplica la política de `tools/pricing.json` §broll (saldo antes,
  consumo después).
- Esta skill publica el video del proyecto; investigación de mercado y responder
  a clientes con Blotato son caminos futuros aparte, no los improvises aquí.
