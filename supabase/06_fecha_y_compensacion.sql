-- =====================================================================
-- Huella de logística · 06 · fecha del envío y compensación por período
-- Va DESPUÉS de la 05. No borra nada. Se puede correr más de una vez.
--  · envios.fecha: fecha del envío (la carga InterBarge). Sirve para agrupar por mes.
--  · El cliente puede elegir compensar un envío en revisión o ya validado, mientras
--    no se hayan retirado los créditos. Si cambia el proyecto de un envío validado,
--    se recalculan los créditos sin tocar la huella.
-- =====================================================================
alter table public.envios add column if not exists fecha date;
update public.envios set fecha = (created_at at time zone 'America/Asuncion')::date where fecha is null;
alter table public.envios alter column fecha set default current_date;
comment on column public.envios.fecha is 'Fecha del envío (la carga InterBarge). Agrupa los envíos por mes para compensar.';

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
    if rol not in ('coralia','interbarge') then new.fecha := old.fecha; end if;

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
      -- Cliente: solo elige si compensa (proyecto) mientras no se hayan retirado los créditos; no toca la huella
      if new.proyecto_id is distinct from old.proyecto_id and old.estado not in ('enviado','en_validacion','validado') then
        raise exception 'Esta orden ya tiene los créditos retirados: no se puede cambiar la compensación';
      end if;
      new.estado := old.estado; new.tramos := old.tramos; new.carga := old.carga; new.empresa := old.empresa;
      new.booking := old.booking; new.oc_numero := old.oc_numero; new.oc_archivo := old.oc_archivo; new.flete_usd := old.flete_usd;
      new.comentario := old.comentario; new.revisado_at := old.revisado_at; new.revisado_por := old.revisado_por;
      new.certificado := old.certificado; new.enviado_at := old.enviado_at; new.rechazo_rol := old.rechazo_rol;
      new.retirado_at := old.retirado_at; new.retiro_ref := old.retiro_ref;
      new.total_kg := old.total_kg; new.total_km := old.total_km; new.total_tkm := old.total_tkm;
      new.creditos := old.creditos; new.usd_estimado := old.usd_estimado; new.cargado_por := old.cargado_por;
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
    if tg_op = 'UPDATE' and new.proyecto_id is distinct from old.proyecto_id then
      if new.proyecto_id is not null then
        select usd_por_t into precio from public.proyectos where id = new.proyecto_id;
        new.creditos := ceil(new.total_kg / 1000.0)::int;
        new.usd_estimado := new.creditos * coalesce(precio, 0);
      else
        new.creditos := null; new.usd_estimado := null;
      end if;
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
