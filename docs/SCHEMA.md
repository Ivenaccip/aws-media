# SCHEMA — el esquema canónico de transcript

`schema/transcript.schema.json` es **el contrato del que cuelga todo el repo**. Las dos
herramientas fusionadas divergían en un solo punto — el ASR (AssemblyAI en ms vs.
faster-whisper en segundos, con esquemas propios) — y la decisión del handoff fue
eliminar esa divergencia, no parcharla: ambos backends normalizan hacia este esquema
y **ninguna skill sabe de qué backend vino el transcript**.

## El contrato

| Regla | Valor |
|---|---|
| Unidad de tiempo | **segundos-float** (nunca ms) |
| Granularidad | **palabra** |
| Referencia temporal | **siempre la fuente cruda** — nunca un clip recortado. Si cortas un clip y lo retranscribes, ese transcript es de OTRA fuente (nuevo `source.id`) |
| Versionado | `schema_version` explícito, obligatorio |

Campos:

```jsonc
{
  "schema_version": "1.0",
  "source": { "id": "0233", "path": "DJI_...0233.MP4", "duration": 245.3 },
  "language": "es",
  "asr": { "backend": "faster-whisper", "model": "medium" },   // solo procedencia
  "words": [
    { "text": "hola", "start": 0.12, "end": 0.35, "confidence": 0.98 }
  ],
  "segments": [
    { "first_word": 0, "last_word": 11, "text": "hola y bienvenidos…" }
  ]
}
```

- `words[]` es la verdad temporal. `confidence` es opcional (faster-whisper no siempre
  la da por palabra; AssemblyAI sí).
- `segments[]` **referencia índices de `words[]`** (inclusive en ambos extremos), no
  duplica timestamps. El `text` del segmento es conveniencia derivable.
- `asr.*` es procedencia. Una skill que ramifique por `asr.backend` está rota por
  diseño — repórtalo como bug.

## Por qué existe

- En S1 el esquema vivía en un *docstring* sin versionar
  (`vendor/claude-shorts/scripts/transcribe.py:2-35`): un update upstream lo rompe en
  silencio. Canonizarlo con `schema_version` neutraliza ese riesgo.
- En L1 el transcript era el JSON completo de AssemblyAI (ms, esquema del vendor):
  acoplaba cada consumidor al proveedor de nube.

## Política de versionado

- `schema_version` usa `MAYOR.MENOR`, empieza en `"1.0"`.
- **MENOR** (`1.0 → 1.1`): agregar campos opcionales. Los consumidores existentes
  siguen funcionando sin cambios; los validadores aceptan ambos.
- **MAYOR** (`1.x → 2.0`): cualquier cambio incompatible — renombrar/quitar campos,
  cambiar unidades o semántica (p.ej. la referencia temporal). Requiere migrador
  `1.x → 2.0` en `tools/normalizers/` y actualizar el `const` del schema.
- Los normalizadores **siempre escriben la versión más reciente**. Los consumidores
  validan `schema_version` antes de leer y fallan con mensaje claro si no la
  soportan — nunca "adivinan" un esquema.
- El archivo canónico de un proyecto vive en
  `videos/video-N/work/transcripts/<source.id>.canonical.json`.

## Flujo

```
AssemblyAI JSON (ms) ──▶ tools/normalizers/assemblyai_to_canonical.py ──┐
                                                                        ├─▶ canónico ─▶ rama longform (cuts.json, edited-transcript.json)
faster-whisper       ──▶ tools/normalizers/fasterwhisper_to_canonical.py┘        └───▶ tools/normalizers/canonical_to_s1_dual.py ─▶ rama shorts (render Remotion)
```

Se transcribe **una sola vez** por proyecto; ambas ramas consumen el mismo canónico.
`canonical_to_s1_dual.py` existe para que el render de captions de S1 funcione sin
tocar S1 por dentro (su entrada es el JSON dual: segmentos estilo-WhisperX + array
`captions` nativo de Remotion).
