import { assert, assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { ApiEstacion } from "./api.ts";
import { decodificar, enCursoEn, plantillaEn, unir } from "./archivos.ts";
import { validarConfig } from "./config.ts";
import { bloquesPem, exportarCertificados } from "./certificados.ts";
import { ClienteDymo, mensaje } from "./dymo.ts";
import { crearRegistro, marca, recortar } from "./log.ts";
import { crc32, png1bit, pngPrueba } from "./png.ts";
import { prueba } from "./prueba.ts";
import { CLAVE, fsMemoria, simulador, URL_API } from "./simulador_test.ts";

Deno.test("config: valores por defecto y mensajes en español", () => {
  assertEquals(validarConfig(`﻿{"url":"${URL_API}/","clave":" k ","extra":1}`), {
    url: URL_API,
    clave: "k",
    impresora: undefined,
    intervalo: 10,
    papel: {},
    girar180: false,
  });
  const c = validarConfig(JSON.stringify({ url: URL_API, clave: "k", impresora: "DYMO", intervalo: 5, papel: { "11354": "X" }, girar180: true }));
  assertEquals([c.impresora, c.intervalo, c.papel, c.girar180], ["DYMO", 5, { "11354": "X" }, true]);
  assertThrows(() => validarConfig("{no"), Error, "no es un JSON válido");
  assertThrows(() => validarConfig("{}"), Error, "«url» falta");
  assertThrows(() => validarConfig(`{"url":"http://ejemplo.com","clave":"k"}`), Error, "https://");
  assertThrows(() => validarConfig(`{"url":"${URL_API}"}`), Error, "«clave»");
  assertThrows(() => validarConfig(`{"url":"${URL_API}","clave":"k","intervalo":1}`), Error, "«intervalo»");
  assertThrows(() => validarConfig(`{"url":"${URL_API}","clave":"k","papel":{"123":"x"}}`), Error, "rollo desconocido");
  assertThrows(() => validarConfig(`{"url":"${URL_API}","clave":"k","girar180":"si"}`), Error, "«girar180»");
  // El mensaje nunca lleva la clave.
  try {
    validarConfig(`{"url":"ftp://x","clave":"secreta"}`);
  } catch (e) {
    assert(!(e as Error).message.includes("secreta"));
  }
});

Deno.test("registro: marca de tiempo y recorte a los últimos bytes en líneas enteras", () => {
  const fs = fsMemoria();
  const ruta = "dir/estacion-dymo.log";
  const log = crearRegistro(ruta, { max: 1000, conservar: 400, ahora: () => new Date(2026, 10, 10, 9, 5, 3), consola: false, fs });
  log("primera\nsegunda");
  assertEquals(fs.texto(ruta), "2026-11-10 09:05:03 primera | segunda\n");
  for (let i = 0; i < 60; i++) log(`línea ${i}`);
  const t = fs.texto(ruta);
  assert(fs.archivos.get(ruta)!.length <= 1000, "no pasa del máximo");
  assert(t.startsWith("2026-11-10 09:05:03 línea "), "empieza en una línea entera");
  assert(t.endsWith("línea 59\n"));
  assert(!t.includes("primera"));
  // Un registro que ya existía cuenta para el tamaño.
  fs.escribir(ruta, new TextEncoder().encode("x".repeat(990) + "\n"));
  crearRegistro(ruta, { max: 1000, conservar: 400, consola: false, fs })("nueva");
  assert(fs.texto(ruta).endsWith(" nueva\n") && !fs.texto(ruta).includes("x"));
  // recortar directamente
  fs.escribir(ruta, new TextEncoder().encode("aaaa\nbbbb\ncccc\n"));
  assertEquals(recortar(ruta, 7, fs), 5);
  assertEquals(fs.texto(ruta), "cccc\n");
  assertEquals(marca(new Date(2026, 0, 2, 3, 4, 5)), "2026-01-02 03:04:05");
});

Deno.test("png: PNG de 1 bit válido (cabecera, CRC, datos)", async () => {
  assertEquals(crc32(new TextEncoder().encode("IEND")), 0xae426082);
  const png = await png1bit(10, 2, (x, y) => x === y);
  assertEquals([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(png.buffer);
  assertEquals(new TextDecoder().decode(png.subarray(12, 16)), "IHDR");
  assertEquals([v.getUint32(16), v.getUint32(20), png[24], png[25]], [10, 2, 1, 0]);
  // Recorre los bloques comprobando CRC y descomprime IDAT.
  let i = 8, idat = new Uint8Array();
  while (i < png.length) {
    const n = v.getUint32(i);
    const tipo = new TextDecoder().decode(png.subarray(i + 4, i + 8));
    assertEquals(v.getUint32(i + 8 + n), crc32(png.subarray(i + 4, i + 8 + n)), `CRC de ${tipo}`);
    if (tipo === "IDAT") idat = png.slice(i + 8, i + 8 + n);
    i += 12 + n;
  }
  const crudo = new Uint8Array(await new Response(new Blob([idat]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  // fila: filtro + 2 bytes; negro = 0
  assertEquals([...crudo], [0, 0b01111111, 0b11000000, 0, 0b10111111, 0b11000000]);
  const prueba57 = await pngPrueba(57, 32);
  assertEquals([new DataView(prueba57.buffer).getUint32(16), new DataView(prueba57.buffer).getUint32(20)], [673, 378]);
});

Deno.test("archivos: texto UTF-8/UTF-16 y trabajo a medias en disco", () => {
  assertEquals(decodificar(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), "a");
  assertEquals(decodificar(new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0xf1, 0x00])), "añ");
  const fs = fsMemoria();
  const e = enCursoEn("dir", fs);
  assertEquals(e.leer(), null);
  e.guardar({ id: "x", hechas: 3 });
  assertEquals(e.leer(), { id: "x", hechas: 3 });
  e.borrar();
  e.borrar();
  assertEquals(e.leer(), null);
  fs.escribir(`dir/estacion-dymo.estado.json`, new TextEncoder().encode("roto"));
  assertEquals(e.leer(), null);
  assertEquals(fs.archivos.size, 0);
  assertEquals(plantillaEn("dir", fs)("11354"), null);
  fs.escribir(`dir/plantilla-11354.label`, new Uint8Array([0xff, 0xfe, ..."<D/>".split("").flatMap((c) => [c.charCodeAt(0), 0])]));
  assertEquals(plantillaEn("dir", fs)("11354"), "<D/>");
});

Deno.test("--prueba: registra impresoras y consumibles e imprime una etiqueta en el rollo puesto", async () => {
  const { s, fetch } = simulador();
  s.rollo = "99012";
  const cfg = validarConfig(JSON.stringify({ url: URL_API, clave: CLAVE }));
  const lineas: string[] = [];
  const ok = await prueba(cfg, new ApiEstacion(fetch, cfg.url, cfg.clave), new ClienteDymo(fetch), (m) => lineas.push(m), () => null);
  assert(ok);
  assertEquals(s.ciclos.map((c) => c.pedir), [false]);
  assertEquals(s.impresiones.length, 1);
  assertStringIncludes(s.impresiones[0].labelXml, "<PaperName>99012 Large Address</PaperName>");
  const todo = lineas.join("\n");
  assertStringIncludes(todo, "<LabelWriterPrinter>");
  assertStringIncludes(todo, 'GetConsumableInfoIn550Printer: HTTP 200: {"sku":"11354"}');
  assert(!todo.includes(CLAVE) && !todo.includes("iVBOR"));

  s.dymoVivo = false;
  assertEquals(await prueba(cfg, new ApiEstacion(fetch, cfg.url, "mala"), new ClienteDymo(fetch), (m) => lineas.push(m), () => null), false);
  assertStringIncludes(lineas.at(-1)!, "clave de la estación no es válida");
});

Deno.test("certificados: exporta los de Windows a certificados.pem; si falla, deja los guardados", async () => {
  const fs = fsMemoria();
  const PEM = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----";
  const log: string[] = [];
  const n = await exportarCertificados("C:\\e", (m) => log.push(m), () => Promise.resolve({ ok: true, salida: `${PEM}\r\n${PEM}\r\n` }), fs);
  assertEquals(n, 2);
  assertEquals(bloquesPem(fs.texto(unir("C:\\e", "certificados.pem"))).length, 2);
  const m = await exportarCertificados("C:\\e", (x) => log.push(x), () => Promise.resolve({ ok: false, salida: "" }), fs);
  assertEquals(m, 2);
  assertEquals(log.length, 1);
  const sinPs = await exportarCertificados("C:\\otra", () => {}, () => Promise.reject(new Error("no existe")), fs);
  assertEquals(sinPs, 0);
});

Deno.test("mensaje: incluye la causa de 'fetch failed' y explica el certificado no reconocido", () => {
  const e = new TypeError("fetch failed", { cause: new Error("client error (Connect): invalid peer certificate: UnknownIssuer") });
  assertStringIncludes(mensaje(e), "certificado no reconocido");
  const r = new TypeError("fetch failed", { cause: new Error("dns error: no such host") });
  assertEquals(mensaje(r), "fetch failed: dns error: no such host");
});
