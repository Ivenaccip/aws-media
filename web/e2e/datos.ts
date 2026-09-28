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

// UI·23 — Métricas con publicaciones medidas seis veces. La de Instagram no
// trae detalle: al abrirla, su gráfica queda a la vista. La de TikTok trae un
// detalle largo: en un teléfono, su gráfica queda bajo el pliegue. La de
// YouTube tiene cifras de seis dígitos, que no caben seis en un teléfono.
const medidas = (vistas: number[]) =>
  vistas.map((v, i) => ({ cuando: `2026-09-${String(20 + i).padStart(2, '0')}T15:00:00Z`, numeros: { vistas: v } }));

const publicacion = (id: string, red: string, vistas: number[], detalle: number) => ({
  id,
  red,
  plataforma: red.toLowerCase(),
  cuando: '2026-09-19T15:00:00Z',
  estado: 'publicado',
  enlace: '',
  error_red: '',
  texto: `Una publicación de ${red} con seis mediciones`,
  cortado: false,
  medios: 1,
  numeros: { vistas: vistas[vistas.length - 1], me_gusta: 40, comentarios: 3, compartidos: 1 },
  detalle: Array.from({ length: detalle }, (_, i) => ({ clave: `dato${i}`, etiqueta: `Dato ${i + 1}`, tipo: 'entero', valor: i * 10 })),
  medido: '2026-09-25T15:00:00Z',
  historial: medidas(vistas),
  medicion: 'medido',
  motivo: '',
  puede_pedir: false,
});

const INSTAGRAM = publicacion('m1', 'Instagram', [3200, 5100, 8740, 12050, 15800, 18230], 0);
const TIKTOK = publicacion('m2', 'TikTok', [410, 980, 1500, 1720, 1690, 2040], 20);
const YOUTUBE = publicacion('m3', 'YouTube', [103200, 245100, 318740, 412050, 515800, 998230], 0);

export const TRAMO_METRICAS = {
  items: [INSTAGRAM, TIKTOK, YOUTUBE],
  mejores: [INSTAGRAM, TIKTOK],
  cursor: null,
  desde: '2026-08-28T00:00:00Z',
  hasta: '2026-09-27T00:00:00Z',
  ultimo_tramo: true,
  hay_lista: true,
  hay_numeros: true,
  truncado: false,
  aviso: null,
  error: null,
  reconectar: false,
};
