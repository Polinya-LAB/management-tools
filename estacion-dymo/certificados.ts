// Certificados de confianza de Windows para hablar con Supabase.
// En la red de Fluidra, Netskope inspecciona el tráfico cifrado y presenta su propio certificado (raíz instalada en
// Windows). Deno no usa el almacén de Windows, así que la estación copia al arrancar las raíces de Windows a
// certificados.pem (junto al exe) y las añade a las suyas para las llamadas al servidor.

import { type Fs, fsDeno, leerTexto, unir } from "./archivos.ts";

export const ARCHIVO_CERTS = "certificados.pem";

// Raíces e intermedias de la máquina y del usuario, solo las vigentes, en PEM.
const SCRIPT = [
  "$c=@();",
  "foreach($s in 'Cert:\\LocalMachine\\Root','Cert:\\CurrentUser\\Root','Cert:\\LocalMachine\\CA','Cert:\\CurrentUser\\CA')",
  "{ $c += Get-ChildItem $s -ErrorAction SilentlyContinue }",
  "$c | Where-Object { $_.NotAfter -gt (Get-Date) } | ForEach-Object {",
  "'-----BEGIN CERTIFICATE-----'; [Convert]::ToBase64String($_.RawData,'InsertLineBreaks'); '-----END CERTIFICATE-----' }",
].join(" ");

export type Ejecutar = (programa: string, args: string[]) => Promise<{ ok: boolean; salida: string }>;

export const ejecutarDeno: Ejecutar = async (programa, args) => {
  const r = await new Deno.Command(programa, { args, stdout: "piped", stderr: "null" }).output();
  return { ok: r.success, salida: new TextDecoder().decode(r.stdout) };
};

/** Bloques PEM de un texto. */
export function bloquesPem(texto: string): string[] {
  return texto.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
}

/** Exporta las raíces de Windows a certificados.pem; si no se puede, deja el que hubiera. Devuelve cuántos hay. */
export async function exportarCertificados(dir: string, log: (m: string) => void, ejecutar: Ejecutar = ejecutarDeno, fs: Fs = fsDeno): Promise<number> {
  const ruta = unir(dir, ARCHIVO_CERTS);
  try {
    const r = await ejecutar("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", SCRIPT]);
    const pem = bloquesPem(r.salida);
    if (r.ok && pem.length) {
      fs.escribir(ruta, new TextEncoder().encode(pem.join("\n") + "\n"));
      return pem.length;
    }
    log("No se han podido leer los certificados de Windows; se usan los guardados, si hay");
  } catch {
    // Fuera de Windows (pruebas) no hay PowerShell: se sigue con lo que haya.
  }
  return bloquesPem(leerTexto(ruta, fs) ?? "").length;
}

/** fetch que confía también en los certificados de certificados.pem (los que Deno pueda leer). */
export function fetchConCertificados(dir: string, log: (m: string) => void, fs: Fs = fsDeno): typeof fetch {
  const pem = bloquesPem(leerTexto(unir(dir, ARCHIVO_CERTS), fs) ?? "");
  if (!pem.length) return fetch;
  let validos = pem;
  let client: Deno.HttpClient;
  try {
    client = Deno.createHttpClient({ caCerts: pem });
  } catch {
    // Algún certificado del almacén que rustls no acepta: se quedan solo los que sí.
    validos = pem.filter((c) => {
      try {
        Deno.createHttpClient({ caCerts: [c] }).close();
        return true;
      } catch {
        return false;
      }
    });
    if (!validos.length) return fetch;
    client = Deno.createHttpClient({ caCerts: validos });
  }
  log(`Certificados de Windows en uso: ${validos.length}`);
  return (input, init) => fetch(input, { ...init, client } as unknown as RequestInit);
}
