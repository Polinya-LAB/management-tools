// Servicio de DYMO y función `impresion` simulados detrás de un único fetch (sin red). Lo usan los demás *_test.ts.

import type { TrabajoEstacion } from "./api.ts";
import type { Rollo } from "./config.ts";
import type { Fetch } from "./dymo.ts";

export const URL_API = "https://ejemplo.supabase.co/functions/v1/impresion";
export const CLAVE = "clave-secreta-de-prueba";
export const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export const IMPRESORAS = `<Printers><LabelWriterPrinter><Name>DYMO LabelWriter 550</Name><ModelName>DYMO LabelWriter 550</ModelName>` +
  `<IsConnected>True</IsConnected><IsLocal>True</IsLocal><IsTwinTurbo>False</IsTwinTurbo></LabelWriterPrinter></Printers>`;

export interface Impresion {
  printerName: string;
  labelXml: string;
  printParamsXml: string;
}

export function simulador() {
  const s = {
    // DYMO
    dymoVivo: true,
    dymoHost: "127.0.0.1",
    dymoPuerto: 41951,
    impresoras: IMPRESORAS,
    /** Respuesta de PrintLabel para la impresión número i (0, 1, …); por defecto 200. */
    fallaImprimir: (_i: number): { status: number; texto: string } | null => null,
    impresiones: [] as Impresion[],
    pedidasDymo: [] as string[],
    // Servidor
    redCaida: false,
    rollo: "11354" as Rollo,
    cola: [] as TrabajoEstacion[],
    ciclos: [] as { dymo: Record<string, unknown>; pedir: boolean }[],
    progresos: [] as { id: string; cuerpo: Record<string, unknown> }[],
    /** Status para cada aviso de progreso; por defecto 200. */
    statusProgreso: (_c: Record<string, unknown>): number => 200,
  };

  const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

  const f: Fetch = async (entrada, init) => {
    const u = new URL(String(entrada));
    if (u.pathname.startsWith("/DYMO/DLS/Printing/")) {
      s.pedidasDymo.push(`${u.host}${u.pathname.slice("/DYMO/DLS/Printing".length)}`);
      if (!s.dymoVivo || u.host !== `${s.dymoHost}:${s.dymoPuerto}`) throw new TypeError("error sending request: connection refused");
      const orden = u.pathname.split("/").pop();
      if (orden === "StatusConnected") return new Response("true");
      if (orden === "GetPrinters") return new Response(s.impresoras);
      if (orden === "GetConsumableInfoIn550Printer") return new Response('{"sku":"11354"}');
      if (orden === "PrintLabel" && init?.method === "POST") {
        const p = new URLSearchParams(String(init.body));
        const i = s.impresiones.length;
        const fallo = s.fallaImprimir(i);
        if (fallo) return new Response(fallo.texto, { status: fallo.status });
        s.impresiones.push({ printerName: p.get("printerName")!, labelXml: p.get("labelXml")!, printParamsXml: p.get("printParamsXml")! });
        return new Response("true");
      }
      return new Response("not found", { status: 404 });
    }
    if (u.href.startsWith(URL_API + "/")) {
      if (s.redCaida) throw new TypeError("error sending request: dns error");
      const h = new Headers(init?.headers);
      if (h.get("x-estacion") !== CLAVE) return json(401, { message: "Clave de estación no válida", code: "bad_station_key" });
      const ruta = u.href.slice(URL_API.length + 1);
      const cuerpo = JSON.parse(String(init?.body ?? "{}"));
      if (ruta === "estacion/ciclo") {
        s.ciclos.push(cuerpo);
        const trabajo = cuerpo.pedir ? s.cola.shift() ?? null : null;
        return json(200, { rollo: s.rollo, trabajo });
      }
      const m = /^estacion\/trabajos\/([^/]+)$/.exec(ruta);
      if (m) {
        s.progresos.push({ id: m[1], cuerpo });
        const st = s.statusProgreso(cuerpo);
        return st === 200 ? json(200, { ok: true }) : json(st, { message: "El trabajo ya no está imprimiéndose", code: "not_printing" });
      }
      return json(404, { code: "not_found" });
    }
    throw new TypeError(`URL inesperada: ${u.href}`);
  };
  return { s, fetch: f };
}

export function trabajo(id: string, n: number, extra: Partial<TrabajoEstacion> = {}): TrabajoEstacion {
  return {
    id,
    rollo: "11354",
    etiquetas: Array.from({ length: n }, (_, i) => ({ codigo: `M-${i + 1}`, png: PNG })),
    n,
    hechas: 0,
    ...extra,
  };
}
