// Las medidas que comparten las dos cajas de la pestaña (Video y Edición), definidas UNA vez para que no se desfasen.
//
// ANCHO_DE_ACCION (dueño, 15-oct-2026: «el botón dorado debe de tener el mismo largo como el de la imagen 4»): lo que mide, como mínimo y
// en escritorio, lo que va en la esquina derecha de la fila de abajo: el selector «Modelo Veo 3.1 Lite · 8 s ▾» de Video (MenuModelo) y el
// botón «Iniciar» de Edición (CajaEdicion). Se midió en Chromium con el modelo por defecto: el selector mide 209,5 px; 13,5 rem son 216 px,
// 6,5 px de holgura para que una tipografía de respaldo (un poco más ancha) no lo haga crecer por encima del botón.
//
// Es un MÍNIMO y no un ancho fijo: con otro modelo de rótulo más largo («Grok Imagine Video 1.5 Lite · 8 s») el selector crece lo que haga
// falta (hasta recortar el nombre con «…», como siempre) y el botón se queda en esta medida. Por debajo de 640 px los dos ocupan todo el
// ancho de la caja, así que la medida solo rige desde ahí.
export const ANCHO_DE_ACCION = 'min-[640px]:min-w-[13.5rem]';

/** Lo mismo con el alto: a partir de 640 px la fila de abajo mide 44 px (el «+», «Editar ▾», el selector de modelo), también con «Iniciar». */
export const ALTO_DE_ACCION = 'min-[640px]:min-h-11';
