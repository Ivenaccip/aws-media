# Prompt para generar la imagen guía de /ayuda

Generar con GPT Image 2 (o el generador de imágenes conectado), en horizontal
(1536x1024 o 16:9). Guardar el resultado como `media/library/guia/ayuda.png` y
registrar la procedencia en `media/library/guia/catalog.json` (modelo, fecha, este prompt).

Los hex del prompt son los de la marca de la casa. **Después de `/brand-setup`,
regenerar sustituyendo**: fondo = color `paper`, texto = `ink`, acento = `accent`
de `brand.md` §Paleta (y el título por el wordmark del canal si se desea).

Si el flujo cambia (se agrega `/subtitulos`, `/publicar`, etc.), actualizar el texto
de las columnas aquí Y en la tabla de SKILL.md, y regenerar.

**`/shorts` NO va en este póster**: es un camino aparte del flujo de edición (extraer
clips verticales del longform ya editado), no un paso de la columna 3 · PUBLICA.

---

## El prompt (copiar tal cual)

> Infografía tipo póster horizontal, estilo minimalista premium (como la papelería de
> Linear o Notion), fondo blanco cálido #FFFEF7, texto principal en azul tinta oscuro
> #1A1A2E, un solo color de acento índigo #6366F1. Tipografía sans-serif geométrica
> moderna, mucho espacio en blanco, iconos de línea delgada, sin fotografías, sin
> degradados, sin sombras dramáticas. Composición: título centrado arriba en
> mayúsculas "TU FLUJO DE VIDEO CON IA" con la palabra "IA" en índigo. Debajo, tres
> columnas conectadas de izquierda a derecha por flechas delgadas índigo. Columna 1,
> encabezado "1 · PREPARA" con subtítulo pequeño "una sola vez", y debajo tres
> renglones con icono de línea a la izquierda de cada uno: "/instalar" (icono
> engrane), "/brand-setup · opcional" (icono paleta de pintor), "conectar
> servicios · opcional" (icono enchufe). Columna 2, encabezado "2 · CONSTRUYE" con subtítulo "por cada video", y
> cinco renglones: "/empezar" (icono botón de play), "/clean-cut" (icono tijeras),
> "/clean-audio" (icono onda de sonido), "/subtitulos" (icono bocadillo de texto),
> "/broll-ai" (icono chispa). Columna 3, encabezado "3 · PUBLICA", y un solo renglón:
> "/publicar" (icono cohete). Los comandos que
> empiezan con "/" van en índigo #6366F1 y en tipografía monoespaciada; el resto del
> texto en azul tinta. En la parte inferior, una franja delgada con borde redondeado
> y fondo índigo muy claro, con el texto centrado: "¿Perdido? Escribe /ayuda" con
> "/ayuda" en índigo. Reproducir TODOS los textos EXACTAMENTE como están escritos
> aquí, en español, sin errores ortográficos, sin texto adicional inventado, sin
> marcas de agua.
