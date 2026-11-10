// Registro en estacion-dymo.log junto al exe. Al pasar de ~1 MB se queda con los últimos ~500 KB.
// Nunca se escriben la clave ni las imágenes: quien llama solo pasa mensajes ya preparados.

export interface Registro {
  (mensaje: string): void;
}

export interface OpcionesRegistro {
  max?: number;
  conservar?: number;
  ahora?: () => Date;
  consola?: boolean;
}

const dos = (n: number) => String(n).padStart(2, "0");
export function marca(d: Date): string {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}

/** Deja en el archivo los últimos `conservar` bytes, empezando en una línea entera. */
export function recortar(ruta: string, conservar: number): void {
  const datos = Deno.readFileSync(ruta);
  if (datos.length <= conservar) return;
  let desde = datos.length - conservar;
  const salto = datos.indexOf(0x0a, desde);
  desde = salto === -1 ? datos.length : salto + 1;
  Deno.writeFileSync(ruta, datos.subarray(desde));
}

export function crearRegistro(ruta: string, op: OpcionesRegistro = {}): Registro {
  const max = op.max ?? 1024 * 1024;
  const conservar = op.conservar ?? 500 * 1024;
  const ahora = op.ahora ?? (() => new Date());
  const enc = new TextEncoder();
  let tam = -1;
  return (mensaje: string) => {
    const linea = `${marca(ahora())} ${mensaje.replace(/\r?\n/g, " | ")}\n`;
    if (op.consola !== false) console.log(linea.trimEnd());
    try {
      if (tam < 0) {
        try {
          tam = Deno.statSync(ruta).size;
        } catch {
          tam = 0;
        }
      }
      const bytes = enc.encode(linea);
      Deno.writeFileSync(ruta, bytes, { append: true });
      tam += bytes.length;
      if (tam > max) {
        recortar(ruta, conservar);
        tam = Deno.statSync(ruta).size;
      }
    } catch (e) {
      // Sin registro no hay dónde avisar; no se para la estación por eso.
      if (op.consola !== false) console.error("No se puede escribir el registro:", e);
    }
  };
}
