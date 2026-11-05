// Punto de entrada de la Edge Function `admin`: crea las dependencias reales y sirve `crearHandlerAdmin`.
// verify_jwt = false en supabase/config.toml: la sesión la comprueba `usuario` (auth.getUser).

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import type { Acceso } from "../_shared/permisos.ts";
import { sesionDe } from "../_shared/sesion.ts";
import { type AdminDeps, crearHandlerAdmin } from "./handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const norm = (email: string) => email.trim().toLowerCase();

const deps: AdminDeps = {
  async usuario(jwt) {
    // Sin sesión solo ante un error de autenticación; los demás errores se lanzan (→ 502, las apps reintentan).
    return sesionDe(await supabase.auth.getUser(jwt));
  },
  async acceso(email) {
    const { data, error } = await supabase
      .from("acceso")
      .select("email, nombre, roles, admin")
      .eq("email", norm(email))
      .maybeSingle();
    if (error) throw error;
    return (data as Acceso | null) ?? null;
  },
  async listar() {
    const { data, error } = await supabase.from("acceso").select("email, nombre, roles, admin");
    if (error) throw error;
    return (data as Acceso[]) ?? [];
  },
  async guardar(a) {
    // upsert sin `user_id` no lo toca: en una actualización se conserva el existente.
    const { error } = await supabase.from("acceso").upsert(a, { onConflict: "email" });
    if (error) throw error;
  },
  async borrar(email) {
    const { error } = await supabase.from("acceso").delete().eq("email", norm(email));
    if (error) throw error;
  },
  // Idempotente: si el usuario de Auth ya existe (p. ej. un POST anterior falló al guardar la fila),
  // devuelve su id en vez de fallar.
  async crearUsuarioAuth(email) {
    const e = norm(email);
    const { data, error } = await supabase.auth.admin.createUser({ email: e, email_confirm: true });
    if (!error && data.user) return data.user.id;
    const yaExiste = error?.code === "email_exists" || error?.code === "user_already_exists" ||
      /already (been )?registered|already exists/i.test(error?.message ?? "");
    if (!yaExiste) throw error ?? new Error("createUser sin usuario");
    const porPagina = 200;
    for (let page = 1;; page++) {
      const { data: lista, error: e2 } = await supabase.auth.admin.listUsers({ page, perPage: porPagina });
      if (e2) throw e2;
      const u = lista.users.find((x) => x.email?.trim().toLowerCase() === e);
      if (u) return u.id;
      if (lista.users.length < porPagina) throw error;
    }
  },
  async borrarUsuarioAuth(email) {
    const { data, error } = await supabase
      .from("acceso")
      .select("user_id")
      .eq("email", norm(email))
      .maybeSingle();
    if (error) throw error;
    const id = (data as { user_id: string | null } | null)?.user_id;
    if (!id) return;
    const { error: e2 } = await supabase.auth.admin.deleteUser(id);
    if (e2) throw e2;
  },
};

Deno.serve(crearHandlerAdmin(deps));
