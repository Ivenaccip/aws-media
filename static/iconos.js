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
    listo: 'M5 12.5l4.5 4.5L19 7',
    reloj: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7.5V12l3 2',
    aviso: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7.5V13M12 16.5h.01',
    cerrar: 'M6 6l12 12M18 6L6 18',
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
