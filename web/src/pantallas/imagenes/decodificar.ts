// Abrir un archivo de imagen para pintarlo en el lienzo. Va aparte para que
// los tests lo reemplacen: jsdom no decodifica imágenes.
export interface Decodificada {
  ancho: number;
  alto: number;
  fuente: CanvasImageSource;
}

export function decodificar(f: Blob): Promise<Decodificada> {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      ok({ ancho: img.naturalWidth || img.width, alto: img.naturalHeight || img.height, fuente: img });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      mal(new Error('No pude abrir esa imagen.'));
    };
    img.src = url;
  });
}
