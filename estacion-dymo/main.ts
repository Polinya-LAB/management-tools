// Estación de impresión DYMO del laboratorio (estacion-dymo.exe, Windows, sin consola).
// Recoge los trabajos de la función `impresion` de Supabase y los imprime con el servicio local de DYMO Connect.
// Diseño: docs/superpowers/specs/2026-11-10-impresion-remota-dymo-design.md. Instrucciones: estacion-dymo/LEEME.txt.

import { ApiEstacion } from "./api.ts";
import { ARCHIVO_LOG, carpeta, enCursoEn, leerTexto, plantillaEn, unir } from "./archivos.ts";
import { exportarCertificados, fetchConCertificados } from "./certificados.ts";
import { ARCHIVO_CONFIG, type Config, validarConfig } from "./config.ts";
import { ClienteDymo, mensaje } from "./dymo.ts";
import { Estacion } from "./estacion.ts";
import { crearRegistro } from "./log.ts";
import { prueba } from "./prueba.ts";

export const VERSION = "1.0.1";
const PUERTO_INSTANCIA = 41999;

const AYUDA = `estacion-dymo ${VERSION}: imprime en la DYMO las etiquetas que se mandan desde Muestras.

Uso:
  estacion-dymo.exe            bucle normal (lo arranca el acceso directo de Inicio)
  estacion-dymo.exe --prueba   comprueba DYMO y el servidor, imprime una etiqueta de prueba y termina
  estacion-dymo.exe --help     esta ayuda

Archivos junto al exe: ${ARCHIVO_CONFIG} (url y clave), estacion-dymo.log (registro),
plantilla-<rollo>.label (opcional). Más información en LEEME.txt.`;

async function main(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    try {
      console.log(AYUDA);
    } catch { /* sin consola */ }
    return 0;
  }
  const modoPrueba = args.includes("--prueba");
  const dir = carpeta();
  const log = crearRegistro(unir(dir, ARCHIVO_LOG));

  globalThis.addEventListener("unhandledrejection", (e) => {
    e.preventDefault();
    log(`Error no capturado: ${mensaje(e.reason)}`);
  });
  globalThis.addEventListener("error", (e) => {
    e.preventDefault();
    log(`Error no capturado: ${mensaje(e.error ?? e.message)}`);
  });

  let cfg: Config;
  try {
    const t = leerTexto(unir(dir, ARCHIVO_CONFIG));
    if (t === null) {
      throw new Error(`No se encuentra ${ARCHIVO_CONFIG} en ${dir}: descárgalo desde la página de accesos ` +
        `(Generar clave de la estación) y vuelve a ejecutar instalar.cmd`);
    }
    cfg = validarConfig(t);
  } catch (e) {
    log(`No se puede arrancar: ${mensaje(e)}`);
    return 2;
  }

  const dymo = new ClienteDymo(fetch, cfg.impresora);
  // Con inspección de tráfico (Netskope en Fluidra), el servidor solo se reconoce con los certificados de Windows.
  await exportarCertificados(dir, log);
  const api = new ApiEstacion(fetchConCertificados(dir, log), cfg.url, cfg.clave);
  const plantilla = plantillaEn(dir);

  if (modoPrueba) return (await prueba(cfg, api, dymo, log, plantilla)) ? 0 : 1;

  // Una sola instancia: el puerto queda ocupado mientras la estación está en marcha.
  try {
    Deno.listen({ hostname: "127.0.0.1", port: PUERTO_INSTANCIA });
  } catch (e) {
    if (e instanceof Deno.errors.AddrInUse) {
      log("La estación ya está en marcha; esta copia se cierra");
      return 0;
    }
    log(`No se pudo comprobar si ya está en marcha (${mensaje(e)}); se sigue`);
  }

  log(`Estación iniciada (versión ${VERSION}, cada ${cfg.intervalo} s, carpeta ${dir})`);
  const estacion = new Estacion({
    config: cfg,
    api,
    dymo,
    log,
    enCurso: enCursoEn(dir),
    plantilla,
    dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  await estacion.correr();
  return 0;
}

if (import.meta.main) Deno.exit(await main(Deno.args));
