/* Parte administrativa (modo demo): pestañas Coralia, Sylvera y Bolsa Paraguaya de Carbono.
 * Usa los envíos de la demo guardados en el navegador (H.demo), con las mismas reglas que la base.
 */
(() => {
  "use strict";
  const { fmt, fmtFecha, esc, kgTxt, ESTADOS } = H;
  const $ = (s) => document.querySelector(s);
  let CAT, ROL = "coralia", selId = null;

  const DESC = {
    coralia: "Coralia ve todos los envíos. Revisa los datos de cada uno y lo pasa a Sylvera, o lo observa para que el cliente lo corrija.",
    sylvera: "Sylvera ve los envíos que Coralia aprobó. Valida el cálculo (sale el certificado) o lo observa.",
    bolsa: "La Bolsa Paraguaya de Carbono ve los envíos validados que compensan, y registra el retiro de los créditos en el registro.",
  };
  const VE = {
    coralia: () => true,
    sylvera: (e) => ["en_validacion", "validado", "retirado"].includes(e.estado) || (e.estado === "rechazado" && e.rechazo_rol === "sylvera"),
    bolsa: (e) => e.proyecto_id && ["validado", "retirado"].includes(e.estado),
  };
  const PENDIENTE = { coralia: (e) => e.estado === "enviado", sylvera: (e) => e.estado === "en_validacion", bolsa: (e) => e.estado === "validado" && e.proyecto_id };

  function sembrarEjemplo() {
    if (H.demo.listar().length) return;
    const a = CAT.puertos.find((p) => p.id === "con"), b = CAT.puertos.find((p) => p.id === "np");
    if (!a || !b) return;
    H.demo.crear({
      oc_numero: "OC-DEMO-0001", empresa: "Empresa de ejemplo SA", carga: "Ejemplo · Maíz a granel", flete_usd: null,
      tramos: [{ modo: "flota-interbarge", desde: { label: a.nombre, puerto: a.id }, hasta: { label: b.nombre, puerto: b.id },
        dist: Math.abs(b.km - a.km), cantidad: 3000, unidad: "t", tipo_carga: "solido", sentido: null }],
      proyecto_id: (CAT.proyectos[0] || {}).id || null, estado: "enviado", usuario_email: "cliente@empresadeejemplo.com",
    }, CAT);
  }

  function pintarTabs() {
    const l = H.demo.listar();
    document.querySelectorAll(".tab").forEach((t) => {
      const r = t.dataset.rol, n = l.filter((e) => VE[r](e) && PENDIENTE[r](e)).length;
      t.setAttribute("aria-selected", r === ROL);
      t.querySelector(".tab-n").textContent = n ? n : "";
      t.querySelector(".tab-n").title = n ? `${n} pendiente${n === 1 ? "" : "s"}` : "";
    });
    $("#rol-desc").textContent = DESC[ROL];
    $("#factores").hidden = ROL !== "coralia";
  }

  function pintarLista() {
    const vis = H.demo.listar().filter(VE[ROL]);
    $("#lista").innerHTML = vis.length ? vis.map((e) => `
      <tr data-id="${esc(e.id)}" class="${e.id === selId ? "sel" : ""}">
        <td>${fmtFecha(e.updated_at)}</td>
        <td><b>${esc(e.empresa || "—")}</b><br><span class="hint">OC ${esc(e.oc_numero || "—")} · ${esc(e.carga || "")}</span></td>
        <td class="num">${kgTxt(+e.total_kg)}${e.creditos ? `<br><span class="hint">${e.creditos} créditos</span>` : ""}</td>
        <td><span class="st ${ESTADOS[e.estado].cls}">${ESTADOS[e.estado].txt}</span>${PENDIENTE[ROL](e) ? ' <span class="pend">pendiente</span>' : ""}</td>
      </tr>`).join("") : `<tr><td colspan="4" class="empty">No hay envíos en esta etapa. Confirmá un presupuesto en la <a href="index.html#calcular">calculadora</a>.</td></tr>`;
    document.querySelectorAll("#lista tr[data-id]").forEach((tr) => (tr.onclick = () => mostrar(tr.dataset.id)));
  }

  function mostrar(id) {
    const e = H.demo.get(id);
    if (!e || !VE[ROL](e)) { selId = null; $("#detalle").innerHTML = `<p class="hint">Elegí un envío para ver el detalle.</p>`; return; }
    selId = id; pintarLista();
    const acts = [];
    if (ROL === "coralia" && e.estado === "enviado") acts.push(["en_validacion", "Aprobar y pasar a Sylvera"], ["rechazado", "Observar", "danger"]);
    if (ROL === "sylvera" && e.estado === "en_validacion") acts.push(["validado", "Validar"], ["rechazado", "Observar", "danger"]);
    if (ROL === "bolsa" && e.estado === "validado" && e.proyecto_id) acts.push(["retirado", "Registrar retiro de créditos"]);
    const comenta = acts.some(([a]) => a === "rechazado");
    const retira = acts.some(([a]) => a === "retirado");
    $("#detalle").innerHTML = `<div class="detail">
      <div><span class="st ${ESTADOS[e.estado].cls}">${ESTADOS[e.estado].txt}</span></div>
      <h2>${esc(e.empresa || "Envío")}</h2>
      <div class="big" style="color:var(--teal)">${kgTxt(+e.total_kg)}</div>
      <dl>
        <dt>Orden de compra</dt><dd>${esc(e.oc_numero || "—")}</dd>
        <dt>Carga</dt><dd>${esc(e.carga || "—")}</dd>
        <dt>Cliente</dt><dd>${esc(e.usuario_email || "—")}</dd>
        <dt>Distancia</dt><dd>${fmt(e.total_km, 0)} km · ${fmt(e.total_tkm, 0)} t·km</dd>
        <dt>Compensación</dt><dd>${e.proyecto_id ? `${e.creditos} créditos · ${esc(e.proyecto_nombre || e.proyecto_id)} · USD ${fmt(e.usd_estimado, 0)}` : "No compensa"}</dd>
        <dt>Confirmado</dt><dd>${fmtFecha(e.enviado_at)}</dd>
        <dt>Revisado</dt><dd>${e.revisado_at ? `${fmtFecha(e.revisado_at)} · ${esc(e.revisado_por || "")}` : "—"}</dd>
        ${e.certificado ? `<dt>Certificado</dt><dd><code>${esc(e.certificado)}</code></dd>` : ""}
        ${e.retiro_ref ? `<dt>Retiro</dt><dd>${esc(e.retiro_ref)} · ${fmtFecha(e.retirado_at)}</dd>` : ""}
        ${e.comentario ? `<dt>Observaciones</dt><dd>${esc(e.comentario)}</dd>` : ""}
      </dl>
      <div class="table-wrap"><table class="mini">
        <thead><tr><th>#</th><th>Tramo</th><th class="num">km</th><th class="num">t</th><th class="num">Factor</th><th class="num">kg CO₂e</th></tr></thead>
        <tbody>${e.tramos.map((t, i) => `<tr><td>${i + 1}</td><td>${esc(t.modo_nombre || t.modo)}<br><span class="hint">${esc(t.desde?.label)} → ${esc(t.hasta?.label)}</span></td>
          <td class="num">${fmt(t.dist, 0)}</td><td class="num">${fmt(t.toneladas, 1)}</td><td class="num">${fmt(t.factor, 5)}</td><td class="num">${fmt(t.kg, 1)}</td></tr>`).join("")}</tbody>
      </table></div>
      ${comenta ? `<label class="field"><span>Observaciones</span><textarea id="d-com" rows="2" placeholder="Obligatorio para observar"></textarea></label>` : ""}
      ${retira ? `<label class="field"><span>Referencia del retiro en el registro</span><input id="d-ref" placeholder="N° de serie o link del registro" /></label>` : ""}
      <div class="acts">${acts.map(([a, txt, cls]) => `<button class="btn small ${cls || ""}" data-a="${a}">${txt}</button>`).join("")}
        ${e.certificado ? `<a class="btn small ghost" href="certificado.html?c=${encodeURIComponent(e.certificado)}" target="_blank" rel="noopener">Ver certificado</a>` : ""}
        ${ROL === "coralia" ? `<button class="btn small danger" data-a="borrar">Borrar</button>` : ""}</div>
      ${!acts.length && ROL !== "coralia" ? `<p class="hint">No hay nada pendiente para ${H.ROL_NOMBRE[ROL]} en este envío.</p>` : ""}
      <p id="d-msg" class="msg" hidden></p>
    </div>`;
    document.querySelectorAll("#detalle [data-a]").forEach((b) => (b.onclick = () => accion(e, b.dataset.a)));
  }

  function accion(e, a) {
    const msg = (t) => { const m = $("#d-msg"); m.className = "msg err"; m.textContent = t; m.hidden = false; };
    if (a === "borrar") {
      if (!confirm("¿Borrar este envío de la demo?")) return;
      H.demo.borrar(e.id); selId = null; return refrescar();
    }
    try {
      H.demo.actualizar(e.id, { estado: a, comentario: $("#d-com")?.value.trim(), retiro_ref: $("#d-ref")?.value.trim() }, ROL);
      refrescar();
    } catch (err) { msg(err.message); }
  }

  function refrescar() { pintarTabs(); pintarLista(); if (selId) mostrar(selId); else $("#detalle").innerHTML = `<p class="hint">Elegí un envío para ver el detalle.</p>`; }

  function elegirRol(r) {
    ROL = r; selId = null;
    history.replaceState(null, "", "#" + r);
    refrescar();
  }

  async function init() {
    H.pintarCabecera();
    if (!H.DEMO) {
      $("#aviso-demo").hidden = false;
      $("#aviso-demo").innerHTML = 'La parte administrativa sin inicio de sesión es solo para la demo. Con el login activado, cada perfil entra desde su <a href="panel.html">panel</a>.';
      return;
    }
    $("#aviso-demo").hidden = false;
    $("#aviso-demo").innerHTML = "<b>Versión de demostración:</b> sin inicio de sesión. Los envíos se guardan solo en este navegador; nadie más los ve.";
    CAT = await H.cargarCatalogos();
    sembrarEjemplo();
    $("#factores-lista").innerHTML = CAT.modos.filter((m) => m.activo !== false && ["hidrovia", "terrestre"].includes(m.via)).map((m) =>
      `<tr><td>${m.icono || ""} ${esc(m.nombre)}</td><td class="num">${fmt(m.factor, 5)}</td><td class="hint">${esc(m.fuente || "")}</td></tr>`).join("");
    document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => elegirRol(t.dataset.rol)));
    $("#reiniciar").onclick = () => { if (confirm("¿Borrar todos los envíos de la demo en este navegador?")) { H.demo.reiniciar(); sembrarEjemplo(); selId = null; refrescar(); } };
    const r = location.hash.slice(1);
    elegirRol(["coralia", "sylvera", "bolsa"].includes(r) ? r : "coralia");
  }
  init().catch((e) => { console.error(e); document.querySelector(".wrap").insertAdjacentHTML("afterbegin", `<div class="notice">Error: ${esc(e.message)}</div>`); });
})();
