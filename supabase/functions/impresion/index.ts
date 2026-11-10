// Punto de entrada de la Edge Function `impresion`: crea las dependencias reales y sirve `crearHandlerImpresion`.
// verify_jwt = false en supabase/config.toml: la sesión la comprueba `usuario` (auth.getUser) y la estación usa su clave.

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import type { Acceso } from "../_shared/permisos.ts";
import { sesionDe } from "../_shared/sesion.ts";
import { crearHandlerImpresion, type Estacion, type ImpresionDeps, type Resumen, type Trabajo } from "./handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const T = "impresion_trabajo";
// Columnas sin las imágenes: lo que ve el portátil. `codigos` se guarda aparte al crear el trabajo.
const RESUMEN = "id, creado, por, nombre, rollo, unidades, codigos, n, hechas, estado, error, actualizado";
const aResumen = (r: unknown) => r as Resumen;

const deps: ImpresionDeps = {
  async usuario(jwt) {
    return sesionDe(await supabase.auth.getUser(jwt));
  },
  async acceso(email) {
    const { data, error } = await supabase.from("acceso").select("email, nombre, roles, admin").eq("email", email).maybeSingle();
    if (error) throw error;
    return (data as Acceso | null) ?? null;
  },
  async estacion() {
    const { data, error } = await supabase.from("impresion_estacion").select("token_hash, rollo, visto, estado, purgado").eq("id", "lab").single();
    if (error) throw error;
    return data as Estacion;
  },
  async guardarEstacion(cambios) {
    const { error } = await supabase.from("impresion_estacion").update({ ...cambios, actualizado: new Date().toISOString() }).eq("id", "lab");
    if (error) throw error;
  },
  async crearTrabajo(t) {
    const fila = { ...t, codigos: t.etiquetas.map((e) => e.codigo) };
    const { error } = await supabase.from(T).upsert(fila, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
    const { data, error: e2 } = await supabase.from(T).select("id, creado, por, nombre, rollo, etiquetas, unidades, n, hechas, estado, error, actualizado").eq("id", t.id).single();
    if (e2) throw e2;
    return data as Trabajo;
  },
  async trabajo(id) {
    const { data, error } = await supabase.from(T).select(RESUMEN).eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? aResumen(data) : null;
  },
  async ultimosDe(email, n) {
    const { data, error } = await supabase.from(T).select(RESUMEN).eq("por", email).order("creado", { ascending: false }).limit(n);
    if (error) throw error;
    return (data ?? []).map(aResumen);
  },
  async impresosDe(email, desde) {
    const { data, error } = await supabase.from(T).select("id, unidades").eq("por", email).eq("estado", "impreso")
      .gte("creado", desde.toISOString()).order("creado", { ascending: false }).limit(200);
    if (error) throw error;
    return (data as { id: string; unidades: string[] }[]) ?? [];
  },
  async tomarSiguiente() {
    const { data, error } = await supabase.rpc("impresion_tomar");
    if (error) throw error;
    return ((data as Trabajo[] | null) ?? [])[0] ?? null;
  },
  async actualizar(id, desde, cambios) {
    const { data, error } = await supabase.from(T).update({ ...cambios, actualizado: new Date().toISOString() })
      .eq("id", id).in("estado", desde).select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
  },
  async interrumpir(antes) {
    const { error } = await supabase.from(T).update({ estado: "error", error: "interrupted", actualizado: new Date().toISOString() })
      .eq("estado", "imprimiendo").lt("actualizado", antes.toISOString());
    if (error) throw error;
  },
  async purgar(antes) {
    const { error } = await supabase.from(T).delete().lt("creado", antes.toISOString());
    if (error) throw error;
  },
  ahora: () => new Date(),
  clave() {
    const b = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
};

Deno.serve(crearHandlerImpresion(deps));
