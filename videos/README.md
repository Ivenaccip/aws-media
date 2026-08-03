# videos/ — proyectos del usuario

Cada video es un proyecto `videos/video-N/`. Créalo con:

```bash
python tools/project.py new video-1
```

Todo el contenido de esta carpeta está **gitignorado** (salvo este README): el
metraje crudo, los renders y el estado de trabajo nunca van a git.

- El árbol `work/` es la capa compartida de las dos ramas (longform y shorts) —
  ver el esquema completo en `tools/project.py`.
- Se transcribe **una sola vez** por proyecto al esquema canónico
  (`work/transcripts/<id>.canonical.json`); ambas ramas consumen ese archivo.
- La rama shorts usa `work/shorts/` como `SHORTS_TMP` (lo cablea la skill, no tú).
