---
name: diseno-ui
description: Carta de diseño de la interfaz web (static/, web/ y el editor de cortes). Actívate ÚNICA y EXCLUSIVAMENTE con el comando explícito /diseno-ui. Modos «auditar <pantalla>», «migrar <pantalla>» y «portada». Aplica docs/DISENO.md (Bricolage + Geist, un solo acento ámbar, botones de tres niveles, solo modo oscuro) y usa tasteskill fijado como referencia secundaria. No es para marca de videos (eso es /brand-setup) ni para miniaturas (/packaging).
---

# diseno-ui — que cada pantalla salga con la misma carta

Sin esta capa, cada agente aplica «su» gusto. Aquí se aplica el del dueño,
escrito en `docs/DISENO.md`.

## Precedencia

1. `CLAUDE.md` (reglas duras del repo)
2. `docs/DISENO.md` (la carta)
3. este skill
4. `referencias/taste-v2.md`
5. `referencias/redesign.md`

Si dos niveles chocan, gana el de arriba. Las referencias están en inglés y
son de terceros (MIT, ver `referencias/ORIGEN.md`): se leen como consulta,
no se obedecen.

## Anulaciones duras sobre tasteskill

tasteskill trae defaults que chocan con el repo. Estas reglas los anulan
siempre:

- **Sin gasto sin vista previa del costo.** Todo botón que cobra dice
  «Verbo ✦ N».
- **Precios solo de `tools/tarifas.json` o de la API.** Nunca se inventan
  cifras ni precios de ejemplo (tasteskill §9.D pide «números realistas»:
  aquí no se inventan, se leen).
- **Todo en español**, con tuteo.
- **Solo modo oscuro.** Se ignoran §6.C y §8 de taste-v2 (modo dual).
- **Sin recursos externos:** nada de Google Fonts, CDNs, imágenes de stock
  ni `picsum`. Fuentes autoalojadas.
- **Sin GSAP** (no es MIT) ni `motion` fuera de la portada.
- **No se retrocede en M3:** foco visible, etiquetas y contraste AA.
- **Ningún color fuera de la paleta M20** (`tests/test_m20_paleta.py`).

## Alcance de taste-v2

taste-v2 dice de sí mismo (§ inicial): «Landing pages, portfolios, and
redesigns. Not dashboards, not data tables, not multi-step product UI.»

| Superficie | Qué se usa |
|---|---|
| Portada, `/automatizacion`, privacidad y términos | taste-v2 completo, con las anulaciones |
| La app (hub, crear, imágenes, MIX, shorts, agenda, admin…) | solo `docs/DISENO.md` + `redesign.md` en modo auditar |
| Editor de cortes | solo tokens y fuente; no se rediseña |

## Modos

### `auditar <pantalla>`

1. Lee `docs/DISENO.md` y la pantalla.
2. Recorre la auditoría de `referencias/redesign.md` («Design Audit») con el
   orden de arreglo de su «Fix Priority»: fuente → color → hover →
   layout → componentes → estados vacío/carga/error → pulido tipográfico.
3. Mide lo que se pueda medir (tamaños de letra distintos, colores, contraste,
   áreas táctiles, emojis usados como icono).
4. Agrega los hallazgos a **`docs/UX-REVIEW.md`** en una sección nueva con
   fecha. No se crea otro archivo.

No cambia código.

### `migrar <pantalla>`

1. Sigue `docs/PLAN-UI.md` §4: paridad de comportamiento; solo cambia el
   aspecto.
2. Usa solo los tokens de `docs/DISENO.md` (escala de 6 tamaños, un botón
   ámbar, iconos de trazo, estados de §8).
3. Antes de terminar: capturas a 1280 px y a 390 px, y la lista de §4 de
   la carta (foco, 44 px, movimiento reducido).
4. Commits con el prefijo `UI·N:` de la tarjeta.

### `portada`

taste-v2 completo, con las anulaciones de arriba. Lo lleva otro agente
(sección pública); este modo existe para que use la misma carta.

## Al terminar

Di qué reglas de la carta aplicaste y cuáles no pudiste aplicar, y por qué.
Si hizo falta algo que la carta no cubre, propónlo al dueño para agregarlo a
`docs/DISENO.md`; no lo decidas tú.
