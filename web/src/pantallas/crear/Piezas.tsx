// Piezas chicas de /estudio/crear/: la tarjeta con título, el chip de elegir
// y la muestra del estilo (las mismas formas que /estudio/imagenes/).
import { useState, type ReactNode } from 'react';

import { Icono } from '../../ui/Icono';
import type { NombreIcono } from '../../ui/iconos';
import { unir } from '../../ui/unir';

export function Tarjeta({
  titulo,
  icono,
  className,
  children,
}: {
  titulo: ReactNode;
  icono?: NombreIcono;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={unir('flex min-w-0 flex-col rounded-grande border border-linea bg-superficie p-4', className)}>
      <h2 className="m-0 mb-3 flex items-center gap-2 font-titulo text-titulo-sm font-bold">
        {icono && <Icono nombre={icono} className="text-secundario" />}
        {titulo}
      </h2>
      {children}
    </section>
  );
}

// elegir no es «hacer»: lo elegido se marca en blanco, no en ámbar
export function Chip({
  puesto,
  rol = 'boton',
  disabled,
  onClick,
  children,
}: {
  puesto: boolean;
  /** radio: una opción de un radiogroup (aria-checked); boton: un interruptor (aria-pressed). */
  rol?: 'boton' | 'radio';
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      {...(rol === 'radio' ? { role: 'radio', 'aria-checked': puesto } : { 'aria-pressed': puesto })}
      disabled={disabled}
      onClick={onClick}
      className={unir(
        'inline-flex min-h-11 cursor-pointer items-center gap-2 whitespace-nowrap rounded-medio border px-3.5 text-left text-sm disabled:cursor-default',
        puesto ? 'border-texto bg-elevada text-texto' : 'border-campo bg-transparent text-secundario hover:border-secundario hover:text-texto',
      )}
    >
      {children}
    </button>
  );
}

export function Muestra({ estilo, descripcion, children }: { estilo: string; descripcion: string; children?: ReactNode }) {
  // la foto tapa la descripción solo cuando llegó; si no existe, queda el texto
  const [lista, setLista] = useState<string | null>(null);
  const [rota, setRota] = useState<string | null>(null);
  const conFoto = estilo !== 'custom' && rota !== estilo;
  return (
    <div className="relative grid min-h-[200px] flex-1 place-items-center overflow-hidden rounded-medio border border-linea p-3">
      <p className="m-0 text-center text-xs text-secundario">{descripcion}</p>
      {conFoto && (
        <img
          key={estilo}
          src={'/estilos/' + encodeURIComponent(estilo) + '.jpg'}
          alt="Ejemplo del estilo elegido"
          onLoad={() => setLista(estilo)}
          onError={() => setRota(estilo)}
          className={unir('absolute inset-0 size-full object-cover', lista !== estilo && 'invisible')}
        />
      )}
      {children}
    </div>
  );
}
