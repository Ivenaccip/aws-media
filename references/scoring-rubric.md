# Rúbrica de scoring de segmentos (rama shorts)

**Archivo editable por el usuario.** Esta rúbrica es tuya: ajusta pesos, ejemplos y
umbrales a tu canal. Es la mitad-shorts de la voz editorial del repo; su gemela es la
política de corte de `.claude/skills/clean-cut/SKILL.md` — las dos usan los mismos
criterios sobre el mismo transcript canónico.

**Contexto del contenido: español LATAM con términos técnicos en inglés.** El
code-switching (deploy, hook, pipeline, feature, prompt…) es la forma NORMAL de hablar
del canal — **nunca lo puntúes como incoherencia, error de transcripción ni ruido**.
Un segmento que alterna español e inglés técnico con naturalidad es tan coherente como
uno monolingüe.

Al analizar el transcript, puntúa cada candidato (15-55 s) en 5 dimensiones, 0-100
cada una, y pondera:

```
score = (hook * 0.30) + (coherencia * 0.25) + (emoción * 0.20) + (densidad * 0.15) + (payoff * 0.10)
```

## 1. Fuerza del hook (peso 0.30)

Los primeros 3 segundos deciden el scroll. Arquetipos:

| Arquetipo | Ejemplo | Rango |
|---|---|---|
| Contrarian / afirmación fuerte | "Todo lo que te dijeron del deploy está mal" | 80-100 |
| Curiosity gap | "Hay una cosa que nadie te cuenta de Remotion…" | 75-95 |
| Promesa de valor | "Este es el framework exacto que uso para…" | 70-90 |
| Pattern interrupt | "Espérate, mira esto raro" | 70-90 |
| Preview del payoff | "Al final de esto vas a saber…" | 65-85 |
| Arranque en plena acción | [entra a media frase con energía] | 60-80 |
| Conocimiento oculto | "El secreto que los seniors no comparten" | 60-80 |
| Genérico / débil | "Bueno, hoy quiero hablarles de…" | 10-40 |

**Boosters** (+5-10 c/u): número específico ("3 pasos", "$50K", "en 30 días");
entidad reconocible (persona, empresa, herramienta — en cualquier idioma);
experiencia propia ("lo probé", "me pasé 6 meses").

## 2. Coherencia independiente (peso 0.25)

El segmento debe entenderse completo sin ver el resto del video.

| Criterio | Score |
|---|---|
| Arco narrativo autocontenido (setup → desarrollo → resolución) | 85-100 |
| Idea completa con huecos menores inferibles | 65-84 |
| Mayormente independiente pero referencia contenido previo ("como les decía") | 40-64 |
| Requiere contexto previo ("volviendo a ese punto") | 10-39 |
| Fragmento — abre o cierra a media idea | 0-9 |

**Red flags** (score bajo automático): "como mencioné antes…", "volviendo a lo de
hace rato…", pronombres sin referente ("él dijo que…"), cierre a media frase.
**NO es red flag:** términos en inglés dentro de una frase en español — eso es
code-switching normal, no incoherencia.

## 3. Intensidad emocional (peso 0.20)

| Señal | Rango |
|---|---|
| Opinión fuerte con convicción / rant apasionado | 80-100 |
| Revelación sorpresa / giro inesperado | 75-95 |
| Humor genuino / risa | 70-90 |
| Vulnerabilidad personal / historia de fracaso honesta | 70-90 |
| Explicación entusiasta de algo fascinante | 60-80 |
| Observación tranquila pero aguda | 40-60 |
| Recitación monótona de datos | 10-30 |

## 4. Densidad de valor (peso 0.15)

| Tipo de contenido | Rango |
|---|---|
| Proceso paso a paso / método exacto | 80-100 |
| Framework / modelo mental con ejemplos | 75-95 |
| Datos específicos / hallazgos | 70-90 |
| Insight contraintuitivo explicado | 65-85 |
| Consejo general con algo de especificidad | 40-60 |
| Frases vacías ("échale ganas", "sé constante") | 10-30 |

**Ajuste por duración:** penaliza segmentos donde >30% del tiempo es relleno,
repetición o tangentes (el relleno se mide igual que en la política de corte de
clean-cut: muletillas y reformulaciones sin intención, en cualquiera de los dos idiomas).

## 5. Calidad del payoff (peso 0.10)

| Tipo de cierre | Rango |
|---|---|
| Remate / revelación satisfactoria | 85-100 |
| Call-to-action claro con siguiente paso específico | 75-90 |
| Pensamiento completo — punto de parada natural | 65-80 |
| Se disuelve hacia el siguiente tema (cortable limpio) | 40-60 |
| Corta a media idea / sin resolución | 10-30 |

## Selección de candidatos

1. **8-12 candidatos** en un video típico de 30-60 min
2. **Duración dulce:** 15-55 s (pico de engagement 25-40 s)
3. **Umbral mínimo: 60** — debajo, se descarta
4. **Diversidad:** no 5 segmentos del mismo subtema
5. **Espaciado:** de preferencia ≥ 2 min entre segmentos en la fuente
6. **Límites naturales:** inicio/fin en frontera de oración, nunca a media palabra
   (el snapping lo garantiza mecánicamente; tú elige fronteras semánticas)

## Hook overlay (texto en pantalla)

- **Línea 1:** 4-8 palabras, la afirmación que detiene el scroll (blanca, grande)
- **Línea 2:** 3-6 palabras, contexto o subtítulo (cian, menor)
- En el idioma del hook hablado (normalmente español; un término en inglés se queda
  en inglés — no lo traduzcas)
- No dupliques las primeras palabras habladas — complementan el audio
