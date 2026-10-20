// Los números del lienzo y los topes del flujo. Son decisiones de diseño, no catálogo de
// n8n: salen del mockup (informe 04 §1.4) y del plan (D7: 1 disparador, 4 agentes, 8 apps).
// Cambiar uno cambia las posiciones que calcula el motor: lo que ya está guardado en un
// borrador no se mueve, pero los cuadros nuevos caerían en otro lugar.

/** Ancho de cada cuadro, en px. */
export const ANCHO_CUADRO = 216;
/** Alto de cada cuadro, en px. */
export const ALTO_CUADRO = 96;

/** Ancho mínimo del lienzo. */
export const LIENZO_ANCHO_MIN = 1000;
/** Alto mínimo del lienzo. */
export const LIENZO_ALTO_MIN = 780;
/** Cuánto crece el lienzo a la derecha del último cuadro (para su «+»). */
export const MARGEN_LIENZO_X = 112;
/** Cuánto crece el lienzo debajo del último cuadro (para su patita). */
export const MARGEN_LIENZO_Y = 168;

/** El mayor `x` que puede tener un cuadro. */
export const X_MAX = 2400;
/** El mayor `y` que puede tener un cuadro. */
export const Y_MAX = 2400;
/** Los cuadros se acomodan a una rejilla de este tamaño. */
export const SNAP = 8;

/** Lo que mueve una flecha del teclado, en px. */
export const PASO_TECLA = 8;
/** Lo que mueve una flecha del teclado con Mayús. */
export const PASO_TECLA_MAYUS = 24;
/** Cuánto hay que mover el puntero (|dx| + |dy|) para que sea un arrastre y no un clic. */
export const UMBRAL_ARRASTRE = 6;

/** Margen de «choca»: dos cuadros chocan si están a menos de ancho+24 y alto+24. */
export const MARGEN_CHOQUE = 24;
/** Paso de la rejilla con la que se busca el lugar libre más cercano. */
export const REJILLA_BUSQUEDA = 24;
/** Cuánto a la derecha de un cuadro cae el que va después (ancho + 128). */
export const HUECO_DERECHA = ANCHO_CUADRO + 128;

/** Cuántos disparadores puede tener un flujo. */
export const TOPE_DISPARADORES = 1;
/** Cuántos agentes de IA puede tener un flujo. */
export const TOPE_AGENTES = 4;
/** Cuántas apps puede tener un flujo. */
export const TOPE_APPS = 8;
/** El mayor número de cuadros posible (1 + 4 + 8). */
export const TOPE_CUADROS = TOPE_DISPARADORES + TOPE_AGENTES + TOPE_APPS;

/** Cuántas veces se sube por la cadena de padres antes de rendirse (con 4 agentes la cadena máxima es 3). */
export const VUELTAS_MAX = 20;

/** Cuántas fotos de «Deshacer» se guardan. */
export const MAX_HISTORIAL = 20;
/** Desde qué número se reparten los ids nuevos (los ejemplos traen ids bajos para no chocar). */
export const ID_INICIAL = 20;
/** El mayor contador de ids que se acepta de afuera: 12 cifras, como los sufijos que `contadorParaFlujo` cuenta (con más, `n + 1` ya no cambia el número y los ids se repetirían). */
export const CONTADOR_MAX = 999_999_999_999;

/** El largo máximo del nombre del flujo. */
export const LARGO_NOMBRE_FLUJO = 80;
/** El largo máximo del nombre de un agente. */
export const LARGO_NOMBRE_AGENTE = 60;
/** El largo máximo del nombre de una app. */
export const LARGO_NOMBRE_APP = 60;
/** El largo máximo del nombre de un nodo en el archivo de n8n. */
export const LARGO_NOMBRE_N8N = 100;
/**
 * El largo máximo de la tarea y de las instrucciones de un agente. Lo aplica el reductor (`editarNodo`, `cargarFlujo`) y la
 * pantalla debe usar el MISMO número como `maxLength` de sus campos.
 */
export const LARGO_TEXTO_AGENTE = 4000;
/** El largo máximo de «para qué le sirve» de un ayudante. */
export const LARGO_DESC_AYUDANTE = 1000;
/** El largo máximo de la ruta de un disparador web. */
export const LARGO_RUTA = 100;

/** El nombre que lleva un flujo nuevo. */
export const NOMBRE_FLUJO_INICIAL = 'Mi automatización';
/** Las instrucciones con que nace un agente nuevo. */
export const INSTRUCCIONES_AGENTE_NUEVO = 'Eres un asistente útil. Responde en español, con claridad.';
/** Para qué le sirve un ayudante cuando la persona no lo ha escrito (al volver una conexión «ida y vuelta»). */
export const DESC_AYUDANTE_POR_DEFECTO =
  'Un colega que revisa lo que le mandes, señala qué mejorar y responde con su propuesta.';
/** Los valores con que nace un disparador nuevo (los campos que su tipo no usa se conservan). */
export const DISPARADOR_NUEVO = { frec: 'dia', ruta: 'mi-flujo', app: 'gmail' } as const;
