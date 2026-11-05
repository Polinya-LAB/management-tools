// Punto de entrada de la Edge Function `github`: crea las dependencias reales y sirve `crearHandler`.
// verify_jwt = false en supabase/config.toml: la sesión la comprueba `usuario` (auth.getUser).

import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import type { Acceso } from "../_shared/permisos.ts";
import { crearHandler, type Deps } from "./handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const deps: Deps = {
  async usuario(jwt) {
    const { data, error } = await supabase.auth.getUser(jwt);
    if (error || !data.user?.email) return null;
    return { email: data.user.email };
  },
  async acceso(email) {
    const { data, error } = await supabase
      .from("acceso")
      .select("email, nombre, roles, admin")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    if (error) throw error;
    return (data as Acceso | null) ?? null;
  },
  gh(path, init = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${Deno.env.get("GITHUB_TOKEN")}`);
    headers.set("Accept", "application/vnd.github+json");
    headers.set("X-GitHub-Api-Version", "2022-11-28");
    headers.set("User-Agent", "laboratorio-acceso");
    return fetch(`https://api.github.com${path}`, { ...init, headers });
  },
};

Deno.serve(crearHandler(deps));
