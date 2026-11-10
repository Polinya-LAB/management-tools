import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import type { Acceso } from "../_shared/permisos.ts";
import { type AdminDeps, crearHandlerAdmin } from "./handler.ts";

const ORIGEN = "https://polinya-lab.github.io";
const BASE = "https://x.supabase.co";

const ADMIN: Acceso = { email: "ana@fluidra.com", nombre: "Ana", roles: {}, admin: true };
const OTRO: Acceso = { email: "luis@fluidra.com", nombre: "Luis", roles: { ensayos: "ver" }, admin: false };

function montar(opts: { filas?: Acceso[]; quien?: string; sinAuth?: boolean } = {}) {
  const filas = opts.filas ?? [ADMIN, OTRO];
  const log: string[] = [];
  const claves: string[] = [];
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
    crearUsuarioAuth: (e, pw) => {
      log.push(`crear:${e}`);
      claves.push(pw);
      return Promise.resolve("uid-1");
    },
    borrarUsuarioAuth: (e) => {
      log.push(`borrarAuth:${e}`);
      return Promise.resolve();
    },
    ponerPassword: (e, pw) => {
      log.push(`password:${e}`);
      claves.push(pw);
      return Promise.resolve(opts.sinAuth ? false : true);
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
  return { llamar, log, guardados, claves };
}

const CLAVE = "Kp7wQx3mZr9tVb2n";
const valido = {
  email: "nuevo@fluidra.com",
  nombre: "Nuevo",
  roles: { piscina: "editar" },
  admin: false,
  password: CLAVE,
};

Deno.test("sin token o token inválido: 401 en todas las rutas", async () => {
  const { llamar, log } = montar();
  for (
    const [m, p] of [
      ["GET", "/admin/usuarios"],
      ["POST", "/admin/usuarios"],
      ["DELETE", "/admin/usuarios/a%40b.com"],
      ["POST", "/admin/usuarios/luis%40fluidra.com/password"],
    ]
  ) {
    assertEquals((await llamar(m, p, undefined, null)).status, 401);
    assertEquals((await llamar(m, p, undefined, "malo")).status, 401);
  }
  assertEquals(log, []);
});

Deno.test("no administrador o sin fila: 403 en todas las rutas", async () => {
  for (const quien of ["luis@fluidra.com", "nadie@fluidra.com"]) {
    const { llamar, log } = montar({ quien });
    assertEquals((await llamar("GET", "/admin/usuarios")).status, 403);
    assertEquals((await llamar("POST", "/admin/usuarios", valido)).status, 403);
    assertEquals((await llamar("DELETE", "/admin/usuarios/luis%40fluidra.com")).status, 403);
    assertEquals((await llamar("POST", "/admin/usuarios/luis%40fluidra.com/password", { password: CLAVE })).status, 403);
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
  const { llamar, log, guardados, claves } = montar();
  const res = await llamar("POST", "/admin/usuarios", { ...valido, email: "  Nuevo@Fluidra.COM ", nombre: " Nuevo " });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals(log, ["crear:nuevo@fluidra.com", "guardar:nuevo@fluidra.com"]);
  assertEquals(claves, [CLAVE]);
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

Deno.test("Supabase Auth no responde (usuario lanza) → 502, no 401", async () => {
  const deps: AdminDeps = {
    usuario: () => Promise.reject(new Error("auth.getUser: AuthRetryableFetchError 503")),
    acceso: () => Promise.resolve(null),
    listar: () => Promise.resolve([]),
    guardar: () => Promise.resolve(),
    borrar: () => Promise.resolve(),
    crearUsuarioAuth: () => Promise.resolve("u"),
    borrarUsuarioAuth: () => Promise.resolve(),
    ponerPassword: () => Promise.resolve(true),
  };
  const res = await crearHandlerAdmin(deps)(
    new Request(`${BASE}/admin/usuarios`, { headers: { origin: ORIGEN, authorization: "Bearer jwt" } }),
  );
  assertEquals(res.status, 502);
  await res.body?.cancel();
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
    ponerPassword: () => Promise.resolve(true),
  };
  const res = await crearHandlerAdmin(deps)(
    new Request(`${BASE}/admin/usuarios`, { headers: { origin: ORIGEN, authorization: "Bearer jwt" } }),
  );
  assertEquals(res.status, 502);
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGEN);
});

Deno.test("POST: si guardar falla tras crear el usuario de Auth, el reintento termina con el mismo id", async () => {
  const filas: Acceso[] = [ADMIN];
  const authExistentes = new Map<string, string>();
  let fallar = true;
  const guardados: (Acceso & { user_id?: string })[] = [];
  const deps: AdminDeps = {
    usuario: () => Promise.resolve({ email: "ana@fluidra.com" }),
    acceso: (e) => Promise.resolve(filas.find((f) => f.email === e) ?? null),
    listar: () => Promise.resolve(filas),
    guardar: (a) => {
      if (fallar) return Promise.reject(new Error("db caída"));
      guardados.push(a);
      filas.push(a);
      return Promise.resolve();
    },
    borrar: () => Promise.resolve(),
    // Idempotente, como el real: si ya existe devuelve el mismo id.
    crearUsuarioAuth: (e) => {
      if (!authExistentes.has(e)) authExistentes.set(e, "uid-7");
      return Promise.resolve(authExistentes.get(e)!);
    },
    borrarUsuarioAuth: () => Promise.resolve(),
    ponerPassword: () => Promise.resolve(true),
  };
  const h = crearHandlerAdmin(deps);
  const post = () =>
    h(
      new Request(`${BASE}/admin/usuarios`, {
        method: "POST",
        headers: { origin: ORIGEN, authorization: "Bearer jwt", "content-type": "application/json" },
        body: JSON.stringify(valido),
      }),
    );
  assertEquals((await post()).status, 502);
  fallar = false;
  assertEquals((await post()).status, 200);
  assertEquals(guardados[0].user_id, "uid-7");
});

Deno.test("POST de una persona nueva: la contraseña es obligatoria y de al menos 12 caracteres", async () => {
  const { password: _p, ...sinClave } = valido;
  for (const b of [sinClave, { ...valido, password: "corta-11chr" }, { ...valido, password: 123456789012 }, { ...valido, password: "" }]) {
    const { llamar, log } = montar();
    const res = await llamar("POST", "/admin/usuarios", b);
    assertEquals(res.status, 400, JSON.stringify(b));
    assertMatch((await res.json()).message, /contraseña/i);
    assertEquals(log, []);
  }
  const { llamar, claves } = montar();
  assertEquals((await llamar("POST", "/admin/usuarios", { ...valido, password: "doce-chars12" })).status, 200);
  assertEquals(claves, ["doce-chars12"]);
});

Deno.test("POST: la contraseña no se guarda en acceso ni se devuelve ni se recorta", async () => {
  const { llamar, guardados, claves } = montar();
  const res = await llamar("POST", "/admin/usuarios", { ...valido, password: "  con espacios  " });
  assertEquals(res.status, 200);
  const texto = await res.text();
  assert(!texto.includes("espacios"));
  assertEquals(claves, ["  con espacios  "]);
  assertEquals("password" in guardados[0], false);
  assertEquals(Object.keys(guardados[0]).sort(), ["admin", "email", "nombre", "roles", "user_id"]);
});

Deno.test("POST de una persona que ya existe con contraseña → 400 (se cambia con Nueva contraseña)", async () => {
  const { llamar, log } = montar();
  const res = await llamar("POST", "/admin/usuarios", { ...OTRO, password: CLAVE });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).message, "Usa Nueva contraseña para cambiarla");
  assertEquals(log, []);
});

Deno.test("POST /usuarios/<correo>/password cambia la contraseña de otra persona", async () => {
  const { llamar, log, claves } = montar();
  const res = await llamar("POST", "/admin/usuarios/Luis%40Fluidra.com/password", { password: CLAVE });
  assertEquals(res.status, 200);
  const texto = await res.text();
  assertEquals(JSON.parse(texto), { ok: true });
  assert(!texto.includes(CLAVE));
  assertEquals(log, ["password:luis@fluidra.com"]);
  assertEquals(claves, [CLAVE]);
});

Deno.test("POST /usuarios/<correo>/password: un administrador puede cambiar la suya", async () => {
  const { llamar, log } = montar();
  assertEquals((await llamar("POST", "/admin/usuarios/ana%40fluidra.com/password", { password: CLAVE })).status, 200);
  assertEquals(log, ["password:ana@fluidra.com"]);
});

Deno.test("POST /usuarios/<correo>/password: contraseña corta o mal formada → 400", async () => {
  for (const b of [{ password: "corta" }, { password: "12345678901" }, {}, { password: 5 }, "no json", null, []]) {
    const { llamar, log } = montar();
    const res = await llamar("POST", "/admin/usuarios/luis%40fluidra.com/password", b);
    assertEquals(res.status, 400, JSON.stringify(b));
    assertEquals(log, []);
  }
});

Deno.test("POST /usuarios/<correo>/password de alguien sin fila en acceso → 404; correo mal codificado → 400", async () => {
  const { llamar, log } = montar();
  assertEquals((await llamar("POST", "/admin/usuarios/nadie%40fluidra.com/password", { password: CLAVE })).status, 404);
  assertEquals((await llamar("POST", "/admin/usuarios/%E0%A4%A/password", { password: CLAVE })).status, 400);
  assertEquals((await llamar("POST", "/admin/usuarios/sin-arroba/password", { password: CLAVE })).status, 400);
  assertEquals(log, []);
});

Deno.test("POST /usuarios/<correo>/password sin usuario de Auth → 409", async () => {
  const { llamar } = montar({ sinAuth: true });
  const res = await llamar("POST", "/admin/usuarios/luis%40fluidra.com/password", { password: CLAVE });
  assertEquals(res.status, 409);
  await res.body?.cancel();
});

Deno.test("ruta /password: otros métodos → 405; otras subrutas → 404", async () => {
  const { llamar, log } = montar();
  assertEquals((await llamar("GET", "/admin/usuarios/luis%40fluidra.com/password")).status, 405);
  assertEquals((await llamar("DELETE", "/admin/usuarios/luis%40fluidra.com/password")).status, 405);
  assertEquals((await llamar("POST", "/admin/usuarios/luis%40fluidra.com/otra", { password: CLAVE })).status, 404);
  assertEquals((await llamar("POST", "/admin/usuarios/luis%40fluidra.com/password/x", { password: CLAVE })).status, 404);
  assertEquals((await llamar("POST", "/admin/usuarios//password", { password: CLAVE })).status, 404);
  assertEquals(log, []);
});

Deno.test("la contraseña no aparece en la consola si ponerPassword falla", async () => {
  const errores: unknown[][] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => errores.push(a);
  try {
    const deps: AdminDeps = {
      usuario: () => Promise.resolve({ email: "ana@fluidra.com" }),
      acceso: (e) => Promise.resolve([ADMIN, OTRO].find((f) => f.email === e) ?? null),
      listar: () => Promise.resolve([]),
      guardar: () => Promise.resolve(),
      borrar: () => Promise.resolve(),
      crearUsuarioAuth: () => Promise.resolve("u"),
      borrarUsuarioAuth: () => Promise.resolve(),
      ponerPassword: () => Promise.reject(new Error("updateUserById: 500")),
    };
    const res = await crearHandlerAdmin(deps)(
      new Request(`${BASE}/admin/usuarios/luis%40fluidra.com/password`, {
        method: "POST",
        headers: { origin: ORIGEN, authorization: "Bearer jwt", "content-type": "application/json" },
        body: JSON.stringify({ password: CLAVE }),
      }),
    );
    assertEquals(res.status, 502);
    assert(!(await res.text()).includes(CLAVE));
    assert(!JSON.stringify(errores.map((a) => a.map(String))).includes(CLAVE));
  } finally {
    console.error = original;
  }
});

Deno.test("los errores llevan code (y args si hacen falta) para que la página los traduzca", async () => {
  {
    const { llamar } = montar();
    const res = await llamar("POST", "/admin/usuarios", { ...valido, password: "corta-11chr" });
    const j = await res.json();
    assertEquals(res.status, 400);
    assertEquals([j.code, j.args], ["password_short", [12]]);
    assertMatch(j.message, /al menos 12/);
  }
  {
    const { llamar } = montar();
    const res = await llamar("POST", "/admin/usuarios", { ...valido, roles: { inventado: "ver" } });
    const j = await res.json();
    assertEquals([res.status, j.code, j.args], [400, "unknown_role", ["inventado"]]);
  }
  {
    const { llamar } = montar();
    const res = await llamar("GET", "/admin/otra");
    assertEquals((await res.json()).code, "not_found");
  }
});
