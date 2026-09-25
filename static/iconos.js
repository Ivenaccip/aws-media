// Carta de diseño §6 — un solo juego de iconos de trazo en lugar de emojis.
// 24 px, trazo 1.7, puntas redondas y currentColor (el trazo lo pone .ico de
// carta.css). Van en línea: sin fuentes de iconos ni CDNs.
//
//   icono('video')            → '<svg class="ico" …>…</svg>' para un innerHTML
//   <i data-icono="video"></i> → se cambia solo por el SVG al cargar la página
//
// Siempre decorativos (aria-hidden): el nombre lo dice el texto de al lado o
// el aria-label del botón que los lleva.
(function () {
  const TRAZOS = {
    video: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM10 9.5l4.5 2.5-4.5 2.5z',
    imagen: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM21 16l-5-5-9 9M9 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
    cortar: 'M6 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM6 15a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM8.6 7.6L20 18M8.6 16.4L20 6',
    shorts: 'M9 2.5h6a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2zM11 18h2',
    guion: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
    estilo: 'M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.6 0-1-.9-1.5-.9-2.4 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01',
    agenda: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4',
    publicar: 'M21 3L10 14M21 3l-7 18-4-7-7-4z',
    metricas: 'M4 20V11M10 20V5M16 20v-7M21 20H3',
    competencia: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
    automatico: 'M20 12a8 8 0 0 1-14.3 4.9M4 12A8 8 0 0 1 18.3 7.1M18.5 3v4.2h-4.2M5.5 21v-4.2h4.2',
    idea: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z',
    subir: 'M12 15V4M7 9l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
    enviar: 'M12 19V5M6 11l6-6 6 6',
    mas: 'M12 5v14M5 12h14',
    menos: 'M5 12h14',
    listo: 'M5 12.5l4.5 4.5L19 7',
    reloj: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7.5V12l3 2',
    aviso: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7.5V13M12 16.5h.01',
    cerrar: 'M6 6l12 12M18 6L6 18',
    // UI·13 — los de crear
    personaje: 'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21a8 8 0 0 1 16 0',
    voz: 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7',
    escuchar: 'M8 5v14l11-7z',
    contexto: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7.5h6',
    rapido: 'M13 2.5L4.5 13.5h6.5l-1 8 8.5-11h-6.5z',
    formato: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM7 12V9h3M17 12v3h-3',
    descargar: 'M12 4v11M7 10l5 5 5-5M4 19.5h16',
    rehacer: 'M4 12a8 8 0 1 0 2.4-5.7M4 3.5v4.2h4.2',
    volver: 'M19 12H5M11 6l-6 6 6 6',
    sinred: 'M2.5 8.5a15 15 0 0 1 4-2.6M10 4.1A15 15 0 0 1 21.5 8.5M5.5 12a10 10 0 0 1 3-1.8M15.5 10.4A10 10 0 0 1 18.5 12M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18',
  };

  function icono(nombre, clase) {
    const d = TRAZOS[nombre];
    if (!d) throw new Error('icono desconocido: ' + nombre);
    return `<svg class="ico${clase ? ' ' + clase : ''}" viewBox="0 0 24 24" aria-hidden="true"` +
      ` focusable="false"><path d="${d}"/></svg>`;
  }

  function pintar(raiz) {
    for (const el of (raiz || document).querySelectorAll('i[data-icono]'))
      el.outerHTML = icono(el.dataset.icono, el.className);
  }

  window.icono = icono;
  window.iconos = { nombres: Object.keys(TRAZOS), pintar };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', () => pintar());
  else pintar();
})();
