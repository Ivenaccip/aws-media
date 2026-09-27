// Contraste WCAG 2.x entre dos colores #rrggbb. La vitrina lo calcula en vivo
// para cada pareja de la carta; es la misma cuenta que docs/DISENO.md usa
// para decir «4.36:1, no pasa AA».
function luminancia(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new RangeError('se espera #rrggbb: ' + hex);
  const n = parseInt(m[1]!, 16);
  const canal = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
}

export function contraste(a: string, b: string): number {
  const [alto, bajo] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (alto + 0.05) / (bajo + 0.05);
}

/** AA: 4.5 para texto normal, 3 para texto grande y bordes de controles. */
export function nivelAA(ratio: number): 'AA' | 'AA grande' | 'no pasa' {
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA grande';
  return 'no pasa';
}
