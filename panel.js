/* Panel por perfil: cliente (sus cálculos), Coralia (todo) y Sylvera (enviados a validación). */
(() => {
  "use strict";
  const { sb, fmt, fmtFecha, esc, kgTxt, ESTADOS } = H;
  const $ = (s) => document.querySelector(s);

  let ROL = "cliente", USER = null, envios = [], filtro = "todos", selId = null, PROY = [];

  const FILTROS = {
    cliente: ["todos", "borrador", "enviado", "en_validacion", "validado", "retirado", "rechazado"],
    coralia: ["todos", "enviado", "en_validacion", "validado", "retirado", "rechazado", "borrador"],
    sylvera: ["todos", "en_validacion", "validado", "retirado", "rechazado"],
  };
  const TITULOS = {
    cliente: ["Mis cálculos", "Tus cálculos y certificados."],
    coralia: ["Panel Coralia", "Todos los cálculos, datos cargados, estados y exportes."],
    sylvera: ["Panel Sylvera", "Cálculos enviados a validación."],
  };

  function msg(sel, txt, tipo = "") { const m = $(sel); m.className = `msg ${tipo}`; m.innerHTML = txt; m.hidden = !txt; }

  // ---------- Ingreso ----------
  function initLogin() {
    $("#v-login").hidden = false;
    $("#l-send").onclick = async () => {
      const email = $("#l-email").value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg("#l-msg", "Revisá el email.", "err"); return; }
      $("#l-send").disabled = true;
      const { error } = await H.enviarCodigo(email, location.origin + location.pathname);
      $("#l-send").disabled = false;
      if (error) { msg("#l-msg", `No se pudo enviar: ${esc(error.message)}`, "err"); return; }
      msg("#l-msg", `Te mandamos un código a <b>${esc(email)}</b>. También podés tocar el link del mail.`, "ok");
      $("#l-stepCode").hidden = false; $("#l-code").focus();
    };
    $("#l-verify").onclick = async () => {
      const token = $("#l-code").value.replace(/\D/g, "");
      if (token.length !== 6) return;
      const { error } = await H.verificarCodigo($("#l-email").value.trim(), token);
      if (error) { msg("#l-msg", "El código no es válido o venció.", "err"); return; }
      location.reload();
    };
    const sso = async (prov) => {
      const { error } = await H.entrarCon(prov, location.origin + location.pathname);
      if (error) msg("#l-msg", `Este ingreso todavía no está configurado (${esc(error.message)}).`, "err");
    };
    $("#l-google").onclick = () => sso("google");
    $("#l-ms").onclick = () => sso("azure");
  }

  // ---------- Lista ----------
  async function cargar() {
    const { data, error } = await sb.from("envios").select("*").order("updated_at", { ascending: false });
    if (error) { $("#lista").innerHTML = `<tr><td colspan="4" class="empty">No se pudieron cargar los cálculos: ${esc(error.message)}</td></tr>`; return; }
    envios = data;
    pintarLista();
    if (selId) mostrar(selId);
  }

  function pintarFiltros() {
    $("#filtros").innerHTML = FILTROS[ROL].map((f) => {
      const n = f === "todos" ? envios.length : envios.filter((e) => e.estado === f).length;
      return `<button class="filter" data-f="${f}" aria-pressed="${f === filtro}">${f === "todos" ? "Todos" : ESTADOS[f].txt} · ${n}</button>`;
    }).join("");
    document.querySelectorAll(".filter").forEach((b) => (b.onclick = () => { filtro = b.dataset.f; pintarLista(); }));
  }

  function pintarLista() {
    pintarFiltros();
    const q = H.norm($("#buscar").value);
    const vis = envios.filter((e) => (filtro === "todos" || e.estado === filtro) &&
      (!q || H.norm([e.empresa, e.carga, e.usuario_email, e.booking, e.certificado].join(" ")).includes(q)));
    $("#lista").innerHTML = vis.length ? vis.map((e) => `
      <tr data-id="${e.id}">
        <td>${fmtFecha(e.updated_at)}</td>
        <td><b>${esc(e.empresa || e.usuario_email || "—")}</b><br><span class="hint">${esc(e.carga || "Sin descripción")} · ${e.tramos.length} tramo${e.tramos.length === 1 ? "" : "s"}${e.booking ? ` · ${esc(e.booking)}` : ""}</span></td>
        <td class="num">${kgTxt(+e.total_kg)}${e.creditos ? `<br><span class="hint">${e.creditos} créditos</span>` : ""}</td>
        <td><span class="st ${ESTADOS[e.estado].cls}">${ESTADOS[e.estado].txt}</span></td>
      </tr>`).join("") : `<tr><td colspan="4" class="empty">${envios.length ? "No hay cálculos con este filtro." : ROL === "cliente" ? 'Todavía no tenés cálculos. <a href="index.html">Hacé el primero</a>.' : "No hay cálculos para mostrar."}</td></tr>`;
    document.querySelectorAll("#lista tr[data-id]").forEach((tr) => (tr.onclick = () => mostrar(tr.dataset.id)));
  }

  // ---------- Detalle y acciones ----------
  function mostrar(id) {
    const e = envios.find((x) => x.id === id);
    if (!e) return;
    selId = id;
    const p = PROY.find((x) => x.id === e.proyecto_id);
    const propio = e.usuario_id === USER.id;
    const acts = [];
    if ((ROL === "cliente" || propio) && ["borrador", "rechazado"].includes(e.estado)) {
      acts.push(`<a class="btn small ghost" href="index.html?id=${e.id}">Editar</a>`, `<button class="btn small" data-a="enviado">Enviar a revisión</button>`, `<button class="btn small danger" data-a="borrar">Borrar</button>`);
    }
    if (ROL === "coralia") {
      if (e.estado === "enviado") acts.push(`<button class="btn small" data-a="en_validacion">Aprobar y pasar a Sylvera</button>`, `<button class="btn small danger" data-a="rechazado">Observar</button>`);
      if (e.estado === "validado" && e.proyecto_id) acts.push(`<button class="btn small" data-a="retirado">Registrar retiro de créditos</button>`);
      if (e.estado !== "borrador" && !propio) acts.push(`<button class="btn small danger" data-a="borrar">Borrar</button>`);
    }
    if (ROL === "sylvera" && e.estado === "en_validacion") acts.push(`<button class="btn small" data-a="validado">Validar</button>`, `<button class="btn small danger" data-a="rechazado">Observar</button>`);
    if (e.certificado) acts.push(`<a class="btn small ghost" href="certificado.html?c=${encodeURIComponent(e.certificado)}" target="_blank" rel="noopener">Ver certificado</a>`);

    const revisor = ROL === "coralia" || (ROL === "sylvera" && e.estado === "en_validacion");
    $("#detalle").innerHTML = `<div class="detail">
      <div><span class="st ${ESTADOS[e.estado].cls}">${ESTADOS[e.estado].txt}</span></div>
      <h2>${esc(e.carga || "Envío sin descripción")}</h2>
      <div class="big" style="color:var(--green)">${kgTxt(+e.total_kg)}</div>
      <dl>
        <dt>Empresa</dt><dd>${esc(e.empresa || "—")}</dd>
        <dt>Cliente</dt><dd>${esc(e.usuario_email || "—")}</dd>
        <dt>Booking</dt><dd>${esc(e.booking || "—")}</dd>
        <dt>Distancia</dt><dd>${fmt(e.total_km, 0)} km · ${fmt(e.total_tkm, 0)} t·km</dd>
        <dt>Compensación</dt><dd>${p ? `${e.creditos} créditos · ${esc(p.nombre)} · USD ${fmt(e.usd_estimado, 0)}` : "No compensa"}</dd>
        <dt>Enviado</dt><dd>${fmtFecha(e.enviado_at)}</dd>
        <dt>Revisado</dt><dd>${e.revisado_at ? `${fmtFecha(e.revisado_at)} · ${esc(e.revisado_por || "")}` : "—"}</dd>
        ${e.certificado ? `<dt>Certificado</dt><dd><code>${esc(e.certificado)}</code></dd>` : ""}
        ${e.retiro_ref ? `<dt>Retiro</dt><dd>${esc(e.retiro_ref)} · ${fmtFecha(e.retirado_at)}</dd>` : ""}
        ${e.comentario ? `<dt>Observaciones</dt><dd>${esc(e.comentario)}</dd>` : ""}
      </dl>
      <div class="table-wrap"><table class="mini">
        <thead><tr><th>#</th><th>Tramo</th><th class="num">km</th><th class="num">t</th><th class="num">Factor</th><th class="num">kg CO₂e</th></tr></thead>
        <tbody>${e.tramos.map((t, i) => `<tr><td>${i + 1}</td><td>${esc(t.modo_nombre || t.modo)}<br><span class="hint">${esc(t.desde?.label)} → ${esc(t.hasta?.label)}</span></td>
          <td class="num">${fmt(t.dist, 0)}</td><td class="num">${fmt(t.toneladas, 2)}</td>
          <td class="num">${fmt(t.factor, 4)}${t.ajuste && t.ajuste !== 1 ? `<br><span class="hint">× ${fmt(t.ajuste, 2)}</span>` : ""}</td><td class="num">${fmt(t.kg, 1)}</td></tr>`).join("")}</tbody>
      </table></div>
      ${revisor ? `<label class="field"><span>Observaciones / comentario</span><textarea id="d-com" rows="2" placeholder="Obligatorio para observar">${esc(e.comentario || "")}</textarea></label>` : ""}
      ${ROL === "coralia" && e.estado === "validado" && e.proyecto_id ? `<label class="field"><span>Referencia del retiro en el registro</span><input id="d-ref" placeholder="N° de serie / link del registro" /></label>` : ""}
      <div class="acts">${acts.join("")}</div>
      <p id="d-msg" class="msg" hidden></p>
    </div>`;
    document.querySelectorAll("#detalle [data-a]").forEach((b) => (b.onclick = () => accion(e, b.dataset.a)));
  }

  async function accion(e, a) {
    if (a === "borrar") {
      if (!confirm("¿Borrar este cálculo? No se puede deshacer.")) return;
      const { error } = await sb.from("envios").delete().eq("id", e.id);
      if (error) return msg("#d-msg", esc(error.message), "err");
      selId = null; $("#detalle").innerHTML = `<p class="hint">Cálculo borrado.</p>`;
      return cargar();
    }
    const cambios = { estado: a };
    const com = $("#d-com")?.value.trim();
    if (com !== undefined) cambios.comentario = com || null;
    if (a === "rechazado" && !com) return msg("#d-msg", "Escribí las observaciones para el cliente.", "err");
    if (a === "retirado") {
      const ref = $("#d-ref").value.trim();
      if (!ref) return msg("#d-msg", "Cargá la referencia del retiro.", "err");
      cambios.retiro_ref = ref;
    }
    const { error } = await sb.from("envios").update(cambios).eq("id", e.id);
    if (error) return msg("#d-msg", esc(error.message), "err");
    cargar();
  }

  // ---------- Exportar ----------
  function exportarCSV() {
    const cols = ["certificado", "estado", "empresa", "usuario_email", "booking", "carga", "total_kg", "total_km", "total_tkm", "proyecto_id", "creditos", "usd_estimado", "enviado_at", "revisado_at", "revisado_por", "retiro_ref", "created_at"];
    const filas = [cols.join(";"), ...envios.map((e) => cols.map((c) => `"${String(e[c] ?? "").replace(/"/g, '""')}"`).join(";"))];
    const tramos = ["envio;tramo;modo;desde;hasta;km;toneladas;factor;ajuste;kg", ...envios.flatMap((e) => e.tramos.map((t, i) =>
      [e.id, i + 1, t.modo_nombre || t.modo, t.desde?.label, t.hasta?.label, t.dist, t.toneladas, t.factor, t.ajuste, t.kg].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")))];
    const bajar = (txt, nombre) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(["﻿" + txt], { type: "text/csv;charset=utf-8" }));
      a.download = nombre; a.click(); URL.revokeObjectURL(a.href);
    };
    const hoy = new Date().toISOString().slice(0, 10);
    bajar(filas.join("\n"), `huella-envios-${hoy}.csv`);
    setTimeout(() => bajar(tramos.join("\n"), `huella-tramos-${hoy}.csv`), 300);
  }

  // ---------- Administración (Coralia) ----------
  async function cargarAdmin() {
    $("#admin").hidden = false;
    const { data: modos } = await sb.from("modos").select("*").order("orden");
    $("#modos").innerHTML = (modos || []).map((m) => `<tr data-id="${esc(m.id)}">
      <td>${m.icono} ${esc(m.nombre)}</td>
      <td><input type="number" step="any" min="0" value="${m.factor}" data-k="factor" style="width:110px" /></td>
      <td><input value="${esc(m.fuente || "")}" data-k="fuente" /></td>
      <td><input type="checkbox" ${m.verificar ? "checked" : ""} data-k="verificar" style="width:auto" /></td>
      <td><button class="btn small" type="button">Guardar</button></td></tr>`).join("");
    document.querySelectorAll("#modos tr").forEach((tr) => (tr.querySelector("button").onclick = async () => {
      const v = (k) => tr.querySelector(`[data-k="${k}"]`);
      const { error } = await sb.from("modos").update({ factor: +v("factor").value, fuente: v("fuente").value, verificar: v("verificar").checked, updated_at: new Date().toISOString() }).eq("id", tr.dataset.id);
      tr.querySelector("button").textContent = error ? "Error" : "Guardado ✓";
      setTimeout(() => (tr.querySelector("button").textContent = "Guardar"), 1500);
    }));
    await cargarSylvera();
    $("#sy-add").onclick = async () => {
      const email = $("#sy-email").value.trim().toLowerCase();
      if (!email.includes("@")) return;
      const { error } = await sb.from("sylvera_autorizados").insert({ email });
      if (!error) { $("#sy-email").value = ""; cargarSylvera(); } else alert(error.message);
    };
  }
  async function cargarSylvera() {
    const { data } = await sb.from("sylvera_autorizados").select("*").order("email");
    $("#sy-lista").innerHTML = (data || []).length ? data.map((s) => `<tr><td>${esc(s.email)}</td><td class="num"><button class="btn small danger" data-e="${esc(s.email)}">Quitar</button></td></tr>`).join("")
      : `<tr><td class="empty">Sin emails autorizados todavía.</td></tr>`;
    document.querySelectorAll("#sy-lista [data-e]").forEach((b) => (b.onclick = async () => {
      if (!confirm(`¿Quitar a ${b.dataset.e}?`)) return;
      await sb.from("sylvera_autorizados").delete().eq("email", b.dataset.e);
      cargarSylvera();
    }));
  }

  // ---------- Inicio ----------
  async function init() {
    document.querySelectorAll("[data-naviera]").forEach((n) => (n.textContent = H.C.NAVIERA));
    H.pintarCabecera();
    const s = await H.sesion();
    if (!s) return initLogin();
    USER = s.user;
    ROL = await H.rol();
    $("#v-panel").hidden = false;
    [$("#p-title").textContent, $("#p-sub").textContent] = TITULOS[ROL] || TITULOS.cliente;
    if (ROL === "sylvera") $("#b-nuevo").hidden = true;
    if (ROL === "coralia") { $("#b-csv").hidden = false; $("#b-csv").onclick = exportarCSV; }
    $("#buscar").oninput = pintarLista;
    const { data: p } = await sb.from("proyectos").select("id,nombre");
    PROY = p || [];
    await cargar();
    if (ROL === "coralia") cargarAdmin();
  }
  init().catch((e) => { console.error(e); document.querySelector(".wrap").insertAdjacentHTML("afterbegin", `<div class="notice">Error: ${esc(e.message)}</div>`); });
})();
