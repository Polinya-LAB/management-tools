import { assert, assertEquals } from "jsr:@std/assert@1";
import type { Acceso } from "../_shared/permisos.ts";
import { crearHandlerImpresion, type Estacion, type ImpresionDeps, sha256, type Trabajo } from "./handler.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const CLAVE = "clave-de-la-estacion-de-prueba";
const PERSONAS: Record<string, Acceso> = {
  "ana@fluidra.com": { email: "ana@fluidra.com", nombre: "Ana", roles: { muestras: "editar" }, admin: false },
  "eva@fluidra.com": { email: "eva@fluidra.com", nombre: "Eva", roles: { muestras: "editar" }, admin: false },
  "luis@fluidra.com": { email: "luis@fluidra.com", nombre: "Luis", roles: { muestras: "ver" }, admin: false },
  "jefa@fluidra.com": { email: "jefa@fluidra.com", nombre: "Jefa", roles: {}, admin: true },
};
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sinPng = ({ etiquetas, ...r }: Trabajo) => ({ ...r, codigos: etiquetas.map((x) => x.codigo) });

async function montar(opts: { sinClave?: boolean } = {}) {
  const reloj = { t: new Date("2026-11-10T10:00:00Z") };
  const est: Estacion = { token_hash: opts.sinClave ? null : await sha256(CLAVE), rollo: "11354", visto: null, estado: null, purgado: null };
  const trabajos: Trabajo[] = [];
  let purgas = 0;
  const deps: ImpresionDeps = {
    usuario: async (jwt) => (jwt.startsWith("jwt-") ? { email: jwt.slice(4) } : null),
    acceso: async (e) => PERSONAS[e] ?? null,
    estacion: async () => ({ ...est }),
    guardarEstacion: async (c) => void Object.assign(est, c),
    crearTrabajo: async (t) => {
      const ya = trabajos.find((x) => x.id === t.id);
      if (ya) return ya;
      const iso = reloj.t.toISOString();
      const nuevo: Trabajo = { ...t, creado: iso, actualizado: iso, hechas: 0, estado: "pendiente", error: null };
      trabajos.push(nuevo);
      return nuevo;
    },
    trabajo: async (id) => { const t = trabajos.find((x) => x.id === id); return t ? sinPng(t) : null; },
    ultimosDe: async (e, k) => trabajos.filter((t) => t.por === e).slice(-k).reverse().map(sinPng),
    tomarSiguiente: async () => {
      const t = trabajos.find((x) => x.estado === "pendiente");
      if (!t) return null;
      Object.assign(t, { estado: "imprimiendo", actualizado: reloj.t.toISOString() });
      return { ...t };
    },
    actualizar: async (id, desde, c) => {
      const t = trabajos.find((x) => x.id === id);
      if (!t || !desde.includes(t.estado)) return false;
      Object.assign(t, c, { actualizado: reloj.t.toISOString() });
      return true;
    },
    interrumpir: async (antes) => {
      for (const t of trabajos) {
        if (t.estado === "imprimiendo" && Date.parse(t.actualizado) < antes.getTime()) Object.assign(t, { estado: "error", error: "Interrumpido" });
      }
    },
    purgar: async (antes) => {
      purgas++;
      for (let i = trabajos.length - 1; i >= 0; i--) if (Date.parse(trabajos[i].creado) < antes.getTime()) trabajos.splice(i, 1);
    },
    ahora: () => reloj.t,
    clave: () => "nueva-clave-aleatoria",
  };
  const h = crearHandlerImpresion(deps);
  const llamar = (metodo: string, ruta: string, cuerpo?: unknown, cab: Record<string, string> = {}) =>
    h(new Request("http://x" + ruta, { method: metodo, headers: { "content-type": "application/json", ...cab }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }));
  const como = (email: string): Record<string, string> => ({ authorization: `Bearer jwt-${email}` });
  const estacion: Record<string, string> = { "x-estacion": CLAVE };
  const listo = { dymo: { ok: true, conectada: true, impresora: "DYMO LabelWriter 550" }, pedir: true };
  const ciclo = async (cuerpo: unknown = listo) => (await llamar("POST", "/impresion/estacion/ciclo", cuerpo, estacion)).json();
  return { llamar, como, estacion, est, trabajos, reloj, ciclo, listo, purgas: () => purgas };
}

let sec = 0;
const envio = (codigos = ["QTS-00001-1"], rollo = "11354", id = ID(++sec)) =>
  ({ id, rollo, etiquetas: codigos.map((codigo) => ({ codigo, png: PNG })), unidades: codigos.map((_, i) => `s1:${i + 1}`) });

Deno.test("portátil: hace falta sesión y Muestras: editar", async () => {
  const { llamar, como } = await montar();
  assertEquals((await llamar("GET", "/impresion/estado")).status, 401);
  assertEquals((await llamar("GET", "/impresion/estado", undefined, { authorization: "Bearer otro" })).status, 401);
  const r = await llamar("POST", "/impresion/trabajos", envio(), como("luis@fluidra.com"));
  assertEquals([r.status, (await r.json()).code], [403, "no_edit"]);
  assertEquals((await llamar("GET", "/impresion/estado", undefined, como("nadie@fluidra.com"))).status, 403);
});

Deno.test("portátil: envía un trabajo, lo ve en su estado y un reenvío con el mismo id no lo duplica", async () => {
  const { llamar, como, trabajos } = await montar();
  const e1 = envio(["QTS-00001-1", "QTS-00001-2"]);
  const r = await llamar("POST", "/impresion/trabajos", e1, como("ana@fluidra.com"));
  assertEquals(r.status, 201);
  const j = await r.json();
  assertEquals([j.id, j.estado, j.n, j.hechas, j.codigos, j.unidades, j.etiquetas], [e1.id, "pendiente", 2, 0, ["QTS-00001-1", "QTS-00001-2"], ["s1:1", "s1:2"], undefined]);
  assertEquals((await llamar("POST", "/impresion/trabajos", e1, como("ana@fluidra.com"))).status, 201);
  assertEquals(trabajos.length, 1);
  // El mismo id desde otra persona no le enseña el trabajo ajeno.
  assertEquals((await llamar("POST", "/impresion/trabajos", e1, como("eva@fluidra.com"))).status, 409);
  const e = await (await llamar("GET", "/impresion/estado", undefined, como("ana@fluidra.com"))).json();
  assertEquals([e.estacion.conectada, e.estacion.configurada, e.estacion.rollo, e.trabajos.length], [false, true, "11354", 1]);
  assertEquals(e.trabajos[0].etiquetas, undefined);
});

Deno.test("portátil: valida el envío (id, rollo, cantidad, PNG, tamaños, unidades)", async () => {
  const { llamar, como } = await montar();
  const ana = como("ana@fluidra.com");
  const grande = PNG.slice(0, 11) + "A".repeat(82000); // ~61 KB
  const casos: [unknown, number, string][] = [
    [{ ...envio(), id: "no-uuid" }, 400, "bad_body"],
    [{ ...envio(), rollo: "12345" }, 400, "bad_body"],
    [envio([]), 400, "bad_count"],
    [envio(Array.from({ length: 101 }, (_, i) => `QTS-${i}`)), 400, "bad_count"],
    [{ ...envio(), etiquetas: [{ codigo: "QTS-1", png: "R0lGODlhAQABAAAAACw=" }] }, 400, "bad_label"],
    [{ ...envio(), etiquetas: [{ codigo: "", png: PNG }] }, 400, "bad_label"],
    [{ ...envio(), etiquetas: [{ codigo: "QTS-1", png: grande }] }, 400, "label_too_big"],
    [{ ...envio(), etiquetas: Array.from({ length: 60 }, (_, i) => ({ codigo: `Q${i}`, png: PNG.slice(0, 11) + "A".repeat(75000) })) }, 400, "job_too_big"],
    [{ ...envio(), unidades: ["../x"] }, 400, "bad_body"],
    [envio(["QTS-1"], "99012"), 409, "roll_changed"],
  ];
  for (const [cuerpo, status, code] of casos) {
    const r = await llamar("POST", "/impresion/trabajos", cuerpo, ana);
    assertEquals([r.status, (await r.json()).code], [status, code], JSON.stringify(cuerpo).slice(0, 80));
  }
});

Deno.test("portátil: cambia el rollo puesto", async () => {
  const { llamar, como, est } = await montar();
  assertEquals((await llamar("PUT", "/impresion/rollo", { rollo: "99012" }, como("ana@fluidra.com"))).status, 200);
  assertEquals(est.rollo, "99012");
  assertEquals((await llamar("PUT", "/impresion/rollo", { rollo: "x" }, como("ana@fluidra.com"))).status, 400);
  assertEquals((await llamar("PUT", "/impresion/rollo", { rollo: "11354" }, como("luis@fluidra.com"))).status, 403);
});

Deno.test("estación: sin clave válida no hace nada", async () => {
  const { llamar } = await montar();
  for (const cab of [{}, { "x-estacion": "otra" }] as Record<string, string>[]) {
    const r = await llamar("POST", "/impresion/estacion/ciclo", {}, cab);
    assertEquals([r.status, (await r.json()).code], [401, "bad_station_key"]);
  }
  const sin = await montar({ sinClave: true });
  assertEquals((await sin.llamar("POST", "/impresion/estacion/ciclo", {}, { "x-estacion": "" })).status, 401);
});

Deno.test("estación: solo recibe trabajo si DYMO responde, la impresora está conectada y lo pide", async () => {
  const { llamar, como, ciclo, est } = await montar();
  await llamar("POST", "/impresion/trabajos", envio(["A"]), como("ana@fluidra.com"));
  assertEquals((await ciclo({ dymo: { ok: false, error: "sin servicio" }, pedir: true })).trabajo, null);
  assertEquals((await ciclo({ dymo: { ok: true, conectada: false }, pedir: true })).trabajo, null);
  assertEquals((await ciclo({ dymo: { ok: true, conectada: true } })).trabajo, null);
  assertEquals(est.estado, { dymo: true, conectada: true, impresora: "", error: "" });
  const c = await ciclo();
  assertEquals([c.rollo, c.trabajo.etiquetas[0].codigo, c.trabajo.etiquetas[0].png, c.trabajo.estado], ["11354", "A", PNG, "imprimiendo"]);
  assertEquals((await ciclo()).trabajo, null);
  const e = await (await llamar("GET", "/impresion/estado", undefined, como("ana@fluidra.com"))).json();
  assert(e.estacion.conectada);
});

Deno.test("estación: progreso, resultado y reintento desde lo hecho", async () => {
  const { llamar, como, estacion, ciclo, trabajos } = await montar();
  await llamar("POST", "/impresion/trabajos", envio(["A", "B", "C"]), como("ana@fluidra.com"));
  await llamar("POST", "/impresion/trabajos", envio(["D"]), como("ana@fluidra.com"));
  const t1 = (await ciclo()).trabajo;
  const p = (id: string, b: unknown) => llamar("POST", `/impresion/estacion/trabajos/${id}`, b, estacion);
  assertEquals((await p(t1.id, { hechas: 1 })).status, 200);
  assertEquals((await p(t1.id, { hechas: 2, fin: "error", error: "Sin papel" })).status, 200);
  assertEquals([trabajos[0].estado, trabajos[0].hechas, trabajos[0].error], ["error", 2, "Sin papel"]);
  // Un resultado repetido o tardío no cambia nada.
  assertEquals((await p(t1.id, { hechas: 3, fin: "impreso" })).status, 409);
  assertEquals((await p(t1.id, { hechas: "x" })).status, 400);
  // Reintentar: solo quien lo mandó (o administración) y solo si falló; sigue desde lo hecho.
  assertEquals((await llamar("POST", `/impresion/trabajos/${t1.id}/reintentar`, undefined, como("eva@fluidra.com"))).status, 404);
  assertEquals((await llamar("POST", `/impresion/trabajos/${t1.id}/reintentar`, undefined, como("ana@fluidra.com"))).status, 200);
  const t2 = (await ciclo()).trabajo;
  assertEquals([t2.id, t2.hechas], [t1.id, 2]);
  assertEquals((await p(t2.id, { hechas: 3, fin: "impreso" })).status, 200);
  assertEquals([trabajos[0].estado, trabajos[0].error], ["impreso", null]);
  assertEquals((await llamar("POST", `/impresion/trabajos/${t1.id}/reintentar`, undefined, como("ana@fluidra.com"))).status, 409);
  assertEquals((await ciclo()).trabajo.etiquetas[0].codigo, "D");
});

Deno.test("estación: 'interrumpido' cuenta desde el último progreso; purga como mucho una vez por hora", async () => {
  const { llamar, como, estacion, ciclo, trabajos, reloj, purgas } = await montar();
  await llamar("POST", "/impresion/trabajos", envio(["A", "B"]), como("ana@fluidra.com"));
  const t = (await ciclo()).trabajo;
  reloj.t = new Date(reloj.t.getTime() + 2 * 60_000);
  await llamar("POST", `/impresion/estacion/trabajos/${t.id}`, { hechas: 1 }, estacion);
  reloj.t = new Date(reloj.t.getTime() + 2 * 60_000);
  await ciclo({ dymo: { ok: true, conectada: true } });
  assertEquals(trabajos[0].estado, "imprimiendo");
  reloj.t = new Date(reloj.t.getTime() + 2 * 60_000);
  await ciclo({ dymo: { ok: true, conectada: true } });
  assertEquals([trabajos[0].estado, trabajos[0].error, trabajos[0].hechas], ["error", "Interrumpido", 1]);
  const antes = purgas();
  await ciclo({}); await ciclo({});
  assertEquals(purgas(), antes);
  reloj.t = new Date(reloj.t.getTime() + 31 * 24 * 3600_000);
  await ciclo({});
  assertEquals([purgas(), trabajos.length], [antes + 1, 0]);
});

Deno.test("clave de la estación: solo administradores; la anterior deja de valer", async () => {
  const { llamar, como, estacion } = await montar();
  assertEquals((await llamar("POST", "/impresion/admin/clave", undefined, como("ana@fluidra.com"))).status, 403);
  const r = await llamar("POST", "/impresion/admin/clave", undefined, como("jefa@fluidra.com"));
  assertEquals(await r.json(), { clave: "nueva-clave-aleatoria" });
  assertEquals((await llamar("POST", "/impresion/estacion/ciclo", {}, estacion)).status, 401);
  assertEquals((await llamar("POST", "/impresion/estacion/ciclo", {}, { "x-estacion": "nueva-clave-aleatoria" })).status, 200);
});

Deno.test("CORS: el preflight anuncia POST y PUT", async () => {
  const { llamar } = await montar();
  const r = await llamar("OPTIONS", "/impresion/trabajos", undefined, { origin: "https://polinya-lab.github.io" });
  assertEquals(r.status, 204);
  assert(r.headers.get("access-control-allow-methods")!.includes("POST"));
});
