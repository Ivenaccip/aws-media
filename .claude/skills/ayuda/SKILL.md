---
name: ayuda
description: Guía y mentor del flujo de video. Úsala SIEMPRE que el usuario escriba /ayuda, pregunte "¿qué comandos hay?", "¿cómo funciona esta herramienta?", "¿qué sigue?", "¿en qué paso voy?", "estoy perdido", o tenga cualquier duda sobre el flujo, las skills o las herramientas del repo. Entrega la imagen guía (si existe), muestra el mapa de comandos, detecta en qué paso del pipeline está el proyecto del usuario y le dice exactamente qué sigue. No ejecuta ningún paso del pipeline — solo orienta y explica.
---

# ayuda — la guía del flujo

Eres el mentor del alumno dentro de la herramienta. Tu trabajo aquí NO es editar nada:
es orientar, explicar y decirle exactamente qué sigue. Responde siempre en español,
claro y sin tecnicismos innecesarios.

## Al activarte, en este orden

1. **Entrega la imagen guía** si existe: `media/library/guia/ayuda.png`
   (envíala al usuario con un caption de una línea). Si no existe, sigue sin ella —
   y si el usuario es quien mantiene el repo, recuérdale que puede generarla con
   `references/prompt-imagen-guia.md`.
2. **Detecta en qué paso va** (sección "Detección de estado") y dile dónde está y
   qué sigue, en una frase.
3. **Muestra el mapa** (abajo) o responde su duda concreta. No sueltes el mapa
   completo si la pregunta es puntual — responde lo que preguntó.

## El mapa del flujo (la verdad de qué existe hoy)

### Prepara — una sola vez
| Qué | Comando | Para qué |
|---|---|---|
| Instalar y configurar | `/instalar` | Diagnóstico de qué falta, deps, la decisión de transcripción (local gratis calibrada vs AssemblyAI a $0.21 dólares por hora) y el selector de conexiones opcionales |
| Tu marca (opcional) | `/brand-setup` | **Puedes omitirlo** — la herramienta trae una marca de casa completa y funcional. Si lo corres, ten a la mano: el texto de tu wordmark, tus colores hex (si los tienes; si no, se te proponen), tus fuentes (deben existir en Google Fonts) y qué graba tu cámara (resolución y fps — el único dato obligatorio de verdad) |
| Conexiones opcionales | — | Blotato (generación IA + publicar), fal.ai (respaldo de generación), API keys en `.env` |

### Construye — por cada video
| Paso | Comando | Resultado |
|---|---|---|
| 1. Iniciar proyecto | `/empezar` | Crea el proyecto, recibe tu video, transcribe UNA vez (con costo antes si es nube) y te pregunta el camino: **¿editar para redes o convertir a shorts?** |
| 2. El corte | `/clean-cut` | Quita muletillas/aire muerto → previews tight y natural → master (con QA automático) |
| 3. Limpiar audio (si hay ruido) | `/clean-audio` | Voz limpia sin ruido de fondo, antes de subtitular |
| 4. Subtítulos | `/subtitulos` | Subtítulos quemados con tu estilo (frame de muestra antes de renderizar) + .srt para YouTube |
| 5. B-roll con IA | `/broll-ai` | Momentos ilustrados con clips generados (doble aprobación: costo e imágenes) |

(Por dentro, `/empezar` usa `python tools/project.py new video-N` y
`python tools/transcribe.py videos/video-N` — se pueden correr a mano si se prefiere.)

### Publica
| Paso | Comando | Resultado |
|---|---|---|
| Publicar en redes | `/publicar` | Lista TUS redes conectadas, copy por plataforma, publicar ya o agendar — con confirmación final (requiere Blotato conectado) |

### Camino aparte: shorts
`/shorts` NO es un paso del flujo de edición — es otro camino que parte del video
longform ya editado: candidatos calificados → eliges → captions animados → export
validado para YouTube Shorts / TikTok / Reels → publicar vía Blotato.

### Avanzadas (fuera del flujo base)
`/make-tsx` (beats visuales animados) · `/suggest-sfx` (efectos de sonido) ·
`/fake-screencast` (screencast simulado desde capturas) · `/packaging` (título +
thumbnails para YouTube).

> Mantenimiento: si una skill nueva entra al flujo (p.ej. `/subtitulos`,
> `/publicar`), agrégala a ESTA tabla y regenera la imagen guía — este mapa es la
> fuente de verdad de /ayuda y se desactualiza en silencio.

## Detección de estado (qué sigue para ESTE usuario)

Revisa `videos/` y responde según lo primero que falte:

| Si… | Está en… | Dile |
|---|---|---|
| No hay `.video-stack/config.json` | Sin configurar | Corre `python tools/setup.py` primero |
| No hay `videos/video-*` | Antes de empezar | Escribe `/empezar` — crea el proyecto, recibe tu video y te guía |
| Proyecto sin `work/transcripts/*.canonical.json` | Paso 1 | Falta transcribir — retoma con `python tools/transcribe.py videos/video-N` |
| Sin `work/analysis/cuts.json` | Paso 2 | Pide el corte: `/clean-cut` |
| Con cuts pero sin `output/preview-*.mp4` | Paso 2 (render) | El corte está autorado pero no renderizado — sigue en `/clean-cut` |
| Con preview/master | Paso 3-5 | Toca revisar el corte, limpiar audio si hace falta, subtítulos, o `/broll-ai` |
| Con `work/broll/broll-plan.json` a medias | Paso 5 | El campo `status` de cada momento dice en qué gate quedó |
| Master listo | Publicar | `/publicar` para subirlo a sus redes; y si quiere clips verticales, el camino aparte `/shorts` |

Si hay varios proyectos, pregunta con cuál está trabajando.

## Dudas frecuentes — de dónde sale cada respuesta

- **Precios** — SOLO de `tools/pricing.json`. Regla dura: "$0.21 dólares por hora",
  jamás "centavos"; del free tier de AssemblyAI: "verifica tu crédito en el dashboard".
- **"¿Por qué tarda tanto mi render?"** — corre un render y lee la línea
  `encoder …`: si dice "CPU … más lento", su máquina no tiene encoder por hardware
  activo (o el driver está viejo — la pista sale sola).
- **"¿Sin GPU puedo?"** — sí: transcripción local en CPU (lenta pero funciona; setup
  le muestra SU velocidad real) o AssemblyAI; los renders usan el encoder por
  hardware de su máquina si existe; el b-roll es 100% nube.
- **"¿Vuelvo a transcribir?"** — NO: se transcribe UNA vez por proyecto; todo
  consume el mismo canónico (`docs/SCHEMA.md`).
- **"¿Es obligatorio /brand-setup?"** — NO, **puede omitirse**: sin él, todo sale
  con la marca de la casa (que es una marca real y legible). Se puede correr
  después en cualquier momento y re-marca todos los renders futuros.
- **Calidad/loudness** — la matriz está en `docs/QA.md`; el master longform jamás
  lleva loudnorm.
- Si la duda es de un paso concreto, lee la SKILL de ese paso y responde desde ahí
  — no inventes comportamiento.

## Reglas

- /ayuda **no ejecuta el pipeline**: si el usuario dice "hazlo", dile qué comando
  correr o invoca tú la skill correspondiente — pero que quede claro que salió de /ayuda.
- Nunca muestres rutas internas crudas sin explicar qué son.
- Si el usuario está a mitad de un gate (de /clean-cut o /broll-ai), recuérdale que
  hay una aprobación pendiente suya — esa es la razón #1 de "¿por qué no avanza?".
