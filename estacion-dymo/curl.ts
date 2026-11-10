// Llamadas al servidor con curl.exe de Windows (incluido desde Windows 10 1803), que usa la pila TLS de Windows
// (Schannel) y su almacén de certificados, igual que Chrome. Se usa cuando la conexión propia de Deno rechaza el
// certificado que presenta la inspección de tráfico de la red (Netskope en Fluidra) aunque Windows lo acepte.
// Todo va por la entrada estándar con `--config -` (URL, cabeceras y cuerpo): la clave no aparece en la línea de
// comandos ni, por tanto, en la lista de procesos.

import type { Fetch } from "./dymo.ts";

export type EjecutarEntrada = (programa: string, args: string[], entrada: string) => Promise<{ ok: boolean; salida: string; error: string }>;

export const ejecutarConEntrada: EjecutarEntrada = async (programa, args, entrada) => {
  const p = new Deno.Command(programa, { args, stdin: "piped", stdout: "piped", stderr: "piped" }).spawn();
  const w = p.stdin.getWriter();
  await w.write(new TextEncoder().encode(entrada));
  await w.close();
  const r = await p.output();
  const d = new TextDecoder();
  return { ok: r.success, salida: d.decode(r.stdout), error: d.decode(r.stderr) };
};

// Valor entre comillas para el fichero de configuración de curl: \ y " escapados, sin saltos de línea.
const comillas = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;

const MARCA = "\n@@estado@@";

// Schannel comprueba la revocación del certificado; el de la inspección de tráfico (Netskope) apunta a una lista de
// revocación que no se puede consultar desde la red (CRYPT_E_NO_REVOCATION_CHECK). "best-effort" la comprueba si puede
// y no corta la conexión si el servicio no responde, como Chrome; el resto de la verificación no cambia. Los curl
// anteriores a 7.70 no la conocen: entonces se usa ssl-no-revoke.
const REVOCACION = ["ssl-revoke-best-effort", "ssl-no-revoke"];

/** fetch mínimo (método, cabeceras, cuerpo de texto) sobre curl.exe. */
export function fetchCurl(ejecutar: EjecutarEntrada = ejecutarConEntrada, programa = "curl.exe"): Fetch {
  let rev = 0;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const cab = new Headers(init?.headers);
    const lineas = [
      `url = ${comillas(url)}`,
      `request = ${comillas(init?.method ?? "GET")}`,
      ...[...cab.entries()].map(([k, v]) => `header = ${comillas(`${k}: ${v}`)}`),
      `write-out = ${comillas(MARCA + "%{http_code}")}`,
    ];
    if (init?.body !== undefined && init.body !== null) lineas.push(`data-binary = ${comillas(String(init.body))}`);
    const llamar = () => ejecutar(programa, ["--silent", "--show-error", "--max-time", "60", "--config", "-"], [REVOCACION[rev], ...lineas].join("\n") + "\n");
    let r = await llamar();
    if (!r.ok && rev === 0 && /ssl-revoke-best-effort/i.test(r.error)) {
      rev = 1; // curl antiguo: no conoce la opción
      r = await llamar();
    }
    const i = r.salida.lastIndexOf(MARCA);
    const status = i >= 0 ? Number(r.salida.slice(i + MARCA.length).trim()) : 0;
    if (!r.ok || !status) throw new TypeError("fetch failed", { cause: new Error(`curl: ${(r.error || r.salida).trim().slice(0, 300)}`) });
    return new Response(r.salida.slice(0, i), { status });
  }) as Fetch;
}

const esCertificado = (e: unknown) =>
  e instanceof Error && /certificate|UnknownIssuer/i.test(`${e.message} ${e.cause instanceof Error ? e.cause.message : String(e.cause ?? "")}`);

/** Usa `base`; si falla por el certificado, pasa a `alternativo` (curl) para el resto de la sesión. */
export function fetchServidor(base: Fetch, alternativo: Fetch, log: (m: string) => void): Fetch {
  let usarAlt = false;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    if (usarAlt) return alternativo(input, init);
    try {
      return await base(input, init);
    } catch (e) {
      if (!esCertificado(e)) throw e;
      usarAlt = true;
      log("El certificado del servidor solo lo reconoce Windows (inspección de tráfico): se usa curl.exe de Windows");
      return alternativo(input, init);
    }
  }) as Fetch;
}
