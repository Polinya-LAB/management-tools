// Función `github`: imita las rutas de la API de GitHub que usan las apps, comprueba la sesión de Supabase y el rol
// de la persona en la app, y reenvía a GitHub con la clave del servidor. Sin red aquí: todo pasa por `Deps`.

import {
  type Acceso,
  type AppId,
  comprobarEscritura,
  PERMISOS,
  puedeLeer,
  type Rol,
  rolDe,
} from "../_shared/permisos.ts";
import { corsHeaders, preflight } from "../_shared/cors.ts";

export interface Deps {
  usuario(jwt: string): Promise<{ email: string } | null>;
  acceso(email: string): Promise<Acceso | null>;
  // Llama a `https://api.github.com${path}` con GITHUB_TOKEN.
  gh(path: string, init?: RequestInit): Promise<Response>;
}

const OWNER = "Polinya-LAB";
const RAMA = "main";
const ROLES_VALIDOS = new Set<Rol>(["ver", "editar"]);
const CLAVES_ROL = new Set<string>(Object.values(PERMISOS).map((p) => p.rol));

type Responder = (status: number, body?: unknown, extra?: Record<string, string>) => Response;

function b64aTexto(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function jsonDeB64(b64: unknown): { ok: true; valor: unknown } | { ok: false } {
  if (typeof b64 !== "string") return { ok: false };
  try {
    return { ok: true, valor: JSON.parse(b64aTexto(b64)) };
  } catch {
    return { ok: false };
  }
}

// Solo valores conocidos; cualquier otro cuenta como `ninguno`.
function normalizar(a: Acceso): Acceso {
  const roles: Acceso["roles"] = {};
  if (a.roles && typeof a.roles === "object") {
    for (const [k, v] of Object.entries(a.roles)) {
      if (CLAVES_ROL.has(k) && ROLES_VALIDOS.has(v as Rol)) roles[k as keyof Acceso["roles"]] = v;
    }
  }
  return { email: String(a.email).trim().toLowerCase(), nombre: String(a.nombre), roles, admin: a.admin === true };
}

// Repos que lee una app, sacados de su lista "Puede leer".
function reposDe(app: AppId): Set<string> {
  return new Set(PERMISOS[app].leer.map((r) => r.split("/")[0]));
}

export function crearHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const pre = preflight(req);
    if (pre) return pre;
    const cors = corsHeaders(req.headers.get("origin"));
    const responder: Responder = (status, body, extra = {}) => {
      const headers = new Headers(cors);
      for (const [k, v] of Object.entries(extra)) headers.set(k, v);
      if (body === undefined) return new Response(null, { status, headers });
      headers.set("content-type", "application/json; charset=utf-8");
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
    };
    const error = (status: number, message: string) => responder(status, { message });
    try {
      return await atender(req, deps, responder, error);
    } catch (e) {
      console.error("github:", e);
      return error(502, "Error al contactar con el servicio");
    }
  };
}

async function atender(
  req: Request,
  deps: Deps,
  responder: Responder,
  error: (status: number, message: string) => Response,
): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Rutas literales: nada codificado (%2F, %2e...), sin barras invertidas, sin segmentos vacíos, "." ni "..".
  const seg = pathname.split("/").slice(1);
  if (seg[0] !== "github") return error(404, "Not Found");
  const app = seg[1];
  if (!app || !Object.hasOwn(PERMISOS, app)) return error(404, "App desconocida");
  const resto = seg.slice(2);
  const rutaRara = /[%\\]/.test(pathname) || resto.some((s) => s === "" || s === "." || s === "..");

  // Sesión
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m) return error(401, "Requires authentication");
  const usuario = await deps.usuario(m[1]);
  if (!usuario?.email) return error(401, "Bad credentials");
  const fila = await deps.acceso(usuario.email.trim().toLowerCase());
  if (!fila) return error(403, "No tienes acceso; pídeselo a un administrador");
  const acceso = normalizar(fila);
  const appId = app as AppId;

  if (rutaRara) return error(403, "Ruta no permitida");

  // GET /user
  if (resto.length === 1 && resto[0] === "user") {
    if (req.method !== "GET") return error(403, "Ruta no permitida");
    return responder(200, { login: acceso.nombre, name: acceso.nombre, email: acceso.email });
  }

  if (resto[0] !== "repos" || resto[1] !== OWNER || !resto[2]) return error(403, "Ruta no permitida");
  const repo = resto[2];
  if (!reposDe(appId).has(repo)) return error(403, "Repositorio no permitido");
  const rol = rolDe(acceso, appId);

  // GET /repos/{owner}/{repo}
  if (resto.length === 3) {
    if (req.method !== "GET") return error(403, "Ruta no permitida");
    if (rol === "ninguno") return error(403, "No tienes acceso a esta app");
    return responder(200, {
      name: repo,
      full_name: `${OWNER}/${repo}`,
      private: true,
      default_branch: RAMA,
      permissions: { pull: true, push: rol === "editar" },
    });
  }

  if (resto[3] !== "contents" || resto.length < 5) return error(403, "Ruta no permitida");
  const path = resto.slice(4).join("/");
  const ghContents = `/repos/${OWNER}/${repo}/contents/${path}`;

  // Lee el fichero de GitHub; si no trae `content` (más de 1 MB), lo pide como blob.
  const leer = async (ifNoneMatch: string | null) => {
    const headers: Record<string, string> = {};
    if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;
    const res = await deps.gh(`${ghContents}?ref=${RAMA}`, { headers });
    const etag = res.headers.get("etag");
    if (res.status !== 200) return { res, etag, json: null as Record<string, unknown> | null };
    const json = await res.json() as Record<string, unknown>;
    if (!json.content && typeof json.sha === "string" && /^[0-9a-f]+$/i.test(json.sha)) {
      const blob = await deps.gh(`/repos/${OWNER}/${repo}/git/blobs/${json.sha}`);
      if (blob.status !== 200) return { res: blob, etag: null, json: null };
      const bj = await blob.json() as Record<string, unknown>;
      json.content = bj.content;
      json.encoding = "base64";
    }
    return { res, etag, json };
  };

  // Respuesta de error de GitHub tal cual (salvo 401: la clave del servidor falla, no la sesión de la persona).
  const deGitHub = async (res: Response) => {
    const texto = await res.text();
    if (res.status === 401) return error(502, "La clave de GitHub del servidor no es válida");
    return responder(res.status, texto === "" ? undefined : texto);
  };

  // GET /repos/{owner}/{repo}/contents/{path}?ref=main
  if (req.method === "GET") {
    const ref = url.searchParams.get("ref");
    if (ref !== null && ref !== RAMA) return error(403, "Solo la rama main");
    if (rol === "ninguno") return error(403, "No tienes acceso a esta app");
    if (!puedeLeer(acceso, appId, repo, path)) return error(404, "Not Found");
    const { res, etag, json } = await leer(req.headers.get("if-none-match"));
    const extra: Record<string, string> = etag ? { etag } : {};
    if (res.status === 304) {
      await res.body?.cancel();
      return responder(304, undefined, extra);
    }
    if (!json) return deGitHub(res);
    return responder(200, json, extra);
  }

  // PUT /repos/{owner}/{repo}/contents/{path}
  if (req.method === "PUT") {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return error(400, "Problems parsing JSON");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return error(400, "Problems parsing JSON");
    if (body.branch !== undefined && body.branch !== RAMA) return error(403, "Solo la rama main");
    if (typeof body.message !== "string") return error(400, "Falta message");
    if (body.sha !== undefined && typeof body.sha !== "string") return error(400, "sha no válido");
    // Rol y fichero antes de llamar a GitHub (sin contenido no cuenta ninguna colección).
    const previa = comprobarEscritura(acceso, appId, repo, path, null, null);
    if (!previa.ok) return error(403, previa.motivo);
    const despues = jsonDeB64(body.content);
    if (!despues.ok) return error(400, "El contenido no es JSON");

    const actual = await leer(null);
    let antes: unknown = null;
    let shaActual: string | undefined;
    if (actual.json) {
      const a = jsonDeB64(actual.json.content);
      if (!a.ok) return error(400, "El fichero actual no es JSON");
      antes = a.valor;
      shaActual = String(actual.json.sha);
    } else if (actual.res.status !== 404) {
      return deGitHub(actual.res);
    } else {
      await actual.res.body?.cancel();
    }
    // La comprobación se hace contra la versión que se va a sustituir: si la app trae otro sha, que reintente.
    if (body.sha !== shaActual) {
      return error(409, `${path} does not match ${body.sha ?? "(sin sha)"}`);
    }
    const ok = comprobarEscritura(acceso, appId, repo, path, antes, despues.valor);
    if (!ok.ok) return error(403, ok.motivo);

    const persona = { name: acceso.nombre, email: acceso.email };
    const envio: Record<string, unknown> = {
      message: body.message,
      content: body.content,
      branch: RAMA,
      author: persona,
      committer: persona,
    };
    if (shaActual !== undefined) envio.sha = shaActual;
    const res = await deps.gh(ghContents, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envio),
    });
    return deGitHub(res);
  }

  return error(403, "Ruta no permitida");
}
