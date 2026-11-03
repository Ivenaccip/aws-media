// «Ver el JSON»: la caja con el archivo que se va a descargar, para leerlo o copiarlo. Se pinta SOLO cuando está abierta (quien arma la
// pantalla decide con su propio estado y, así, el JSON se calcula solo si hace falta); el botón que la abre vive en Barra y enlaza
// esta caja por su `id` (`ID_PANEL_JSON`) con `aria-expanded` y `aria-controls`.
//
// Recibe el JSON ya hecho (`construirFlujo(...).json`) o null mientras todavía no se puede armar, y el texto que lo explica
// (`resumenFlujo(estado).textoSinJson`). «Copiar el JSON» se resuelve aquí: copia, lo dice en el cuadro de avisos de la esquina y,
// si esa página no lo trae (las pruebas, la vitrina), lo dice en una línea propia; si el navegador no deja copiar, deja el texto
// seleccionado para Ctrl+C. Nada se queda en el almacenamiento.
//
// La caja se desplaza por dentro y por eso se enfoca con el teclado (`tabIndex={0}`): sin eso quien no usa ratón no podría leerla
// (regla `scrollable-region-focusable` de axe); mismo patrón y mismo `eslint-disable` puntual que coi/Resultado.tsx.
import { useRef, useState } from 'react';

import { Boton } from '../../ui/Boton';
import { Icono } from '../../ui/Icono';
import { unir } from '../../ui/unir';
import { avisar } from '../../nucleo/avisos';
import { copiarTexto, seleccionar } from '../coi/copiar';
import * as T from './modelo/textos';

/** El `id` de la caja del JSON (el botón «Ver el JSON» de Barra la enlaza con `aria-controls`). */
export const ID_PANEL_JSON = 'json-caja';

const CLAVE_AVISO = 'constructor-json';

export interface PropsPanelJson {
  /** El archivo, o null si todavía no se puede armar. */
  json: string | null;
  /** Lo que dice la caja mientras no hay JSON («Todavía no hay JSON. Te falta: …»). */
  textoSinJson: string;
  className?: string;
}

export function PanelJson({ json, textoSinJson, className }: PropsPanelJson) {
  // «copiado» es del JSON que se copió: si el flujo cambia, el botón vuelve a decir «Copiar el JSON» sin ningún reloj
  const [copiadoDe, setCopiadoDe] = useState<string | null>(null);
  // lo que se dice en la propia página cuando no hay cuadro de avisos; también va atado al JSON de ese momento
  const [dicho, setDicho] = useState<{ para: string | null; texto: string } | null>(null);
  const refCaja = useRef<HTMLDivElement>(null);
  const copiado = json !== null && copiadoDe === json;

  function decir(a: T.TextoAviso) {
    const enLaEsquina = avisar(a.texto, { tipo: a.tipo, clave: CLAVE_AVISO });
    setDicho(enLaEsquina ? null : { para: json, texto: a.texto });
  }

  async function copiar() {
    if (json === null) {
      decir({ texto: textoSinJson, tipo: 'mal' });
      return;
    }
    const bien = await copiarTexto(json);
    if (bien) {
      setCopiadoDe(json);
      decir(T.jsonCopiado());
    } else {
      // sin permiso para el portapapeles: el texto queda seleccionado y se dice cómo seguir
      seleccionar(refCaja.current);
      decir(T.noSeCopio());
    }
  }

  return (
    <div id={ID_PANEL_JSON} className={unir('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Boton
          apagado={json === null}
          aria-label={copiado ? 'Copiado: el JSON' : undefined}
          icono={<Icono nombre={copiado ? 'listo' : 'copiar'} className="size-5!" />}
          className={unir(copiado && 'border-exito! text-exito!')}
          onClick={copiar}
        >
          {copiado ? 'Copiado' : 'Copiar el JSON'}
        </Boton>
        {dicho && dicho.para === json && (
          <p role="status" className="m-0 text-xs text-secundario">
            {dicho.texto}
          </p>
        )}
      </div>
      <div
        ref={refCaja}
        role="region"
        aria-label="JSON del flujo para n8n"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        className="max-h-85 overflow-auto rounded-boton border border-linea bg-hundido p-4"
      >
        <pre className="m-0 whitespace-pre text-xs">{json ?? textoSinJson}</pre>
      </div>
    </div>
  );
}
