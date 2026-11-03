// Lo que enseña una página de nivel cuando su dirección no es de ningún nivel (o es la de una herramienta de la Caja, que tiene su
// propia entrada): una carpeta puesta donde no va, o una dirección que el servidor sirvió escrita de otra manera que la página no
// reconoce. Antes no se montaba nada y la persona se quedaba con una pantalla en blanco. El texto es el de la 404 del servidor
// (server/web.py, `_PAGINA_404`), para que una dirección rota diga lo mismo la sirva quien la sirva.
import { RUTA_MAPA } from '../../../marca/rutas';

/** El título de la pestaña cuando no hay nada que enseñar (el `<title>` del HTML es el de un nivel que aquí no existe). */
export const TITULO_NO_ENCONTRADA = 'No encontramos esa página';

export function NoEncontrada() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[1100px] flex-col px-4 pt-16 pb-0 max-[380px]:px-3">
      <section className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center py-6">
        <h1 className="m-0 mb-4 font-titulo text-titulo-md font-extrabold">{TITULO_NO_ENCONTRADA}</h1>
        <p className="m-0 mb-4 text-sm text-secundario">La dirección no existe o cambió de lugar.</p>
        <p className="m-0 text-sm">
          <a href={RUTA_MAPA}>Ir al inicio</a>
        </p>
      </section>
    </main>
  );
}
