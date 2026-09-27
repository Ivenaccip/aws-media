// La imagen de trabajo y, encima, la capa donde se pinta la zona a cambiar.
// Dos <canvas> del mismo tamaño: el de abajo lleva la imagen (reducida a
// MAX_LADO) y el de arriba el trazo en ámbar.
//
// Para el modelo salen dos archivos: la original y una copia con la zona
// resaltada. Se leen por la ref (React 19: la ref es una prop).
import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';

import { unir } from '../../ui/unir';
import type { Decodificada } from './decodificar';
import { escala } from './logica';

export interface MandoLienzo {
  imagenBlob(): Promise<Blob>;
  marcadaBlob(): Promise<Blob>;
  borrarZona(): void;
  miniatura(): string;
}

export interface PropsLienzo {
  imagen: Decodificada;
  pincel: boolean;
  grosor: number;
  bloqueado: boolean;
  alTrazo: (hay: boolean) => void;
  ref?: Ref<MandoLienzo>;
}

const COLOR = '#da8c28'; // el ámbar de la marca: lo que se pinta se ve

function aBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((ok, mal) => c.toBlob(b => (b ? ok(b) : mal(new Error('No pude leer tu imagen.'))), 'image/jpeg', 0.92));
}

export function Lienzo({ imagen, pincel, grosor, bloqueado, alTrazo, ref }: PropsLienzo) {
  const img = useRef<HTMLCanvasElement>(null);
  const mask = useRef<HTMLCanvasElement>(null);
  const pintando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const tam = escala(imagen.ancho, imagen.alto);

  // cada imagen nueva: se pinta y la zona empieza en blanco
  useLayoutEffect(() => {
    const c = img.current;
    const m = mask.current;
    if (!c || !m) return;
    c.width = m.width = tam.ancho;
    c.height = m.height = tam.alto;
    c.getContext('2d')?.drawImage(imagen.fuente, 0, 0, tam.ancho, tam.alto);
    m.getContext('2d')?.clearRect(0, 0, m.width, m.height);
    alTrazo(false);
    // alTrazo es un setter estable del padre
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagen, tam.ancho, tam.alto]);

  useImperativeHandle(
    ref,
    () => ({
      imagenBlob: () => aBlob(img.current!),
      marcadaBlob: () => {
        const c = document.createElement('canvas');
        c.width = mask.current!.width;
        c.height = mask.current!.height;
        const x = c.getContext('2d');
        if (x) {
          x.drawImage(img.current!, 0, 0);
          x.globalAlpha = 0.55;
          x.drawImage(mask.current!, 0, 0);
        }
        return aBlob(c);
      },
      borrarZona: () => {
        const m = mask.current;
        m?.getContext('2d')?.clearRect(0, 0, m.width, m.height);
        alTrazo(false);
      },
      miniatura: () => img.current?.toDataURL('image/jpeg', 0.6) ?? '',
    }),
    [alTrazo],
  );

  function punto(e: React.PointerEvent<HTMLCanvasElement>) {
    const m = mask.current!;
    const r = m.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * m.width) / (r.width || 1),
      y: ((e.clientY - r.top) * m.height) / (r.height || 1),
    };
  }

  function traza(p: { x: number; y: number }) {
    const x = mask.current?.getContext('2d');
    if (x) {
      x.strokeStyle = x.fillStyle = COLOR;
      x.lineWidth = grosor;
      x.lineCap = x.lineJoin = 'round';
      x.beginPath();
      if (ultimo.current) {
        x.moveTo(ultimo.current.x, ultimo.current.y);
        x.lineTo(p.x, p.y);
        x.stroke();
      }
      x.arc(p.x, p.y, grosor / 2, 0, Math.PI * 2);
      x.fill();
    }
    ultimo.current = p;
    alTrazo(true);
  }

  const soltar = () => {
    pintando.current = false;
    ultimo.current = null;
  };

  return (
    <div
      role="img"
      aria-label="Tu imagen"
      className={unir('relative mx-auto max-h-full max-w-full', bloqueado && 'opacity-70')}
      style={{ aspectRatio: `${tam.ancho} / ${tam.alto}` }}
    >
      <canvas ref={img} aria-hidden="true" className="block size-full rounded-medio" />
      <canvas
        ref={mask}
        data-testid="zona"
        aria-hidden="true"
        className={unir(
          'absolute inset-0 size-full touch-none opacity-55',
          pincel ? 'cursor-crosshair' : 'hidden',
          bloqueado && 'pointer-events-none',
        )}
        onPointerDown={e => {
          if (bloqueado || !pincel) return;
          pintando.current = true;
          ultimo.current = null;
          traza(punto(e));
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={e => {
          if (pintando.current) traza(punto(e));
        }}
        onPointerUp={soltar}
        onPointerCancel={soltar}
      />
    </div>
  );
}
