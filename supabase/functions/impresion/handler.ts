// Cola de impresión de etiquetas: los portátiles mandan trabajos (Muestras: editar) y la estación del ordenador fijo
// (estacion-dymo.exe, con su clave) los toma, informa del progreso y del resultado.
// Diseño: docs/superpowers/specs/2026-11-10-impresion-remota-dymo-design.md (sección "Cambios tras la revisión").
// Lógica pura con dependencias inyectadas; index.ts pone las reales (Supabase) y handler_test.ts las simuladas.

import { corsHeaders, preflight } from "../_shared/cors.ts";
import { type Acceso, rolDe } from "../_shared/permisos.ts";

export const ROLLOS = ["99012", "99010", "11354", "11352"] as const;
export type Rollo = typeof ROLLOS[number];
export type EstadoTrabajo = "pendiente" | "imprimiendo" | "impreso" | "error";

export interface Etiqueta {
  codigo: string;
  png: string; // base64, sin prefijo data:
}
export interface Trabajo {
  id: string;
  creado: string;
  por: string;
  nombre: string;
  rollo: Rollo;
  etiquetas: Etiqueta[];
  unidades: string[]; // claves de unidad de Muestras ("<id recepción>:<n>") que se marcan al imprimirse
  n: number;
  hechas: number;
  estado: EstadoTrabajo;
  error: string | null;
  actualizado: string;
}
export type Resumen = Omit<Trabajo, "etiquetas"> & { codigos: string[] };
export type NuevoTrabajo = Pick<Trabajo, "id" | "por" | "nombre" | "rollo" | "etiquetas" | "unidades" | "n">;
export interface Estacion {
  token_hash: string | null;
  rollo: Rollo;
  visto: string | null;
  estado: { dymo?: boolean; conectada?: boolean; impresora?: string; error?: string } | null;
  purgado: string | null;
}

export interface ImpresionDeps {
  usuario(jwt: string): Promise<{ email: string } | null>;
  acceso(email: string): Promise<Acceso | null>;
  estacion(): Promise<Estacion>;
  guardarEstacion(cambios: Partial<Estacion>): Promise<void>;
  /** Inserta el trabajo; si ya existe uno con ese id, no hace nada. Devuelve el que queda guardado. */
  crearTrabajo(t: NuevoTrabajo): Promise<Trabajo>;
  trabajo(id: string): Promise<Resumen | null>;
  ultimosDe(email: string, n: number): Promise<Resumen[]>;
  /** Toma el pendiente más antiguo y lo pasa a "imprimiendo" en una sola operación (nadie más puede tomarlo). */
  tomarSiguiente(): Promise<Trabajo | null>;
  /** Cambia estado (y opcionalmente hechas/error) solo si el trabajo está en uno de `desde`; devuelve si cambió.
   *  Siempre pone `actualizado` a ahora. */
  actualizar(id: string, desde: EstadoTrabajo[], cambios: Partial<Pick<Trabajo, "estado" | "hechas" | "error">>): Promise<boolean>;
  /** "imprimiendo" sin progreso desde antes de `antes` → error "Interrumpido". */
  interrumpir(antes: Date): Promise<void>;
  purgar(antes: Date): Promise<void>;
  ahora(): Date;
  clave(): string;
}

const CONECTADA_MS = 30_000;
const INTERRUMPIDO_MS = 3 * 60_000;
const RETENCION_MS = 30 * 24 * 3600_000;
const PURGA_MS = 3600_000;
const MAX_ETIQUETAS = 100;
const MAX_PNG = 60 * 1024; // bytes de cada imagen
const MAX_TOTAL = 3 * 1024 * 1024; // bytes de todas las imágenes de un envío
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PNG_FIRMA = "iVBORw0KGgo"; // base64 de 89 50 4E 47 0D 0A 1A 0A
const UNIDAD = /^[A-Za-z0-9_-]{1,80}:\d{1,4}$/;

type Responder = (status: number, body?: unknown) => Response;

export async function sha256(texto: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Comparación sin salir antes de tiempo (mismo coste para cualquier valor de igual longitud).
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const bytesBase64 = (s: string) => Math.floor(s.length * 3 / 4) - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0);
const esRollo = (v: unknown): v is Rollo => typeof v === "string" && (ROLLOS as readonly string[]).includes(v);
const texto = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export function crearHandlerImpresion(deps: ImpresionDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const cors = new Headers(corsHeaders(req.headers.get("origin")));
    // El CORS compartido solo anuncia GET/PUT; los portátiles también hacen POST.
    cors.set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    if (preflight(req)) return new Response(null, { status: 204, headers: cors });
    const responder: Responder = (status, body) => {
      const headers = new Headers(cors);
      if (body === undefined) return new Response(null, { status, headers });
      headers.set("content-type", "application/json; charset=utf-8");
      return new Response(JSON.stringify(body), { status, headers });
    };
    try {
      return await atender(req, deps, responder);
    } catch (e) {
      console.error("impresion:", e);
      return responder(502, { message: "Error al contactar con el servicio", code: "service" });
    }
  };
}

async function leerJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

async function atender(req: Request, deps: ImpresionDeps, responder: Responder): Promise<Response> {
  const error = (status: number, message: string, code: string, ...args: (string | number)[]) =>
    responder(status, args.length ? { message, code, args } : { message, code });
  const seg = new URL(req.url).pathname.split("/").slice(1);
  if (seg[0] !== "impresion") return error(404, "Not Found", "not_found");
  const ruta = seg.slice(1).join("/");
  const metodo = req.method;

  // ---------- Estación (clave propia, sin sesión de persona) ----------
  if (seg[1] === "estacion") {
    const clave = req.headers.get("x-estacion") ?? "";
    const est = await deps.estacion();
    if (!clave || !est.token_hash || !iguales(await sha256(clave), est.token_hash)) {
      return error(401, "Clave de estación no válida", "bad_station_key");
    }
    const ahora = deps.ahora();
    if (ruta === "estacion/ciclo" && metodo === "POST") {
      const b = await leerJson(req);
      const d = esObjeto(b) && esObjeto(b.dymo) ? b.dymo : {};
      const estado = { dymo: d.ok === true, conectada: d.conectada === true, impresora: texto(d.impresora, 120), error: texto(d.error, 300) };
      const cambios: Partial<Estacion> = { visto: ahora.toISOString(), estado };
      if (!est.purgado || ahora.getTime() - Date.parse(est.purgado) > PURGA_MS) {
        await deps.purgar(new Date(ahora.getTime() - RETENCION_MS));
        cambios.purgado = ahora.toISOString();
      }
      await deps.guardarEstacion(cambios);
      await deps.interrumpir(new Date(ahora.getTime() - INTERRUMPIDO_MS));
      // Solo se entrega trabajo si DYMO responde, la impresora está conectada y la estación lo pide.
      const pide = esObjeto(b) && b.pedir === true && estado.dymo && estado.conectada;
      const trabajo = pide ? await deps.tomarSiguiente() : null;
      return responder(200, { rollo: est.rollo, trabajo });
    }
    if (seg[2] === "trabajos" && seg.length === 4 && metodo === "POST") {
      if (!UUID.test(seg[3])) return error(404, "Not Found", "not_found");
      const b = await leerJson(req);
      if (!esObjeto(b) || typeof b.hechas !== "number" || !Number.isInteger(b.hechas) || b.hechas < 0) {
        return error(400, "Cuerpo no válido", "bad_body");
      }
      if (b.fin !== undefined && b.fin !== "impreso" && b.fin !== "error") return error(400, "Cuerpo no válido", "bad_body");
      const cambios: Partial<Pick<Trabajo, "estado" | "hechas" | "error">> = { hechas: b.hechas };
      if (b.fin === "impreso") Object.assign(cambios, { estado: "impreso", error: null });
      if (b.fin === "error") Object.assign(cambios, { estado: "error", error: texto(b.error, 300).trim() || "Error de impresión" });
      await deps.guardarEstacion({ visto: ahora.toISOString() });
      const ok = await deps.actualizar(seg[3], ["imprimiendo"], cambios);
      return ok ? responder(200, { ok: true }) : error(409, "El trabajo ya no está imprimiéndose", "not_printing");
    }
    return error(404, "Not Found", "not_found");
  }

  // ---------- Personas (sesión de Supabase) ----------
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m) return error(401, "Requires authentication", "auth_required");
  const usuario = await deps.usuario(m[1]);
  if (!usuario?.email) return error(401, "Bad credentials", "bad_credentials");
  const yo = usuario.email.trim().toLowerCase();
  const fila = await deps.acceso(yo);
  if (!fila) return error(403, "No tienes acceso; pídeselo a un administrador", "no_access");

  if (ruta === "admin/clave" && metodo === "POST") {
    if (!fila.admin) return error(403, "Solo para administradores", "admin_only");
    const clave = deps.clave();
    await deps.guardarEstacion({ token_hash: await sha256(clave) });
    return responder(200, { clave });
  }

  if (rolDe(fila, "muestras") !== "editar") return error(403, "No tienes permiso de edición en Muestras", "no_edit");
  const ahora = deps.ahora();

  if (ruta === "estado" && metodo === "GET") {
    const est = await deps.estacion();
    const conectada = !!est.visto && ahora.getTime() - Date.parse(est.visto) < CONECTADA_MS;
    return responder(200, {
      estacion: { configurada: !!est.token_hash, conectada, visto: est.visto, rollo: est.rollo, estado: est.estado ?? {} },
      trabajos: await deps.ultimosDe(yo, 10),
    });
  }

  if (ruta === "rollo" && metodo === "PUT") {
    const b = await leerJson(req);
    if (!esObjeto(b) || !esRollo(b.rollo)) return error(400, "Rollo no válido", "bad_roll");
    await deps.guardarEstacion({ rollo: b.rollo });
    return responder(200, { rollo: b.rollo });
  }

  if (ruta === "trabajos" && metodo === "POST") {
    const b = await leerJson(req);
    if (!esObjeto(b) || typeof b.id !== "string" || !UUID.test(b.id) || !esRollo(b.rollo) || !Array.isArray(b.etiquetas)) {
      return error(400, "Cuerpo no válido", "bad_body");
    }
    const ets = b.etiquetas;
    if (!ets.length || ets.length > MAX_ETIQUETAS) return error(400, `Entre 1 y ${MAX_ETIQUETAS} etiquetas por envío`, "bad_count", MAX_ETIQUETAS);
    const unidades = b.unidades === undefined ? [] : b.unidades;
    if (!Array.isArray(unidades) || unidades.length > MAX_ETIQUETAS || !unidades.every((u) => typeof u === "string" && UNIDAD.test(u))) {
      return error(400, "Cuerpo no válido", "bad_body");
    }
    const etiquetas: Etiqueta[] = [];
    let total = 0;
    for (const e of ets) {
      if (!esObjeto(e) || typeof e.codigo !== "string" || !e.codigo.trim() || typeof e.png !== "string") {
        return error(400, "Etiqueta no válida", "bad_label");
      }
      if (!e.png.startsWith(PNG_FIRMA) || !/^[A-Za-z0-9+/]+=*$/.test(e.png)) return error(400, "Etiqueta no válida", "bad_label");
      const bytes = bytesBase64(e.png);
      if (bytes > MAX_PNG) return error(400, "Etiqueta demasiado grande", "label_too_big");
      total += bytes;
      etiquetas.push({ codigo: e.codigo.trim().slice(0, 40), png: e.png });
    }
    if (total > MAX_TOTAL) return error(400, "Envío demasiado grande", "job_too_big");
    const est = await deps.estacion();
    if (b.rollo !== est.rollo) return error(409, "El rollo puesto en la impresora ha cambiado", "roll_changed", est.rollo);
    const t = await deps.crearTrabajo({ id: b.id.toLowerCase(), por: yo, nombre: fila.nombre, rollo: b.rollo, etiquetas, unidades: unidades as string[], n: etiquetas.length });
    if (t.por !== yo) return error(409, "Ese envío ya existe", "duplicate");
    const { etiquetas: guardadas, ...resumen } = t;
    return responder(201, { ...resumen, codigos: guardadas.map((e) => e.codigo) });
  }

  if (seg[1] === "trabajos" && seg.length === 4 && seg[3] === "reintentar" && metodo === "POST") {
    if (!UUID.test(seg[2])) return error(404, "Not Found", "not_found");
    const t = await deps.trabajo(seg[2]);
    if (!t || (t.por !== yo && !fila.admin)) return error(404, "Not Found", "not_found");
    const ok = await deps.actualizar(seg[2], ["error"], { estado: "pendiente", error: null });
    return ok ? responder(200, { ok: true }) : error(409, "Solo se pueden reintentar los trabajos con error", "not_error");
  }

  return error(404, "Not Found", "not_found");
}
