// El guardarraíl del texto (M13, static/guardrail.js): se modera ANTES de la
// petición que cobra. Si /api/moderar falla, se deja pasar: un filtro caído no
// frena el producto (los guardarraíles de los proveedores siguen detrás).
// A diferencia de guardrail.js, aquí no se pinta nada: la pantalla decide
// cómo enseñar el motivo (con <Dialogo>), y siempre como TEXTO.
export type Veredicto =
  | { permitido: true }
  | { permitido: false; mensaje: string; motivo: string };

const MENSAJE_POR_DEFECTO =
  'La IA no permite violencia explícita, sangre o implicaciones sexuales.';

export async function moderar(texto: string): Promise<Veredicto> {
  if (!texto.trim()) return { permitido: true };
  try {
    const r = await fetch('/api/moderar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto }),
    });
    if (!r.ok) return { permitido: true };
    const d = (await r.json()) as { permitido?: boolean; mensaje?: string; motivo?: string };
    if (d.permitido) return { permitido: true };
    return {
      permitido: false,
      mensaje: d.mensaje || MENSAJE_POR_DEFECTO,
      motivo: d.motivo || '',
    };
  } catch {
    return { permitido: true };
  }
}
