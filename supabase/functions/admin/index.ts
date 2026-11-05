// Punto de entrada de la Edge Function `admin`: crea las dependencias reales y sirve `crearHandlerAdmin`.
// verify_jwt = false en supabase/config.toml: la sesión la comprueba `usuario` (auth.getUser).

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import type { Acceso } from "../_shared/permisos.ts";
import { sesionDe } from "../_shared/sesion.ts";
import { type AdminDeps, crearHandlerAdmin } from "./handler.ts";
import { ponerPasswordPorId } from "./password.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const norm = (email: string) => email.trim().toLowerCase();

// Busca el usuario de Auth por correo, página a página (la API de administración no filtra por correo).
async function idAuthPorCorreo(e: string): Promise<string | null> {
  const porPagina = 200;
  for (let page = 1;; page++) {
    const { data: lista, error } = await supabase.auth.admin.listUsers({ page, perPage: porPagina });
    if (error) throw error;
    const u = lista.users.find((x) => x.email?.trim().toLowerCase() === e);
    if (u) return u.id;
    if (lista.users.length < porPagina) return null;
  }
}


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
  // le pone la contraseña dada y devuelve su id en vez de fallar.
  async crearUsuarioAuth(email, password) {
    const e = norm(email);
    const { data, error } = await supabase.auth.admin.createUser({ email: e, password, email_confirm: true });
    if (!error && data.user) return data.user.id;
    const yaExiste = error?.code === "email_exists" || error?.code === "user_already_exists" ||
      /already (been )?registered|already exists/i.test(error?.message ?? "");
    if (!yaExiste) throw error ?? new Error("createUser sin usuario");
    const id = await idAuthPorCorreo(e);
    if (!id) throw error;
    // Recién encontrado por correo: si ahora no existe, alguien lo ha borrado a la vez; se trata como cualquier error.
    if (!await ponerPasswordPorId(supabase.auth.admin, id, password)) throw error;
    return id;
  },
  async ponerPassword(email, password) {
    const e = norm(email);
    const { data, error } = await supabase.from("acceso").select("user_id").eq("email", e).maybeSingle();
    if (error) throw error;
    const id = (data as { user_id: string | null } | null)?.user_id ?? await idAuthPorCorreo(e);
    if (!id) return false;
    // Un user_id que ya no existe en Auth (usuario borrado a mano) da false → 409, no 502.
    return await ponerPasswordPorId(supabase.auth.admin, id, password);
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
