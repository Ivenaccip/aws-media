// Datos de mentira para las pruebas de navegador. Nada aquí es un precio:
// los créditos de las tarifas salen de tools/tarifas.json en la app misma.

// una miniatura de 16:10 que se distingue a simple vista en una captura
export const MINIATURA_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">' +
  '<rect width="320" height="200" fill="#1b3049"/><circle cx="160" cy="100" r="56" fill="#da8c28"/></svg>';

export const PELICULA = {
  id: 'p1',
  estado: 'listo',
  etapa: null,
  brief: 'Un colibrí en cámara lenta',
  duracion_s: 30,
  guion: [],
  personaje: { opciones: [] },
  progreso: { editor: 'gen-p1' },
  resultado: { mensaje: 'Tu película está lista.' },
};
