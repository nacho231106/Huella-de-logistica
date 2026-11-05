-- =====================================================================
-- Huella de logística · 01 esquema inicial  (YA APLICADO en "vergara-huella")
-- Solo hace falta correrlo si se arma la base en otro proyecto de Supabase.
-- Después correr 02_v2_hidrovia_compensacion.sql.
-- Nota: la tabla 'calculos' quedó reemplazada por 'envios' (v2) y no se usa.
-- =====================================================================
create table public.modos (
  id text primary key, nombre text not null, icono text not null default '🚚',
  tipo text not null check (tipo in ('maritimo','terrestre')),
  factor numeric not null check (factor >= 0), fuente text,
  verificar boolean not null default true, activo boolean not null default true,
  orden int not null default 0, updated_at timestamptz not null default now()
);
create table public.config (clave text primary key, valor jsonb not null, descripcion text);
create table public.sylvera_autorizados (email text primary key check (email = lower(email)), nombre text, agregado_at timestamptz not null default now());
create table public.perfiles (id uuid primary key references auth.users on delete cascade, nombre text, empresa text, created_at timestamptz not null default now());

-- Rol del usuario actual: coralia (@coraliae.com con email confirmado), sylvera (lista), cliente (resto)
create or replace function public.app_rol()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when x.uid is null then null
    when u.email_confirmed_at is null then 'cliente'
    when lower(u.email) like '%@coraliae.com' then 'coralia'
    when exists (select 1 from public.sylvera_autorizados s where s.email = lower(u.email)) then 'sylvera'
    else 'cliente' end
  from (select auth.uid() as uid) x left join auth.users u on u.id = x.uid;
$$;
revoke all on function public.app_rol() from public, anon;
grant execute on function public.app_rol() to authenticated;

-- Tabla 'calculos' (v1, SIN USO desde v2). Se crea solo para que la v2 encuentre la función verificar_certificado.
create table public.calculos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid() references auth.users on delete cascade,
  usuario_email text, carga text not null default '', empresa text, booking text,
  tramos jsonb not null default '[]'::jsonb, total_kg numeric not null default 0,
  total_km numeric not null default 0, total_tkm numeric not null default 0,
  estado text not null default 'borrador' check (estado in ('borrador','enviado','validado','rechazado')),
  comentario text, enviado_at timestamptz, revisado_at timestamptz, revisado_por text, certificado text unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.calculos enable row level security;
create or replace function public.verificar_certificado(codigo text)
returns table (certificado text) language sql stable security definer set search_path = '' as $$
  select c.certificado from public.calculos c where false;
$$;

alter table public.modos enable row level security;
alter table public.config enable row level security;
alter table public.sylvera_autorizados enable row level security;
alter table public.perfiles enable row level security;

create policy "modos: lectura pública" on public.modos for select to anon, authenticated using (activo or (select public.app_rol()) = 'coralia');
create policy "modos: coralia edita" on public.modos for all to authenticated
  using ((select public.app_rol()) = 'coralia') with check ((select public.app_rol()) = 'coralia');
create policy "config: lectura pública" on public.config for select to anon, authenticated using (true);
create policy "config: coralia edita" on public.config for all to authenticated
  using ((select public.app_rol()) = 'coralia') with check ((select public.app_rol()) = 'coralia');
create policy "sylvera: coralia administra" on public.sylvera_autorizados for all to authenticated
  using ((select public.app_rol()) = 'coralia') with check ((select public.app_rol()) = 'coralia');
create policy "perfiles: propio o coralia" on public.perfiles for select to authenticated
  using (id = (select auth.uid()) or (select public.app_rol()) = 'coralia');
create policy "perfiles: alta propia" on public.perfiles for insert to authenticated with check (id = (select auth.uid()));
create policy "perfiles: edita propio" on public.perfiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

insert into public.config (clave, valor, descripcion) values
  ('toneladas_por_m3', '1'::jsonb, 'Conversión de volumen a toneladas cuando solo se carga m3 (regla peso/medida).');
insert into public.modos (id, nombre, icono, tipo, factor, fuente, verificar, orden) values
  ('buque-vergara', 'Buque Vergara · carril costero', '🚢', 'maritimo', 0.016, '[Completar: dato propio de Vergara]', true, 1),
  ('camion-articulado', 'Camión articulado (semirremolque)', '🚚', 'terrestre', 0.08, '[Completar fuente]', true, 2),
  ('camion-rigido', 'Camión rígido', '🚛', 'terrestre', 0.2, '[Completar fuente]', true, 3),
  ('ferrocarril', 'Ferrocarril de carga', '🚆', 'terrestre', 0.03, '[Completar fuente]', true, 4);
