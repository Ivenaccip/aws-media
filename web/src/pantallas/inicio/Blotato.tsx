// Conectar Blotato (M23 · C). La clave solo viaja en el POST y el campo se
// vacía en cuanto sale, al cerrar y al cancelar; ninguna respuesta la trae.
//
// Conectar tiene un costo que NO es nuestro: la API de Blotato no viene en su
// prueba gratis y generar la clave la termina. El aviso va ANTES del campo,
// con el precio que manda el server.
import { useId, useState } from 'react';

import { Boton } from '../../ui/Boton';
import { Confirmar } from '../../ui/Confirmar';
import { Dialogo } from '../../ui/Dialogo';
import { Icono } from '../../ui/Icono';
import { conectarBlotato, quitarBlotato, RED, type EstadoBlotato } from './logica';

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface PropsBlotato {
  abierto: boolean;
  alCambiar: (abierto: boolean) => void;
  /** Lo último que se sabe; null = revisando. */
  estado: EstadoBlotato | null;
  /** Si leer el estado falló al abrir. */
  errorCarga?: string;
  /** Cada respuesta del server (el menú se enciende o apaga con ella). */
  alSaber: (e: EstadoBlotato) => void;
}

export function DialogoBlotato({ abierto, alCambiar, estado, errorCarga = '', alSaber }: PropsBlotato) {
  const [formulario, setFormulario] = useState(false);
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const idClave = useId();

  const cargando = abierto && estado === null && !errorCarga;
  const verForm = estado !== null && (formulario || !estado.conectado);
  const titulo = verForm && estado?.conectado ? 'Cambia tu clave de Blotato' : estado?.conectado ? 'Tu Blotato' : 'Conecta tu Blotato';
  const env = estado?.origen === 'env';

  function cerrar(a: boolean) {
    if (!a) {
      setClave('');
      setFormulario(false);
      setError('');
    }
    alCambiar(a);
  }

  async function conectar(e: React.FormEvent) {
    e.preventDefault();
    if (trabajando) return;
    const limpia = clave.trim();
    if (!limpia) {
      setError('Pega tu clave de Blotato primero.');
      return;
    }
    setTrabajando(true);
    setError('');
    try {
      const d = await conectarBlotato(limpia);
      setClave('');
      setFormulario(false);
      alSaber(d);
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setTrabajando(false);
    }
  }

  async function quitar() {
    setTrabajando(true);
    setError('');
    try {
      alSaber(await quitarBlotato());
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <>
      <Dialogo
        abierto={abierto}
        alCambiar={cerrar}
        titulo={titulo}
        descripcion="Con tu cuenta de Blotato conectada podrás programar tus videos y ver cómo rinden en tus redes."
      >
        {cargando && <p className="mt-4 mb-0 text-sm text-secundario">Revisando tu conexión…</p>}

        {estado && !verForm && (
          <div className="mt-4">
            <p className="m-0 mb-2 flex items-center gap-2 font-semibold text-exito">
              <Icono nombre="listo" />
              Tu Blotato está conectado
            </p>
            {env && (
              <p className="m-0 mb-2 text-sm text-secundario">
                Estás usando la clave del <code>.env</code> de esta máquina.
              </p>
            )}
            {estado.cuentas.length > 0 && (
              <ul aria-label="Redes conectadas en tu Blotato" className="m-0 mb-1 grid list-none gap-1.5 p-0">
                {estado.cuentas.map(c => (
                  <li
                    key={c.id || c.platform + c.username}
                    className="flex items-baseline gap-2.5 rounded-medio border border-linea bg-fondo px-3 py-2 text-sm"
                  >
                    <span className="min-w-21 font-semibold">{RED[c.platform] ?? c.platform}</span>
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap text-secundario">
                      {c.fullname || c.username}
                      {c.username && c.fullname ? ` · @${c.username}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {!estado.cuentas.length && !estado.error && (
              <p className="m-0 text-sm text-secundario">
                Tu Blotato todavía no tiene redes conectadas. Agrégalas en Blotato y vuelve a abrir esta ventana.
              </p>
            )}
            {estado.error && (
              <p role="alert" className="m-0 text-xs text-error">
                {estado.error}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Boton nivel="secundario" onClick={() => setFormulario(true)}>
                Cambiar clave
              </Boton>
              {/* la del .env no se quita desde aquí */}
              {!env && (
                <Boton nivel="peligro" className="ml-auto" disabled={trabajando} onClick={() => setConfirmando(true)}>
                  Desconectar
                </Boton>
              )}
            </div>
          </div>
        )}

        {verForm && (
          <form noValidate onSubmit={e => void conectar(e)} className="mt-4">
            <ol className="m-0 mb-3 pl-5 text-sm">
              <li>
                Entra a{' '}
                <a href="https://my.blotato.com/settings" target="_blank" rel="noopener noreferrer">
                  Blotato → Settings → API
                </a>
                .
              </li>
              <li className="mt-1">
                Pulsa <b>Generate API Key</b> y copia la clave completa.
              </li>
              <li className="mt-1">Pégala aquí abajo.</li>
            </ol>
            <p role="note" className="m-0 mb-3.5 rounded-medio border border-ambar-hondo bg-aviso-fondo px-3 py-2.5 text-xs">
              <b className="text-ambar-claro">Antes de generarla:</b> la API no viene en la prueba gratis de Blotato. Al
              generar la clave, Blotato termina tu prueba y{' '}
              {estado?.plan
                ? `empieza a cobrarte su plan (desde $${estado.plan.usd_por_mes} dólares al mes con ${estado.plan.nombre})`
                : 'empieza a cobrarte su plan de pago'}
              . Ese cobro es de Blotato, no nuestro.
            </p>
            <label htmlFor={idClave} className="mb-1 block text-xs text-secundario">
              Tu clave de API de Blotato
            </label>
            <input
              id={idClave}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- el diálogo existe para pegar esto
              autoFocus
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              maxLength={512}
              placeholder="Pega aquí tu clave"
              value={clave}
              onChange={e => setClave(e.target.value)}
              className="min-h-11 w-full rounded-medio border border-campo bg-fondo px-3 font-mono text-sm text-texto"
            />
            <div className="mt-3.5 flex flex-wrap gap-2">
              <Boton type="submit" nivel="principal" trabajando={trabajando && 'Revisando la clave…'}>
                Conectar
              </Boton>
              {estado?.conectado && (
                <Boton
                  nivel="secundario"
                  onClick={() => {
                    setClave('');
                    setFormulario(false);
                    setError('');
                  }}
                >
                  Cancelar
                </Boton>
              )}
            </div>
          </form>
        )}

        {(error || (estado === null && errorCarga)) && (
          <p role="alert" className="mt-3 mb-0 text-xs text-error">
            {error || errorCarga}
          </p>
        )}
      </Dialogo>

      <Confirmar
        abierto={confirmando}
        alCambiar={setConfirmando}
        titulo="¿Desconectar tu cuenta de Blotato?"
        descripcion="Dejaremos de guardar tu clave. Tu cuenta y tus publicaciones en Blotato no cambian."
        confirmar="Desconectar"
        peligro
        alConfirmar={() => void quitar()}
      />
    </>
  );
}
