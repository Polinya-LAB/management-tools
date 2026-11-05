import { assert, assertEquals } from "jsr:@std/assert@1";
import type { Acceso } from "../_shared/permisos.ts";
import { type AdminDeps, crearHandlerAdmin } from "./handler.ts";

const ORIGEN = "https://polinya-lab.github.io";
const BASE = "https://x.supabase.co";

const ADMIN: Acceso = { email: "ana@fluidra.com", nombre: "Ana", roles: {}, admin: true };
const OTRO: Acceso = { email: "luis@fluidra.com", nombre: "Luis", roles: { ensayos: "ver" }, admin: false };

function montar(opts: { filas?: Acceso[]; quien?: string } = {}) {
  const filas = opts.filas ?? [ADMIN, OTRO];
  const log: string[] = [];
  const guardados: (Acceso & { user_id?: string })[] = [];
  const deps: AdminDeps = {
    usuario: (jwt) => Promise.resolve(jwt === "jwt" ? { email: opts.quien ?? "Ana@Fluidra.com" } : null),
    acceso: (email) => Promise.resolve(filas.find((f) => f.email === email) ?? null),
    listar: () => Promise.resolve(filas),
    guardar: (a) => {
      log.push(`guardar:${a.email}`);
      guardados.push(a);
      return Promise.resolve();
    },
    borrar: (e) => {
      log.push(`borrar:${e}`);
      return Promise.resolve();
    },
    crearUsuarioAuth: (e) => {
      log.push(`crear:${e}`);
      return Promise.resolve("uid-1");
    },
    borrarUsuarioAuth: (e) => {
      log.push(`borrarAuth:${e}`);
      return Promise.resolve();
    },
  };
  const h = crearHandlerAdmin(deps);
  const llamar = (method: string, path: string, body?: unknown, jwt: string | null = "jwt") =>
    h(
      new Request(`${BASE}${path}`, {
        method,
        headers: {
          origin: ORIGEN,
          ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  return { llamar, log, guardados };
}

const valido = { email: "nuevo@fluidra.com", nombre: "Nuevo", roles: { piscina: "editar" }, admin: false };

Deno.test("sin token o token inválido: 401 en las tres rutas", async () => {
  const { llamar, log } = montar();
  for (const [m, p] of [["GET", "/admin/usuarios"], ["POST", "/admin/usuarios"], ["DELETE", "/admin/usuarios/a%40b.com"]]) {
    assertEquals((await llamar(m, p, undefined, null)).status, 401);
    assertEquals((await llamar(m, p, undefined, "malo")).status, 401);
  }
  assertEquals(log, []);
});

Deno.test("no administrador o sin fila: 403 en las tres rutas", async () => {
  for (const quien of ["luis@fluidra.com", "nadie@fluidra.com"]) {
    const { llamar, log } = montar({ quien });
    assertEquals((await llamar("GET", "/admin/usuarios")).status, 403);
    assertEquals((await llamar("POST", "/admin/usuarios", valido)).status, 403);
    assertEquals((await llamar("DELETE", "/admin/usuarios/luis%40fluidra.com")).status, 403);
    assertEquals(log, []);
  }
});

Deno.test("GET devuelve la lista ordenada por nombre, con CORS", async () => {
  const { llamar } = montar({
    filas: [
      { ...OTRO, nombre: "Zoe" },
      { ...OTRO, email: "b@x.com", nombre: "álvaro" },
      ADMIN,
    ],
  });
  const res = await llamar("GET", "/admin/usuarios");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGEN);
  const { usuarios } = await res.json();
  assertEquals(usuarios.map((u: Acceso) => u.nombre), ["álvaro", "Ana", "Zoe"]);
});

Deno.test("POST normaliza el correo y crea el usuario de Auth solo si no existía la fila", async () => {
  const { llamar, log, guardados } = montar();
  const res = await llamar("POST", "/admin/usuarios", { ...valido, email: "  Nuevo@Fluidra.COM ", nombre: " Nuevo " });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals(log, ["crear:nuevo@fluidra.com", "guardar:nuevo@fluidra.com"]);
  assertEquals(guardados[0], {
    email: "nuevo@fluidra.com",
    nombre: "Nuevo",
    roles: { piscina: "editar" },
    admin: false,
    user_id: "uid-1",
  });

  const m2 = montar();
  const r2 = await m2.llamar("POST", "/admin/usuarios", { ...OTRO, email: " LUIS@fluidra.com", roles: {} });
  assertEquals(r2.status, 200);
  assertEquals(m2.log, ["guardar:luis@fluidra.com"]);
  assertEquals("user_id" in m2.guardados[0], false);
});

Deno.test("POST: roles inválidos, claves desconocidas o campos mal formados → 400", async () => {
  const malos: unknown[] = [
    { ...valido, roles: { piscina: "admin" } },
    { ...valido, roles: { piscina: "EDITAR" } },
    { ...valido, roles: { inventada: "ver" } },
    { ...valido, roles: ["ver"] },
    { ...valido, roles: "ver" },
    { ...valido, nombre: "   " },
    { ...valido, nombre: 5 },
    { ...valido, email: "sin-arroba" },
    { ...valido, email: "@fluidra.com" },
    { ...valido, email: "ana@" },
    { ...valido, email: "a@b@c.com" },
    { ...valido, email: "a b@c.com" },
    { ...valido, admin: "si" },
    "no es json",
    [],
    null,
  ];
  for (const b of malos) {
    const { llamar, log } = montar();
    assertEquals((await llamar("POST", "/admin/usuarios", b)).status, 400, JSON.stringify(b));
    assertEquals(log, []);
  }
});

Deno.test("POST: roles puede omitir claves", async () => {
  const { llamar, guardados } = montar();
  const { roles: _r, ...sinRoles } = valido;
  assertEquals((await llamar("POST", "/admin/usuarios", sinRoles)).status, 200);
  assertEquals(guardados[0].roles, {});
});

Deno.test("POST: un administrador no puede quitarse a sí mismo el rol", async () => {
  const { llamar, log } = montar();
  const res = await llamar("POST", "/admin/usuarios", { ...ADMIN, email: "ANA@fluidra.com", admin: false });
  assertEquals(res.status, 400);
  assertEquals(log, []);
  assertEquals((await llamar("POST", "/admin/usuarios", { ...ADMIN, nombre: "Ana R." })).status, 200);
});

Deno.test("DELETE de sí mismo → 400 (también con mayúsculas y codificado)", async () => {
  const { llamar, log } = montar();
  assertEquals((await llamar("DELETE", "/admin/usuarios/Ana%40Fluidra.com")).status, 400);
  assertEquals(log, []);
});

Deno.test("DELETE de otro borra el usuario de Auth y la fila", async () => {
  const { llamar, log } = montar();
  const res = await llamar("DELETE", "/admin/usuarios/Luis%40Fluidra.com");
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals(log, ["borrarAuth:luis@fluidra.com", "borrar:luis@fluidra.com"]);
});

Deno.test("DELETE con codificación inválida o sin correo → 400 / 404", async () => {
  const { llamar } = montar();
  assertEquals((await llamar("DELETE", "/admin/usuarios/%E0%A4%A")).status, 400);
  assertEquals((await llamar("DELETE", "/admin/usuarios/")).status, 404);
});

Deno.test("métodos y rutas: 405 y 404, OPTIONS permite POST y DELETE", async () => {
  const { llamar } = montar();
  assertEquals((await llamar("PUT", "/admin/usuarios", valido)).status, 405);
  assertEquals((await llamar("PATCH", "/admin/usuarios", valido)).status, 405);
  assertEquals((await llamar("GET", "/admin/otra")).status, 404);
  assertEquals((await llamar("GET", "/otra/usuarios")).status, 404);
  assertEquals((await llamar("GET", "/admin/usuarios/a%40b.com")).status, 405);
  assertEquals((await llamar("DELETE", "/admin/usuarios")).status, 405);
  const pre = await llamar("OPTIONS", "/admin/usuarios", undefined, null);
  assertEquals(pre.status, 204);
  const metodos = pre.headers.get("access-control-allow-methods") ?? "";
  assert(metodos.includes("POST") && metodos.includes("DELETE"));
});

Deno.test("error inesperado → 502 con CORS", async () => {
  const deps: AdminDeps = {
    usuario: () => Promise.resolve({ email: "ana@fluidra.com" }),
    acceso: () => Promise.reject(new Error("boom")),
    listar: () => Promise.resolve([]),
    guardar: () => Promise.resolve(),
    borrar: () => Promise.resolve(),
    crearUsuarioAuth: () => Promise.resolve("u"),
    borrarUsuarioAuth: () => Promise.resolve(),
  };
  const res = await crearHandlerAdmin(deps)(
    new Request(`${BASE}/admin/usuarios`, { headers: { origin: ORIGEN, authorization: "Bearer jwt" } }),
  );
  assertEquals(res.status, 502);
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGEN);
});
