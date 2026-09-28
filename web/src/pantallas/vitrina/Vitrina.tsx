// /estudio/_vitrina/: cada componente de web/ en cada uno de sus estados, con
// el contraste calculado en vivo. Es donde el dueño aprueba la base desde el
// teléfono antes de que exista la primera pantalla (tarjeta UI·6). No cobra
// nada: los botones que «cobran» aquí solo esperan un segundo y medio.
import { useState, type FormEvent, type ReactNode } from 'react';

import { EsperaIA } from '../../marca/EsperaIA';
import { BotonCobro } from '../../marca/BotonCobro';
import { NotaSaldo } from '../../marca/NotaSaldo';
import { contraste, nivelAA } from '../../nucleo/contraste';
import { creditos, duracion } from '../../nucleo/formato';
import { clip, video } from '../../nucleo/tarifas';
import { Aviso } from '../../ui/Aviso';
import { Boton } from '../../ui/Boton';
import { Campo } from '../../ui/Campo';
import { Confirmar } from '../../ui/Confirmar';
import { Dialogo } from '../../ui/Dialogo';
import { Esqueleto } from '../../ui/Esqueleto';
import { Guardado } from '../../ui/Guardado';
import { Icono } from '../../ui/Icono';
import { TRAZOS, type NombreIcono } from '../../ui/iconos';
import { Pestanas } from '../../ui/Pestanas';
import { TablaDatos } from '../../ui/TablaDatos';
import { Tarjeta } from '../../ui/Tarjeta';
import { Vacio } from '../../ui/Vacio';

// Las parejas texto/fondo que la carta usa de verdad (docs/DISENO.md §3).
const PAREJAS: Array<{ papel: string; texto: string; fondo: string; borde?: boolean }> = [
  { papel: 'Texto sobre fondo', texto: '#ece8e1', fondo: '#0b1626' },
  { papel: 'Texto sobre superficie', texto: '#ece8e1', fondo: '#111f33' },
  { papel: 'Secundario sobre superficie', texto: '#93a3b8', fondo: '#111f33' },
  { papel: 'Apagado sobre superficie (solo decoración)', texto: '#6b7a8f', fondo: '#111f33' },
  { papel: 'Tinta sobre ámbar (botón principal)', texto: '#14100a', fondo: '#da8c28' },
  { papel: 'Tinta sobre ámbar hondo (por eso no se usa)', texto: '#14100a', fondo: '#a96716' },
  { papel: 'Enlace sobre superficie', texto: '#a9c6ee', fondo: '#111f33' },
  { papel: 'Enlace sobre elevada', texto: '#a9c6ee', fondo: '#18293f' },
  { papel: 'Azul sobre elevada (por eso no es enlace)', texto: '#5b8dd6', fondo: '#18293f' },
  { papel: 'Error sobre superficie', texto: '#ff8080', fondo: '#111f33' },
  { papel: 'Éxito sobre superficie', texto: '#3dd68c', fondo: '#111f33' },
  // un borde se mide contra lo que lo rodea: la carta da 3.2–3.5:1 contra el
  // fondo y la superficie; contra el relleno del campo (#18293f) no llega
  { papel: 'Borde de campo sobre superficie (pide 3:1)', texto: '#55708f', fondo: '#111f33', borde: true },
  { papel: 'Borde de campo sobre fondo (pide 3:1)', texto: '#55708f', fondo: '#0b1626', borde: true },
  { papel: 'Borde de campo contra su relleno #18293f', texto: '#55708f', fondo: '#18293f', borde: true },
];

const TAMANOS: Array<{ clase: string; nombre: string }> = [
  { clase: 'text-titulo-lg font-titulo font-extrabold tracking-[-0.02em]', nombre: 'titulo-lg · 32' },
  { clase: 'text-titulo-md font-titulo font-bold', nombre: 'titulo-md · 24' },
  { clase: 'text-titulo-sm font-bold', nombre: 'titulo-sm · 20' },
  { clase: 'text-md', nombre: 'texto-md · 17' },
  { clase: 'text-sm', nombre: 'texto-sm · 15' },
  { clase: 'text-xs', nombre: 'texto-xs · 13' },
];

const FILAS = [
  { id: 'ana@ejemplo.com', proyectos: 4, saldo: 320 },
  { id: 'luis@ejemplo.com', proyectos: 1, saldo: 45 },
  { id: '<img src=x onerror=alert(1)>', proyectos: 0, saldo: 0 },
];

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="m-0 text-titulo-md">{titulo}</h2>
      {children}
    </section>
  );
}

function Fila({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-3">{children}</div>;
}

// UI·24: el «no» y el «listo» de un formulario, sin toasts. Vacío o con una
// letra, el campo tiembla (solo cuando el error aparece: el segundo «no»
// seguido cambia el texto y no tiembla); bien escrito, «Guardado» junto al
// botón. Escribir otra vez lo quita.
function GuardarDeMuestra() {
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  function guardar(e: FormEvent) {
    e.preventDefault();
    const n = nombre.trim();
    const malo = !n ? 'Escribe el nombre de tu canal.' : n.length < 3 ? 'Usa al menos 3 letras.' : null;
    setError(malo);
    setGuardado(!malo);
  }

  return (
    <form noValidate onSubmit={guardar} className="grid max-w-[480px] gap-3">
      <Campo etiqueta="Nombre del canal" value={nombre} error={error} ayuda="Lo ven quienes te siguen."
        onChange={e => {
          setNombre(e.target.value);
          setGuardado(false);
        }} />
      <div className="flex min-h-12 flex-wrap items-center gap-3">
        <Boton type="submit">Guardar</Boton>
        {/* la región está siempre: lo que cambia dentro se anuncia seguro */}
        <span role="status" className="text-sm">{guardado && <Guardado anuncia={false} />}</span>
      </div>
    </form>
  );
}

export function Vitrina() {
  const [dialogo, setDialogo] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [confirmado, setConfirmado] = useState(0);
  const [latido, setLatido] = useState(0);
  const [cobros, setCobros] = useState(0);
  const [dibujos, setDibujos] = useState(0);
  const costoPelicula = video.por_duracion['30'];

  return (
    <main className="mx-auto flex max-w-[960px] flex-col gap-12 px-4 py-8 sm:px-8">
      <header className="flex flex-col gap-2">
        <h1 className="m-0 text-titulo-lg font-extrabold tracking-[-0.02em]">Vitrina</h1>
        <p className="m-0 max-w-[65ch] text-md text-secundario">
          Los componentes de la UI nueva en todos sus estados. Nada de aquí cobra: los botones con
          precio solo esperan un segundo y medio. Las reglas salen de docs/DISENO.md.
        </p>
      </header>

      <Seccion titulo="Color y contraste">
        <p className="m-0 max-w-[65ch] text-secundario">
          Calculado en vivo con la fórmula de WCAG. AA pide 4.5:1 para texto normal y 3:1 para texto
          grande y bordes de controles.
        </p>
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          {PAREJAS.map(p => {
            const r = contraste(p.texto, p.fondo);
            const nivel = p.borde ? (r >= 3 ? 'AA (3:1)' : 'no pasa') : nivelAA(r);
            return (
              <li key={p.papel} className="flex items-center gap-3 rounded-grande border border-linea p-3">
                {p.borde ? (
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-medio" style={{ background: p.fondo }} aria-hidden="true">
                    <span className="h-7 w-10 rounded-chico border-2" style={{ borderColor: p.texto }} />
                  </span>
                ) : (
                  <span
                    className="flex size-14 shrink-0 items-center justify-center rounded-medio text-titulo-sm font-bold"
                    style={{ background: p.fondo, color: p.texto }}
                    aria-hidden="true"
                  >
                    Aa
                  </span>
                )}
                <span className="flex flex-col">
                  <span>{p.papel}</span>
                  <span className="text-xs text-secundario tabular-nums">
                    {p.texto} sobre {p.fondo} · {r.toFixed(2)}:1 ·{' '}
                    <span className={nivel === 'no pasa' ? 'text-error' : 'text-exito'}>{nivel}</span>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </Seccion>

      <Seccion titulo="Letra">
        <p className="m-0 text-secundario">Bricolage Grotesque en los títulos, Geist en todo lo demás. Seis tamaños y ninguno más.</p>
        <div className="flex flex-col gap-2">
          {TAMANOS.map(t => (
            <p key={t.nombre} className={'m-0 ' + t.clase}>
              Irremplazables · {t.nombre}
            </p>
          ))}
          <p className="m-0 text-sm tabular-nums">Cifras tabulares: 1,111 · 8,888 · {duracion(80)}</p>
        </div>
      </Seccion>

      <Seccion titulo="Botones">
        <p className="m-0 text-secundario">Uno solo ámbar por pantalla. Pasa el dedo o el ratón para ver «encima» y «al apretar».</p>
        <Fila>
          <Boton nivel="principal">Publicar</Boton>
          <Boton nivel="principal" disabled>Publicar</Boton>
          <Boton nivel="principal" trabajando="Publicando…">Publicar</Boton>
        </Fila>
        <Fila>
          <Boton>Ver ejemplo</Boton>
          <Boton disabled>Ver ejemplo</Boton>
          <Boton trabajando="Cargando…">Ver ejemplo</Boton>
          <Boton denso icono={<Icono nombre="descargar" />}>Descargar (denso)</Boton>
        </Fila>
        <Fila>
          <Boton nivel="peligro">Borrar</Boton>
          <Boton nivel="enlace">Ver todos tus videos</Boton>
        </Fila>
      </Seccion>

      <Seccion titulo="Botones que cobran">
        <p className="m-0 max-w-[65ch] text-secundario">
          «Verbo ✦ N» con precios reales de tools/tarifas.json. Un doble clic es un solo cobro:
          prueba a darle dos veces rápido. Cobros de mentira hasta ahora: {cobros}.
        </p>
        <Fila>
          <span className="flex flex-col gap-2">
            <BotonCobro verbo="Generar" costo={costoPelicula} saldo={320} trabajando="Generando…"
              alCobrar={async () => { setCobros(n => n + 1); await esperar(1500); }} />
            <NotaSaldo saldo={320} costo={costoPelicula} />
          </span>
          <BotonCobro verbo="Generar" costo={clip.video_8s} saldo={12} alCobrar={async () => {}} />
        </Fila>
      </Seccion>

      <Seccion titulo="Esperando a la IA">
        <p className="m-0 max-w-[65ch] text-secundario">
          El orbe de siempre (static/orbe.js). «Hubo avance» reinicia su paciencia, como cuando el
          sondeo trae noticias.
        </p>
        <Fila>
          <EsperaIA texto={'Animando las escenas · ' + (latido % 6 + 1) + ' de 6'} latido={latido} tope={60000} />
          <Boton denso onClick={() => setLatido(n => n + 1)}>Hubo avance</Boton>
        </Fila>
      </Seccion>

      <Seccion titulo="Avisos">
        <Aviso>Recortamos tu foto para que quepa en 9:16.</Aviso>
        <Aviso tipo="exito">Guardado.</Aviso>
        <Aviso tipo="error">
          <strong>No pudimos terminar el video.</strong> Te devolvimos {creditos(90)}.
        </Aviso>
      </Seccion>

      <Seccion titulo="Campos">
        <div className="grid max-w-[480px] gap-4">
          <Campo etiqueta="Título del video" placeholder="Mi primer video" ayuda="Lo ves solo tú." />
          <Campo etiqueta="Tu correo" defaultValue="ana(arroba)ejemplo.com"
            error="Falta la arroba (@). Escribe algo como ana@ejemplo.com." />
        </div>
      </Seccion>

      <Seccion titulo="Guardar, sin toasts">
        <p className="m-0 max-w-[65ch] text-secundario">
          El «no» es el campo que tiembla cuando aparece el error; el «listo», una palomita que se
          dibuja donde se guardó. Con «reducir movimiento» no tiembla ni se dibuja: el mensaje sale igual.
        </p>
        <GuardarDeMuestra />
        {/* el Aviso de la Agenda al guardar la hora; al abrir, quieto */}
        <Fila>
          <Aviso key={dibujos} tipo="exito" dibujar={dibujos > 0}>
            Hora cambiada: Instagram sale el viernes a las 10:30 (tu hora).
          </Aviso>
          <Boton denso onClick={() => setDibujos(n => n + 1)}>Dibujar la palomita</Boton>
        </Fila>
      </Seccion>

      <Seccion titulo="Pestañas">
        <Pestanas
          etiqueta="Ejemplo de pestañas"
          pestanas={[
            { id: 'uno', titulo: 'Resumen', contenido: <p className="m-0">Usa las flechas del teclado para cambiar.</p> },
            { id: 'dos', titulo: 'Detalle', contenido: <p className="m-0">La segunda pestaña.</p> },
            { id: 'tres', titulo: 'Historial', contenido: <p className="m-0">Y la tercera.</p> },
          ]}
        />
      </Seccion>

      <Seccion titulo="Diálogos">
        <Fila>
          <Boton onClick={() => setDialogo(true)}>Abrir diálogo</Boton>
          <Boton nivel="peligro" onClick={() => setConfirmar(true)}>Borrar el proyecto…</Boton>
          {confirmado > 0 && <span className="self-center text-secundario">Confirmado {confirmado} vez(ces).</span>}
        </Fila>
        <Dialogo
          abierto={dialogo}
          alCambiar={setDialogo}
          titulo="Revisa tu texto"
          descripcion="Así se ve el motivo del moderador: siempre como texto."
          acciones={<Boton nivel="principal" onClick={() => setDialogo(false)}>Entendido, lo edito</Boton>}
        >
          <p className="m-0 rounded-medio bg-hundido p-3 text-sm text-secundario">
            {'<img src=x onerror=alert(1)> — esto no se ejecuta'}
          </p>
        </Dialogo>
        <Confirmar
          abierto={confirmar}
          alCambiar={setConfirmar}
          titulo="¿Borrar el proyecto?"
          descripcion="Se borran el video y sus versiones. No se puede deshacer."
          confirmar="Borrar"
          peligro
          alConfirmar={() => setConfirmado(n => n + 1)}
        />
      </Seccion>

      <Seccion titulo="Tabla de datos">
        <TablaDatos
          titulo="Usuarios de ejemplo"
          filas={FILAS}
          claveFila={f => f.id}
          columnas={[
            { clave: 'id', titulo: 'Correo', celda: f => f.id },
            { clave: 'p', titulo: 'Proyectos', celda: f => f.proyectos, numerica: true },
            { clave: 's', titulo: 'Saldo', celda: f => creditos(f.saldo), numerica: true },
          ]}
        />
        <TablaDatos
          titulo="Tabla vacía"
          filas={[]}
          claveFila={() => ''}
          columnas={[]}
          vacio={<Vacio icono="agenda" titulo="Aún no hay publicaciones" texto="Cuando agendes una, aparece aquí con su fecha y su red."
            accion={<Boton>Agendar una publicación</Boton>} />}
        />
      </Seccion>

      <Seccion titulo="Cargando">
        <Tarjeta titulo="Tarjeta con esqueleto">
          <div className="flex flex-col gap-2">
            <Esqueleto className="h-5 w-3/4" />
            <Esqueleto className="h-5 w-1/2" />
          </div>
        </Tarjeta>
      </Seccion>

      <Seccion titulo="Iconos">
        <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4">
          {(Object.keys(TRAZOS) as NombreIcono[]).map(n => (
            <li key={n} className="flex items-center gap-2 rounded-medio border border-linea px-3 py-2 text-secundario">
              <Icono nombre={n} />
              <span className="text-xs">{n}</span>
            </li>
          ))}
        </ul>
      </Seccion>

      <footer className="border-t border-linea pt-4 text-xs text-secundario">
        Los créditos se escriben con la estrella y enteros: {creditos(1200)}.
      </footer>
    </main>
  );
}
