// Subir un video: nombre del proyecto, archivo, progreso real, Cancelar y
// aviso al cerrar a medias (M5). La comparten editar metraje y shorts.
//
// No cobra: el video sube directo a S3 con una URL firmada. Lo que cobra
// viene después, en la pantalla que la usa.
import { useEffect, useRef, useState } from 'react';

import { ErrorApi } from '../nucleo/api';
import {
  confirmar,
  firmar,
  mb,
  nombreAlterno,
  nombreDesde,
  nombreValido,
  subirConProgreso,
  type Avance,
  type Subida,
} from '../nucleo/subida';
import { Boton } from '../ui/Boton';
import { Campo } from '../ui/Campo';
import { Icono } from '../ui/Icono';
import { unir } from '../ui/unir';

export interface PropsSubirVideo {
  titulo: string;
  descripcion: string;
  nombreInicial?: string;
  /** Si Subir es el principal (ámbar) de la pantalla ahora mismo. */
  principal: boolean;
  /** Con el campo vacío, propone un nombre a partir del archivo. */
  sugerirNombre?: boolean;
  /** Ya confirmado: el video está en el proyecto. */
  alSubir: (proyecto: string, subida: Subida) => void;
}

interface Nota {
  texto: string;
  error?: boolean;
}

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SubirVideo({ titulo, descripcion, nombreInicial = '', principal, sugerirNombre = false, alSubir }: PropsSubirVideo) {
  const [nombre, setNombre] = useState(nombreInicial);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [avance, setAvance] = useState<Avance | null>(null);
  const [nota, setNota] = useState<Nota | null>(null);
  const candado = useRef(false);
  const cancelar = useRef<(() => void) | null>(null);

  // cerrar la pestaña con la subida a medias la pierde: el navegador avisa
  const subiendo = avance !== null;
  useEffect(() => {
    if (!subiendo) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [subiendo]);

  async function subir() {
    if (candado.current) return;
    const p = nombre.trim();
    if (!p || !archivo) {
      setNota({ texto: 'Falta el nombre del proyecto o el archivo.' });
      return;
    }
    if (!nombreValido(p)) {
      setNota({
        texto: 'El nombre solo puede llevar letras, números, guion y guion bajo (ej. entrevista-marzo).',
        error: true,
      });
      return;
    }
    candado.current = true; // antes de cualquier await: doble clic = una subida
    const f = archivo;
    setAvance({ pct: 0, cargados: 0, total: f.size });
    try {
      setNota({ texto: 'Pidiendo permiso de subida…' });
      let firma;
      try {
        firma = await firmar(p, f);
      } catch (e) {
        if (!(e instanceof ErrorApi && e.estado === 409)) throw e;
        const otro = nombreAlterno(p); // nada se subió todavía
        setNombre(otro);
        throw new Error(`${e.message} Te dejamos «${otro}» en el nombre: pulsa Subir para usarlo.`, { cause: e });
      }
      const s = subirConProgreso(firma, f, a => {
        setAvance(a);
        setNota({ texto: `Subiendo ${f.name} — ${a.pct}% (${mb(a.cargados)} de ${mb(f.size)} MB)` });
      });
      cancelar.current = s.cancelar;
      await s.hecho;
      cancelar.current = null;
      setNota({ texto: 'Confirmando…' });
      const sub = await confirmar(p, firma.key);
      setNota({ texto: `Listo: ${sub.archivo} ya está en tu proyecto ${p}.` });
      alSubir(p, sub);
    } catch (e) {
      setNota({ texto: mensaje(e), error: true });
    } finally {
      cancelar.current = null;
      candado.current = false;
      setAvance(null);
    }
  }

  return (
    <section className="mb-6 rounded-grande border border-linea bg-superficie p-6">
      <h2 className="m-0 mb-1 flex items-center gap-2 text-titulo-sm font-bold">
        <Icono nombre="subir" className="text-secundario" />
        {titulo}
      </h2>
      <p className="m-0 mb-4 text-secundario">{descripcion}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px] flex-1">
          <Campo
            etiqueta="Nombre del proyecto"
            placeholder="ej. entrevista-marzo"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            disabled={subiendo}
          />
        </div>
        <label className="flex max-w-full flex-col gap-1 text-sm font-medium">
          Archivo de video
          <input
            type="file"
            accept=".mp4,.mov,.m4v,video/mp4,video/quicktime"
            disabled={subiendo}
            onChange={e => {
              const f = e.target.files?.[0] ?? null;
              setArchivo(f);
              if (f && sugerirNombre && !nombre.trim()) setNombre(nombreDesde(f.name));
            }}
            className="max-w-full text-xs font-normal text-secundario file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-boton file:border file:border-solid file:border-campo file:bg-transparent file:px-4 file:text-sm file:text-texto"
          />
        </label>
        <Boton nivel={principal ? 'principal' : 'secundario'} onClick={() => void subir()} disabled={subiendo}>
          Subir
        </Boton>
        {subiendo && (
          <Boton nivel="secundario" onClick={() => cancelar.current?.()}>
            Cancelar
          </Boton>
        )}
      </div>
      {avance && (
        <div
          role="progressbar"
          aria-label="Avance de la subida"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={avance.pct}
          className="mt-3 h-2 overflow-hidden rounded-chico bg-elevada"
        >
          <div className="h-full bg-ambar transition-[width] duration-300" style={{ width: `${avance.pct}%` }} />
        </div>
      )}
      <p
        role={nota?.error ? 'alert' : 'status'}
        className={unir('mb-0 text-xs', nota && 'mt-3', nota?.error ? 'text-error' : 'text-secundario')}
      >
        {nota?.texto}
      </p>
    </section>
  );
}
