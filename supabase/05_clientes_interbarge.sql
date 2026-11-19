-- =====================================================================
-- Huella de logística · 05 · clientes con aprobación de InterBarge
-- Va DESPUÉS de la 04. No borra nada. Se puede correr más de una vez.
--
--  · Perfil nuevo: InterBarge (lista interbarge_autorizados).
--  · Tabla clientes: cada persona que crea su cuenta queda "pendiente" hasta que
--    InterBarge la acepta o la rechaza. Se crea sola al registrarse (trigger en auth.users).
--  · Las órdenes (envios) las carga InterBarge para un cliente aceptado. El cliente
--    solo las ve y puede elegir si compensa la huella (proyecto) mientras está en revisión.
--  · Coralia revisa, Sylvera valida y la Bolsa registra el retiro, igual que antes.
-- =====================================================================

-- ===== Perfil InterBarge =====
create table if not exists public.interbarge_autorizados (
  email text primary key check (email = lower(email)),
  nombre text,
  agregado_at timestamptz not null default now()
);
alter table public.interbarge_autorizados enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='interbarge_autorizados' and policyname='interbarge: coralia administra') then
    create policy "interbarge: coralia administra" on public.interbarge_autorizados for all to authenticated
      using ((select public.app_rol()) = 'coralia') with check ((select public.app_rol()) = 'coralia');
  end if;
end $$;

create or replace function public.app_rol()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when x.uid is null then null
    when u.email_confirmed_at is null then 'cliente'
    when lower(u.email) like '%@coraliae.com' then 'coralia'
    when exists (select 1 from public.sylvera_autorizados s where s.email = lower(u.email)) then 'sylvera'
    when exists (select 1 from public.bolsa_autorizados b where b.email = lower(u.email)) then 'bolsa'
    when exists (select 1 from public.interbarge_autorizados i where i.email = lower(u.email)) then 'interbarge'
    else 'cliente' end
  from (select auth.uid() as uid) x left join auth.users u on u.id = x.uid;
$$;

-- ===== Clientes =====
create table if not exists public.clientes (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  empresa text,
  nombre text,
  estado text not null default 'pendiente' check (estado in ('pendiente','aceptado','rechazado')),
  comentario text,
  revisado_por text,
  revisado_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.clientes is 'Clientes que pidieron acceso. InterBarge los acepta o rechaza; solo los aceptados reciben órdenes.';
alter table public.clientes enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='clientes' and policyname='clientes: ver') then
    create policy "clientes: ver" on public.clientes for select to authenticated using (
      id = (select auth.uid()) or (select public.app_rol()) in ('interbarge','coralia'));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='clientes' and policyname='clientes: interbarge decide') then
    create policy "clientes: interbarge decide" on public.clientes for update to authenticated
      using ((select public.app_rol()) in ('interbarge','coralia')) with check ((select public.app_rol()) in ('interbarge','coralia'));
  end if;
end $$;

-- Al decidir, se registra quién y cuándo; solo cambian estado y comentario
create or replace function public.clientes_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.id := old.id; new.email := old.email; new.created_at := old.created_at;
  new.empresa := old.empresa; new.nombre := old.nombre;
  if new.estado is distinct from old.estado then
    new.revisado_por := lower(auth.jwt() ->> 'email');
    new.revisado_at := now();
  else
    new.revisado_por := old.revisado_por; new.revisado_at := old.revisado_at;
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'clientes_guard') then
    create trigger clientes_guard before update on public.clientes for each row execute function public.clientes_guard();
  end if;
end $$;

-- Alta automática del cliente cuando crea su cuenta (el personal de Coralia, Sylvera, Bolsa e InterBarge no)
create or replace function public.alta_cliente()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m text := lower(new.email);
begin
  if m like '%@coraliae.com'
     or exists (select 1 from public.sylvera_autorizados where email = m)
     or exists (select 1 from public.bolsa_autorizados where email = m)
     or exists (select 1 from public.interbarge_autorizados where email = m) then
    return new;
  end if;
  insert into public.clientes (id, email, empresa, nombre)
  values (new.id, m, nullif(trim(new.raw_user_meta_data ->> 'empresa'), ''), nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''))
  on conflict (id) do nothing;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'alta_cliente' and tgrelid = 'auth.users'::regclass) then
    create trigger alta_cliente after insert on auth.users for each row execute function public.alta_cliente();
  end if;
end $$;

-- ===== Órdenes (envios) =====
alter table public.envios add column if not exists cargado_por text;

-- InterBarge carga órdenes para clientes aceptados
alter policy "envios: crear propio" on public.envios with check (
  usuario_id = (select auth.uid())
  or ((select public.app_rol()) = 'interbarge'
      and exists (select 1 from public.clientes c where c.id = usuario_id and c.estado = 'aceptado'))
);
alter policy "envios: ver" on public.envios using (
  usuario_id = (select auth.uid())
  or (select public.app_rol()) in ('coralia','interbarge')
  or ((select public.app_rol()) = 'sylvera'
      and (estado in ('en_validacion','validado','retirado') or (estado = 'rechazado' and rechazo_rol = 'sylvera')))
  or ((select public.app_rol()) = 'bolsa' and proyecto_id is not null and estado in ('validado','retirado'))
);
alter policy "envios: editar" on public.envios using (
  usuario_id = (select auth.uid())
  or (select public.app_rol()) = 'coralia'
  or ((select public.app_rol()) = 'interbarge' and estado in ('borrador','enviado','rechazado'))
  or ((select public.app_rol()) = 'sylvera' and estado = 'en_validacion')
  or ((select public.app_rol()) = 'bolsa' and estado = 'validado' and proyecto_id is not null)
) with check (
  usuario_id = (select auth.uid())
  or (select public.app_rol()) in ('coralia','interbarge','sylvera','bolsa')
);
alter policy "envios: borrar" on public.envios using (
  (select public.app_rol()) = 'coralia'
  or ((select public.app_rol()) = 'interbarge' and estado in ('borrador','enviado','rechazado'))
);

create or replace function public.envios_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  rol text := public.app_rol();
  mail text := lower(auth.jwt() ->> 'email');
  r record; precio numeric;
begin
  if tg_op = 'INSERT' then
    if rol = 'interbarge' then
      -- la orden es del cliente elegido; queda registrado quién la cargó
      select c.email into new.usuario_email from public.clientes c where c.id = new.usuario_id and c.estado = 'aceptado';
      if new.usuario_email is null then raise exception 'El cliente no existe o todavía no fue aceptado'; end if;
      new.cargado_por := mail;
    else
      if auth.uid() is not null then new.usuario_id := auth.uid(); end if;
      new.usuario_email := mail;
      new.cargado_por := mail;
    end if;
    if new.estado not in ('borrador','enviado') then raise exception 'Una orden nueva solo puede ser borrador o enviada'; end if;
    new.comentario := null; new.revisado_at := null; new.revisado_por := null; new.certificado := null;
    new.rechazo_rol := null; new.retirado_at := null; new.retiro_ref := null;
    new.enviado_at := case when new.estado = 'enviado' then now() end;
  else
    new.id := old.id; new.usuario_id := old.usuario_id; new.usuario_email := old.usuario_email;
    new.created_at := old.created_at; new.cargado_por := old.cargado_por;

    if rol = 'coralia' then
      null;
    elsif rol = 'interbarge' then
      -- InterBarge corrige sus órdenes mientras no estén validadas
      if old.estado not in ('borrador','enviado','rechazado') then raise exception 'Esta orden ya está en validación y no se puede modificar'; end if;
      if new.estado not in ('borrador','enviado') then raise exception 'Estado no permitido'; end if;
      new.comentario := old.comentario; new.revisado_at := old.revisado_at; new.revisado_por := old.revisado_por;
      new.certificado := old.certificado; new.rechazo_rol := old.rechazo_rol;
      new.retirado_at := old.retirado_at; new.retiro_ref := old.retiro_ref;
    elsif rol in ('sylvera','bolsa') and old.usuario_id <> auth.uid() then
      if rol = 'sylvera' and (old.estado <> 'en_validacion' or new.estado not in ('en_validacion','validado','rechazado')) then
        raise exception 'Sylvera solo puede validar u observar órdenes enviadas a validación';
      end if;
      if rol = 'bolsa' and (old.estado <> 'validado' or new.estado not in ('validado','retirado')) then
        raise exception 'La Bolsa solo puede registrar el retiro de créditos de órdenes validadas';
      end if;
      new.tramos := old.tramos; new.carga := old.carga; new.empresa := old.empresa; new.booking := old.booking;
      new.proyecto_id := old.proyecto_id; new.oc_numero := old.oc_numero; new.oc_archivo := old.oc_archivo; new.flete_usd := old.flete_usd;
      new.total_kg := old.total_kg; new.total_km := old.total_km; new.total_tkm := old.total_tkm;
      new.creditos := old.creditos; new.usd_estimado := old.usd_estimado; new.certificado := old.certificado;
      if rol = 'sylvera' then new.retiro_ref := old.retiro_ref; new.retirado_at := old.retirado_at; end if;
      if rol = 'bolsa' then new.comentario := old.comentario; end if;
    else
      -- Cliente: solo elige si compensa (proyecto) mientras la orden está en revisión
      if new.proyecto_id is distinct from old.proyecto_id and old.estado not in ('enviado','en_validacion') then
        raise exception 'La compensación solo se puede elegir mientras la orden está en revisión';
      end if;
      new.estado := old.estado; new.tramos := old.tramos; new.carga := old.carga; new.empresa := old.empresa;
      new.booking := old.booking; new.oc_numero := old.oc_numero; new.oc_archivo := old.oc_archivo; new.flete_usd := old.flete_usd;
      new.comentario := old.comentario; new.revisado_at := old.revisado_at; new.revisado_por := old.revisado_por;
      new.certificado := old.certificado; new.enviado_at := old.enviado_at; new.rechazo_rol := old.rechazo_rol;
      new.retirado_at := old.retirado_at; new.retiro_ref := old.retiro_ref;
    end if;

    if new.estado is distinct from old.estado then
      if new.estado = 'enviado' then new.enviado_at := now(); new.rechazo_rol := null; end if;
      if new.estado in ('en_validacion','validado','rechazado') then new.revisado_at := now(); new.revisado_por := mail; end if;
      if new.estado = 'rechazado' then new.rechazo_rol := rol; end if;
      if new.estado = 'retirado' then
        if old.estado <> 'validado' then raise exception 'Solo se retiran créditos de una orden validada'; end if;
        if new.proyecto_id is null then raise exception 'La orden no tiene proyecto de compensación'; end if;
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

notify pgrst, 'reload schema';
