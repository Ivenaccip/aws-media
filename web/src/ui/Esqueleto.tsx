// El hueco de algo que está cargando. La carta deja los esqueletos de las
// esperas cortas «para después» (§8): existe para cuando se decidan, y la
// vitrina lo enseña. Quieto con «reducir movimiento».
import { unir } from './unir';

export function Esqueleto({ className, etiqueta = 'Cargando…' }: { className?: string; etiqueta?: string }) {
  return (
    <div
      role="status"
      aria-label={etiqueta}
      className={unir('animate-pulse rounded-medio bg-elevada motion-reduce:animate-none', className ?? 'h-5 w-40')}
    />
  );
}
