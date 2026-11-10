// Configuración de la estación: estacion-dymo.json junto al exe (lo descarga la página de accesos).

export const ROLLOS = ["99012", "99010", "11354", "11352"] as const;
export type Rollo = typeof ROLLOS[number];

export interface Config {
  url: string; // https://<proyecto>.supabase.co/functions/v1/impresion, sin barra final
  clave: string;
  impresora?: string;
  intervalo: number; // segundos entre ciclos en reposo
  papel: Partial<Record<Rollo, string>>; // PaperName por rollo, si el de fábrica no vale
  girar180: boolean;
}

export const ARCHIVO_CONFIG = "estacion-dymo.json";

const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Valida el JSON ya leído. Lanza Error con un mensaje en español para el registro. */
export function validarConfig(texto: string): Config {
  let v: unknown;
  try {
    v = JSON.parse(texto.replace(/^﻿/, ""));
  } catch {
    throw new Error(`${ARCHIVO_CONFIG} no es un JSON válido: descárgalo otra vez desde la página de accesos`);
  }
  if (!esObjeto(v)) throw new Error(`${ARCHIVO_CONFIG} no es un objeto JSON`);
  const malo = (campo: string, que: string) => new Error(`${ARCHIVO_CONFIG}: «${campo}» ${que}`);

  if (typeof v.url !== "string" || !v.url.trim()) throw malo("url", "falta o está vacío");
  let url: URL;
  try {
    url = new URL(v.url.trim());
  } catch {
    throw malo("url", "no es una dirección válida");
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost"; // solo para pruebas
  if (url.protocol !== "https:" && !local) throw malo("url", "debe empezar por https://");
  if (typeof v.clave !== "string" || !v.clave.trim()) throw malo("clave", "falta o está vacía");
  if (v.impresora !== undefined && (typeof v.impresora !== "string")) throw malo("impresora", "debe ser un texto");
  const intervalo = v.intervalo ?? 10;
  if (typeof intervalo !== "number" || !(intervalo >= 3 && intervalo <= 300)) throw malo("intervalo", "debe ser un número entre 3 y 300 (segundos)");
  const papel: Partial<Record<Rollo, string>> = {};
  if (v.papel !== undefined) {
    if (!esObjeto(v.papel)) throw malo("papel", 'debe ser un objeto, p. ej. {"11354": "11354 Multi-Purpose"}');
    for (const [k, p] of Object.entries(v.papel)) {
      if (!(ROLLOS as readonly string[]).includes(k)) throw malo("papel", `tiene un rollo desconocido (${k})`);
      if (typeof p !== "string" || !p.trim()) throw malo("papel", `el papel de ${k} debe ser un texto`);
      papel[k as Rollo] = p.trim();
    }
  }
  if (v.girar180 !== undefined && typeof v.girar180 !== "boolean") throw malo("girar180", "debe ser true o false");

  return {
    url: url.href.replace(/\/+$/, ""),
    clave: v.clave.trim(),
    impresora: typeof v.impresora === "string" && v.impresora.trim() ? v.impresora.trim() : undefined,
    intervalo,
    papel,
    girar180: v.girar180 === true,
  };
}
