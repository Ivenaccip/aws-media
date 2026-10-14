import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { CuadroDeTexto } from './CuadroDeTexto';

const clases = (el: Element) => el.className.split(/\s+/);

describe('CuadroDeTexto', () => {
  it('envuelve el texto en un cuadro de campo y el aro de foco es del cuadro, no del texto', () => {
    render(<CuadroDeTexto aria-label="Tu texto" claseCuadro="mb-4" className="min-h-22" />);
    const texto = screen.getByRole('textbox', { name: 'Tu texto' });
    const cuadro = texto.parentElement!;
    // el aspecto de «campo» de la carta (§3 y §4): fondo elevada, borde de campo (no el de línea), radio 10, relleno de 12
    expect(clases(cuadro)).toEqual(expect.arrayContaining(['border', 'border-campo', 'bg-elevada', 'rounded-medio', 'p-3', 'mb-4']));
    expect(clases(cuadro)).not.toContain('border-linea');
    // el aro: lo dibuja el cuadro cuando algo de adentro tiene foco VISIBLE (no `focus-within`: un toque a un botón de adentro
    // con el ratón no enciende el aro de todo el cuadro), con las medidas de tokens.css
    expect(clases(cuadro)).toEqual(
      expect.arrayContaining(['has-focus-visible:outline-2', 'has-focus-visible:outline-offset-3', 'has-focus-visible:outline-ambar-claro']),
    );
    expect(clases(cuadro).some(c => c.startsWith('focus-within:'))).toBe(false);
    // el texto no dibuja otro (dos aros, uno dentro del otro, se verían como un error) ni pone borde ni fondo propios
    expect(clases(texto)).toEqual(expect.arrayContaining(['outline-none', 'border-0', 'bg-transparent', 'p-0', 'w-full', 'min-h-22']));
    // el ejemplo con el gris secundario, no con el 50 % del texto
    expect(clases(texto)).toContain('placeholder:text-secundario');
    // y el texto es de 15 px (nunca menos de 13)
    expect(clases(texto)).toContain('text-sm');
  });

  it('un clic en el relleno del cuadro enfoca el texto; un clic en el texto o en lo de adentro no lo toca', () => {
    render(
      <CuadroDeTexto aria-label="Tu texto">
        <button type="button">Una idea</button>
      </CuadroDeTexto>,
    );
    const texto = screen.getByRole('textbox', { name: 'Tu texto' });
    const idea = screen.getByRole('button', { name: 'Una idea' });
    const cuadro = texto.parentElement!;
    // lo de adentro atiende su clic (el navegador mueve el foco a donde se pulsó): el cuadro no se mete
    expect(fireEvent.mouseDown(idea)).toBe(true);
    expect(texto).not.toHaveFocus();
    expect(fireEvent.mouseDown(texto)).toBe(true);
    // el relleno sí: foco al texto, y sin dejar que el navegador lo suelte al no hallar nada enfocable bajo el ratón
    expect(fireEvent.mouseDown(cuadro)).toBe(false);
    expect(texto).toHaveFocus();
  });

  it('lo que va de hijo queda DENTRO del cuadro, debajo del texto, y la ref y las props llegan al <textarea>', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(
      <CuadroDeTexto ref={ref} aria-label="Tu texto" maxLength={50} defaultValue="hola">
        <p>las ideas</p>
      </CuadroDeTexto>,
    );
    const texto = screen.getByRole('textbox', { name: 'Tu texto' });
    expect(ref.current).toBe(texto);
    expect(texto).toHaveAttribute('maxlength', '50');
    expect(texto).toHaveValue('hola');
    const cuadro = texto.parentElement!;
    expect([...cuadro.children]).toEqual([texto, screen.getByText('las ideas')]);
  });
});
