/* Ingreso y panel del equipo con usuario y contraseña.
 * InterBarge: solicitudes de clientes y órdenes · Coralia: revisión y accesos · Sylvera: validación · Bolsa: retiro de créditos.
 * Lo que ve y puede hacer cada perfil lo aplica la base (RLS y reglas de estados); acá solo se muestra.
 */
(() => {
  "use strict";
  const { sb, fmt, fmtFecha, esc, kgTxt, ESTADOS } = H;
  const $ = (s) => document.querySelector(s);
  let ROL, VISTA, filas = [], selId = null, PROY = [];

  const INFO = {
    interbarge: ["InterBarge", "Aceptá o rechazá a los clientes que piden acceso y cargá las órdenes de compra de sus envíos."],
    coralia: ["Coralia", "Revisá los datos de cada orden y pasala a Sylvera, o observala para que InterBarge la corrija."],
    sylvera: ["Sylvera", "Validá el cálculo de las órdenes que aprobó Coralia. Al validar sale el certificado."],
    bolsa: ["Bolsa Paraguaya de Carbono", "Registrá el retiro de los créditos de las órdenes validadas que compensan."],
  };
  const ESTADO_CLI = { pendiente: ["Pendiente", "st-wait"], aceptado: ["Aceptado", "st-ok"], rechazado: ["Rechazado", "st-bad"] };
  const PENDIENTE = { interbarge: (e) => e.estado === "rechazado", coralia: (e) => e.estado === "enviado", sylvera: (e) => e.estado === "en_validacion", bolsa: (e) => e.estado === "validado" && e.proyecto_id };

  function msg(t, tipo = "err") { const m = $("#d-msg"); if (!m) return; m.className = `msg ${tipo}`; m.textContent = t; m.hidden = !t; }

  // ---------- Solicitudes de clientes (InterBarge) ----------
  async function cargarClientes() {
    const { data, error } = await sb.from("clientes").select("*").order("created_at", { ascending: false });
    filas = data || [];
    $("#thead").innerHTML = "<tr><th>Fecha</th><th>Empresa</th><th>Contacto</th><th>Estado</th></tr>";
    $("#lista").innerHTML = error ? `<tr><td colspan="4" class="empty">${esc(error.message)}</td></tr>` : filas.length ? filas.map((c) => `
      <tr data-id="${esc(c.id)}" class="${c.id === selId ? "sel" : ""}"><td>${fmtFecha(c.created_at)}</td><td><b>${esc(c.empresa || "—")}</b></td>
      <td>${esc(c.nombre || "")}<br><span class="hint">${esc(c.email)}</span></td>
      <td><span class="st ${ESTADO_CLI[c.estado][1]}">${ESTADO_CLI[c.estado][0]}</span></td></tr>`).join("")
      : `<tr><td colspan="4" class="empty">Todavía no hay solicitudes. Los clientes las mandan desde la portada con “Crear cuenta”.</td></tr>`;
    document.querySelectorAll("#lista tr[data-id]").forEach((tr) => (tr.onclick = () => verCliente(tr.dataset.id)));
    if (selId) verCliente(selId);
  }
  function verCliente(id) {
    const c = filas.find((x) => x.id === id); if (!c) return;
    selId = id; document.querySelectorAll("#lista tr").forEach((tr) => tr.classList.toggle("sel", tr.dataset.id === id));
    $("#detalle").innerHTML = `<div class="detail">
      <div><span class="st ${ESTADO_CLI[c.estado][1]}">${ESTADO_CLI[c.estado][0]}</span></div>
      <h2>${esc(c.empresa || "Sin empresa")}</h2>
      <dl><dt>Contacto</dt><dd>${esc(c.nombre || "—")}</dd><dt>Email</dt><dd>${esc(c.email)}</dd>
        <dt>Pidió acceso</dt><dd>${fmtFecha(c.created_at)}</dd>
        ${c.revisado_at ? `<dt>Decidido</dt><dd>${fmtFecha(c.revisado_at)} · ${esc(c.revisado_por || "")}</dd>` : ""}
        ${c.comentario ? `<dt>Comentario</dt><dd>${esc(c.comentario)}</dd>` : ""}</dl>
      <label class="field"><span>Comentario (obligatorio para rechazar)</span><textarea id="d-com" rows="2"></textarea></label>
      <div class="acts">
        ${c.estado !== "aceptado" ? `<button class="btn small" data-c="aceptado">Aceptar cliente</button>` : ""}
        ${c.estado !== "rechazado" ? `<button class="btn small danger" data-c="rechazado">Rechazar</button>` : ""}
        ${c.estado === "aceptado" ? `<a class="btn small ghost" href="index.html#calcular">Cargarle una orden</a>` : ""}
      </div><p id="d-msg" class="msg" hidden></p></div>`;
    document.querySelectorAll("#detalle [data-c]").forEach((b) => (b.onclick = async () => {
      const estado = b.dataset.c, comentario = $("#d-com").value.trim();
      if (estado === "rechazado" && !comentario) return msg("Escribí el motivo del rechazo.");
      const { error } = await sb.from("clientes").update({ estado, comentario: comentario || null }).eq("id", c.id);
      if (error) return msg(error.message);
      await cargarClientes(); pintarTabs();
    }));
  }

  // ---------- Órdenes (todos los perfiles; la base filtra lo que ve cada uno) ----------
  async function cargarOrdenes() {
    const { data, error } = await sb.from("envios").select("*").order("updated_at", { ascending: false });
    filas = data || [];
    $("#thead").innerHTML = "<tr><th>Fecha</th><th>Cliente</th><th class=\"num\">Huella</th><th>Estado</th></tr>";
    $("#lista").innerHTML = error ? `<tr><td colspan="4" class="empty">${esc(error.message)}</td></tr>` : filas.length ? filas.map((e) => `
      <tr data-id="${esc(e.id)}" class="${e.id === selId ? "sel" : ""}"><td>${fmtFecha(e.updated_at)}</td>
      <td><b>${esc(e.empresa || e.usuario_email || "—")}</b><br><span class="hint">OC ${esc(e.oc_numero || "—")} · ${esc(e.carga || "")}</span></td>
      <td class="num">${kgTxt(+e.total_kg)}${e.creditos ? `<br><span class="hint">${e.creditos} créditos</span>` : ""}</td>
      <td><span class="st ${ESTADOS[e.estado].cls}">${ESTADOS[e.estado].txt}</span>${PENDIENTE[ROL](e) ? ' <span class="pend">pendiente</span>' : ""}</td></tr>`).join("")
      : `<tr><td colspan="4" class="empty">${ROL === "interbarge" ? 'No cargaste órdenes todavía. <a href="index.html#calcular">Cargar una orden</a>.' : "No hay órdenes en tu etapa por ahora."}</td></tr>`;
    document.querySelectorAll("#lista tr[data-id]").forEach((tr) => (tr.onclick = () => verOrden(tr.dataset.id)));
    if (selId) verOrden(selId);
  }
  function verOrden(id) {
    const e = filas.find((x) => x.id === id); if (!e) return;
    selId = id; document.querySelectorAll("#lista tr").forEach((tr) => tr.classList.toggle("sel", tr.dataset.id === id));
    const p = PROY.find((x) => x.id === e.proyecto_id);
    const acts = [];
    if (ROL === "coralia" && e.estado === "enviado") acts.push(["en_validacion", "Aprobar y pasar a Sylvera"], ["rechazado", "Observar", "danger"]);
    if (ROL === "sylvera" && e.estado === "en_validacion") acts.push(["validado", "Validar"], ["rechazado", "Observar", "danger"]);
    if (ROL === "bolsa" && e.estado === "validado" && e.proyecto_id) acts.push(["retirado", "Registrar retiro de créditos"]);
    if (ROL === "interbarge" && e.estado === "rechazado") acts.push(["enviado", "Reenviar a Coralia"]);
    const comenta = acts.some(([a]) => a === "rechazado"), retira = acts.some(([a]) => a === "retirado");
    const edita = ROL === "interbarge" && ["enviado", "rechazado", "borrador"].includes(e.estado);
    $("#detalle").innerHTML = `<div class="detail">
      <div><span class="st ${ESTADOS[e.estado].cls}">${ESTADOS[e.estado].txt}</span></div>
      <h2>${esc(e.empresa || e.usuario_email || "Orden")}</h2>
      <div class="big" style="color:var(--teal)">${kgTxt(+e.total_kg)}</div>
      <dl>
        <dt>Orden de compra</dt><dd>${esc(e.oc_numero || "—")}</dd>
        <dt>Producto</dt><dd>${esc(e.carga || "—")}</dd>
        <dt>Cliente</dt><dd>${esc(e.usuario_email || "—")}</dd>
        <dt>Distancia</dt><dd>${fmt(e.total_km, 0)} km · ${fmt(e.total_tkm, 0)} t·km</dd>
        <dt>Compensación</dt><dd>${p ? `${e.creditos} créditos · ${esc(p.nombre)} · USD ${fmt(e.usd_estimado, 0)}` : "El cliente no eligió compensar"}</dd>
        <dt>Cargada</dt><dd>${fmtFecha(e.created_at)}${e.cargado_por ? ` · ${esc(e.cargado_por)}` : ""}</dd>
        <dt>Revisada</dt><dd>${e.revisado_at ? `${fmtFecha(e.revisado_at)} · ${esc(e.revisado_por || "")}` : "—"}</dd>
        ${e.certificado ? `<dt>Certificado</dt><dd><code>${esc(e.certificado)}</code></dd>` : ""}
        ${e.retiro_ref ? `<dt>Retiro</dt><dd>${esc(e.retiro_ref)} · ${fmtFecha(e.retirado_at)}</dd>` : ""}
        ${e.comentario ? `<dt>Observaciones</dt><dd>${esc(e.comentario)}</dd>` : ""}
      </dl>
      <div class="table-wrap"><table class="mini">
        <thead><tr><th>Tramo</th><th class="num">km</th><th class="num">t</th><th class="num">Factor</th><th class="num">kg CO₂e</th></tr></thead>
        <tbody>${(e.tramos || []).map((t) => `<tr><td>${esc(t.modo_nombre || t.modo)}<br><span class="hint">${esc(t.desde?.label)} → ${esc(t.hasta?.label)}</span></td>
          <td class="num">${fmt(t.dist, 0)}</td><td class="num">${fmt(t.toneladas, 1)}</td><td class="num">${fmt(t.factor, 5)}</td><td class="num">${fmt(t.kg, 0)}</td></tr>`).join("")}</tbody>
      </table></div>
      ${comenta ? `<label class="field"><span>Observaciones (obligatorio para observar)</span><textarea id="d-com" rows="2"></textarea></label>` : ""}
      ${retira ? `<label class="field"><span>Referencia del retiro en el registro</span><input id="d-ref" placeholder="N° de serie o link del registro" /></label>` : ""}
      <div class="acts">${acts.map(([a, txt, cls]) => `<button class="btn small ${cls || ""}" data-a="${a}">${txt}</button>`).join("")}
        ${edita ? `<a class="btn small ghost" href="index.html?id=${encodeURIComponent(e.id)}#calcular">Editar orden</a>` : ""}
        ${e.certificado ? `<a class="btn small ghost" href="certificado.html?c=${encodeURIComponent(e.certificado)}" target="_blank" rel="noopener">Ver certificado</a>` : ""}
        ${edita || ROL === "coralia" ? `<button class="btn small danger" data-a="borrar">Borrar</button>` : ""}</div>
      ${!acts.length && !edita && ROL !== "coralia" ? `<p class="hint">No hay nada pendiente para vos en esta orden.</p>` : ""}
      <p id="d-msg" class="msg" hidden></p></div>`;
    document.querySelectorAll("#detalle [data-a]").forEach((b) => (b.onclick = () => accion(e, b.dataset.a)));
  }
  async function accion(e, a) {
    if (a === "borrar") {
      if (!confirm("¿Borrar esta orden? No se puede deshacer.")) return;
      const { error } = await sb.from("envios").delete().eq("id", e.id);
      if (error) return msg(error.message);
      selId = null; $("#detalle").innerHTML = '<p class="hint">Orden borrada.</p>'; return cargarOrdenes();
    }
    const cambios = { estado: a }, com = $("#d-com")?.value.trim();
    if (com !== undefined) cambios.comentario = com || null;
    if (a === "rechazado" && !com) return msg("Escribí las observaciones.");
    if (a === "retirado") { const ref = $("#d-ref").value.trim(); if (!ref) return msg("Cargá la referencia del retiro."); cambios.retiro_ref = ref; }
    const { error } = await sb.from("envios").update(cambios).eq("id", e.id);
    if (error) return msg(error.message);
    await cargarOrdenes(); pintarTabs();
  }

  // ---------- Coralia: factores y accesos del equipo ----------
  async function pintarExtraCoralia() {
    const [{ data: modos }, ...listas] = await Promise.all([
      sb.from("modos").select("*").eq("activo", true).order("orden"),
      sb.from("interbarge_autorizados").select("*").order("email"),
      sb.from("sylvera_autorizados").select("*").order("email"),
      sb.from("bolsa_autorizados").select("*").order("email"),
    ]);
    const tablas = [["interbarge_autorizados", "InterBarge"], ["sylvera_autorizados", "Sylvera"], ["bolsa_autorizados", "Bolsa Paraguaya de Carbono"]];
    $("#extra").innerHTML = `<div class="two" style="margin-top:24px">
      <section class="card pad"><div class="sec-head"><h2>Factores de emisión vigentes</h2><p class="hint">Los usa el cálculo de cada orden.</p></div>
        <div class="table-wrap"><table class="mini"><thead><tr><th>Medio</th><th class="num">kg CO₂e/t·km</th><th>Fuente</th></tr></thead>
        <tbody>${(modos || []).map((m) => `<tr><td>${m.icono || ""} ${esc(m.nombre)}</td><td class="num">${fmt(m.factor, 5)}</td><td class="hint">${esc(m.fuente || "")}</td></tr>`).join("")}</tbody></table></div></section>
      <section class="card pad"><div class="sec-head"><h2>Accesos del equipo</h2><p class="hint">Emails habilitados para cada perfil. Coralia: cualquier email @coraliae.com. Cada persona entra con “¿Olvidaste tu contraseña?” la primera vez, o con la cuenta que le creamos.</p></div>
        ${tablas.map(([t, nombre], i) => `<h3 class="acc-t">${nombre}</h3>
          <ul class="acc-lista">${(listas[i].data || []).map((x) => `<li>${esc(x.email)} <button class="btn small danger" data-quitar="${t}" data-email="${esc(x.email)}">Quitar</button></li>`).join("") || '<li class="hint">Ninguno</li>'}</ul>
          <div class="otp"><label class="field"><span>Agregar email</span><input data-nuevo="${t}" type="email" placeholder="nombre@empresa.com" /></label><button class="btn small" data-agregar="${t}">Agregar</button></div>`).join("")}
      </section></div>`;
    document.querySelectorAll("[data-agregar]").forEach((b) => (b.onclick = async () => {
      const t = b.dataset.agregar, email = document.querySelector(`[data-nuevo="${t}"]`).value.trim().toLowerCase();
      if (!email.includes("@")) return;
      const { error } = await sb.from(t).insert({ email }); if (error) alert(error.message); else pintarExtraCoralia();
    }));
    document.querySelectorAll("[data-quitar]").forEach((b) => (b.onclick = async () => {
      if (!confirm(`¿Quitar a ${b.dataset.email}?`)) return;
      await sb.from(b.dataset.quitar).delete().eq("email", b.dataset.email); pintarExtraCoralia();
    }));
  }

  // ---------- Pestañas ----------
  async function pintarTabs() {
    if (ROL !== "interbarge") return;
    const [{ count: pend }, { count: obs }] = await Promise.all([
      sb.from("clientes").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
      sb.from("envios").select("id", { count: "exact", head: true }).eq("estado", "rechazado"),
    ]);
    const tab = (v, txt, n) => `<button class="tab" role="tab" data-v="${v}" aria-selected="${VISTA === v}">${txt} <span class="tab-n">${n || ""}</span></button>`;
    $("#tabs").hidden = false;
    $("#tabs").innerHTML = tab("clientes", "Solicitudes de clientes", pend) + tab("ordenes", "Órdenes", obs);
    document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => { VISTA = b.dataset.v; selId = null; $("#detalle").innerHTML = '<p class="hint">Elegí una fila para ver el detalle.</p>'; mostrarVista(); }));
  }
  function mostrarVista() {
    pintarTabs();
    $("#toolbar").innerHTML = ROL === "interbarge" && VISTA === "ordenes" ? `<a class="btn" href="index.html#calcular">+ Cargar orden</a>` : "";
    return VISTA === "clientes" ? cargarClientes() : cargarOrdenes();
  }

  async function init() {
    await H.pintarCabecera();
    const s = await H.sesion();
    if (!s) {
      $("#v-login").hidden = false;
      H.tarjetaLogin($("#login-admin"), { sinRegistro: true, titulo: "Ingresá", subtitulo: "Con tu usuario del equipo", alEntrar: () => location.reload() });
      return;
    }
    ROL = await H.rol();
    if (!H.PERSONAL.includes(ROL)) { location.replace("cliente.html"); return; }
    const [nombre, desc] = INFO[ROL];
    $("#v-panel").hidden = false;
    $("#rol-chip").textContent = nombre;
    $("#p-title").textContent = ROL === "interbarge" ? "InterBarge" : nombre;
    $("#p-sub").textContent = desc;
    const { data: p } = await sb.from("proyectos").select("id,nombre"); PROY = p || [];
    VISTA = ROL === "interbarge" ? "clientes" : "ordenes";
    await mostrarVista();
    if (ROL === "coralia") pintarExtraCoralia();
  }
  init().catch((e) => { console.error(e); document.querySelector(".wrap").insertAdjacentHTML("afterbegin", `<div class="notice">Error: ${esc(e.message)}</div>`); });
})();
