import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { fetchCurl, fetchServidor } from "./curl.ts";

// Con el curl real del sistema (en Windows, curl.exe) contra un servidor local: cabeceras y cuerpo por la entrada
// estándar, nunca en los argumentos.
async function hay(): Promise<boolean> {
  try {
    return (await new Deno.Command("curl", { args: ["--version"], stdout: "null", stderr: "null" }).output()).success;
  } catch {
    return false; // sin curl o sin permiso --allow-run
  }
}
const hayCurl = await hay();

Deno.test({ name: "curl: manda método, cabeceras y cuerpo; devuelve estado y cuerpo", ignore: !hayCurl, fn: async () => {
  const ac = new AbortController();
  let visto: { m: string; k: string | null; t: string; b: string } | null = null;
  const srv = Deno.serve({ port: 0, hostname: "127.0.0.1", signal: ac.signal, onListen() {} }, async (r) => {
    visto = { m: r.method, k: r.headers.get("x-estacion"), t: r.headers.get("content-type") ?? "", b: await r.text() };
    return new Response(JSON.stringify({ rollo: "11354", trabajo: null }), { status: 200 });
  });
  const url = `http://127.0.0.1:${srv.addr.port}/impresion/estacion/ciclo`;
  const f = fetchCurl(undefined, "curl");
  const cuerpo = JSON.stringify({ dymo: { ok: true, impresora: 'DYMO "550" \\ ñ' }, pedir: true });
  const r = await f(url, { method: "POST", headers: { "content-type": "application/json", "x-estacion": "clave-secreta" }, body: cuerpo });
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { rollo: "11354", trabajo: null });
  assertEquals(visto, { m: "POST", k: "clave-secreta", t: "application/json", b: cuerpo });
  ac.abort();
  await srv.finished;
} });

Deno.test("curl: la clave va por la entrada estándar, no en los argumentos; un fallo de curl es 'fetch failed'", async () => {
  let args: string[] = [], entrada = "";
  const f = fetchCurl(async (_p, a, e) => {
    args = a; entrada = e;
    return await Promise.resolve({ ok: true, salida: '{"ok":true}\n@@estado@@409', error: "" });
  });
  const r = await f("https://x.supabase.co/functions/v1/impresion/estacion/trabajos/1", { method: "POST", headers: { "x-estacion": "k" }, body: "{}" });
  assertEquals([r.status, await r.text()], [409, '{"ok":true}']);
  assertEquals(args.join(" ").includes("k\""), false);
  assertStringIncludes(entrada, 'header = "x-estacion: k"');
  assertEquals(entrada.split("\n")[0], "ssl-revoke-best-effort");
  const mal = fetchCurl(() => Promise.resolve({ ok: false, salida: "", error: "curl: (6) Could not resolve host" }));
  const e = await assertRejects(() => mal("https://x/"), TypeError);
  assertStringIncludes(String((e as Error).cause), "Could not resolve host");
});

Deno.test("fetchServidor: pasa a curl solo cuando falla el certificado, y se queda en curl", async () => {
  const log: string[] = [];
  let base = 0, alt = 0;
  const certErr = new TypeError("fetch failed", { cause: new Error("invalid peer certificate: UnknownIssuer") });
  const f = fetchServidor(() => { base++; return Promise.reject(certErr); }, () => { alt++; return Promise.resolve(new Response("ok")); }, (m) => log.push(m));
  assertEquals(await (await f("https://x/")).text(), "ok");
  await f("https://x/");
  assertEquals([base, alt, log.length], [1, 2, 1]);
  const g = fetchServidor(() => Promise.reject(new TypeError("fetch failed", { cause: new Error("dns error") })), () => Promise.resolve(new Response("x")), () => {});
  await assertRejects(() => g("https://x/"), TypeError);
});

Deno.test("curl: si no conoce ssl-revoke-best-effort (curl antiguo), repite con ssl-no-revoke y se queda con ella", async () => {
  const entradas: string[] = [];
  const f = fetchCurl((_p, _a, e) => {
    entradas.push(e.split("\n")[0]);
    return Promise.resolve(e.startsWith("ssl-revoke-best-effort")
      ? { ok: false, salida: "", error: "curl: option ssl-revoke-best-effort: is unknown" }
      : { ok: true, salida: "{}\n@@estado@@200", error: "" });
  });
  assertEquals((await f("https://x/")).status, 200);
  await f("https://x/");
  assertEquals(entradas, ["ssl-revoke-best-effort", "ssl-no-revoke", "ssl-no-revoke"]);
});
