/* "Mi huella": lo que ve el cliente (según el prototipo del recorrido de Kieffer).
 * Pendiente → aviso de revisión · Rechazado → aviso ·
 * Aceptado → 1. Mis envíos · 2. Compensar · 3. Pago · 4. Documentos
 */
(() => {
  "use strict";
  const { fmt, esc, ESTADOS } = H;
  const $ = (s) => document.querySelector(s);
  let CAT, RUTA, CLI, ENVIOS = [];
  let paso = 0, mes = null, proy = null, medio = "tarjeta", abierto = null, mesDocs = null;

  const usd = (n) => "USD " + fmt(n, 0);
  const tco2 = (e) => (+e.total_kg || 0) / 1000;
  const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const fechaDe = (e) => e.fecha || String(e.created_at || "").slice(0, 10);
  const claveMes = (e) => fechaDe(e).slice(0, 7);
  const nombreMes = (k) => k ? `${MESES[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}` : "";
  const fechaTxt = (e) => fechaDe(e).split("-").reverse().join("/");
  const fluvial = (e) => e.tramos.find((t) => t.via === "hidrovia" || t.modo === "flota-interbarge") || e.tramos[0] || {};
  const pendiente = (e) => !e.proyecto_id && e.estado !== "retirado";
  const creditosDe = (lista) => lista.reduce((a, e) => a + Math.ceil(tco2(e)), 0);
  const proyecto = (id) => CAT.proyectos.find((p) => p.id === id);
  const caja = (icono, titulo, texto) => `<section class="card pad estado-cuenta">
      <div class="ec-icono" aria-hidden="true">${icono}</div><h1>${titulo}</h1><p class="lead">${texto}</p></section>`;

  function estadoComp(e) {
    if (e.estado === "retirado") return ["Compensado", "st-ok"];
    if (e.proyecto_id) return ["Compensación pedida", "st-wait"];
    return ["Sin compensar", "st-draft"];
  }

  // ---------- Mapa del recorrido por la hidrovía (SVG) ----------
  function mapa(t) {
    const pts = RUTA.hidrovia.puntos;
    const lat = pts.map((p) => p.lat), lng = pts.map((p) => p.lng);
    const [la0, la1, ln0, ln1] = [Math.min(...lat), Math.max(...lat), Math.min(...lng), Math.max(...lng)];
    const W = 220, H_ = 340, pad = 18;
    const k = Math.min((W - 2 * pad) / (ln1 - ln0), (H_ - 2 * pad) / (la1 - la0));
    const xy = (p) => [pad + (p.lng - ln0) * k + ((W - 2 * pad) - (ln1 - ln0) * k) / 2, pad + (la1 - p.lat) * k];
    const linea = (arr) => arr.map((p) => xy(p).map((v) => v.toFixed(1)).join(",")).join(" ");
    const iA = pts.findIndex((p) => p.puerto === t.desde?.puerto), iB = pts.findIndex((p) => p.puerto === t.hasta?.puerto);
    const tramo = iA >= 0 && iB >= 0 ? pts.slice(Math.min(iA, iB), Math.max(iA, iB) + 1) : [];
    const fin = (p) => p.id === t.desde?.puerto || p.id === t.hasta?.puerto;
    return `<svg class="mapa-rio" viewBox="0 0 ${W} ${H_}" role="img" aria-label="Recorrido por el río de ${esc(t.desde?.label)} a ${esc(t.hasta?.label)}">
      <polyline points="${linea(pts)}" class="rio" />${tramo.length ? `<polyline points="${linea(tramo)}" class="ruta" />` : ""}
      ${CAT.puertos.filter((p) => p.via === "hidrovia").map((p) => { const [x, y] = xy(p); const f = fin(p);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${f ? 5.5 : 3}" class="${f ? "pto fin" : "pto"}" />` +
          (f ? `<text x="${(x + 9).toFixed(1)}" y="${(y + 4).toFixed(1)}" class="pto-txt">${esc(p.nombre)}</text>` : ""); }).join("")}</svg>`;
  }

  function detalle(e) {
    const fl = fluvial(e), [ec] = estadoComp(e);
    return `<tr class="det"><td colspan="7"><div class="orden-grid">
      <div class="orden-mapa">${mapa(fl)}</div>
      <div>
        <h3>Orden de compra ${esc(e.oc_numero || "—")}</h3>
        <p class="ruta-txt"><b>${esc(fl.desde?.label || "—")}</b> → <b>${esc(fl.hasta?.label || "—")}</b> por la hidrovía Paraná-Paraguay</p>
        <div class="table-wrap"><table class="mini">
          <thead><tr><th>Tramo</th><th class="num">km</th><th class="num">t</th><th class="num">Factor</th><th class="num">kg CO₂e</th></tr></thead>
          <tbody>${e.tramos.map((t) => `<tr><td>${esc(t.modo_nombre || t.modo)}<br><span class="hint">${esc(t.desde?.label)} → ${esc(t.hasta?.label)}</span></td>
            <td class="num">${fmt(t.dist, 0)}</td><td class="num">${fmt(t.toneladas, 1)}</td><td class="num">${fmt(t.factor, 4)}</td><td class="num">${fmt(t.kg, 0)}</td></tr>`).join("")}</tbody>
        </table></div>
        <dl class="oc-info"><dt>Empresa</dt><dd>${esc(e.empresa || "—")}</dd><dt>Producto</dt><dd>${esc(e.carga || "—")}</dd>
          <dt>Revisión</dt><dd>${e.estado === "rechazado" ? "InterBarge está corrigiendo datos" : esc(ESTADOS[e.estado].txt)}</dd>
          <dt>Compensación</dt><dd>${ec}${e.proyecto_id ? ` · ${esc(proyecto(e.proyecto_id)?.nombre || "")} · ${e.creditos} créditos` : ""}</dd>
          ${e.certificado ? `<dt>Certificado</dt><dd><a href="certificado.html?c=${encodeURIComponent(e.certificado)}" target="_blank" rel="noopener">${esc(e.certificado)}</a></dd>` : ""}</dl>
      </div></div></td></tr>`;
  }

  // ---------- 1. Mis envíos ----------
  function pasoEnvios() {
    const tot = ENVIOS.reduce((a, e) => a + tco2(e), 0), tons = ENVIOS.reduce((a, e) => a + (fluvial(e).toneladas || 0), 0);
    const meses = [...new Set(ENVIOS.filter(pendiente).map(claveMes))].sort();
    if (!meses.includes(mes)) mes = meses[meses.length - 1] || null;
    return `<h2>Mis envíos</h2>
      <p class="hint">${esc(CLI.empresa || ENVIOS[0]?.empresa || "Tu empresa")} · envíos con <span data-naviera>InterBarge</span> por la hidrovía</p>
      <div class="kpis">
        <div class="kpi"><span>Envíos</span><b>${ENVIOS.length}</b></div>
        <div class="kpi"><span>Toneladas transportadas</span><b>${fmt(tons, 0)}</b></div>
        <div class="kpi"><span>Huella total</span><b>${fmt(tot, 1)} t CO₂e</b></div>
      </div>
      <div class="table-wrap"><table class="envios">
        <thead><tr><th>Fecha</th><th>Recorrido</th><th>Producto</th><th class="num">t</th><th class="num">km</th><th class="num">t CO₂e</th><th>Estado</th></tr></thead>
        <tbody>${ENVIOS.map((e) => { const fl = fluvial(e), [txt, cls] = estadoComp(e);
          return `<tr data-abrir="${esc(e.id)}" class="${abierto === e.id ? "sel" : ""}" title="Ver el recorrido y el detalle"><td>${fechaTxt(e)}</td><td>${esc(fl.desde?.label || "—")} → ${esc(fl.hasta?.label || "—")}</td>
            <td>${esc(e.carga || "—")}</td><td class="num">${fmt(fl.toneladas || 0, 0)}</td><td class="num">${fmt(e.total_km, 0)}</td><td class="num">${fmt(tco2(e), 1)}</td>
            <td><span class="st ${cls}">${txt}</span></td></tr>${abierto === e.id ? detalle(e) : ""}`; }).join("")}</tbody>
      </table></div>
      <p class="hint">Tocá un envío para ver su recorrido en el mapa y el detalle del cálculo.</p>
      ${meses.length ? `<div class="periodos"><span class="hint">Elegí qué período compensar:</span>
        <div class="medios">${meses.map((m) => { const l = ENVIOS.filter((e) => pendiente(e) && claveMes(e) === m);
          return `<button class="medio" data-mes="${m}" aria-pressed="${m === mes}">${nombreMes(m)} · ${fmt(l.reduce((a, e) => a + tco2(e), 0), 1)} t CO₂e</button>`; }).join("")}</div></div>
        <div><button class="btn" data-ir="1">Compensar ${nombreMes(mes).toLowerCase()}</button></div>`
        : `<div class="ok-msg">Todos tus envíos tienen la compensación pedida o hecha. Mirá tus <button class="link-btn" data-ir="3">documentos</button>.</div>`}`;
  }

  // ---------- 2. Compensar ----------
  const delMes = () => ENVIOS.filter((e) => pendiente(e) && claveMes(e) === mes);
  function pasoCompensar() {
    const l = delMes(), cred = creditosDe(l);
    if (!l.length) return `<h2>Elegí un proyecto para compensar</h2><p class="hint">Primero elegí un período con envíos sin compensar en <button class="link-btn" data-ir="0">Mis envíos</button>.</p>`;
    if (!proyecto(proy)) proy = CAT.proyectos[0]?.id || null;
    return `<h2>Elegí un proyecto para compensar</h2>
      <p class="hint">${nombreMes(mes)}: ${l.length} envío${l.length === 1 ? "" : "s"} · ${fmt(l.reduce((a, e) => a + tco2(e), 0), 1)} t CO₂e → <b>${cred} créditos</b> (1 crédito = 1 t CO₂e; se redondea hacia arriba por envío)</p>
      <div class="proys">${CAT.proyectos.map((p) => `<button class="proy" data-proy="${esc(p.id)}" aria-pressed="${p.id === proy}">
        <small>${esc(p.tag || "")}${p.ejemplo ? " · ejemplo" : ""}</small><b>${esc(p.nombre)}</b><span class="hint">${esc([p.lugar, p.estandar].filter(Boolean).join(" · "))}</span>
        <span class="p"><span class="hint">${cred} × USD ${fmt(p.usd_por_t, 0)}</span><b>${usd(cred * p.usd_por_t)}</b></span></button>`).join("")}</div>
      <div><button class="btn" data-ir="2">Ir a pagar</button></div>`;
  }

  // ---------- 3. Pago ----------
  function pasoPago() {
    const l = delMes(), p = proyecto(proy), cred = creditosDe(l);
    if (!l.length || !p) return `<h2>Pago</h2><p class="hint">Elegí primero el período y el proyecto en <button class="link-btn" data-ir="0">Mis envíos</button>.</p>`;
    return `<h2>Pago</h2>
      <div class="resumen">
        <div><span>Período</span><span>${nombreMes(mes)} · ${l.length} envío${l.length === 1 ? "" : "s"}</span></div>
        <div><span>Huella</span><span>${fmt(l.reduce((a, e) => a + tco2(e), 0), 2)} t CO₂e</span></div>
        <div><span>Proyecto</span><span>${esc(p.nombre)}</span></div>
        <div><span>Créditos</span><span>${cred} × USD ${fmt(p.usd_por_t, 0)}</span></div>
        <div class="tot"><span>Total</span><span>${usd(cred * p.usd_por_t)}</span></div>
      </div>
      <div class="medios">${[["tarjeta", "Tarjeta"], ["mp", "Mercado Pago"], ["transf", "Transferencia"]].map(([k, n]) => `<button class="medio" data-medio="${k}" aria-pressed="${k === medio}">${n}</button>`).join("")}</div>
      <p class="hint">Medios de pago de ejemplo: falta definir quién cobra y con qué. Por ahora no se cobra: al confirmar queda pedida la compensación, y la Bolsa Paraguaya de Carbono registra el retiro de los créditos cuando el cálculo esté validado.</p>
      <div><button class="btn" id="pagar">Confirmar compensación · ${usd(cred * p.usd_por_t)}</button></div>
      <p class="msg" id="pago-msg" hidden></p>`;
  }
  async function pagar() {
    const l = delMes(), b = $("#pagar");
    b.disabled = true; b.textContent = "Confirmando…";
    for (const e of l) {
      const { error } = await H.sb.from("envios").update({ proyecto_id: proy }).eq("id", e.id);
      if (error) { const m = $("#pago-msg"); m.className = "msg err"; m.textContent = error.message; m.hidden = false; b.disabled = false; return; }
    }
    mesDocs = mes;
    await recargar(); paso = 3; pintar();
  }

  // ---------- 4. Documentos ----------
  function reporte(lista, k) {
    const cols = ["Fecha", "Orden de compra", "Producto", "Tramo", "Desde", "Hasta", "km", "Toneladas", "Factor (kg CO2e/t·km)", "Fuente del factor", "kg CO2e", "Estado", "Compensación", "Certificado"];
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const filas = lista.flatMap((e) => e.tramos.map((t) => [fechaTxt(e), e.oc_numero, e.carga, t.modo_nombre || t.modo, t.desde?.label, t.hasta?.label,
      fmt(t.dist, 0), fmt(t.toneladas, 2), fmt(t.factor, 5), t.fuente, fmt(t.kg, 1), ESTADOS[e.estado].txt, estadoComp(e)[0], e.certificado || ""].map(q).join(";")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + [cols.map(q).join(";"), ...filas].join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `reporte-huella-${k || "todos"}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
  function pasoDocumentos() {
    const meses = [...new Set(ENVIOS.map(claveMes))].sort();
    if (!meses.includes(mesDocs)) mesDocs = meses[meses.length - 1] || null;
    const l = ENVIOS.filter((e) => claveMes(e) === mesDocs), comp = l.filter((e) => e.proyecto_id);
    const retirados = comp.filter((e) => e.estado === "retirado"), certs = l.filter((e) => e.certificado);
    const p = proyecto(comp[0]?.proyecto_id);
    const aviso = !comp.length ? `<div class="notice notice-info">En ${nombreMes(mesDocs).toLowerCase()} no pediste compensar. Igual podés descargar el reporte de huella.</div>`
      : retirados.length === comp.length ? `<div class="ok-msg"><b>Compensación completa.</b> La Bolsa Paraguaya de Carbono registró el retiro de ${creditosDe(retirados)} créditos${p ? ` de “${esc(p.nombre)}”` : ""} a nombre de ${esc(CLI.empresa || l[0]?.empresa || "tu empresa")}.</div>`
      : `<div class="notice notice-info"><b>Compensación pedida.</b> Coralia revisa los datos, Sylvera valida el cálculo y la Bolsa Paraguaya de Carbono registra el retiro de los créditos. Vas a ver acá cada certificado a medida que se emite.</div>`;
    return `<h2>Mis documentos</h2>
      <div class="medios">${meses.map((m) => `<button class="medio" data-mesdocs="${m}" aria-pressed="${m === mesDocs}">${nombreMes(m)}</button>`).join("")}</div>
      ${aviso}
      <div class="docs">
        <div class="doc"><h3>Factura</h3><span class="ref">${comp.length ? usd(comp.reduce((a, e) => a + (+e.usd_estimado || 0), 0)) : "—"}</span>
          <p class="hint">Emisor a definir: se emite con el sistema de facturación de quien vende los créditos.</p><button class="btn ghost" disabled>A definir</button></div>
        <div class="doc"><h3>Certificado de compensación</h3>
          ${certs.length ? certs.map((e) => `<span class="ref">${esc(e.certificado)}${e.retiro_ref ? ` · retiro ${esc(e.retiro_ref)}` : ""}</span>`).join("") : `<span class="ref">Todavía no hay certificados</span>`}
          <p class="hint">Sale cuando Sylvera valida el cálculo. Cualquiera lo puede verificar con su código.</p>
          ${certs.length ? certs.map((e) => `<a class="btn ghost" href="certificado.html?c=${encodeURIComponent(e.certificado)}" target="_blank" rel="noopener">Ver ${esc(e.certificado)}</a>`).join("") : `<button class="btn ghost" disabled>Todavía no disponible</button>`}</div>
        <div class="doc"><h3>Reporte de huella logística</h3><span class="ref">${nombreMes(mesDocs)} · Alcance 3, categoría 4</span>
          <p class="hint">Envío por envío, con distancias, toneladas, factores y fuentes. Sirve para el inventario de tu empresa.</p>
          <button class="btn ghost" id="reporte">Descargar Excel</button></div>
      </div>
      <div><button class="btn ghost" data-ir="0">Volver a mis envíos</button></div>`;
  }

  // ---------- Pintar ----------
  const PASOS = ["Mis envíos", "Compensar", "Pago", "Documentos"];
  function pintar() {
    const esc_ = [pasoEnvios, pasoCompensar, pasoPago, pasoDocumentos][paso]();
    $("#contenido").innerHTML = `<section class="hero"><h1>Mi huella</h1>
        <p class="lead">La huella de carbono de cada envío que <span data-naviera>InterBarge</span> hace para vos por la hidrovía, y su compensación.</p></section>
      <ol class="pasos-cli">${PASOS.map((t, i) => `<li><button data-ir="${i}" class="${i < paso ? "hecho" : ""}" ${i === paso ? 'aria-current="step"' : ""}><b>${i + 1}</b>${t}</button></li>`).join("")}</ol>
      <section class="card pad escena">${esc_}
        <div class="nav-pasos"><button class="btn ghost" data-ir="${paso - 1}" ${paso ? "" : "disabled"}>← Anterior</button>
          <button class="btn ghost" data-ir="${paso + 1}" ${paso < PASOS.length - 1 ? "" : "disabled"}>Siguiente →</button></div></section>`;
    document.querySelectorAll("[data-naviera]").forEach((n) => (n.textContent = H.C.NAVIERA));
    $("#pagar")?.addEventListener("click", pagar);
    $("#reporte")?.addEventListener("click", () => reporte(ENVIOS.filter((e) => claveMes(e) === mesDocs), mesDocs));
  }
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-ir],[data-mes],[data-proy],[data-medio],[data-abrir],[data-mesdocs]");
    if (!b || b.disabled) return;
    if (b.dataset.ir != null) { paso = Math.max(0, Math.min(3, +b.dataset.ir)); pintar(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    else if (b.dataset.mes) { mes = b.dataset.mes; pintar(); }
    else if (b.dataset.proy) { proy = b.dataset.proy; pintar(); }
    else if (b.dataset.medio) { medio = b.dataset.medio; pintar(); }
    else if (b.dataset.mesdocs) { mesDocs = b.dataset.mesdocs; pintar(); }
    else if (b.dataset.abrir) { abierto = abierto === b.dataset.abrir ? null : b.dataset.abrir; pintar(); }
  });

  async function recargar() {
    const { data, error } = await H.sb.from("envios").select("*").order("fecha", { ascending: true }).order("created_at", { ascending: true });
    if (error) throw error;
    ENVIOS = data || [];
  }

  async function init() {
    await H.pintarCabecera();
    const s = await H.sesion();
    if (!s) { location.replace("index.html"); return; }
    const r = await H.rol();
    if (H.PERSONAL.includes(r)) { location.replace("admin.html"); return; }
    CLI = await H.miCliente();
    if (!CLI || CLI.estado === "pendiente") {
      $("#contenido").innerHTML = caja("⏳", "Tu solicitud está en revisión",
        `<span data-naviera>InterBarge</span> va a revisar la solicitud${CLI?.empresa ? ` de <b>${esc(CLI.empresa)}</b>` : ""}. Cuando la acepte, vas a ver acá la huella de carbono de tus envíos.`);
      document.querySelectorAll("[data-naviera]").forEach((n) => (n.textContent = H.C.NAVIERA));
      return;
    }
    if (CLI.estado === "rechazado") {
      $("#contenido").innerHTML = caja("✕", "InterBarge no aceptó tu solicitud",
        `${CLI.comentario ? `Motivo: ${esc(CLI.comentario)}. ` : ""}Si creés que es un error, comunicate con InterBarge.`);
      return;
    }
    [CAT, RUTA] = await Promise.all([H.cargarCatalogos(), fetch("data/ruta.json").then((x) => x.json())]);
    await recargar();
    if (!ENVIOS.length) {
      $("#contenido").innerHTML = caja("🚢", "Todavía no hay envíos",
        `Cuando <span data-naviera>InterBarge</span> cargue la orden de compra de un envío, vas a ver acá su recorrido y su huella de carbono.`);
      document.querySelectorAll("[data-naviera]").forEach((n) => (n.textContent = H.C.NAVIERA));
      return;
    }
    pintar();
  }
  init().catch((e) => { console.error(e); $("#contenido").innerHTML = `<div class="notice">Error: ${esc(e.message)}</div>`; });
})();
