// Los verbos de los botones que cobran. Es VERBOS de tests/test_m21_botones.py
// (tests/test_web_tuberia.py comprueba que sean los mismos): un verbo nuevo
// se decide a propósito en los dos sitios, no se cuela un martes cualquiera.
export const VERBOS = [
  'Escribir', 'Producir', 'Reintentar', 'Cambiar', 'Generar', 'Aplicar',
  'Analizar', 'Re-analizar', 'Importar', 'Renderizar', 'Proponer', 'Animar',
  'Transformar', 'Revisar', 'Editar',
  // 14-oct-2026 (dueño): el botón de la pestaña Edición del inicio dice «Iniciar ✦ N»
  'Iniciar',
] as const;

export type Verbo = (typeof VERBOS)[number];
