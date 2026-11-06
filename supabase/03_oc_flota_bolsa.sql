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
