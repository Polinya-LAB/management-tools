// Registro en estacion-dymo.log junto al exe. Al pasar de ~1 MB se queda con los últimos ~500 KB.
// Nunca se escriben la clave ni las imágenes: quien llama solo pasa mensajes ya preparados.

import { type Fs, fsDeno } from "./archivos.ts";

export interface Registro {
  (mensaje: string): void;
}

export interface OpcionesRegistro {
  max?: number;
  conservar?: number;
  ahora?: () => Date;
  consola?: boolean;
  fs?: Fs;
}

const dos = (n: number) => String(n).padStart(2, "0");
export function marca(d: Date): string {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}

/** Deja en el archivo los últimos `conservar` bytes, empezando en una línea entera. */
export function recortar(ruta: string, conservar: number, fs: Fs = fsDeno): number {
  const datos = fs.leer(ruta) ?? new Uint8Array();
  if (datos.length <= conservar) return datos.length;
  let desde = datos.length - conservar;
  const salto = datos.indexOf(0x0a, desde);
  desde = salto === -1 ? datos.length : salto + 1;
  fs.escribir(ruta, datos.subarray(desde));
  return datos.length - desde;
}

export function crearRegistro(ruta: string, op: OpcionesRegistro = {}): Registro {
  const max = op.max ?? 1024 * 1024;
  const conservar = op.conservar ?? 500 * 1024;
  const ahora = op.ahora ?? (() => new Date());
  const fs = op.fs ?? fsDeno;
  const enc = new TextEncoder();
  let tam = -1;
  return (mensaje: string) => {
    const linea = `${marca(ahora())} ${mensaje.replace(/\r?\n/g, " | ")}\n`;
    try {
      // Con --no-terminal no hay consola en Windows; si escribir en ella falla, da igual.
      if (op.consola !== false) console.log(linea.trimEnd());
    } catch { /* sin consola */ }
    try {
      if (tam < 0) tam = fs.leer(ruta)?.length ?? 0;
      const bytes = enc.encode(linea);
      fs.escribir(ruta, bytes, true);
      tam += bytes.length;
      if (tam > max) tam = recortar(ruta, conservar, fs);
    } catch (e) {
      // Sin registro no hay dónde avisar; no se para la estación por eso.
      try {
        if (op.consola !== false) console.error("No se puede escribir el registro:", e);
      } catch { /* sin consola */ }
    }
  };
}
