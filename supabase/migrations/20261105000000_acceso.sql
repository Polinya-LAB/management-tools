-- Acceso por correo: quién puede entrar a las apps del laboratorio y con qué rol.
-- Una fila por persona (email en minúsculas). Solo las Edge Functions `github` y `admin`
-- la leen y escriben, con la clave de servicio; los clientes no tienen acceso (RLS sin políticas).
-- roles: {"ensayos":"ver"|"editar", ...}; clave ausente = ninguno
--   claves: ensayos, muestras, calibraciones, mantenimiento, piscina
-- admin: puede gestionar personas y roles desde la función `admin`.

create table public.acceso (
  email text primary key check (email = lower(email)),
  user_id uuid references auth.users on delete set null,
  nombre text not null,
  roles jsonb not null default '{}',
  admin boolean not null default false,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

alter table public.acceso enable row level security;

create function public.acceso_actualizado()
returns trigger
language plpgsql
as $$
begin
  new.actualizado = now();
  return new;
end;
$$;

create trigger acceso_actualizado
before update on public.acceso
for each row execute function public.acceso_actualizado();
