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
  nombre = replace(nombre, 'Buque Vergara', 'Buque Interbarge'),
  fuente = replace(fuente, 'Vergara', 'Interbarge')
  where id in ('buque-vergara','camion-articulado','camion-rigido','ferrocarril') and orden < 10;
-- Interbarge opera solo en la hidrovía: el buque del carril costero queda desactivado
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
revoke execute on function public.verificar_certificado(text) from anon;

-- Avisar a la API que hay tablas nuevas
notify pgrst, 'reload schema';
