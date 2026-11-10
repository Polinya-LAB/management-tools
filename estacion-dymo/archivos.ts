// Archivos junto al exe: carpeta, trabajo a medias y plantillas de DYMO Connect.

import type { Rollo } from "./config.ts";
import type { EnCurso } from "./estacion.ts";

/** Lo justo del sistema de archivos; en las pruebas va en memoria. */
export interface Fs {
  leer(ruta: string): Uint8Array | null; // null si no existe
  escribir(ruta: string, datos: Uint8Array, anadir?: boolean): void;
  borrar(ruta: string): void; // sin error si no existe
}

export const fsDeno: Fs = {
  leer(ruta) {
    try {
      return Deno.readFileSync(ruta);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return null;
      throw e;
    }
  },
  escribir: (ruta, datos, anadir = false) => Deno.writeFileSync(ruta, datos, { append: anadir }),
  borrar(ruta) {
    try {
      Deno.removeSync(ruta);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  },
};

export const ARCHIVO_ESTADO = "estacion-dymo.estado.json";
export const ARCHIVO_LOG = "estacion-dymo.log";

/** Carpeta del exe (o ESTACION_DYMO_DIR, para probar con `deno run`). */
export function carpeta(): string {
  let d: string | undefined;
  try {
    d = Deno.env.get("ESTACION_DYMO_DIR");
  } catch { /* sin permiso de entorno */ }
  if (d) return d;
  const exe = Deno.execPath();
  return exe.slice(0, Math.max(exe.lastIndexOf("/"), exe.lastIndexOf("\\"))) || ".";
}

export const unir = (dir: string, nombre: string) => `${dir}${/[\\/]$/.test(dir) ? "" : Deno.build.os === "windows" ? "\\" : "/"}${nombre}`;

/** Texto de un archivo guardado por Windows: UTF-8 (con o sin BOM) o UTF-16. */
export function decodificar(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
  return new TextDecoder().decode(b).replace(/^﻿/, "");
}

export function leerTexto(ruta: string, fs: Fs = fsDeno): string | null {
  const b = fs.leer(ruta);
  return b === null ? null : decodificar(b);
}

export function enCursoEn(dir: string, fs: Fs = fsDeno) {
  const ruta = unir(dir, ARCHIVO_ESTADO);
  return {
    leer(): EnCurso | null {
      const t = leerTexto(ruta, fs);
      if (t === null) return null;
      try {
        const v = JSON.parse(t);
        if (typeof v?.id === "string" && Number.isInteger(v.hechas)) return { id: v.id, hechas: v.hechas };
      } catch { /* archivo roto */ }
      this.borrar();
      return null;
    },
    guardar(e: EnCurso) {
      fs.escribir(ruta, new TextEncoder().encode(JSON.stringify(e)));
    },
    borrar() {
      try {
        fs.borrar(ruta);
      } catch { /* se queda; al arrancar se dará por interrumpido */ }
    },
  };
}

export function plantillaEn(dir: string, fs: Fs = fsDeno) {
  return (rollo: Rollo) => leerTexto(unir(dir, `plantilla-${rollo}.label`), fs);
}

/** Plantilla en el formato de DYMO Connect (.dymo, DesktopLabel) guardada desde el propio DYMO Connect. */
export function plantillaDcdEn(dir: string, fs: Fs = fsDeno) {
  return (rollo: Rollo) => leerTexto(unir(dir, `plantilla-${rollo}.dymo`), fs);
}
