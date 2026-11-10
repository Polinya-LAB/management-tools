import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { AVISO_NO_CONECTADA, ClienteDymo, escapar, sinPlantillaDcd, xmlDesdePlantillaDcd, leerImpresoras, papelDe, twips, xmlEtiqueta, xmlParametros } from "./dymo.ts";
import { IMPRESORAS, PNG, simulador } from "./simulador_test.ts";

Deno.test("papel de fábrica: medidas en twips por rollo", () => {
  assertEquals(twips(25.4), 1440);
  const casos: [Parameters<typeof papelDe>[0], string, number, number][] = [
    ["11354", "11354 Multi-Purpose", 1814, 3231],
    ["99012", "99012 Large Address", 2041, 5046],
    ["99010", "99010 Standard Address", 1587, 5046],
    ["11352", "11352 Return Address Int", 1417, 3061],
  ];
  for (const [rollo, nombre, corto, largo] of casos) {
    const p = papelDe(rollo);
    assertEquals([p.nombre, p.orientacion, p.ancho, p.alto], [nombre, "Landscape", corto, largo]);
    const xml = xmlEtiqueta(PNG, p);
    assertStringIncludes(xml, `<RoundRectangle X="0" Y="0" Width="${corto}" Height="${largo}" Rx="270" Ry="270"/>`);
    assertStringIncludes(xml, `<Bounds X="0" Y="0" Width="${largo}" Height="${corto}"/>`);
    assertStringIncludes(xml, `<PaperName>${nombre}</PaperName>`);
  }
});

Deno.test("xmlEtiqueta: imagen, giro 180, escapado y base64 no válido", () => {
  const p = papelDe("11354", "Papel <raro> & \"cosas\"");
  const xml = xmlEtiqueta(PNG, p);
  assert(xml.startsWith('<?xml version="1.0" encoding="utf-8"?><DieCutLabel Version="8.0" Units="twips">'));
  assertStringIncludes(xml, "<PaperName>Papel &lt;raro&gt; &amp; &quot;cosas&quot;</PaperName>");
  assertStringIncludes(xml, `<Image>${PNG}</Image>`);
  assertStringIncludes(xml, "<Rotation>Rotation0</Rotation>");
  assertStringIncludes(xml, "<PaperOrientation>Landscape</PaperOrientation>");
  assertStringIncludes(xmlEtiqueta(PNG, p, true), "<Rotation>Rotation180</Rotation>");
  assertThrows(() => xmlEtiqueta("<x>", p));
  assertEquals(escapar(`a&b<c>"d'`), "a&amp;b&lt;c&gt;&quot;d&apos;");
  assertEquals(
    xmlParametros("QTS-M<1>"),
    "<LabelWriterPrintParams><Copies>1</Copies><JobTitle>QTS-M&lt;1&gt;</JobTitle><PrintQuality>BarcodeAndGraphics</PrintQuality></LabelWriterPrintParams>",
  );
});

Deno.test("plantilla-<rollo>.label manda sobre el json y los valores de fábrica", () => {
  const plantilla = `<?xml version="1.0" encoding="utf-8"?>
<DieCutLabel Version="8.0" Units="twips">
  <PaperOrientation>Landscape</PaperOrientation>
  <Id>Multi &amp; Purpose</Id>
  <PaperName>11354 Multi-Purpose 57mm</PaperName>
  <DrawCommands>
    <RoundRectangle X="0" Y="0" Width="1871" Height="3255" Rx="270" Ry="270" />
  </DrawCommands>
</DieCutLabel>`;
  const p = papelDe("11354", "del json", plantilla);
  assertEquals(p, { nombre: "11354 Multi-Purpose 57mm", id: "Multi & Purpose", orientacion: "Landscape", ancho: 1871, alto: 3255 });
  const xml = xmlEtiqueta(PNG, p);
  assertStringIncludes(xml, "<Id>Multi &amp; Purpose</Id>");
  assertStringIncludes(xml, `<Bounds X="0" Y="0" Width="3255" Height="1871"/>`);
  // Vertical: la imagen apaisada se gira 90° (270° con girar180).
  const vertical = papelDe("11354", undefined, plantilla.replace("Landscape", "Portrait"));
  assertStringIncludes(xmlEtiqueta(PNG, vertical), "<Rotation>Rotation90</Rotation>");
  assertStringIncludes(xmlEtiqueta(PNG, vertical, true), "<Rotation>Rotation270</Rotation>");
  assertStringIncludes(xmlEtiqueta(PNG, vertical), `<Bounds X="0" Y="0" Width="1871" Height="3255"/>`);
  // El json solo cambia el nombre del papel.
  assertEquals(papelDe("99012", "Otro").nombre, "Otro");
  assertEquals(papelDe("99012", "Otro").alto, 5046);
  // Formato nuevo de DYMO Connect: no vale.
  assertThrows(() => papelDe("11354", undefined, `<DesktopLabel Version="1"></DesktopLabel>`), Error, "formato clásico");
});

Deno.test("GetPrinters: XML directo y como cadena JSON", () => {
  const esperado = [{ nombre: "DYMO LabelWriter 550", modelo: "DYMO LabelWriter 550", conectada: true, local: true }];
  assertEquals(leerImpresoras(IMPRESORAS), esperado);
  assertEquals(leerImpresoras(JSON.stringify(IMPRESORAS)), esperado);
  const dos = `<Printers><LabelWriterPrinter><Name>A &amp; B</Name><ModelName>LW 450</ModelName><IsConnected>False</IsConnected>` +
    `<IsLocal>True</IsLocal></LabelWriterPrinter>\n<LabelWriterPrinter><Name>C</Name><ModelName>LW 550</ModelName>` +
    `<IsConnected>True</IsConnected><IsLocal>False</IsLocal></LabelWriterPrinter></Printers>`;
  assertEquals(leerImpresoras(dos).map((p) => [p.nombre, p.conectada]), [["A & B", false], ["C", true]]);
  assertEquals(leerImpresoras("<Printers />"), []);
});

Deno.test("busca el servicio en 41951-41960 de 127.0.0.1 y luego en localhost; recuerda el puerto", async () => {
  const { s, fetch } = simulador();
  s.dymoHost = "localhost";
  s.dymoPuerto = 41954;
  const c = new ClienteDymo(fetch);
  assertEquals(await c.buscar(), "https://localhost:41954");
  const probados = s.pedidasDymo.filter((p) => p.endsWith("/StatusConnected")).map((p) => p.split("/")[0]);
  assertEquals(probados.slice(0, 10), Array.from({ length: 10 }, (_, i) => `127.0.0.1:${41951 + i}`));
  assert(probados.includes("localhost:41954"));
  s.pedidasDymo.length = 0;
  assertEquals(await c.buscar(), "https://localhost:41954");
  assertEquals(s.pedidasDymo, ["localhost:41954/StatusConnected"]);
  // Si deja de responder ahí, vuelve a buscar.
  s.dymoHost = "127.0.0.1";
  s.dymoPuerto = 41952;
  assertEquals(await c.buscar(), "https://127.0.0.1:41952");
  s.dymoVivo = false;
  assertEquals(await c.buscar(), null);
});

Deno.test("estado: impresora configurada, primera conectada, sin servicio", async () => {
  const { s, fetch } = simulador();
  assertEquals(await new ClienteDymo(fetch).estado(), { ok: true, conectada: true, impresora: "DYMO LabelWriter 550", error: "" });
  assertEquals((await new ClienteDymo(fetch, "dymo labelwriter 550").estado()).conectada, true);
  const otra = await new ClienteDymo(fetch, "Otra").estado();
  assertEquals([otra.ok, otra.conectada], [true, false]);
  assertStringIncludes(otra.error, "Otra");
  s.impresoras = JSON.stringify(IMPRESORAS.replace("<IsConnected>True", "<IsConnected>False"));
  // La 550 puede decir IsConnected=False funcionando: se intenta igualmente, con aviso.
  assertEquals(await new ClienteDymo(fetch).estado(), { ok: true, conectada: true, impresora: "DYMO LabelWriter 550", error: AVISO_NO_CONECTADA });
  s.dymoVivo = false;
  assertEquals((await new ClienteDymo(fetch).estado()).ok, false);
});

Deno.test("PrintLabel: formulario y errores con el texto de DYMO", async () => {
  const { s, fetch } = simulador();
  const c = new ClienteDymo(fetch);
  await c.imprimir("DYMO LabelWriter 550", "<label/>", "<params/>");
  assertEquals(s.impresiones, [{ printerName: "DYMO LabelWriter 550", labelXml: "<label/>", printParamsXml: "<params/>" }]);
  s.fallaImprimir = () => ({ status: 500, texto: JSON.stringify("Printer is offline") });
  await assertRejects(() => c.imprimir("X", "<label/>", "<p/>"), Error, "DYMO (HTTP 500): Printer is offline");
});

Deno.test("plantilla de DYMO Connect: cambia solo la imagen (Data) y, con girar180, su giro", () => {
  const p = `﻿<?xml version="1.0" encoding="utf-8"?><DesktopLabel Version="1"><DYMOLabel Version="3"><LabelName>X</LabelName>` +
    `<DynamicLayoutManager><LabelObjects><ImageObject><Name>IImageObject0</Name><Rotation>Rotation0</Rotation>` +
    `<Data>VIEJA==</Data><ScaleMode>Uniform</ScaleMode></ImageObject></LabelObjects></DynamicLayoutManager></DYMOLabel></DesktopLabel>`;
  const x = xmlDesdePlantillaDcd(p, "iVBORw0KGgo=");
  assertStringIncludes(x, "<Data>iVBORw0KGgo=</Data>");
  assertEquals(x.includes("VIEJA"), false);
  assertEquals(x.startsWith("<?xml"), true);
  assertStringIncludes(xmlDesdePlantillaDcd(p, "AAAA", true), "<Rotation>Rotation180</Rotation>");
  assertStringIncludes(xmlDesdePlantillaDcd(p.replace("<Data>VIEJA==</Data>", "<Data />"), "AAAA"), "<Data>AAAA</Data>");
  assertThrows(() => xmlDesdePlantillaDcd(p.replace(/<ImageObject>[\s\S]*<\/ImageObject>/, ""), "AAAA"), Error, "ninguna imagen");
  assertThrows(() => xmlDesdePlantillaDcd("<DieCutLabel/>", "AAAA"), Error, "DYMO Connect");
  assertStringIncludes(sinPlantillaDcd("11354", new Error("Invalid label file: The 'DieCutLabel' element is not declared.")), "plantilla-11354.dymo");
});
