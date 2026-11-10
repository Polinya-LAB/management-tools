import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { ApiEstacion } from "./api.ts";
import { validarConfig } from "./config.ts";
import { ClienteDymo } from "./dymo.ts";
import { CLAVE_MALA, type EnCurso, Estacion } from "./estacion.ts";
import { CLAVE, simulador, trabajo, URL_API } from "./simulador_test.ts";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function montar(op: { clave?: string; enCurso?: EnCurso; plantilla?: string; girar180?: boolean; alDormir?: () => void } = {}) {
  const sim = simulador();
  const cfg = validarConfig(JSON.stringify({ url: URL_API, clave: op.clave ?? CLAVE, girar180: op.girar180 }));
  const lineas: string[] = [];
  const esperas: number[] = [];
  const disco = { actual: op.enCurso ?? null as EnCurso | null, historial: [] as EnCurso[] };
  const estacion = new Estacion({
    config: cfg,
    api: new ApiEstacion(sim.fetch, cfg.url, cfg.clave),
    dymo: new ClienteDymo(sim.fetch),
    log: (m) => lineas.push(m),
    enCurso: {
      leer: () => disco.actual,
      guardar: (e) => void (disco.actual = e, disco.historial.push({ ...e })),
      borrar: () => void (disco.actual = null),
    },
    plantilla: () => op.plantilla ?? null,
    dormir: async (ms) => void (esperas.push(ms), op.alDormir?.()),
  });
  return { ...sim, estacion, lineas, esperas, disco };
}

const titulos = (s: ReturnType<typeof simulador>["s"]) =>
  s.impresiones.map((i) => /<JobTitle>([^<]*)<\/JobTitle>/.exec(i.printParamsXml)![1]);

Deno.test("sin trabajos: ciclo con el estado de DYMO y espera el intervalo", async () => {
  const { s, estacion, lineas } = montar();
  assertEquals(await estacion.paso(), 10_000);
  assertEquals(s.ciclos, [{ dymo: { ok: true, conectada: true, impresora: "DYMO LabelWriter 550", error: "" }, pedir: true }]);
  assertEquals(await estacion.paso(), 10_000);
  // Los mensajes repetidos no se vuelven a escribir.
  assertEquals(lineas, ["DYMO lista: DYMO LabelWriter 550", "Conectada con el servidor (rollo puesto: 11354)"]);
  for (const l of lineas) assert(!l.includes(CLAVE));
});

Deno.test("sin servicio de DYMO no pide trabajos", async () => {
  const { s, estacion } = montar();
  s.dymoVivo = false;
  s.cola.push(trabajo(ID(1), 1));
  assertEquals(await estacion.paso(), 10_000);
  assertEquals(s.ciclos[0].pedir, false);
  assertEquals(s.ciclos[0].dymo.ok, false);
  assertEquals(s.cola.length, 1);
});

Deno.test("imprime desde `hechas`, avisa tras cada etiqueta y al final; luego vuelve enseguida", async () => {
  const { s, estacion, disco, lineas } = montar({ girar180: true });
  s.cola.push(trabajo(ID(1), 4, { hechas: 1 }));
  assertEquals(await estacion.paso(), 0);
  assertEquals(titulos(s), ["QTS-M-2", "QTS-M-3", "QTS-M-4"]);
  assertEquals(s.impresiones[0].printerName, "DYMO LabelWriter 550");
  assertStringIncludes(s.impresiones[0].labelXml, "<PaperName>11354 Multi-Purpose</PaperName>");
  assertStringIncludes(s.impresiones[0].labelXml, "<Rotation>Rotation180</Rotation>");
  assertEquals(s.progresos, [
    { id: ID(1), cuerpo: { hechas: 2 } },
    { id: ID(1), cuerpo: { hechas: 3 } },
    { id: ID(1), cuerpo: { hechas: 4, fin: "impreso" } },
  ]);
  assertEquals(disco.historial.map((e) => e.hechas), [1, 2, 3, 4]);
  assertEquals(disco.actual, null);
  assert(lineas.some((l) => l.includes("impreso (4 etiquetas)")));
  for (const l of lineas) assert(!l.includes("iVBOR"), "no se registran imágenes");
  assertEquals(await estacion.paso(), 10_000);
});

Deno.test("fallo de PrintLabel: error con el mensaje de DYMO y no sigue", async () => {
  const { s, estacion, disco } = montar();
  s.cola.push(trabajo(ID(2), 3));
  s.fallaImprimir = (i) => (i === 1 ? { status: 500, texto: "Paper out" } : null);
  assertEquals(await estacion.paso(), 0);
  assertEquals(titulos(s), ["QTS-M-1"]);
  assertEquals(s.progresos, [
    { id: ID(2), cuerpo: { hechas: 1 } },
    { id: ID(2), cuerpo: { hechas: 1, fin: "error", error: "DYMO (HTTP 500): Paper out" } },
  ]);
  assertEquals(disco.actual, null);
});

Deno.test("rollo distinto del puesto: error sin imprimir", async () => {
  const { s, estacion } = montar();
  s.cola.push(trabajo(ID(3), 2, { rollo: "99012" }));
  await estacion.paso();
  assertEquals(s.impresiones, []);
  assertEquals(s.progresos, [{ id: ID(3), cuerpo: { hechas: 0, fin: "error", error: "El trabajo es para el rollo 99012 y está puesto 11354" } }]);
});

Deno.test("plantilla no válida: error sin imprimir", async () => {
  const { s, estacion } = montar({ plantilla: "<DesktopLabel/>" });
  s.cola.push(trabajo(ID(3), 1));
  await estacion.paso();
  assertEquals(s.impresiones, []);
  assertEquals(s.progresos[0].cuerpo.fin, "error");
  assertStringIncludes(String(s.progresos[0].cuerpo.error), "plantilla-11354.label");
});

Deno.test("409 al avisar del progreso: se para el trabajo", async () => {
  const { s, estacion, disco, lineas } = montar();
  s.cola.push(trabajo(ID(4), 3));
  s.statusProgreso = () => 409;
  assertEquals(await estacion.paso(), 0);
  assertEquals(titulos(s), ["QTS-M-1"]);
  assertEquals(s.progresos, [{ id: ID(4), cuerpo: { hechas: 1 } }]);
  assertEquals(disco.actual, null);
  assert(lineas.some((l) => l.includes("ya no lo da por imprimiéndose")));
});

Deno.test("progreso sin red: sigue imprimiendo y reintenta el resultado final", async () => {
  let dormidas = 0;
  const { s, estacion, esperas } = montar({ alDormir: () => void (++dormidas === 2 && (s.redCaida = false)) });
  s.cola.push(trabajo(ID(5), 2));
  s.fallaImprimir = () => {
    s.redCaida = true; // la red cae tras tomar el trabajo
    return null;
  };
  await estacion.paso();
  assertEquals(titulos(s), ["QTS-M-1", "QTS-M-2"]);
  assertEquals(s.progresos, [{ id: ID(5), cuerpo: { hechas: 2, fin: "impreso" } }]);
  assertEquals(esperas, [5000, 10_000]);
});

Deno.test("clave no válida: lo dice en el registro y espera 60 s", async () => {
  const { s, estacion, lineas } = montar({ clave: "otra" });
  assertEquals(await estacion.paso(), 60_000);
  assertEquals(await estacion.paso(), 60_000);
  assertEquals(lineas.filter((l) => l === CLAVE_MALA).length, 1);
  assertEquals(s.ciclos, []);
});

Deno.test("sin red: espera cada vez más, hasta 60 s, y vuelve al intervalo al recuperarse", async () => {
  const { s, estacion, lineas } = montar();
  s.redCaida = true;
  const esperas = [];
  for (let i = 0; i < 5; i++) esperas.push(await estacion.paso());
  assertEquals(esperas, [10_000, 20_000, 40_000, 60_000, 60_000]);
  assert(lineas.some((l) => l.startsWith("Sin conexión con el servidor")));
  s.redCaida = false;
  assertEquals(await estacion.paso(), 10_000);
});

Deno.test("al reiniciar con un trabajo a medias lo da por error con lo hecho", async () => {
  const { s, estacion, disco } = montar({ enCurso: { id: ID(6), hechas: 2 } });
  assertEquals(await estacion.paso(), 10_000);
  assertEquals(s.progresos, [{ id: ID(6), cuerpo: { hechas: 2, fin: "error", error: "Interrumpido al reiniciar la estación" } }]);
  assertEquals(disco.actual, null);
  await estacion.paso();
  assertEquals(s.progresos.length, 1);
});

Deno.test("reinicio: 409 se ignora; sin red se reintenta en el siguiente ciclo", async () => {
  const a = montar({ enCurso: { id: ID(7), hechas: 1 } });
  a.s.statusProgreso = () => 409;
  assertEquals(await a.estacion.paso(), 10_000);
  assertEquals(a.disco.actual, null);

  const b = montar({ enCurso: { id: ID(8), hechas: 1 } });
  b.s.redCaida = true;
  assertEquals(await b.estacion.paso(), 10_000);
  assertEquals(b.disco.actual, { id: ID(8), hechas: 1 });
  b.s.redCaida = false;
  await b.estacion.paso();
  assertEquals(b.s.progresos.map((p) => p.id), [ID(8)]);
  assertEquals(b.disco.actual, null);
});

Deno.test("correr: no se para ante un error inesperado", async () => {
  const { estacion, lineas, esperas } = montar();
  let vueltas = 0;
  estacion.paso = () => (vueltas++ === 0 ? Promise.reject(new Error("raro")) : Promise.resolve(7));
  await estacion.correr(() => vueltas < 2);
  assertEquals(esperas, [60_000, 7]);
  assertEquals(lineas, ["Error inesperado: raro"]);
});
