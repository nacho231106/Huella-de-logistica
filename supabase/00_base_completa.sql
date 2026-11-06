-- =====================================================================
-- Huella de logística · BASE COMPLETA (01 + 02 + 03 + 04 en un solo archivo)
-- Para un proyecto de Supabase NUEVO y vacío.
-- CÓMO CORRERLO: supabase.com → proyecto → SQL Editor → pegar TODO → Run.
-- Se corre una sola vez. Después, en config.js, poner la URL y la clave
-- publishable del proyecto (Settings → API).
-- =====================================================================


-- #####################################################################
-- ### 01
-- #####################################################################
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


-- #####################################################################
-- ### 02
-- #####################################################################
-- =====================================================================
-- Huella de logística · v2 (hidrovía + compensación + estados de revisión)
-- CÓMO CORRERLO: supabase.com → proyecto "vergara-huella" → SQL Editor →
-- pegar TODO este archivo → Run. Se corre una sola vez. No borra nada.
-- =====================================================================

-- Arreglo: los visitantes sin login tienen que poder leer modos/config
grant execute on function public.app_rol() to anon;

-- ===== Modos: columna 'via' (costero / hidrovia / terrestre) =====
alter table public.modos add column if not exists via text not null default 'terrestre' check (via in ('costero','hidrovia','terrestre'));
update public.modos set via = 'costero' where tipo = 'maritimo' and id = 'buque-vergara';
update public.modos set orden = orden + 10,
  nombre = replace(nombre, 'Buque Vergara', 'Buque InterBarge'),
  fuente = replace(fuente, 'Vergara', 'InterBarge')
  where id in ('buque-vergara','camion-articulado','camion-rigido','ferrocarril') and orden < 10;
-- InterBarge opera solo en la hidrovía: el buque del carril costero queda desactivado
update public.modos set activo = false where id = 'buque-vergara';
insert into public.modos (id, nombre, icono, tipo, via, factor, fuente, verificar, orden) values
  ('convoy-2',   'Convoy · empujador + 2 barcazas',       '⛴️', 'maritimo', 'hidrovia', 0.017,  'GLEC Framework v2.0 · vías navegables interiores, gasóleo, WTW. Reemplazar por factor propio de la flota.', true, 1),
  ('convoy-4-5', 'Convoy · empujador + 4/5 barcazas',     '⛴️', 'maritimo', 'hidrovia', 0.010,  'GLEC Framework v2.0 · vías navegables interiores, gasóleo, WTW. Reemplazar por factor propio de la flota.', true, 2),
  ('convoy-6',   'Convoy · empujador + 6 o más barcazas', '⛴️', 'maritimo', 'hidrovia', 0.0074, 'GLEC Framework v2.0 · vías navegables interiores, gasóleo, WTW. Reemplazar por factor propio de la flota.', true, 3)
on conflict (id) do nothing;

-- ===== Configuración =====
update public.config set descripcion = '[SIN USO desde v2: ver densidades]' where clave = 'toneladas_por_m3';
insert into public.config (clave, valor, descripcion) values
  ('densidades', '{"solido":0.75,"liquido":0.88,"general":1}'::jsonb, 'Toneladas por m³ según tipo de carga.'),
  ('toneladas_por_teu', '10'::jsonb, 'Toneladas promedio por TEU.'),
  ('ajuste_sentido', '{"arriba":1.25,"abajo":0.85,"ilustrativo":true}'::jsonb, 'Multiplicador del factor en la hidrovía según sentido. ILUSTRATIVO: definir con datos de consumo por sentido.')
on conflict (clave) do nothing;

-- ===== Proyectos de compensación (EJEMPLO) =====
create table if not exists public.proyectos (
  id text primary key,
  tag text not null,
  nombre text not null,
  lugar text,
  estandar text,
  usd_por_t numeric not null check (usd_por_t >= 0),
  ejemplo boolean not null default true,
  activo boolean not null default true,
  orden int not null default 0
);
alter table public.proyectos enable row level security;
create policy "proyectos: lectura pública" on public.proyectos for select to anon, authenticated using (activo or (select public.app_rol()) = 'coralia');
create policy "proyectos: coralia edita" on public.proyectos for all to authenticated
  using ((select public.app_rol()) = 'coralia') with check ((select public.app_rol()) = 'coralia');
insert into public.proyectos (id, tag, nombre, lugar, estandar, usd_por_t, orden) values
  ('p1', 'Forestación nativa', 'Restauración de bosque chaqueño', 'Chaco, Argentina', 'Verra VCS · 2024', 18, 1),
  ('p2', 'Metano evitado', 'Biodigestores en tambos', 'Santa Fe, Argentina', 'Gold Standard · 2023', 12, 2),
  ('p3', 'Conservación', 'Humedales del Delta del Paraná', 'Entre Ríos, Argentina', 'Verra VCS · 2024', 15, 3)
on conflict (id) do nothing;

-- ===== Cálculo de tramos (v2) =====
create or replace function public.calcular_tramos_v2(p_tramos jsonb, out tramos jsonb, out total_kg numeric, out total_km numeric, out total_tkm numeric)
language plpgsql stable set search_path = '' as $$
declare
  t jsonb; m public.modos%rowtype; dens jsonb; t_teu numeric; adj jsonb;
  dist numeric; q numeric; ton numeric; mult numeric; kg numeric; u text;
begin
  select valor into dens from public.config where clave = 'densidades';
  select (valor #>> '{}')::numeric into t_teu from public.config where clave = 'toneladas_por_teu';
  select valor into adj from public.config where clave = 'ajuste_sentido';
  dens := coalesce(dens, '{}'::jsonb); t_teu := coalesce(t_teu, 10); adj := coalesce(adj, '{}'::jsonb);
  tramos := '[]'::jsonb; total_kg := 0; total_km := 0; total_tkm := 0;
  for t in select * from jsonb_array_elements(coalesce(p_tramos, '[]'::jsonb)) loop
    m := null;
    select * into m from public.modos where id = t->>'modo';
    dist := greatest(coalesce(nullif(t->>'dist','')::numeric, 0), 0);
    q := greatest(coalesce(nullif(t->>'cantidad','')::numeric, 0), 0);
    u := coalesce(t->>'unidad', 't');
    ton := case u
      when 'kg'  then q / 1000
      when 't'   then q
      when 'm3'  then q * coalesce((dens ->> coalesce(t->>'tipo_carga','general'))::numeric, 1)
      when 'teu' then q * t_teu
      else 0 end;
    mult := 1;
    if m.via = 'hidrovia' then
      mult := case t->>'sentido'
        when 'arriba' then coalesce((adj->>'arriba')::numeric, 1)
        when 'abajo'  then coalesce((adj->>'abajo')::numeric, 1)
        else 1 end;
    end if;
    kg := case when m.id is null then 0 else dist * ton * m.factor * mult end;
    total_kg := total_kg + kg; total_km := total_km + dist; total_tkm := total_tkm + dist * ton;
    tramos := tramos || jsonb_build_array(t || jsonb_build_object(
      'toneladas', round(ton, 4), 'kg', round(kg, 3), 'factor', m.factor, 'ajuste', mult,
      'fuente', m.fuente, 'modo_nombre', m.nombre, 'via', m.via));
  end loop;
  total_kg := round(total_kg, 3); total_km := round(total_km, 1); total_tkm := round(total_tkm, 1);
end $$;

-- ===== Envíos (reemplaza a la tabla 'calculos', que queda sin uso) =====
create table if not exists public.envios (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid() references auth.users on delete cascade,
  usuario_email text,
  carga text not null default '',
  empresa text,
  booking text,
  tramos jsonb not null default '[]'::jsonb,
  total_kg numeric not null default 0,
  total_km numeric not null default 0,
  total_tkm numeric not null default 0,
  proyecto_id text references public.proyectos,
  creditos int,
  usd_estimado numeric,
  estado text not null default 'borrador'
    check (estado in ('borrador','enviado','en_validacion','validado','retirado','rechazado')),
  comentario text,
  rechazo_rol text,
  enviado_at timestamptz,
  revisado_at timestamptz,
  revisado_por text,
  retirado_at timestamptz,
  retiro_ref text,
  certificado text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.envios is 'Cálculos de huella. Estados: borrador → enviado (revisión Coralia) → en_validacion (Sylvera) → validado → retirado (créditos retirados). rechazado en cualquier revisión.';
create index if not exists envios_usuario_idx on public.envios (usuario_id);
create index if not exists envios_estado_idx on public.envios (estado);
create index if not exists envios_proyecto_idx on public.envios (proyecto_id);

create or replace function public.envios_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  rol text := public.app_rol();
  mail text := lower(auth.jwt() ->> 'email');
  r record; precio numeric;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.usuario_id := auth.uid(); end if;
    new.usuario_email := mail;
    if new.estado not in ('borrador','enviado') then raise exception 'Un cálculo nuevo solo puede ser borrador o enviado'; end if;
    new.comentario := null; new.revisado_at := null; new.revisado_por := null; new.certificado := null;
    new.rechazo_rol := null; new.retirado_at := null; new.retiro_ref := null;
    new.enviado_at := case when new.estado = 'enviado' then now() end;
  else
    new.id := old.id; new.usuario_id := old.usuario_id; new.usuario_email := old.usuario_email; new.created_at := old.created_at;

    if rol = 'coralia' then
      null;
    elsif rol = 'sylvera' and old.usuario_id <> auth.uid() then
      if old.estado <> 'en_validacion' or new.estado not in ('en_validacion','validado','rechazado') then
        raise exception 'Sylvera solo puede validar o rechazar cálculos enviados a validación';
      end if;
      new.tramos := old.tramos; new.carga := old.carga; new.empresa := old.empresa; new.booking := old.booking;
      new.proyecto_id := old.proyecto_id; new.retiro_ref := old.retiro_ref; new.retirado_at := old.retirado_at;
    else
      if old.estado not in ('borrador','rechazado') then raise exception 'Este cálculo ya fue enviado y no se puede modificar'; end if;
      if new.estado not in ('borrador','enviado') then raise exception 'Estado no permitido'; end if;
      new.comentario := old.comentario; new.revisado_at := old.revisado_at; new.revisado_por := old.revisado_por;
      new.certificado := old.certificado; new.enviado_at := old.enviado_at; new.rechazo_rol := old.rechazo_rol;
      new.retirado_at := old.retirado_at; new.retiro_ref := old.retiro_ref;
    end if;

    if new.estado is distinct from old.estado then
      if new.estado = 'enviado' then new.enviado_at := now(); new.rechazo_rol := null; end if;
      if new.estado in ('en_validacion','validado','rechazado') then new.revisado_at := now(); new.revisado_por := mail; end if;
      if new.estado = 'rechazado' then new.rechazo_rol := rol; end if;
      if new.estado = 'retirado' then
        if old.estado <> 'validado' then raise exception 'Solo se retiran créditos de un cálculo validado'; end if;
        if new.proyecto_id is null then raise exception 'El cálculo no tiene proyecto de compensación'; end if;
        new.retirado_at := now();
      end if;
    end if;
  end if;

  if new.estado in ('validado','retirado') then
    if new.certificado is null then
      new.certificado := 'HC-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(new.id::text, '-', ''), 1, 8));
    end if;
  elsif tg_op = 'INSERT' or new.tramos is distinct from old.tramos or new.estado is distinct from old.estado or new.proyecto_id is distinct from old.proyecto_id then
    select * into r from public.calcular_tramos_v2(new.tramos);
    new.tramos := r.tramos; new.total_kg := r.total_kg; new.total_km := r.total_km; new.total_tkm := r.total_tkm;
    if new.proyecto_id is not null then
      select usd_por_t into precio from public.proyectos where id = new.proyecto_id;
      new.creditos := ceil(new.total_kg / 1000.0)::int;
      new.usd_estimado := new.creditos * coalesce(precio, 0);
    else
      new.creditos := null; new.usd_estimado := null;
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger envios_guard before insert or update on public.envios
for each row execute function public.envios_guard();

alter table public.envios enable row level security;
create policy "envios: ver" on public.envios for select to authenticated using (
  usuario_id = (select auth.uid())
  or (select public.app_rol()) = 'coralia'
  or ((select public.app_rol()) = 'sylvera'
      and (estado in ('en_validacion','validado','retirado') or (estado = 'rechazado' and rechazo_rol = 'sylvera')))
);
create policy "envios: crear propio" on public.envios for insert to authenticated
  with check (usuario_id = (select auth.uid()));
create policy "envios: editar" on public.envios for update to authenticated using (
  usuario_id = (select auth.uid())
  or (select public.app_rol()) = 'coralia'
  or ((select public.app_rol()) = 'sylvera' and estado = 'en_validacion')
) with check (
  usuario_id = (select auth.uid())
  or (select public.app_rol()) in ('coralia','sylvera')
);
create policy "envios: borrar" on public.envios for delete to authenticated using (
  (usuario_id = (select auth.uid()) and estado in ('borrador','rechazado'))
  or (select public.app_rol()) = 'coralia'
);

-- ===== Verificación pública del certificado =====
create or replace function public.verificar_envio(codigo text)
returns table (certificado text, estado text, carga text, empresa text, total_kg numeric, total_km numeric, total_tkm numeric,
               revisado_at timestamptz, tramos jsonb, creditos int, proyecto text, proyecto_estandar text, retirado_at timestamptz, retiro_ref text)
language sql stable security definer set search_path = '' as $$
  select e.certificado, e.estado, e.carga, e.empresa, e.total_kg, e.total_km, e.total_tkm, e.revisado_at, e.tramos,
         e.creditos, p.nombre, p.estandar, e.retirado_at, e.retiro_ref
  from public.envios e left join public.proyectos p on p.id = e.proyecto_id
  where e.certificado = upper(trim(codigo)) and e.estado in ('validado','retirado');
$$;
grant execute on function public.verificar_envio(text) to anon, authenticated;

-- Avisar a la API que hay tablas nuevas
notify pgrst, 'reload schema';


-- #####################################################################
-- ### 03
-- #####################################################################
-- =====================================================================
-- Huella de logística · v3 (orden de compra + factor propio de la flota + Bolsa Paraguaya de Carbono)
-- CÓMO CORRERLO: supabase.com → proyecto "vergara-huella" → SQL Editor →
-- pegar TODO este archivo → Run. Se corre una sola vez, DESPUÉS de la 02. No borra datos.
-- =====================================================================

-- ===== Factor propio de la flota (inventario GEI InterBarge 2025, Coralia) =====
-- Emisiones operativas de la flota 2025: 62.295 t CO2e
--   motores principales 55.173,5 + generadores 4.280,4 + embarcaciones auxiliares 444,1
--   + lubricantes 389,6 + refrigerantes 1.191,5 + remolcadores de terceros 259,7 + slop 556,5
--   (quedan afuera oficinas, electricidad, vuelos, autos y basura común: no son parte del servicio de transporte)
-- Toneladas transportadas 2025: 1.826.094 t  →  34,1 kg CO2e por tonelada
-- Distancia media por tonelada: 1.500 km (SUPUESTO de Coralia, el inventario no trae t·km)
-- Factor = 62.295.000 kg / (1.826.094 t × 1.500 km) = 0,0227 kg CO2e/t·km
insert into public.modos (id, nombre, icono, tipo, via, factor, fuente, verificar, orden) values
  ('flota-interbarge', 'Convoy InterBarge (flota propia)', '⛴️', 'maritimo', 'hidrovia', 0.0227,
   'Inventario GEI InterBarge 2025 (Coralia, ISO 14064-1): 62.295 t CO2e operativas ÷ (1.826.094 t × 1.500 km de distancia media supuesta)', true, 0)
on conflict (id) do update set factor = excluded.factor, fuente = excluded.fuente, nombre = excluded.nombre, activo = true;

-- Los factores genéricos y los otros modos dejan de mostrarse (quedan guardados por si se vuelven a usar)
update public.modos set activo = false where id <> 'flota-interbarge';

insert into public.config (clave, valor, descripcion) values
  ('factor_flota', '{"anio":2025,"emisiones_t":62295,"toneladas":1826094,"distancia_media_km":1500}'::jsonb,
   'Datos con los que se calculó el factor de la flota. Si cambia algo, recalcular modos.factor de flota-interbarge = emisiones_t*1000/(toneladas*distancia_media_km).')
on conflict (clave) do update set valor = excluded.valor;
-- Sin datos de consumo por sentido: el ajuste queda neutro
update public.config set valor = '{"arriba":1,"abajo":1,"ilustrativo":false}'::jsonb where clave = 'ajuste_sentido';

-- ===== Datos de la orden de compra en cada envío =====
alter table public.envios
  add column if not exists oc_numero text,
  add column if not exists oc_archivo text,
  add column if not exists flete_usd numeric check (flete_usd is null or flete_usd >= 0);
comment on column public.envios.oc_archivo is 'Ruta del archivo de la OC en el bucket "ordenes" (carpeta = id del usuario).';

-- ===== Bolsa Paraguaya de Carbono =====
create table if not exists public.bolsa_autorizados (
  email text primary key check (email = lower(email)),
  nombre text,
  agregado_at timestamptz not null default now()
);
alter table public.bolsa_autorizados enable row level security;
drop policy if exists "bolsa: coralia administra" on public.bolsa_autorizados;
create policy "bolsa: coralia administra" on public.bolsa_autorizados for all to authenticated
  using ((select public.app_rol()) = 'coralia') with check ((select public.app_rol()) = 'coralia');

create or replace function public.app_rol()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when x.uid is null then null
    when u.email_confirmed_at is null then 'cliente'
    when lower(u.email) like '%@coraliae.com' then 'coralia'
    when exists (select 1 from public.sylvera_autorizados s where s.email = lower(u.email)) then 'sylvera'
    when exists (select 1 from public.bolsa_autorizados b where b.email = lower(u.email)) then 'bolsa'
    else 'cliente' end
  from (select auth.uid() as uid) x left join auth.users u on u.id = x.uid;
$$;

-- ===== Reglas de edición de envíos (reemplaza la de la v2) =====
create or replace function public.envios_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  rol text := public.app_rol();
  mail text := lower(auth.jwt() ->> 'email');
  r record; precio numeric;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.usuario_id := auth.uid(); end if;
    new.usuario_email := mail;
    if new.estado not in ('borrador','enviado') then raise exception 'Un cálculo nuevo solo puede ser borrador o enviado'; end if;
    new.comentario := null; new.revisado_at := null; new.revisado_por := null; new.certificado := null;
    new.rechazo_rol := null; new.retirado_at := null; new.retiro_ref := null;
    new.enviado_at := case when new.estado = 'enviado' then now() end;
  else
    new.id := old.id; new.usuario_id := old.usuario_id; new.usuario_email := old.usuario_email; new.created_at := old.created_at;

    if rol = 'coralia' then
      null;
    elsif rol in ('sylvera','bolsa') and old.usuario_id <> auth.uid() then
      if rol = 'sylvera' and (old.estado <> 'en_validacion' or new.estado not in ('en_validacion','validado','rechazado')) then
        raise exception 'Sylvera solo puede validar u observar cálculos enviados a validación';
      end if;
      if rol = 'bolsa' and (old.estado <> 'validado' or new.estado not in ('validado','retirado')) then
        raise exception 'La Bolsa solo puede registrar el retiro de créditos de cálculos validados';
      end if;
      -- Los datos del envío no se tocan
      new.tramos := old.tramos; new.carga := old.carga; new.empresa := old.empresa; new.booking := old.booking;
      new.proyecto_id := old.proyecto_id; new.oc_numero := old.oc_numero; new.oc_archivo := old.oc_archivo; new.flete_usd := old.flete_usd;
      new.total_kg := old.total_kg; new.total_km := old.total_km; new.total_tkm := old.total_tkm;
      new.creditos := old.creditos; new.usd_estimado := old.usd_estimado; new.certificado := old.certificado;
      if rol = 'sylvera' then new.retiro_ref := old.retiro_ref; new.retirado_at := old.retirado_at; end if;
      if rol = 'bolsa' then new.comentario := old.comentario; end if;
    else
      if old.estado not in ('borrador','rechazado') then raise exception 'Este cálculo ya fue enviado y no se puede modificar'; end if;
      if new.estado not in ('borrador','enviado') then raise exception 'Estado no permitido'; end if;
      new.comentario := old.comentario; new.revisado_at := old.revisado_at; new.revisado_por := old.revisado_por;
      new.certificado := old.certificado; new.enviado_at := old.enviado_at; new.rechazo_rol := old.rechazo_rol;
      new.retirado_at := old.retirado_at; new.retiro_ref := old.retiro_ref;
    end if;

    if new.estado is distinct from old.estado then
      if new.estado = 'enviado' then new.enviado_at := now(); new.rechazo_rol := null; end if;
      if new.estado in ('en_validacion','validado','rechazado') then new.revisado_at := now(); new.revisado_por := mail; end if;
      if new.estado = 'rechazado' then new.rechazo_rol := rol; end if;
      if new.estado = 'retirado' then
        if old.estado <> 'validado' then raise exception 'Solo se retiran créditos de un cálculo validado'; end if;
        if new.proyecto_id is null then raise exception 'El cálculo no tiene proyecto de compensación'; end if;
        if coalesce(trim(new.retiro_ref), '') = '' then raise exception 'Falta la referencia del retiro'; end if;
        new.retirado_at := now();
      end if;
    end if;
  end if;

  if new.estado in ('validado','retirado') then
    if new.certificado is null then
      new.certificado := 'HC-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(new.id::text, '-', ''), 1, 8));
    end if;
  elsif tg_op = 'INSERT' or new.tramos is distinct from old.tramos or new.estado is distinct from old.estado or new.proyecto_id is distinct from old.proyecto_id then
    select * into r from public.calcular_tramos_v2(new.tramos);
    new.tramos := r.tramos; new.total_kg := r.total_kg; new.total_km := r.total_km; new.total_tkm := r.total_tkm;
    if new.proyecto_id is not null then
      select usd_por_t into precio from public.proyectos where id = new.proyecto_id;
      new.creditos := ceil(new.total_kg / 1000.0)::int;
      new.usd_estimado := new.creditos * coalesce(precio, 0);
    else
      new.creditos := null; new.usd_estimado := null;
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

-- ===== Permisos de envíos con la Bolsa =====
drop policy if exists "envios: ver" on public.envios;
create policy "envios: ver" on public.envios for select to authenticated using (
  usuario_id = (select auth.uid())
  or (select public.app_rol()) = 'coralia'
  or ((select public.app_rol()) = 'sylvera'
      and (estado in ('en_validacion','validado','retirado') or (estado = 'rechazado' and rechazo_rol = 'sylvera')))
  or ((select public.app_rol()) = 'bolsa' and proyecto_id is not null and estado in ('validado','retirado'))
);
drop policy if exists "envios: editar" on public.envios;
create policy "envios: editar" on public.envios for update to authenticated using (
  usuario_id = (select auth.uid())
  or (select public.app_rol()) = 'coralia'
  or ((select public.app_rol()) = 'sylvera' and estado = 'en_validacion')
  or ((select public.app_rol()) = 'bolsa' and estado = 'validado' and proyecto_id is not null)
) with check (
  usuario_id = (select auth.uid())
  or (select public.app_rol()) in ('coralia','sylvera','bolsa')
);

-- ===== Archivos de las órdenes de compra (privados) =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ordenes', 'ordenes', false, 10485760,
  array['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv'])
on conflict (id) do nothing;

drop policy if exists "ordenes: subir propias" on storage.objects;
create policy "ordenes: subir propias" on storage.objects for insert to authenticated
  with check (bucket_id = 'ordenes' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "ordenes: ver" on storage.objects;
create policy "ordenes: ver" on storage.objects for select to authenticated using (
  bucket_id = 'ordenes' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select public.app_rol()) in ('coralia','sylvera','bolsa')
  )
);

-- ===== Verificación pública del certificado (suma N° de OC) =====
drop function if exists public.verificar_envio(text);
create function public.verificar_envio(codigo text)
returns table (certificado text, estado text, carga text, empresa text, oc_numero text, total_kg numeric, total_km numeric, total_tkm numeric,
               revisado_at timestamptz, tramos jsonb, creditos int, proyecto text, proyecto_estandar text, retirado_at timestamptz, retiro_ref text)
language sql stable security definer set search_path = '' as $$
  select e.certificado, e.estado, e.carga, e.empresa, e.oc_numero, e.total_kg, e.total_km, e.total_tkm, e.revisado_at, e.tramos,
         e.creditos, p.nombre, p.estandar, e.retirado_at, e.retiro_ref
  from public.envios e left join public.proyectos p on p.id = e.proyecto_id
  where e.certificado = upper(trim(codigo)) and e.estado in ('validado','retirado');
$$;
grant execute on function public.verificar_envio(text) to anon, authenticated;

notify pgrst, 'reload schema';


-- #####################################################################
-- ### 04
-- #####################################################################
-- =====================================================================
-- Huella de logística · 04 · tramos terrestres (camión y tren) y metadatos de los factores
-- CÓMO CORRERLO: supabase.com → proyecto → SQL Editor → pegar TODO → Run. Va DESPUÉS de la 03.
-- Se puede correr más de una vez sin error: deja siempre el mismo resultado.
--
-- QUÉ HACE
--   1. Agrega la columna modos.metadatos (jsonb) con los datos que pide el estándar Coralia
--      de factores (lib/ef/standard.js): GWP, límites, fósil/biogénico/dLUC, gases, DQR,
--      fuente localizable, licencia y verificación.
--   2. Carga los metadatos del factor de la flota (inventario GEI InterBarge 2025). No cambia su valor.
--   3. Crea o actualiza los tres medios terrestres con los factores DESNZ 2025
--      (hoja Freighting goods, carga promedio, por t·km, tanque a rueda, GWP AR5):
--        camion-articulado 0,078 · camion-rigido 0,19748 · ferrocarril 0,02779
--
-- CÓMO DESHACERLA
--   update public.modos set activo = false where id in ('camion-articulado','camion-rigido','ferrocarril');
--   alter table public.modos drop column if exists metadatos;
--   (Los envíos ya guardados conservan sus tramos y su huella: el cálculo queda guardado en cada envío.)
-- =====================================================================

alter table public.modos add column if not exists metadatos jsonb;
comment on column public.modos.metadatos is 'Metadatos del factor según el estándar Coralia (lib/ef/standard.js). Se audita con scripts/auditar-factores.mjs.';

update public.modos set metadatos = $json${"name": "Convoy de empuje InterBarge en la hidrovía Paraná-Paraguay", "name_en": "InterBarge push-tow convoy on the Paraná-Paraguay waterway", "unit": "kg CO2e/t·km", "gwp_source": "IPCC AR6 (inventario: CH4 27,9 y N2O 273, hoja FE - Parámetros)", "gwp_horizonte": 100, "limites_sistema": "Tanque a rueda (TTW) de la operación de la flota: combustión en motores principales, generadores y embarcaciones auxiliares, lubricantes, refrigerantes, remolcadores de puerto contratados y tratamiento de slop. Sin producción del combustible (WTT).", "metodo_asignacion": "Por masa transportada (t·km): emisiones operativas anuales ÷ (toneladas transportadas × distancia media por tonelada).", "tipo_factor": "combustion", "alcance": "3", "categoria_ghg": "S3.4 Transporte y distribución aguas arriba (S3.9 si el flete lo paga el cliente final)", "categoria_iso14064": "Categoría 3: emisiones indirectas del transporte", "ef_fosil": 0.022743, "ef_biogenico": 0.000315, "ef_dluc": 0, "nota_biogenico": "CO2 biogénico de la mezcla B2 (gasoil) y E25 (nafta): 862,9 t en 2025, reportado aparte y no sumado al factor.", "region": "Hidrovía Paraná-Paraguay (Paraguay, Argentina, Uruguay, Brasil, Bolivia)", "data_year": 2025, "representatividad_tecnologica": "Flota propia de remolcadores de empuje (motores EMD/ALCO) con convoyes de barcazas.", "dqr_ter": 1, "dqr_ger": 1, "dqr_tir": 1, "dqr_p": 3, "dqr_total": 1.5, "dqr_nota": "PEF (1 = mejor, 5 = peor). TeR, GeR y TiR 1: dato propio de la flota, de la hidrovía y de 2025. P 3: generadores y embarcaciones auxiliares estimados, y distancia media de 1.500 km supuesta (el inventario no trae t·km).", "fuente_organismo": "Coralia Environmental, con datos de InterBarge", "fuente_documento": "Inventario de GEI InterBarge 2024 y 2025 (ISO 14064-1 / GHG Protocol), julio 2026", "fuente_archivo": "Calculo inventario GEI - Interbarge 2024 y 2025-CoraliaEnvironmental.xlsx · hoja RESUMEN 2024-2025, filas 11-22 (emisiones por fuente), fila 24 (biogénicas) y fila 28 (toneladas transportadas)", "valor_original": 62295.4, "unidad_original": "t CO2e/año (2025) y 1.826.094 t transportadas/año", "conversion": "62.295 t CO2e × 1.000 ÷ (1.826.094 t × 1.500 km) = 0,0227 kg CO2e/t·km", "licencia": "Datos primarios de InterBarge procesados por Coralia, para el servicio de huella de InterBarge", "uso_comercial": true, "nota_licencia": "A confirmar por Nico: que InterBarge autoriza usar su inventario en la calculadora pública.", "verificacion": "Consultor (Coralia). Sin verificación de tercera parte.", "modulos": ["producto", "corporativo"]}$json$::jsonb
where id = 'flota-interbarge';

insert into public.modos (id, nombre, icono, tipo, via, factor, fuente, verificar, orden, activo, metadatos) values
  ('camion-articulado', 'Camión articulado', '🚚', 'terrestre', 'terrestre', 0.078,
   'DESNZ 2025 · HGV (all diesel), All artics, carga promedio · hoja Freighting goods, fila 60', false, 12, true,
   $json${"unit": "kg CO2e/t·km", "gwp_source": "IPCC AR5 (DESNZ 2025, hoja Introduction, fila 35)", "gwp_horizonte": 100, "limites_sistema": "Tanque a rueda (TTW): combustión del vehículo durante el transporte. Sin producción del combustible (WTT), que DESNZ publica aparte en el set completo.", "metodo_asignacion": "Por masa transportada (t·km): DESNZ deriva el factor por t·km del factor por km con la carga media nacional (hoja Freighting goods, fila 12).", "tipo_factor": "combustion", "alcance": "3", "categoria_ghg": "S3.4 Transporte y distribución aguas arriba (S3.9 si el flete lo paga el cliente final)", "categoria_iso14064": "Categoría 3: emisiones indirectas del transporte", "ef_biogenico": 0, "ef_dluc": 0, "nota_biogenico": "DESNZ no publica el CO2 biogénico por t·km para fletes: el factor cuenta solo el CO2 fósil. Se declara 0.", "pais_iso3": "GBR", "region": "Reino Unido (proxy para Argentina, Paraguay, Uruguay y Brasil)", "data_year": 2025, "dqr_ter": 2, "dqr_ger": 3, "dqr_tir": 1, "dqr_p": 2, "dqr_total": 2.0, "dqr_nota": "PEF (1 = mejor, 5 = peor). TeR 2: camión/tren diésel comparable. GeR 3: dato del Reino Unido usado en Sudamérica. TiR 1: set 2025. P 2: estadística oficial.", "fuente_organismo": "UK Department for Energy Security and Net Zero (DESNZ)", "fuente_documento": "UK Government GHG Conversion Factors for Company Reporting 2025, condensed set, versión 1", "fuente_url": "https://assets.publishing.service.gov.uk/media/6846a4e6d25e6f6afd4c0180/ghg-conversion-factors-2025-condensed-set.xlsx", "fuente_pagina": "https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2025", "licencia": "Open Government Licence v3.0 (Crown copyright)", "uso_comercial": true, "verificacion": "Publicación oficial del gobierno del Reino Unido. Sin verificación de tercera parte específica para este uso.", "modulos": ["producto", "corporativo"], "name": "Camión articulado diésel, carga promedio", "name_en": "Articulated HGV, diesel, average laden", "ef_fosil": 0.078, "ef_co2": 0.07672, "ef_ch4": 1e-05, "ef_n2o": 0.00127, "representatividad_tecnologica": "HGV (all diesel), All artics: promedio de camiones articulados del Reino Unido, carga promedio.", "fuente_archivo": "ghg-conversion-factors-2025-condensed-set.xlsx · hoja Freighting goods, fila 60 (All artics, tonne.km), columnas P a S (Average laden)", "valor_original": 0.078, "unidad_original": "kg CO2e/tonne.km", "conversion": "Sin conversión"}$json$::jsonb),
  ('camion-rigido', 'Camión rígido', '🚛', 'terrestre', 'terrestre', 0.19748,
   'DESNZ 2025 · HGV (all diesel), All rigids, carga promedio · hoja Freighting goods, fila 51', false, 13, true,
   $json${"unit": "kg CO2e/t·km", "gwp_source": "IPCC AR5 (DESNZ 2025, hoja Introduction, fila 35)", "gwp_horizonte": 100, "limites_sistema": "Tanque a rueda (TTW): combustión del vehículo durante el transporte. Sin producción del combustible (WTT), que DESNZ publica aparte en el set completo.", "metodo_asignacion": "Por masa transportada (t·km): DESNZ deriva el factor por t·km del factor por km con la carga media nacional (hoja Freighting goods, fila 12).", "tipo_factor": "combustion", "alcance": "3", "categoria_ghg": "S3.4 Transporte y distribución aguas arriba (S3.9 si el flete lo paga el cliente final)", "categoria_iso14064": "Categoría 3: emisiones indirectas del transporte", "ef_biogenico": 0, "ef_dluc": 0, "nota_biogenico": "DESNZ no publica el CO2 biogénico por t·km para fletes: el factor cuenta solo el CO2 fósil. Se declara 0.", "pais_iso3": "GBR", "region": "Reino Unido (proxy para Argentina, Paraguay, Uruguay y Brasil)", "data_year": 2025, "dqr_ter": 2, "dqr_ger": 3, "dqr_tir": 1, "dqr_p": 2, "dqr_total": 2.0, "dqr_nota": "PEF (1 = mejor, 5 = peor). TeR 2: camión/tren diésel comparable. GeR 3: dato del Reino Unido usado en Sudamérica. TiR 1: set 2025. P 2: estadística oficial.", "fuente_organismo": "UK Department for Energy Security and Net Zero (DESNZ)", "fuente_documento": "UK Government GHG Conversion Factors for Company Reporting 2025, condensed set, versión 1", "fuente_url": "https://assets.publishing.service.gov.uk/media/6846a4e6d25e6f6afd4c0180/ghg-conversion-factors-2025-condensed-set.xlsx", "fuente_pagina": "https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2025", "licencia": "Open Government Licence v3.0 (Crown copyright)", "uso_comercial": true, "verificacion": "Publicación oficial del gobierno del Reino Unido. Sin verificación de tercera parte específica para este uso.", "modulos": ["producto", "corporativo"], "name": "Camión rígido diésel, carga promedio", "name_en": "Rigid HGV, diesel, average laden", "ef_fosil": 0.19748, "ef_co2": 0.19514, "ef_ch4": 4e-05, "ef_n2o": 0.00229, "representatividad_tecnologica": "HGV (all diesel), All rigids: promedio de camiones rígidos del Reino Unido (más de 3,5 t), carga promedio.", "fuente_archivo": "ghg-conversion-factors-2025-condensed-set.xlsx · hoja Freighting goods, fila 51 (All rigids, tonne.km), columnas P a S (Average laden)", "valor_original": 0.19748, "unidad_original": "kg CO2e/tonne.km", "conversion": "Sin conversión"}$json$::jsonb),
  ('ferrocarril', 'Tren de carga', '🚆', 'terrestre', 'terrestre', 0.02779,
   'DESNZ 2025 · Rail, Freight train · hoja Freighting goods, fila 106', false, 14, true,
   $json${"unit": "kg CO2e/t·km", "gwp_source": "IPCC AR5 (DESNZ 2025, hoja Introduction, fila 35)", "gwp_horizonte": 100, "limites_sistema": "Tanque a rueda (TTW): combustión del vehículo durante el transporte. Sin producción del combustible (WTT), que DESNZ publica aparte en el set completo.", "metodo_asignacion": "Por masa transportada (t·km): DESNZ deriva el factor por t·km del factor por km con la carga media nacional (hoja Freighting goods, fila 12).", "tipo_factor": "combustion", "alcance": "3", "categoria_ghg": "S3.4 Transporte y distribución aguas arriba (S3.9 si el flete lo paga el cliente final)", "categoria_iso14064": "Categoría 3: emisiones indirectas del transporte", "ef_biogenico": 0, "ef_dluc": 0, "nota_biogenico": "DESNZ no publica el CO2 biogénico por t·km para fletes: el factor cuenta solo el CO2 fósil. Se declara 0.", "pais_iso3": "GBR", "region": "Reino Unido (proxy para Argentina, Paraguay, Uruguay y Brasil)", "data_year": 2025, "dqr_ter": 2, "dqr_ger": 3, "dqr_tir": 1, "dqr_p": 2, "dqr_total": 2.0, "dqr_nota": "PEF (1 = mejor, 5 = peor). TeR 2: camión/tren diésel comparable. GeR 3: dato del Reino Unido usado en Sudamérica. TiR 1: set 2025. P 2: estadística oficial.", "fuente_organismo": "UK Department for Energy Security and Net Zero (DESNZ)", "fuente_documento": "UK Government GHG Conversion Factors for Company Reporting 2025, condensed set, versión 1", "fuente_url": "https://assets.publishing.service.gov.uk/media/6846a4e6d25e6f6afd4c0180/ghg-conversion-factors-2025-condensed-set.xlsx", "fuente_pagina": "https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2025", "licencia": "Open Government Licence v3.0 (Crown copyright)", "uso_comercial": true, "verificacion": "Publicación oficial del gobierno del Reino Unido. Sin verificación de tercera parte específica para este uso.", "modulos": ["producto", "corporativo"], "name": "Tren de carga", "name_en": "Freight train", "ef_fosil": 0.02779, "ef_co2": 0.02749, "ef_ch4": 2e-05, "ef_n2o": 0.00028, "representatividad_tecnologica": "Rail, Freight train: promedio de los trenes de carga del Reino Unido (mayormente diésel).", "fuente_archivo": "ghg-conversion-factors-2025-condensed-set.xlsx · hoja Freighting goods, fila 106 (Freight train, tonne.km), columnas D a G", "valor_original": 0.02779, "unidad_original": "kg CO2e/tonne.km", "conversion": "Sin conversión"}$json$::jsonb)
on conflict (id) do update set nombre = excluded.nombre, icono = excluded.icono, tipo = excluded.tipo, via = excluded.via,
  factor = excluded.factor, fuente = excluded.fuente, verificar = excluded.verificar, orden = excluded.orden,
  activo = true, metadatos = excluded.metadatos, updated_at = now();

notify pgrst, 'reload schema';

