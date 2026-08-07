---
name: subtitulos
description: Paso de subtítulos de la rama longform — quema subtítulos sincronizados sobre el master/preview usando edited-transcript.json. Úsala cuando el usuario quiera "subtítulos", "subtitular el video", "agrégale subtítulos", "captions para el longform", o el .srt de su video. Cubre la segmentación palabra→subtítulo, el estilo (default o de marca), el GATE de frame de muestra antes de quemar todo, el quemado con tools/make_subs.py (audio intacto, encoder de hwenc) y el .srt para subir a YouTube como subtítulos suaves. NO es la de captions animados de shorts (eso vive en /shorts con Remotion).
---

# subtitulos — subtítulos del longform

Quema subtítulos sincronizados por palabra sobre un video ya cortado. Todo sale de
`videos/video-N/work/edited-transcript.json` (ms, timeline del master — lo produce
`/clean-cut` al final); **nunca se estima de oído ni se retranscribe**. Da igual
qué backend de transcripción eligió el usuario (local o AssemblyAI): esta skill
consume el resultado ya normalizado y no ramifica por backend (`docs/SCHEMA.md`).

La herramienta es determinística: `tools/make_subs.py` segmenta, escribe
`work/subs/subs.ass` + `subs.srt` y quema. Tu trabajo es elegir el estilo con el
usuario y **no quemar el video completo sin el gate del frame de muestra**.

## Flujo

1. **Confirmar el base.** Default: el mp4 más reciente de `output/` (la tool lo
   toma sola); si el usuario quiere otro (tight vs natural, con b-roll ya
   insertado), pásalo con `--base`. Orden recomendado del pipeline: subtítulos
   DESPUÉS del feedback del corte (cambiar cortes desincroniza subtítulos) y
   después de `/broll-ai` si va a haber b-roll (así el subtítulo queda encima del
   b-roll, que es lo correcto).
2. **Decidir el estilo — la marca primero.** Leer `brand.md` (paleta y tipografía)
   y mapear a flags de la tool:
   - `--text-color` = blanco puro o el `paper` de la marca (el texto SIEMPRE debe
     ser el color más claro de la paleta — legibilidad sobre gusto);
   - `--outline-color` = el `ink` oscuro de la marca;
   - `--font` = la fuente de cuerpo de la marca **SI está instalada en el sistema**
     (verifícalo en `C:\Windows\Fonts` / `fc-list`; libass NO lee
     `@remotion/google-fonts`, son mundos separados). Si no está: decírselo y
     ofrecer instalar el .ttf, usar la más parecida del sistema, o Arial.
   Los defaults de la tool (blanco `FFFFFF`, contorno `14141E`, Arial, 52pt @1080p,
   2 líneas, abajo-centro) equivalen a la marca de la casa — son el fallback si el
   usuario no corrió `/brand-setup` o no quiere personalizar. Ajustes del usuario →
   `--size`, `--bold`, `--margin-v`.
3. **GATE: frame de muestra (duro).** Elegir 2-3 momentos CON texto en pantalla
   (del transcript: un subtítulo de 2 líneas, uno corto) y renderizar:
   `python tools/make_subs.py videos/video-N --frame 12.5 [estilo...]`
   Ver el PNG tú primero (¿legible? ¿no tapa nada clave? ¿tamaño correcto?) y
   mostrárselo al usuario. Iterar estilo aquí — un frame tarda segundos, el video
   completo minutos. **Sin su aprobación no se quema.**
4. **Quemar:** `python tools/make_subs.py videos/video-N --mode final [estilo aprobado]`
   → `<base>-subtitulado.mp4`. La tool copia el audio bit a bit (aquí jamás se toca
   loudness), recodifica el video con la cadena de encoders y verifica sola
   (v:0 == a:0 == duración del base; si falla el gate, la salida no se usa).
5. **Entregar también el `.srt`** (`work/subs/subs.srt`): sirve para subirlo a
   YouTube como subtítulos suaves (mejor SEO y accesibilidad) además del quemado.

## Segmentación (lo que hace la tool, por si preguntan)

Corta subtítulo en: pausa ≥ 600 ms, puntuación fuerte (si ya lleva >1.2 s), tope de
38 caracteres por línea / 2 líneas, o 5 s de duración. Da 150 ms de respiro al final
sin pisar al siguiente. Esos umbrales viven como constantes en `tools/make_subs.py`;
si un video necesita otros, se cambian ahí con el usuario enterado.

## Reglas

- **El transcript es la verdad.** Si el usuario reporta un subtítulo desincronizado,
  el problema está en `edited-transcript.json` (o el base no corresponde al
  transcript — p.ej. quemó sobre natural con transcript del tight): diagnostica eso,
  no "ajustes a mano" de tiempos.
- **Un typo del ASR se corrige en `edited-transcript.json`** (y se re-generan los
  archivos) — así el .srt y el quemado quedan consistentes, no parchando el .ass.
- Los frames de muestra van en `work/subs/` (son del proyecto, no scratch).
- Base con "subtitulado" en el nombre = ya tiene subtítulos quemados; nunca quemar
  encima (la tool los excluye del default, pero un `--base` explícito puede
  forzarlo — avisa).
