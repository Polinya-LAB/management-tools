import { assert, assertEquals } from "jsr:@std/assert@1";
import type { Acceso } from "../_shared/permisos.ts";
import { crearHandler, type Deps } from "./handler.ts";
import { corsHeaders } from "../_shared/cors.ts";

const ORIGEN = "https://polinya-lab.github.io";
const BASE = "https://x.supabase.co";

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const unb64 = (s: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

interface Llamada {
  path: string;
  init?: RequestInit;
}

function montar(
  roles: Acceso["roles"],
  responder: (path: string, init?: RequestInit) => Response | Promise<Response> = () =>
    json({ message: "Not Found" }, 404),
  opts: { sinFila?: boolean } = {},
) {
  const llamadas: Llamada[] = [];
  const deps: Deps = {
    usuario: (jwt) => Promise.resolve(jwt === "buen-jwt" ? { email: "Ana@Fluidra.com" } : null),
    acceso: (email) =>
      Promise.resolve(
        opts.sinFila || email !== "ana@fluidra.com"
          ? null
          : { email: "ana@fluidra.com", nombre: "Ana Ruiz", roles, admin: false },
      ),
    gh: (path, init) => {
      llamadas.push({ path, init });
      return Promise.resolve(responder(path, init));
    },
  };
  return { handler: crearHandler(deps), llamadas };
}

const pet = (ruta: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request(`${BASE}${ruta}`, {
    ...init,
    headers: { authorization: "Bearer buen-jwt", origin: ORIGEN, ...(init.headers ?? {}) },
  });

const ENS = "/github/ensayos/repos/Polinya-LAB/lab-data/contents/ensayos/ensayos.json";

// ---------- CORS ----------

Deno.test("cors: orígenes permitidos y cabeceras", () => {
  const h = new Headers(corsHeaders(ORIGEN));
  assertEquals(h.get("access-control-allow-origin"), ORIGEN);
  assertEquals(
    new Headers(corsHeaders("http://localhost:8080")).get("access-control-allow-origin"),
    "http://localhost:8080",
  );
  assertEquals(new Headers(corsHeaders("https://evil.example")).get("access-control-allow-origin"), null);
  assertEquals(
    new Headers(corsHeaders("https://polinya-lab.github.io.evil.example")).get("access-control-allow-origin"),
    null,
  );
  assertEquals(new Headers(corsHeaders("http://localhost.evil.example")).get("access-control-allow-origin"), null);
  assertEquals(new Headers(corsHeaders(null)).get("access-control-allow-origin"), null);
  const allow = h.get("access-control-allow-headers") ?? "";
  for (const x of ["authorization", "apikey", "content-type", "if-none-match", "x-client-info"]) {
    assert(allow.includes(x), x);
  }
  assertEquals(h.get("access-control-expose-headers"), "etag");
  assertEquals(h.get("access-control-allow-methods"), "GET, PUT, OPTIONS");
});

Deno.test("OPTIONS → 204 con CORS, sin sesión", async () => {
  const { handler, llamadas } = montar({});
  const res = await handler(
    new Request(`${BASE}/github/ensayos/user`, { method: "OPTIONS", headers: { origin: ORIGEN } }),
  );
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGEN);
  assertEquals(llamadas.length, 0);
});

// ---------- Sesión ----------

Deno.test("sin Authorization → 401 con CORS", async () => {
  const { handler } = montar({ ensayos: "editar" });
  const res = await handler(new Request(`${BASE}/github/ensayos/user`, { headers: { origin: ORIGEN } }));
  assertEquals(res.status, 401);
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGEN);
  assert(typeof (await res.json()).message === "string");
});

Deno.test("JWT no válido → 401", async () => {
  const { handler } = montar({ ensayos: "editar" });
  const res = await handler(pet("/github/ensayos/user", { headers: { authorization: "Bearer malo" } }));
  assertEquals(res.status, 401);
  await res.body?.cancel();
});

Deno.test("Supabase Auth no responde (usuario lanza) → 502, no 401", async () => {
  const deps: Deps = {
    usuario: () => Promise.reject(new Error("auth.getUser: AuthRetryableFetchError 503")),
    acceso: () => Promise.resolve(null),
    gh: () => Promise.resolve(json({}, 200)),
  };
  const res = await crearHandler(deps)(pet("/github/ensayos/user"));
  assertEquals(res.status, 502);
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGEN);
  await res.body?.cancel();
});

Deno.test("JWT válido sin fila en acceso → 403 con CORS", async () => {
  const { handler } = montar({}, undefined, { sinFila: true });
  const res = await handler(pet("/github/ensayos/user"));
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGEN);
  await res.body?.cancel();
});

Deno.test("app desconocida → 404", async () => {
  const { handler } = montar({ ensayos: "editar" });
  const res = await handler(pet("/github/otra/user"));
  assertEquals(res.status, 404);
  await res.body?.cancel();
});

// ---------- /user y /repos ----------

Deno.test("GET /user → nombre y correo", async () => {
  const { handler, llamadas } = montar({ ensayos: "ver" });
  const res = await handler(pet("/github/ensayos/user"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { login: "Ana Ruiz", name: "Ana Ruiz", email: "ana@fluidra.com" });
  assertEquals(llamadas.length, 0);
});

Deno.test("GET /repos: push según rol; ninguno o repo ajeno → 403", async () => {
  const ruta = "/github/calibraciones/repos/Polinya-LAB/lab-data";
  let r = await montar({ calibraciones: "editar" }).handler(pet(ruta));
  assertEquals(r.status, 200);
  const j = await r.json();
  assertEquals(j.permissions.push, true);
  assertEquals(j.permissions.pull, true);
  assertEquals(j.full_name, "Polinya-LAB/lab-data");
  r = await montar({ calibraciones: "ver" }).handler(pet(ruta));
  assertEquals((await r.json()).permissions.push, false);
  r = await montar({ ensayos: "editar" }).handler(pet(ruta));
  assertEquals(r.status, 403);
  await r.body?.cancel();
  r = await montar({ piscina: "editar" }).handler(pet("/github/piscina/repos/Polinya-LAB/lab-data"));
  assertEquals(r.status, 403);
  await r.body?.cancel();
  r = await montar({ piscina: "editar" }).handler(pet("/github/piscina/repos/Polinya-LAB/endurance-data"));
  assertEquals(r.status, 200);
  await r.body?.cancel();
  // ocupacion usa el rol ensayos
  r = await montar({ ensayos: "ver" }).handler(pet("/github/ocupacion/repos/Polinya-LAB/lab-data"));
  assertEquals((await r.json()).permissions.push, false);
});

Deno.test("rol con valor desconocido cuenta como ninguno", async () => {
  // deno-lint-ignore no-explicit-any
  const { handler } = montar({ ensayos: "admin" as any });
  const r = await handler(pet("/github/ensayos/repos/Polinya-LAB/lab-data"));
  assertEquals(r.status, 403);
  await r.body?.cancel();
});

// ---------- GET contents ----------

Deno.test("GET contents reenvía If-None-Match y devuelve 304 y ETag", async () => {
  const { handler, llamadas } = montar(
    { ensayos: "ver" },
    () => new Response(null, { status: 304, headers: { etag: 'W/"abc"' } }),
  );
  const res = await handler(pet(`${ENS}?ref=main`, { headers: { "if-none-match": 'W/"abc"' } }));
  assertEquals(res.status, 304);
  assertEquals(res.headers.get("etag"), 'W/"abc"');
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGEN);
  assertEquals(await res.text(), "");
  assertEquals(llamadas.length, 1);
  assertEquals(llamadas[0].path, "/repos/Polinya-LAB/lab-data/contents/ensayos/ensayos.json?ref=main");
  assertEquals(new Headers(llamadas[0].init?.headers).get("if-none-match"), 'W/"abc"');
});

Deno.test("GET contents 200 devuelve el JSON y el ETag; sin ref = main", async () => {
  const cuerpo = { sha: "s1", content: b64('{"tests":{}}'), encoding: "base64" };
  const { handler, llamadas } = montar({ ensayos: "ver" }, () => json(cuerpo, 200, { etag: '"e1"' }));
  const res = await handler(pet(ENS));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("etag"), '"e1"');
  assertEquals(await res.json(), cuerpo);
  assertEquals(llamadas[0].path, "/repos/Polinya-LAB/lab-data/contents/ensayos/ensayos.json?ref=main");
});

Deno.test("GET contents fuera de leer → 404 sin llamar a gh; ninguno → 403", async () => {
  const { handler, llamadas } = montar({ ensayos: "editar" });
  let r = await handler(
    pet("/github/ensayos/repos/Polinya-LAB/lab-data/contents/mantenimiento/registro.json?ref=main"),
  );
  assertEquals(r.status, 404);
  await r.body?.cancel();
  r = await handler(pet("/github/piscina/repos/Polinya-LAB/endurance-data/contents/piscina.json?ref=main"));
  assertEquals(r.status, 403);
  await r.body?.cancel();
  assertEquals(llamadas.length, 0);
});

Deno.test("GET contents con ref distinto de main → 403", async () => {
  const { handler, llamadas } = montar({ ensayos: "editar" });
  const r = await handler(pet(`${ENS}?ref=otra`));
  assertEquals(r.status, 403);
  await r.body?.cancel();
  assertEquals(llamadas.length, 0);
});

Deno.test("GET contents sin content (>1 MB) se rellena desde el blob", async () => {
  const texto = '{"tests":{"a":1}}';
  const { handler, llamadas } = montar({ ensayos: "ver" }, (path) => {
    if (path.startsWith("/repos/Polinya-LAB/lab-data/contents/")) {
      return json({ sha: "a9", content: "", encoding: "none", size: 2000000 }, 200, { etag: '"e9"' });
    }
    if (path === "/repos/Polinya-LAB/lab-data/git/blobs/a9") {
      return json({ sha: "a9", content: b64(texto), encoding: "base64" });
    }
    return json({ message: "Not Found" }, 404);
  });
  const res = await handler(pet(`${ENS}?ref=main`));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("etag"), '"e9"');
  const j = await res.json();
  assertEquals(unb64(j.content), texto);
  assertEquals(j.encoding, "base64");
  assertEquals(j.sha, "a9");
  assertEquals(llamadas.map((l) => l.path), [
    "/repos/Polinya-LAB/lab-data/contents/ensayos/ensayos.json?ref=main",
    "/repos/Polinya-LAB/lab-data/git/blobs/a9",
  ]);
});

Deno.test("GET contents: error de GitHub se devuelve con su código", async () => {
  const { handler } = montar({ ensayos: "ver" }, () => json({ message: "Not Found" }, 404));
  const r = await handler(pet(`${ENS}?ref=main`));
  assertEquals(r.status, 404);
  assertEquals((await r.json()).message, "Not Found");
});

// ---------- PUT ----------

function ghConFichero(actual: unknown | null, sha = "s1", alPut?: (init?: RequestInit) => Response) {
  return (_path: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") {
      if (actual === null) return json({ message: "Not Found" }, 404);
      return json({ sha, content: b64(JSON.stringify(actual)), encoding: "base64" });
    }
    if (alPut) return alPut(init);
    return json({ content: { sha: "nuevo" }, commit: { sha: "c1" } }, 200);
  };
}

const putBody = (datos: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    message: "Muestras: add X",
    branch: "main",
    sha: "s1",
    content: b64(JSON.stringify(datos)),
    ...extra,
  });

Deno.test("PUT permitido: lee el actual y reenvía con author y committer", async () => {
  const antes = { tests: { t1: {} }, muestras: {} };
  const despues = { tests: { t1: {} }, muestras: { m1: { plr: "1" } } };
  const { handler, llamadas } = montar({ muestras: "editar" }, ghConFichero(antes));
  const res = await handler(
    pet("/github/muestras/repos/Polinya-LAB/lab-data/contents/ensayos/ensayos.json", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: putBody(despues, { author: { name: "Otro", email: "x@y.z" } }),
    }),
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).content.sha, "nuevo");
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGEN);
  assertEquals(llamadas.length, 2);
  assertEquals(llamadas[0].path, "/repos/Polinya-LAB/lab-data/contents/ensayos/ensayos.json?ref=main");
  assertEquals(llamadas[1].path, "/repos/Polinya-LAB/lab-data/contents/ensayos/ensayos.json");
  assertEquals(llamadas[1].init?.method, "PUT");
  const enviado = JSON.parse(String(llamadas[1].init?.body));
  const persona = { name: "Ana Ruiz", email: "ana@fluidra.com" };
  assertEquals(enviado.author, persona);
  assertEquals(enviado.committer, persona);
  assertEquals(enviado.message, "Muestras: add X");
  assertEquals(enviado.sha, "s1");
  assertEquals(enviado.branch, "main");
  assertEquals(JSON.parse(unb64(enviado.content)), despues);
});

Deno.test("PUT de fichero nuevo (GitHub 404 al leer) → antes = null", async () => {
  const { handler, llamadas } = montar({ piscina: "editar" }, ghConFichero(null));
  const res = await handler(
    pet("/github/piscina/repos/Polinya-LAB/endurance-data/contents/piscina.json", {
      method: "PUT",
      body: JSON.stringify({ message: "init", content: b64("{}") }),
    }),
  );
  assertEquals(res.status, 200);
  await res.body?.cancel();
  assertEquals(llamadas.length, 2);
  assertEquals(JSON.parse(String(llamadas[1].init?.body)).branch, "main");
});

Deno.test("PUT rechazado por comprobarEscritura → 403 con motivo y sin PUT", async () => {
  const antes = { tests: { t1: {} }, muestras: {} };
  const despues = { tests: { t1: {}, t2: {} }, muestras: {} };
  const { handler, llamadas } = montar({ muestras: "editar", ensayos: "ver" }, ghConFichero(antes));
  const res = await handler(
    pet("/github/muestras/repos/Polinya-LAB/lab-data/contents/ensayos/ensayos.json", {
      method: "PUT",
      body: putBody(despues),
    }),
  );
  assertEquals(res.status, 403);
  assertEquals((await res.json()).message, "Cambia ensayos y no tienes permiso de edición en ensayos");
  assert(llamadas.every((l) => (l.init?.method ?? "GET") === "GET"));
});

Deno.test("PUT con rol ver → 403 sin llamar a gh", async () => {
  const { handler, llamadas } = montar({ calibraciones: "ver" }, ghConFichero({}));
  const res = await handler(
    pet("/github/calibraciones/repos/Polinya-LAB/lab-data/contents/calibraciones/calibraciones.json", {
      method: "PUT",
      body: putBody({}),
    }),
  );
  assertEquals(res.status, 403);
  await res.body?.cancel();
  assertEquals(llamadas.length, 0);
});

Deno.test("PUT: GitHub responde 409 o 422 → se devuelve igual", async () => {
  for (const status of [409, 422]) {
    const cuerpo = { message: "conflict", documentation_url: "x" };
    const { handler } = montar({ calibraciones: "editar" }, ghConFichero({}, "s1", () => json(cuerpo, status)));
    const res = await handler(
      pet("/github/calibraciones/repos/Polinya-LAB/lab-data/contents/calibraciones/calibraciones.json", {
        method: "PUT",
        body: putBody({ equipment: {} }),
      }),
    );
    assertEquals(res.status, status);
    assertEquals(await res.json(), cuerpo);
  }
});

Deno.test("PUT con sha distinto del actual → 409 sin PUT (se comprobó otra versión)", async () => {
  const { handler, llamadas } = montar({ calibraciones: "editar" }, ghConFichero({}, "s2"));
  const res = await handler(
    pet("/github/calibraciones/repos/Polinya-LAB/lab-data/contents/calibraciones/calibraciones.json", {
      method: "PUT",
      body: putBody({ equipment: {} }),
    }),
  );
  assertEquals(res.status, 409);
  await res.body?.cancel();
  assert(llamadas.every((l) => (l.init?.method ?? "GET") === "GET"));
});

Deno.test("PUT con branch distinto de main → 403; contenido no JSON → 400", async () => {
  const ruta = "/github/calibraciones/repos/Polinya-LAB/lab-data/contents/calibraciones/calibraciones.json";
  const { handler, llamadas } = montar({ calibraciones: "editar" }, ghConFichero({}));
  let r = await handler(pet(ruta, { method: "PUT", body: putBody({}, { branch: "dev" }) }));
  assertEquals(r.status, 403);
  await r.body?.cancel();
  assertEquals(llamadas.length, 0);
  r = await handler(pet(ruta, { method: "PUT", body: putBody({}, { content: b64("no es json") }) }));
  assertEquals(r.status, 400);
  await r.body?.cancel();
  r = await handler(pet(ruta, { method: "PUT", body: "{roto" }));
  assertEquals(r.status, 400);
  await r.body?.cancel();
  assert(llamadas.every((l) => (l.init?.method ?? "GET") === "GET"));
});

// ---------- Rutas prohibidas ----------

Deno.test("rutas no permitidas → 403 sin llamar a gh", async () => {
  const { handler, llamadas } = montar({ ensayos: "editar", calibraciones: "editar" });
  const rutas = [
    "/github/ensayos/repos/Polinya-LAB/lab-data/git/blobs/x",
    "/github/ensayos/repos/Polinya-LAB/management-tools",
    "/github/ensayos/repos/Polinya-LAB/management-tools/contents/ensayos/ensayos.json",
    "/github/ensayos/repos/otro/lab-data/contents/ensayos/ensayos.json",
    "/github/ensayos/repos/polinya-lab/lab-data/contents/ensayos/ensayos.json",
    "/github/ensayos/repos/Polinya-LAB/lab-data/contents/ensayos%2Fensayos.json",
    "/github/ensayos/repos/Polinya-LAB/lab-data/contents//ensayos/ensayos.json",
    "/github/ensayos/repos/Polinya-LAB/lab-data%2Fcontents/ensayos/ensayos.json",
    "/github/ensayos/repos/Polinya-LAB/lab-data/contents/ensayos/ensayos.json/../../../management-tools",
    "/github/ensayos/user/repos",
    "/github/ensayos/orgs/Polinya-LAB",
    "/github/ensayos",
  ];
  for (const r of rutas) {
    const res = await handler(pet(r));
    assert(res.status === 403 || res.status === 404, `${r} → ${res.status}`);
    assertEquals(res.headers.get("access-control-allow-origin"), ORIGEN);
    await res.body?.cancel();
  }
  const blob = await handler(pet(rutas[0]));
  assertEquals(blob.status, 403);
  await blob.body?.cancel();
  const mt = await handler(pet(rutas[1]));
  assertEquals(mt.status, 403);
  await mt.body?.cancel();
  // DELETE y POST tampoco
  for (const method of ["DELETE", "POST", "PATCH"]) {
    const res = await handler(pet(ENS, { method, body: "{}" }));
    assertEquals(res.status, 403);
    await res.body?.cancel();
  }
  assertEquals(llamadas.length, 0);
});
