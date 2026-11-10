-- Cola de impresión de etiquetas (Muestras → estación del ordenador fijo con la DYMO).
-- Diseño: docs/superpowers/specs/2026-11-10-impresion-remota-dymo-design.md
-- Solo la Edge Function `impresion` lee y escribe, con la clave de servicio: RLS sin políticas y las funciones SQL
-- sin permiso para anon/authenticated.

create table public.impresion_estacion (
  id text primary key default 'lab' check (id = 'lab'),
  token_hash text,                       -- SHA-256 (hex) de la clave de la estación; null = sin configurar
  rollo text not null default '11354' check (rollo in ('99012', '99010', '11354', '11352')),
  visto timestamptz,                     -- último ciclo de la estación
  estado jsonb,                          -- {dymo, conectada, impresora, error}
  purgado timestamptz,                   -- última limpieza de trabajos viejos
  actualizado timestamptz not null default now()
);
insert into public.impresion_estacion (id) values ('lab');

create table public.impresion_trabajo (
  id uuid primary key,                   -- lo genera el portátil: un reenvío no duplica el trabajo
  creado timestamptz not null default now(),
  por text not null,                     -- correo de quien lo mandó
  nombre text not null,
  rollo text not null check (rollo in ('99012', '99010', '11354', '11352')),
  etiquetas jsonb not null,              -- [{codigo, png(base64)}]
  codigos jsonb not null default '[]',   -- códigos QTS, para listar sin traer las imágenes
  unidades jsonb not null default '[]',  -- claves "<recepción>:<n>" que se marcan impresas al terminar
  n integer not null check (n between 1 and 100),
  hechas integer not null default 0,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'imprimiendo', 'impreso', 'error')),
  error text,
  actualizado timestamptz not null default now()
);
create index impresion_trabajo_cola on public.impresion_trabajo (estado, creado);
create index impresion_trabajo_por on public.impresion_trabajo (por, creado desc);

alter table public.impresion_estacion enable row level security;
alter table public.impresion_trabajo enable row level security;

-- Toma el pendiente más antiguo y lo pasa a "imprimiendo" de una vez: dos llamadas a la vez no toman el mismo.
create function public.impresion_tomar()
returns setof public.impresion_trabajo
language sql
as $$
  update public.impresion_trabajo t
     set estado = 'imprimiendo', actualizado = now()
   where t.id = (
     select id from public.impresion_trabajo
      where estado = 'pendiente'
      order by creado
      limit 1
      for update skip locked)
  returning t.*;
$$;

revoke all on function public.impresion_tomar() from public, anon, authenticated;
revoke all on table public.impresion_estacion, public.impresion_trabajo from anon, authenticated;
