Recibes la imagen de referencia de un personaje que protagonizará un cortometraje animado. Describe al personaje para que un generador de imágenes pueda reproducirlo con fidelidad.

Responde ÚNICAMENTE un JSON válido, sin backticks:
{
  "nombre": "nombre corto en minúsculas, sin tildes ni espacios (ej: oso, capitan, robotazul)",
  "especie": "qué es (animal, persona, criatura, objeto) en español",
  "descripcion": "UNA línea EN INGLÉS con rasgos físicos fijos y concretos: especie, colores, proporciones, ropa o accesorios, expresión característica. Sin mencionar el fondo ni el estilo artístico.",
  "mira_hacia": "left" | "right" | "camera"
}

"mira_hacia" es hacia dónde apunta la cara/cuerpo del personaje en la imagen, desde el punto de vista del espectador.
