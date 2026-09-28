// El prefijo «use» lo exige React (reglas de los hooks).
//
// UI·21 — algo que trabajaba en la nube acaba de quedar listo, y se enciende
// un instante (la clase `destello` de tokens.css). Solo en el paso de «no» a
// «sí» mientras la pantalla está abierta: lo que ya estaba listo al entrar no
// se enciende. `null` es «todavía no se sabe» (los datos no han llegado):
// de null a «sí» es la primera carga, y tampoco se enciende. Es el patrón de
// React de guardar lo del render anterior en el estado (seguro con
// StrictMode; los refs no se leen al pintar).
import { useCallback, useState } from 'react';

export function useLlegada(llego: boolean | null): [encendida: boolean, apagar: () => void] {
  const [antes, setAntes] = useState(llego);
  const [encendida, setEncendida] = useState(false);
  if (llego !== antes) {
    setAntes(llego);
    setEncendida(antes === false && llego === true);
  }
  return [encendida, useCallback(() => setEncendida(false), [])];
}
