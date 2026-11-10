// Cliente del servicio local de DYMO Connect ("DYMO Connect Web Service") y XML de etiqueta clásico (DieCutLabel).
// Rutas y puertos tomados de dymo-connect-framework: https://127.0.0.1:41951-41960/DYMO/DLS/Printing/...

import type { Rollo } from "./config.ts";

export type Fetch = typeof fetch;

// ---------- Papel ----------

export interface Papel {
  nombre: string; // PaperName
  id: string;
  orientacion: "Landscape" | "Portrait";
  ancho: number; // twips, RoundRectangle Width (lado corto en las etiquetas de fábrica)
  alto: number; // twips, RoundRectangle Height
}

/** Medidas en mm (largo × corto) y PaperName por defecto. El nombre del papel no está verificado con la 550. */
export const ROLLOS_DYMO: Record<Rollo, { largo: number; corto: number; nombre: string; id: string }> = {
  "11354": { largo: 57, corto: 32, nombre: "11354 Multi-Purpose", id: "MultiPurpose" },
  "99012": { largo: 89, corto: 36, nombre: "99012 Large Address", id: "LargeAddress" },
  "99010": { largo: 89, corto: 28, nombre: "99010 Standard Address", id: "Address" },
  "11352": { largo: 54, corto: 25, nombre: "11352 Return Address Int", id: "ReturnAddressInt" },
};

export const twips = (mm: number) => Math.round(mm / 25.4 * 1440);

const etiqueta = (xml: string, tag: string) => {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return m ? desescapar(m[1].trim()) : undefined;
};

/** Papel de un rollo: plantilla-<rollo>.label (si hay) > «papel» del json > valores de fábrica. */
export function papelDe(rollo: Rollo, nombreConfig?: string, plantilla?: string | null): Papel {
  const r = ROLLOS_DYMO[rollo];
  if (!r) throw new Error(`Rollo desconocido: ${rollo}`);
  if (plantilla) {
    const nombre = etiqueta(plantilla, "PaperName");
    const rect = /<RoundRectangle\b[^>]*>/.exec(plantilla)?.[0] ?? "";
    const attr = (a: string) => Number(new RegExp(`\\b${a}="([\\d.]+)"`).exec(rect)?.[1]);
    const ancho = attr("Width"), alto = attr("Height");
    if (!/<DieCutLabel\b/.test(plantilla) || !nombre || !(ancho > 0) || !(alto > 0)) {
      throw new Error(`plantilla-${rollo}.label no tiene el formato clásico de DYMO (DieCutLabel con PaperName y RoundRectangle)`);
    }
    return {
      nombre,
      id: etiqueta(plantilla, "Id") ?? r.id,
      orientacion: etiqueta(plantilla, "PaperOrientation") === "Portrait" ? "Portrait" : "Landscape",
      ancho: Math.round(ancho),
      alto: Math.round(alto),
    };
  }
  return { nombre: nombreConfig ?? r.nombre, id: r.id, orientacion: "Landscape", ancho: twips(r.corto), alto: twips(r.largo) };
}

// ---------- XML ----------

export function escapar(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
export function desescapar(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** Etiqueta con una sola imagen que ocupa toda la superficie. La imagen llega apaisada (lado largo en horizontal). */
export function xmlEtiqueta(pngBase64: string, papel: Papel, girar180 = false): string {
  if (!/^[A-Za-z0-9+/]+=*$/.test(pngBase64)) throw new Error("Imagen de etiqueta no válida");
  const apaisada = papel.orientacion === "Landscape";
  // En Landscape las coordenadas del objeto ya son apaisadas; en Portrait se gira la imagen 90°.
  const giro = apaisada ? (girar180 ? 180 : 0) : (girar180 ? 270 : 90);
  const [bw, bh] = apaisada ? [Math.max(papel.ancho, papel.alto), Math.min(papel.ancho, papel.alto)] : [papel.ancho, papel.alto];
  return `<?xml version="1.0" encoding="utf-8"?>` +
    `<DieCutLabel Version="8.0" Units="twips">` +
    `<PaperOrientation>${papel.orientacion}</PaperOrientation>` +
    `<Id>${escapar(papel.id)}</Id>` +
    `<PaperName>${escapar(papel.nombre)}</PaperName>` +
    `<DrawCommands><RoundRectangle X="0" Y="0" Width="${papel.ancho}" Height="${papel.alto}" Rx="270" Ry="270"/></DrawCommands>` +
    `<ObjectInfo><ImageObject><Name>IMG</Name>` +
    `<ForeColor Alpha="255" Red="0" Green="0" Blue="0"/><BackColor Alpha="0" Red="255" Green="255" Blue="255"/>` +
    `<LinkedObjectName></LinkedObjectName><Rotation>Rotation${giro}</Rotation><IsMirrored>False</IsMirrored>` +
    `<IsVariable>False</IsVariable><Image>${pngBase64}</Image><ScaleMode>Uniform</ScaleMode><BorderWidth>0</BorderWidth>` +
    `<BorderColor Alpha="255" Red="0" Green="0" Blue="0"/><HorizontalAlignment>Center</HorizontalAlignment>` +
    `<VerticalAlignment>Center</VerticalAlignment></ImageObject>` +
    `<Bounds X="0" Y="0" Width="${bw}" Height="${bh}"/></ObjectInfo></DieCutLabel>`;
}

export function xmlParametros(titulo: string): string {
  return `<LabelWriterPrintParams><Copies>1</Copies><JobTitle>${escapar(titulo)}</JobTitle>` +
    `<PrintQuality>BarcodeAndGraphics</PrintQuality></LabelWriterPrintParams>`;
}

// ---------- Impresoras ----------

export interface Impresora {
  nombre: string;
  modelo: string;
  conectada: boolean;
  local: boolean;
}

/** El servicio a veces devuelve el XML como cadena JSON ("<Printers>…"): se quita esa capa. */
export function textoServicio(t: string): string {
  const s = t.trim();
  if (s.startsWith('"')) {
    try {
      const v = JSON.parse(s);
      if (typeof v === "string") return v;
    } catch { /* se deja tal cual */ }
  }
  return s;
}

export function leerImpresoras(respuesta: string): Impresora[] {
  const xml = textoServicio(respuesta);
  const out: Impresora[] = [];
  for (const m of xml.matchAll(/<LabelWriterPrinter>([\s\S]*?)<\/LabelWriterPrinter>/g)) {
    const campo = (t: string) => etiqueta(m[1], t) ?? "";
    out.push({
      nombre: campo("Name"),
      modelo: campo("ModelName"),
      conectada: campo("IsConnected").toLowerCase() === "true",
      local: campo("IsLocal").toLowerCase() === "true",
    });
  }
  return out;
}

// ---------- Servicio ----------

export interface EstadoDymo {
  ok: boolean; // el servicio responde
  conectada: boolean; // la impresora elegida figura conectada
  impresora: string;
  error: string;
}

export const PUERTOS = Array.from({ length: 10 }, (_, i) => 41951 + i);
const RUTA = "DYMO/DLS/Printing";

export class ClienteDymo {
  base: string | null = null; // p. ej. https://127.0.0.1:41951
  ultimasImpresoras = "";

  constructor(private f: Fetch, private impresora?: string, private espera = { comprobar: 3000, orden: 10_000, imprimir: 60_000 }) {}

  private async pedir(base: string, orden: string, ms: number, init: RequestInit = {}): Promise<Response> {
    return await this.f(`${base}/${RUTA}/${orden}`, { ...init, signal: AbortSignal.timeout(ms) });
  }

  private async responde(base: string): Promise<boolean> {
    try {
      const r = await this.pedir(base, "StatusConnected", this.espera.comprobar);
      return r.ok && textoServicio(await r.text()).toLowerCase() === "true";
    } catch {
      return false;
    }
  }

  /** Busca el servicio: primero donde estaba; si no, 127.0.0.1:41951-41960 y después localhost. */
  async buscar(): Promise<string | null> {
    if (this.base && await this.responde(this.base)) return this.base;
    this.base = null;
    for (const host of ["127.0.0.1", "localhost"]) {
      const bases = PUERTOS.map((p) => `https://${host}:${p}`);
      const vivos = await Promise.all(bases.map((b) => this.responde(b)));
      const i = vivos.indexOf(true);
      if (i >= 0) return (this.base = bases[i]);
    }
    return null;
  }

  async estado(): Promise<EstadoDymo> {
    const base = await this.buscar();
    if (!base) return { ok: false, conectada: false, impresora: "", error: "El servicio de DYMO Connect no responde" };
    let lista: Impresora[];
    try {
      const r = await this.pedir(base, "GetPrinters", this.espera.orden);
      const t = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status} ${textoServicio(t).slice(0, 200)}`);
      this.ultimasImpresoras = textoServicio(t);
      lista = leerImpresoras(t);
    } catch (e) {
      return { ok: true, conectada: false, impresora: "", error: `GetPrinters: ${mensaje(e)}` };
    }
    if (this.impresora) {
      const p = lista.find((x) => x.nombre.toLowerCase() === this.impresora!.toLowerCase());
      if (!p) return { ok: true, conectada: false, impresora: this.impresora, error: `No se encuentra la impresora «${this.impresora}»` };
      return { ok: true, conectada: true, impresora: p.nombre, error: p.conectada ? "" : AVISO_NO_CONECTADA };
    }
    const p = lista.find((x) => x.conectada) ?? lista[0];
    if (!p) return { ok: true, conectada: false, impresora: "", error: "No hay ninguna LabelWriter instalada" };
    return { ok: true, conectada: true, impresora: p.nombre, error: p.conectada ? "" : AVISO_NO_CONECTADA };
  }

  /** Lanza Error con el texto de DYMO si no la acepta. */
  async imprimir(impresora: string, labelXml: string, paramsXml: string): Promise<void> {
    const base = this.base ?? await this.buscar();
    if (!base) throw new Error("El servicio de DYMO Connect no responde");
    const cuerpo = new URLSearchParams({ printerName: impresora, printParamsXml: paramsXml, labelXml, labelSetXml: "" });
    const r = await this.pedir(base, "PrintLabel", this.espera.imprimir, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: cuerpo.toString(),
    });
    const t = textoServicio(await r.text());
    if (!r.ok) throw new Error(`DYMO (HTTP ${r.status}): ${t.slice(0, 250) || "sin detalle"}`);
  }

  async consumibles(impresora: string): Promise<string> {
    const base = this.base ?? await this.buscar();
    if (!base) throw new Error("El servicio de DYMO Connect no responde");
    const r = await this.pedir(base, `GetConsumableInfoIn550Printer?printerName=${encodeURIComponent(impresora)}`, this.espera.orden);
    return `HTTP ${r.status}: ${textoServicio(await r.text())}`;
  }
}

// Algunas versiones de DYMO Connect dicen IsConnected=False de una 550 que imprime bien: se intenta igualmente y,
// si de verdad está apagada o sin etiquetas, el error de PrintLabel queda en el trabajo.
export const AVISO_NO_CONECTADA = "DYMO la marca como no conectada; se intenta imprimir igualmente";

export function mensaje(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  if (e.name === "TimeoutError") return "no responde (tiempo agotado)";
  // fetch solo dice "fetch failed": el motivo real va en la causa.
  const causa = e.cause instanceof Error ? e.cause.message : typeof e.cause === "string" ? e.cause : "";
  if (/UnknownIssuer|certificate/i.test(causa)) return `certificado no reconocido (${causa.slice(0, 400)})`;
  return causa && !e.message.includes(causa) ? `${e.message}: ${causa.slice(0, 200)}` : e.message;
}
