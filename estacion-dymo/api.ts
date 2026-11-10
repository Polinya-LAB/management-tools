// Llamadas a la función `impresion` de Supabase con la clave de la estación (cabecera x-estacion).

import type { Rollo } from "./config.ts";
import type { EstadoDymo, Fetch } from "./dymo.ts";

export interface TrabajoEstacion {
  id: string;
  rollo: Rollo;
  etiquetas: { codigo: string; png: string }[];
  n: number;
  hechas: number;
}
export interface RespuestaCiclo {
  rollo: Rollo;
  trabajo: TrabajoEstacion | null;
}

/** Respuesta de error de la función (status y code). Los fallos de red llegan como otros errores. */
export class ErrorApi extends Error {
  constructor(public status: number, public code: string, mensaje: string) {
    super(mensaje);
  }
}

export class ApiEstacion {
  constructor(private f: Fetch, private url: string, private clave: string, private esperaMs = 60_000) {}

  private async post(ruta: string, cuerpo: unknown): Promise<unknown> {
    const r = await this.f(`${this.url}/${ruta}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-estacion": this.clave },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(this.esperaMs),
    });
    const t = await r.text();
    let v: unknown = undefined;
    try {
      v = t ? JSON.parse(t) : undefined;
    } catch { /* cuerpo no JSON */ }
    if (!r.ok) {
      const o = (v && typeof v === "object" ? v : {}) as { code?: string; message?: string };
      throw new ErrorApi(r.status, o.code ?? "", `HTTP ${r.status}${o.message ? `: ${o.message}` : ""}`);
    }
    return v;
  }

  async ciclo(dymo: EstadoDymo, pedir: boolean): Promise<RespuestaCiclo> {
    const v = await this.post("estacion/ciclo", { dymo, pedir }) as Partial<RespuestaCiclo> | undefined;
    if (!v || typeof v.rollo !== "string") throw new Error("Respuesta de ciclo no válida");
    const t = v.trabajo;
    if (!t) return { rollo: v.rollo, trabajo: null };
    if (typeof t.id !== "string" || !Array.isArray(t.etiquetas)) throw new Error("Trabajo recibido no válido");
    const hechas = Number.isInteger(t.hechas) && t.hechas >= 0 ? t.hechas : 0;
    return { rollo: v.rollo, trabajo: { id: t.id, rollo: t.rollo, etiquetas: t.etiquetas, n: t.etiquetas.length, hechas } };
  }

  async progreso(id: string, cuerpo: { hechas: number; fin?: "impreso" | "error"; error?: string }): Promise<void> {
    await this.post(`estacion/trabajos/${encodeURIComponent(id)}`, cuerpo);
  }
}
