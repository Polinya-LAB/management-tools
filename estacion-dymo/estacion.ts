// Bucle de la estación: comprueba DYMO, hace el ciclo con el servidor e imprime los trabajos etiqueta a etiqueta.

import { ApiEstacion, ErrorApi, type RespuestaCiclo, type TrabajoEstacion } from "./api.ts";
import type { Config, Rollo } from "./config.ts";
import { type EstadoDymo, mensaje, papelDe, xmlEtiqueta, xmlParametros } from "./dymo.ts";
import type { Registro } from "./log.ts";

export interface EnCurso {
  id: string;
  hechas: number;
}

export interface DepsEstacion {
  config: Config;
  api: Pick<ApiEstacion, "ciclo" | "progreso">;
  dymo: { estado(): Promise<EstadoDymo>; imprimir(impresora: string, labelXml: string, paramsXml: string): Promise<void> };
  log: Registro;
  /** Trabajo a medias guardado en estacion-dymo.estado.json. */
  enCurso: { leer(): EnCurso | null; guardar(e: EnCurso): void; borrar(): void };
  plantilla(rollo: Rollo): string | null;
  dormir(ms: number): Promise<void>;
}

export const ESPERA_MAX = 60_000;
export const CLAVE_MALA = "La clave de la estación no es válida: genera otra en la página de accesos";
const INTERRUMPIDO = "Interrumpido al reiniciar la estación";

export class Estacion {
  private porRecuperar = true;
  private fallos = 0;
  private avisos = new Map<string, string>();

  constructor(private d: DepsEstacion) {}

  /** Escribe en el registro solo cuando cambia el mensaje de ese tema (evita una línea cada 10 s). */
  private avisar(tema: string, texto: string) {
    if (this.avisos.get(tema) === texto) return;
    this.avisos.set(tema, texto);
    this.d.log(texto);
  }

  async correr(seguir: () => boolean = () => true): Promise<void> {
    while (seguir()) {
      let ms: number;
      try {
        ms = await this.paso();
      } catch (e) {
        this.d.log(`Error inesperado: ${mensaje(e)}`);
        ms = ESPERA_MAX;
      }
      if (ms > 0) await this.d.dormir(ms);
    }
  }

  /** Un ciclo; devuelve cuánto esperar antes del siguiente (0 = enseguida). */
  async paso(): Promise<number> {
    const intervalo = this.d.config.intervalo * 1000;
    try {
      if (this.porRecuperar) await this.recuperar();
      const dymo = await this.d.dymo.estado();
      const lista = dymo.ok && dymo.conectada;
      this.avisar("dymo", lista ? `DYMO lista: ${dymo.impresora}` : `DYMO no disponible: ${dymo.error}`);
      const r: RespuestaCiclo = await this.d.api.ciclo(dymo, lista);
      this.fallos = 0;
      this.avisar("red", `Conectada con el servidor (rollo puesto: ${r.rollo})`);
      if (!r.trabajo) return intervalo;
      await this.imprimirTrabajo(r.trabajo, r.rollo, dymo.impresora);
      return 0; // puede haber más trabajos esperando
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 401) {
        this.avisar("red", CLAVE_MALA);
        return ESPERA_MAX;
      }
      this.fallos++;
      this.avisar("red", `Sin conexión con el servidor: ${mensaje(e)}`);
      return Math.min(ESPERA_MAX, intervalo * 2 ** (this.fallos - 1));
    }
  }

  /** Un trabajo que quedó a medias al cerrarse la estación se da por error con lo ya impreso. */
  private async recuperar() {
    const e = this.d.enCurso.leer();
    if (e) {
      try {
        await this.d.api.progreso(e.id, { hechas: e.hechas, fin: "error", error: INTERRUMPIDO });
        this.d.log(`Trabajo ${e.id}: ${INTERRUMPIDO.toLowerCase()} (etiquetas impresas: ${e.hechas})`);
      } catch (err) {
        // 409/404: ya no está imprimiéndose; no hay nada que avisar. Red o clave: se reintenta en el siguiente ciclo.
        if (!(err instanceof ErrorApi) || err.status === 401 || err.status >= 500) throw err;
      }
      this.d.enCurso.borrar();
    }
    this.porRecuperar = false;
  }

  async imprimirTrabajo(t: TrabajoEstacion, rolloPuesto: Rollo, impresora: string): Promise<void> {
    const { config: cfg, log } = this.d;
    let hechas = Math.min(t.hechas, t.n);
    log(`Trabajo ${t.id}: ${t.n} etiquetas, rollo ${t.rollo}${hechas ? `, sigue desde la ${hechas + 1}` : ""}`);
    this.d.enCurso.guardar({ id: t.id, hechas });
    try {
      if (t.rollo !== rolloPuesto) {
        return await this.finalizar(t.id, { hechas, fin: "error", error: `El trabajo es para el rollo ${t.rollo} y está puesto ${rolloPuesto}` });
      }
      let papel;
      try {
        papel = papelDe(t.rollo, cfg.papel[t.rollo], this.d.plantilla(t.rollo));
      } catch (e) {
        return await this.finalizar(t.id, { hechas, fin: "error", error: mensaje(e) });
      }
      for (let i = hechas; i < t.n; i++) {
        const et = t.etiquetas[i];
        try {
          await this.d.dymo.imprimir(impresora, xmlEtiqueta(et.png, papel, cfg.girar180), xmlParametros(`QTS-${et.codigo}`));
        } catch (e) {
          return await this.finalizar(t.id, { hechas, fin: "error", error: mensaje(e) });
        }
        hechas = i + 1;
        this.d.enCurso.guardar({ id: t.id, hechas });
        if (hechas === t.n) break; // la última va con el resultado final
        try {
          await this.d.api.progreso(t.id, { hechas });
        } catch (e) {
          if (e instanceof ErrorApi && e.status < 500) {
            log(`Trabajo ${t.id}: el servidor ya no lo da por imprimiéndose (${e.message}); se para tras ${hechas} etiquetas`);
            return;
          }
          log(`Trabajo ${t.id}: no se pudo avisar del progreso (${mensaje(e)}); se sigue imprimiendo`);
        }
      }
      await this.finalizar(t.id, { hechas, fin: "impreso" });
    } finally {
      this.d.enCurso.borrar();
    }
  }

  /** Resultado final; ante fallos de red se reintenta unas cuantas veces. */
  private async finalizar(id: string, cuerpo: { hechas: number; fin: "impreso" | "error"; error?: string }): Promise<void> {
    const que = cuerpo.fin === "impreso" ? `impreso (${cuerpo.hechas} etiquetas)` : `error: ${cuerpo.error}`;
    for (let intento = 1;; intento++) {
      try {
        await this.d.api.progreso(id, cuerpo);
        this.d.log(`Trabajo ${id}: ${que}`);
        return;
      } catch (e) {
        if (e instanceof ErrorApi && e.status < 500) {
          this.d.log(`Trabajo ${id}: ${que}; el servidor no lo aceptó (${e.message})`);
          return;
        }
        if (intento >= 4) {
          this.d.log(`Trabajo ${id}: ${que}; no se pudo avisar al servidor (${mensaje(e)})`);
          return;
        }
        await this.d.dormir(5000 * 2 ** (intento - 1));
      }
    }
  }
}
