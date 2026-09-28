/** Junta clases, saltándose las vacías. */
export function unir(...clases: Array<string | false | null | undefined>): string {
  return clases.filter(Boolean).join(' ');
}
