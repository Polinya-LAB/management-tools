// Función `admin`: alta, cambio y baja de personas (tabla `acceso` + usuarios de Supabase Auth) y su contraseña.
// Solo para filas con `admin = true`. Sin red aquí: todo pasa por `AdminDeps`.
// Las contraseñas solo pasan a Supabase Auth: nunca se guardan en `acceso`, ni se devuelven, ni se escriben en el log.

import { type Acceso, type ClaveRol, PERMISOS, type Rol } from "../_shared/permisos.ts";
import { corsHeaders, preflight } from "../_shared/cors.ts";

export interface AdminDeps {
  usuario(jwt: string): Promise<{ email: string } | null>;
  acceso(email: string): Promise<Acceso | null>;
  listar(): Promise<Acceso[]>;
  // `user_id` solo viene cuando se acaba de crear el usuario de Auth.
  guardar(a: Acceso & { user_id?: string }): Promise<void>;
  borrar(email: string): Promise<void>;
  // Idempotente: si el usuario de Auth ya existe, devuelve su id y le pone `password`.
  crearUsuarioAuth(email: string, password: string): Promise<string>;
  borrarUsuarioAuth(email: string): Promise<void>;
  // false si la persona no tiene usuario de Auth.
  ponerPassword(email: string, password: string): Promise<boolean>;
}

export const MIN_PASSWORD = 12;
// bcrypt (Supabase Auth) solo usa los primeros 72 bytes.
const MAX_PASSWORD_BYTES = 72;

// Error para la página: `message` en español (lo que se mostraba siempre) y `code` + `args` para que la página
// lo traduzca al idioma elegido (acceso/index.html).
export type Fallo = { motivo: string; code: string; args?: (string | number)[] };
const fallo = (motivo: string, code: string, ...args: (string | number)[]): Fallo =>
  args.length ? { motivo, code, args } : { motivo, code };

// Motivo si no vale; null si vale. No recorta: los espacios forman parte de la contraseña.
function motivoPassword(p: unknown): Fallo | null {
  if (typeof p !== "string" || p.length < MIN_PASSWORD) {
    return fallo(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`, "password_short", MIN_PASSWORD);
  }
  if (new TextEncoder().encode(p).length > MAX_PASSWORD_BYTES) {
    return fallo(`La contraseña no puede pasar de ${MAX_PASSWORD_BYTES} bytes`, "password_long", MAX_PASSWORD_BYTES);
  }
  return null;
}

const CLAVES_ROL = new Set<string>(Object.values(PERMISOS).map((p) => p.rol));
const VALORES_ROL = new Set<string>(["ninguno", "ver", "editar"]);

type Responder = (status: number, body?: unknown) => Response;

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const normalizarEmail = (s: string) => s.trim().toLowerCase();

// Exactamente una "@" con texto a ambos lados y sin espacios.
const pareceCorreo = (s: string) => /^[^@\s]+@[^@\s]+$/.test(s);

// Valida y normaliza el cuerpo del POST; devuelve el motivo si no vale.
function validar(cuerpo: unknown): { ok: true; acceso: Acceso } | ({ ok: false } & Fallo) {
  const no = (f: Fallo) => ({ ok: false as const, ...f });
  if (!esObjeto(cuerpo)) return no(fallo("Cuerpo no válido", "bad_body"));
  if (typeof cuerpo.email !== "string") return no(fallo("Correo no válido", "bad_email"));
  const email = normalizarEmail(cuerpo.email);
  if (!pareceCorreo(email)) return no(fallo("Correo no válido", "bad_email"));
  if (typeof cuerpo.nombre !== "string" || !cuerpo.nombre.trim()) {
    return no(fallo("El nombre es obligatorio", "name_required"));
  }
  if (typeof cuerpo.admin !== "boolean") return no(fallo("admin debe ser verdadero o falso", "bad_admin"));
  const roles: Acceso["roles"] = {};
  if (cuerpo.roles !== undefined) {
    if (!esObjeto(cuerpo.roles)) return no(fallo("roles no válido", "bad_roles"));
    for (const [k, v] of Object.entries(cuerpo.roles)) {
      if (!CLAVES_ROL.has(k)) return no(fallo(`Rol desconocido: ${k}`, "unknown_role", k));
      if (typeof v !== "string" || !VALORES_ROL.has(v)) return no(fallo(`Valor no válido para ${k}`, "bad_role_value", k));
      roles[k as ClaveRol] = v as Rol;
    }
  }
  return { ok: true, acceso: { email, nombre: cuerpo.nombre.trim(), roles, admin: cuerpo.admin } };
}

// Correo de un segmento de la ruta (codificado), normalizado; null si no vale.
function correoDe(segmento: string): string | null {
  let email: string;
  try {
    email = normalizarEmail(decodeURIComponent(segmento));
  } catch {
    return null;
  }
  return pareceCorreo(email) ? email : null;
}

export function crearHandlerAdmin(deps: AdminDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin");
    // El CORS compartido solo anuncia GET/PUT; aquí hacen falta POST y DELETE.
    const cors = new Headers(corsHeaders(origin));
    cors.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
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
      console.error("admin:", e);
      return responder(502, { message: "Error al contactar con el servicio", code: "service" });
    }
  };
}

async function atender(req: Request, deps: AdminDeps, responder: Responder): Promise<Response> {
  const error = (status: number, message: string, code: string) => responder(status, { message, code });
  const errorDe = (status: number, f: Fallo) => responder(status, { message: f.motivo, code: f.code, ...(f.args ? { args: f.args } : {}) });
  const seg = new URL(req.url).pathname.split("/").slice(1);
  if (seg[0] !== "admin" || seg[1] !== "usuarios" || seg.length > 4) return error(404, "Not Found", "not_found");
  if (seg.length === 4 && (seg[3] !== "password" || !seg[2])) return error(404, "Not Found", "not_found");
  const objetivo = seg[2]; // correo codificado: DELETE /usuarios/<correo> y POST /usuarios/<correo>/password
  const esColeccion = seg.length === 2;
  const esPassword = seg.length === 4;

  const metodo = req.method;
  if (metodo !== "GET" && metodo !== "POST" && metodo !== "DELETE") return error(405, "Método no permitido", "method");
  if (esPassword && metodo !== "POST") return error(405, "Método no permitido", "method");

  // Sesión
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m) return error(401, "Requires authentication", "auth_required");
  const usuario = await deps.usuario(m[1]);
  if (!usuario?.email) return error(401, "Bad credentials", "bad_credentials");
  const yo = normalizarEmail(usuario.email);
  const fila = await deps.acceso(yo);
  if (!fila?.admin) return error(403, "Solo para administradores", "admin_only");

  if (esColeccion && metodo === "GET") {
    const lista = [...await deps.listar()].sort((a, b) =>
      a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" })
    );
    return responder(200, { usuarios: lista });
  }

  if (esColeccion && metodo === "POST") {
    let cuerpo: unknown;
    try {
      cuerpo = await req.json();
    } catch {
      return error(400, "JSON no válido", "bad_json");
    }
    const v = validar(cuerpo);
    if (!v.ok) return errorDe(400, v);
    const a = v.acceso;
    const password = (cuerpo as Record<string, unknown>).password;
    if (password !== undefined) {
      const motivo = motivoPassword(password);
      if (motivo) return errorDe(400, motivo);
    }
    if (a.email === yo && !a.admin) return error(400, "No puedes quitarte el rol de administrador", "self_unadmin");
    const existente = await deps.acceso(a.email);
    if (existente) {
      // Un solo camino para cambiar la contraseña: POST /usuarios/<correo>/password.
      if (password !== undefined) return error(400, "Usa Nueva contraseña para cambiarla", "use_new_password");
      await deps.guardar(a);
    } else {
      if (password === undefined) return errorDe(400, motivoPassword(undefined)!);
      const user_id = await deps.crearUsuarioAuth(a.email, password as string);
      await deps.guardar({ ...a, user_id });
    }
    return responder(200, { ok: true });
  }

  if (esPassword && metodo === "POST") {
    const email = correoDe(objetivo);
    if (email === null) return error(400, "Correo no válido", "bad_email");
    let cuerpo: unknown;
    try {
      cuerpo = await req.json();
    } catch {
      return error(400, "JSON no válido", "bad_json");
    }
    if (!esObjeto(cuerpo)) return error(400, "Cuerpo no válido", "bad_body");
    const motivo = motivoPassword(cuerpo.password);
    if (motivo) return errorDe(400, motivo);
    if (!await deps.acceso(email)) return error(404, "Esa persona no está dada de alta", "not_registered");
    if (!await deps.ponerPassword(email, cuerpo.password as string)) {
      return error(409, "Esa persona no tiene usuario de acceso; dala de baja y vuelve a darla de alta", "no_auth_user");
    }
    return responder(200, { ok: true });
  }

  if (!esColeccion && metodo === "DELETE") {
    if (!objetivo) return error(404, "Not Found", "not_found");
    const email = correoDe(objetivo);
    if (email === null) return error(400, "Correo no válido", "bad_email");
    if (email === yo) return error(400, "No puedes borrarte a ti mismo", "self_delete");
    // Primero Auth: necesita el user_id guardado en la fila, que `borrar` elimina.
    await deps.borrarUsuarioAuth(email);
    await deps.borrar(email);
    return responder(200, { ok: true });
  }

  return error(405, "Método no permitido", "method");
}
