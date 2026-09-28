// UI·27 — una sola espera para todo lo que tarda: la de crear (UI·11), sacada
// aquí para que imagen, clip, shorts y el corte de Subir se vean igual.
//
// La regla es la de la carta (§8): un paso marcado es VERDAD. Cada pantalla
// pasa sus pasos y en cuál va según lo que sabe de verdad (el servidor, o el
// navegador cuando la espera es suya). Donde el servidor no cuenta fases, hay
// pocos pasos y lo demás es tiempo: «Llevas 0:45 · suele tardar 1–2 min». La
// barra se reparte por pasos; dentro del paso activo solo avanza con un tiempo
// estimado, nunca llega al final por su cuenta (se queda en el 90 % del
// paso) y nunca retrocede.
//
// «Puedes cerrar esta pestaña» solo donde el trabajo sigue en la nube: una
// imagen se espera en el navegador y ahí sería mentira.
import { useEffect, useState, type ReactNode } from 'react';

import { Icono } from '../ui/Icono';
import { unir } from '../ui/unir';
import { EsperaIA } from './EsperaIA';

export interface PasoEspera {
  /** Lo que falta por hacer («Generar el video»). */
  falta: string;
  /** Mientras es el paso en curso («Generando el video»); sin él, `falta`. */
  activo?: string;
  /** Ya hecho («Video generado»); sin él, `falta`. */
  hecho?: string;
}

export interface PropsEsperaPasos {
  pasos: PasoEspera[];
  /** El paso en curso (0…n-1). Lo anterior se pinta hecho. */
  paso: number;
  /** Lo que se le pega al texto del paso en curso (« · 2 de 6»). */
  detalle?: string | undefined;
  /** 0–100. Sin él se calcula con `avanceEspera`. */
  pct?: number;
  /** Sin orbe: la línea de estado («Renderizando en la nube»). */
  estado?: string | undefined;
  /** Arriba de la barra: «Faltan unos 3 min», «Llevas 0:45 · suele tardar…». */
  tiempo?: string | null;
  /** El orbe: su texto y cuánto silencio aguanta antes de avisar. Solo
   *  cuando la IA trabaja (M19): un render o una descarga no llevan orbe y
   *  dicen lo que pasa con `estado`. */
  orbe?: { texto: string; tope: number; latido?: number | string | undefined; reposo?: boolean | undefined; textoAlAgotar: string };
  /** «Puedes cerrar esta pestaña…»: solo si el trabajo sigue en la nube. */
  cerrar?: ReactNode;
  /** Dentro de otra tarjeta (un clip de la lista): sin su propio borde ni fondo. */
  plano?: boolean;
  className?: string;
}

/** 0–100: los pasos hechos más, dentro del activo, la parte del tiempo
 *  estimado que ya pasó (como mucho el 90 % del paso). Sin estimado, solo lo
 *  que dicen los pasos. */
export function avanceEspera(paso: number, total: number, llevasMs: number | null, estimadoMs: number | null): number {
  if (total <= 0) return 0;
  const i = Math.min(Math.max(paso, 0), total - 1);
  const dentro = llevasMs != null && estimadoMs ? Math.min(0.9, Math.max(0, llevasMs / estimadoMs)) : 0;
  return ((i + dentro) / total) * 100;
}

/** «1:05», «12:30»: lo que lleva, con segundos siempre de dos cifras. */
export function reloj(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/** «Llevas 0:45 · suele tardar 1–2 min». Sin reloj, solo lo que suele tardar. */
export function textoLlevas(llevasMs: number | null, suele?: string): string | null {
  const partes = [llevasMs != null ? 'Llevas ' + reloj(llevasMs) : null, suele ? 'suele tardar ' + suele : null].filter(
    Boolean,
  );
  if (!partes.length) return null;
  const t = partes.join(' · ');
  return t.charAt(0).toUpperCase() + t.slice(1) + '.';
}

/** Cuánto lleva desde `inicio` (ISO del servidor o epoch ms del navegador),
 *  al segundo. null si no hay inicio o no se entiende. */
export function useLlevas(inicio: string | number | null | undefined): number | null {
  const desde = typeof inicio === 'number' ? inicio : inicio ? Date.parse(inicio) : NaN;
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (Number.isNaN(desde)) return;
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [desde]);
  if (Number.isNaN(desde)) return null;
  // un reloj del servidor adelantado no puede dar «Llevas -0:03»
  return Math.max(0, ahora - desde);
}

export function EsperaPasos({
  pasos,
  paso,
  detalle,
  pct,
  tiempo,
  orbe,
  estado,
  cerrar,
  plano = false,
  className,
}: PropsEsperaPasos) {
  // la barra nunca retrocede (un sondeo viejo, un paso que se recalcula): el
  // máximo va en estado y se compara en el render, el patrón de React para
  // «cambió una prop» (como Campo)
  const crudo = Math.min(100, Math.max(0, pct ?? avanceEspera(paso, pasos.length, null, null)));
  const [valor, setValor] = useState(crudo);
  if (crudo > valor) setValor(crudo);
  const mostrado = Math.max(valor, crudo);
  return (
    <section
      className={unir('max-w-[720px]', !plano && 'rounded-grande border border-linea bg-superficie p-5', className)}
    >
      {tiempo && <p className="m-0 mb-3 tabular-nums text-secundario">{tiempo}</p>}
      <div
        role="progressbar"
        aria-label="Avance"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(mostrado)}
        className="h-1.5 overflow-hidden rounded-[3px] bg-linea"
      >
        <i
          className="block h-full bg-gradient-to-r from-ambar to-ambar-claro transition-[width] duration-400 motion-reduce:transition-none"
          style={{ width: mostrado + '%' }}
        />
      </div>
      <div className="mt-3">
        {orbe ? (
          <EsperaIA
            texto={orbe.texto}
            tope={orbe.tope}
            {...(orbe.latido !== undefined ? { latido: orbe.latido } : {})}
            reposo={orbe.reposo ?? false}
            textoAlAgotar={orbe.textoAlAgotar}
          />
        ) : (
          estado && (
            <p role="status" className="m-0 text-sm text-secundario">
              {estado}
            </p>
          )
        )}
      </div>
      <ol aria-label="Pasos" className="m-0 mt-4 grid list-none gap-3 p-0">
        {pasos.map((x, k) => {
          const hecho = k < paso;
          const activo = k === paso;
          return (
            <li
              key={x.falta}
              aria-current={activo ? 'step' : undefined}
              className={unir(
                'grid grid-cols-[24px_1fr] items-start gap-2.5',
                hecho || activo ? 'text-texto' : 'text-secundario',
                activo && 'font-semibold',
              )}
            >
              <span className="grid size-6 place-items-center" aria-hidden="true">
                {hecho ? (
                  <Icono nombre="listo" className="text-exito" />
                ) : activo ? (
                  <span className="size-3 rounded-full bg-ambar-claro motion-safe:animate-pulse" />
                ) : (
                  <span className="size-2.5 rounded-full border-2 border-campo" />
                )}
              </span>
              <span>
                {hecho ? (x.hecho ?? x.falta) : activo ? (x.activo ?? x.falta) + (detalle ?? '') : x.falta}
              </span>
            </li>
          );
        })}
      </ol>
      {cerrar && <p className="m-0 mt-3 text-xs text-secundario">{cerrar}</p>}
    </section>
  );
}
