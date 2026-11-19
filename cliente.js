/* "Mi huella": lo que ve el cliente.
 * Pendiente → aviso de revisión · Rechazado → aviso · Aceptado → sus órdenes con recorrido, OC y huella.
 */
(() => {
  "use strict";
  const { fmt, fmtFecha, esc, kgTxt, ESTADOS } = H;
  const $ = (s) => document.querySelector(s);
  let CAT, RUTA;

  const usd = (n) => "USD " + fmt(n, 0);
  const caja = (icono, titulo, texto) => `<section class="card pad estado-cuenta">
      <div class="ec-icono" aria-hidden="true">${icono}</div><h1>${titulo}</h1><p class="lead">${texto}</p></section>`;

  // ---------- Mapa del recorrido por la hidrovía (SVG) ----------
  function mapa(t) {
    const pts = RUTA.hidrovia.puntos;
    const lat = pts.map((p) => p.lat), lng = pts.map((p) => p.lng);
    const [la0, la1, ln0, ln1] = [Math.min(...lat), Math.max(...lat), Math.min(...lng), Math.max(...lng)];
    const W = 220, H_ = 340, pad = 18;
    const esc_ = Math.min((W - 2 * pad) / (ln1 - ln0), (H_ - 2 * pad) / (la1 - la0));
    const xy = (p) => [pad + (p.lng - ln0) * esc_ + ((W - 2 * pad) - (ln1 - ln0) * esc_) / 2, pad + (la1 - p.lat) * esc_];
    const linea = (arr) => arr.map((p) => xy(p).map((v) => v.toFixed(1)).join(",")).join(" ");
    const iA = pts.findIndex((p) => p.puerto === t.desde?.puerto), iB = pts.findIndex((p) => p.puerto === t.hasta?.puerto);
    const tramo = iA >= 0 && iB >= 0 ? pts.slice(Math.min(iA, iB), Math.max(iA, iB) + 1) : [];
    const puertos = CAT.puertos.filter((p) => p.via === "hidrovia");
    const fin = (p) => p && (p.id === t.desde?.puerto || p.id === t.hasta?.puerto);
    return `<svg class="mapa-rio" viewBox="0 0 ${W} ${H_}" role="img" aria-label="Recorrido por el río de ${esc(t.desde?.label)} a ${esc(t.hasta?.label)}">
      <polyline points="${linea(pts)}" class="rio" />
      ${tramo.length ? `<polyline points="${linea(tramo)}" class="ruta" />` : ""}
      ${puertos.map((p) => { const [x, y] = xy(p); const f = fin(p);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${f ? 5.5 : 3}" class="${f ? "pto fin" : "pto"}" />` +
          (f ? `<text x="${(x + 9).toFixed(1)}" y="${(y + 4).toFixed(1)}" class="pto-txt">${esc(p.nombre)}</text>` : ""); }).join("")}
    </svg>`;
  }

  // ---------- Etapas ----------
  function etapas(e) {
    const lista = [["enviado", "Revisión Coralia"], ["en_validacion", "Validación Sylvera"], ["validado", "Certificado"]];
    if (e.proyecto_id) lista.push(["retirado", "Créditos retirados"]);
    const orden = ["enviado", "en_validacion", "validado", "retirado"];
    const i = e.estado === "rechazado" ? 0 : orden.indexOf(e.estado);
    return `<ol class="steps">${lista.map(([k, txt], n) => `<li class="${n < i || (n === i && ["validado", "retirado"].includes(e.estado)) ? "done" : n === i ? "now" : ""}">${txt}</li>`).join("")}</ol>`;
  }

  // ---------- Compensación (el cliente elige mientras está en revisión) ----------
  function compensacion(e) {
    const puede = ["enviado", "en_validacion"].includes(e.estado);
    const cred = Math.ceil((+e.total_kg || 0) / 1000);
    if (!puede) {
      const p = CAT.proyectos.find((x) => x.id === e.proyecto_id);
      return `<div class="comp"><h3>Compensación</h3><p>${p ? `${e.creditos} créditos de “${esc(p.nombre)}” · ${usd(e.usd_estimado)}${e.retiro_ref ? ` · retirados (ref. ${esc(e.retiro_ref)})` : ""}` : "Sin compensar."}</p></div>`;
    }
    const op = (id, titulo, sub, monto) => `<button type="button" class="opcion" role="radio" data-env="${esc(e.id)}" data-proy="${esc(id)}" aria-checked="${(e.proyecto_id || "") === id}">
        <span class="op-radio" aria-hidden="true"></span><span class="op-txt"><strong>${titulo}</strong><span class="hint">${sub}</span></span><span class="op-monto"><b>${monto}</b></span></button>`;
    return `<div class="comp"><h3>¿Querés compensar esta huella?</h3>
      <p class="hint">Cada crédito equivale a 1 t CO₂e: tu huella son ${cred} crédito${cred === 1 ? "" : "s"}. Podés elegir mientras la orden está en revisión.</p>
      <div class="opciones" role="radiogroup">
        ${op("", "No compensar por ahora", "Solo conocer la huella", "—")}
        ${CAT.proyectos.map((p) => op(p.id, esc(p.nombre), [p.tag, p.lugar, p.estandar].filter(Boolean).map(esc).join(" · ") + (p.ejemplo ? " · <em>proyecto de ejemplo</em>" : ""), usd(cred * p.usd_por_t))).join("")}
      </div><p class="msg" hidden data-msg="${esc(e.id)}"></p></div>`;
  }

  function orden(e) {
    const fl = e.tramos.find((t) => t.via === "hidrovia" || t.modo === "flota-interbarge") || e.tramos[0] || {};
    const tons = fl.toneladas || 0;
    return `<article class="card pad orden" id="o-${esc(e.id)}">
      <div class="orden-head">
        <div><span class="st ${ESTADOS[e.estado].cls}">${e.estado === "rechazado" ? "En corrección" : ESTADOS[e.estado].txt}</span>
          <h2>Orden de compra ${esc(e.oc_numero || "—")}</h2>
          <p class="hint">${esc(e.carga || "")} · cargada el ${fmtFecha(e.created_at)}</p></div>
        <div class="orden-huella"><span class="eyebrow">Huella de carbono</span><b>${kgTxt(+e.total_kg)}</b><span class="hint">${fmt(e.total_km, 0)} km · ${fmt(tons, 0)} t</span></div>
      </div>
      ${e.estado === "rechazado" ? `<p class="msg">Coralia o Sylvera pidieron corregir datos de esta orden. InterBarge la está revisando.</p>` : ""}
      ${etapas(e)}
      <div class="orden-grid">
        <div class="orden-mapa">${mapa(fl)}</div>
        <div>
          <h3>Recorrido</h3>
          <p class="ruta-txt"><b>${esc(fl.desde?.label || "—")}</b> → <b>${esc(fl.hasta?.label || "—")}</b> por la hidrovía Paraná-Paraguay</p>
          <div class="table-wrap"><table class="mini">
            <thead><tr><th>Tramo</th><th class="num">km</th><th class="num">t</th><th class="num">kg CO₂e</th></tr></thead>
            <tbody>${e.tramos.map((t) => `<tr><td>${esc(t.modo_nombre || t.modo)}<br><span class="hint">${esc(t.desde?.label)} → ${esc(t.hasta?.label)}</span></td>
              <td class="num">${fmt(t.dist, 0)}</td><td class="num">${fmt(t.toneladas, 1)}</td><td class="num">${fmt(t.kg, 0)}</td></tr>`).join("")}</tbody>
          </table></div>
          <dl class="oc-datos">
            <dt>Empresa</dt><dd>${esc(e.empresa || "—")}</dd>
            <dt>Producto</dt><dd>${esc(e.carga || "—")}</dd>
            ${e.flete_usd ? `<dt>Flete</dt><dd>${usd(e.flete_usd)}</dd>` : ""}
          </dl>
        </div>
      </div>
      ${compensacion(e)}
      ${e.certificado ? `<a class="btn" href="certificado.html?c=${encodeURIComponent(e.certificado)}" target="_blank" rel="noopener">Ver certificado ${esc(e.certificado)}</a>` : ""}
    </article>`;
  }

  async function pintarOrdenes(cli) {
    const { data, error } = await H.sb.from("envios").select("*").order("created_at", { ascending: false });
    const l = data || [];
    $("#contenido").innerHTML = `<section class="hero">
        <h1>Mi huella</h1>
        <p class="lead">${esc(cli.empresa || l[0]?.empresa || "Tu empresa")}: la huella de carbono de cada envío que <span data-naviera>InterBarge</span> hace para vos por la hidrovía.</p>
      </section>
      ${error ? `<div class="notice">No pudimos cargar tus órdenes: ${esc(error.message)}</div>` : ""}
      ${l.length ? l.map(orden).join("") : `<section class="card pad vacio"><h2>Todavía no hay órdenes</h2><p class="lead">Cuando <span data-naviera>InterBarge</span> cargue la orden de compra de un envío, vas a ver acá el recorrido y su huella de carbono.</p></section>`}`;
    document.querySelectorAll("[data-naviera]").forEach((n) => (n.textContent = H.C.NAVIERA));
    document.querySelectorAll(".opcion[data-env]").forEach((b) => (b.onclick = async () => {
      const id = b.dataset.env, proy = b.dataset.proy || null;
      const { error: err } = await H.sb.from("envios").update({ proyecto_id: proy }).eq("id", id);
      if (err) { const m = document.querySelector(`[data-msg="${id}"]`); m.className = "msg err"; m.textContent = err.message; m.hidden = false; return; }
      pintarOrdenes(cli);
    }));
  }

  async function init() {
    await H.pintarCabecera();
    const s = await H.sesion();
    if (!s) { location.replace("index.html"); return; }
    const r = await H.rol();
    if (H.PERSONAL.includes(r)) { location.replace("admin.html"); return; }
    const cli = await H.miCliente();
    if (!cli || cli.estado === "pendiente") {
      $("#contenido").innerHTML = caja("⏳", "Tu solicitud está en revisión",
        `<span data-naviera>InterBarge</span> va a revisar la solicitud${cli?.empresa ? ` de <b>${esc(cli.empresa)}</b>` : ""}. Cuando la acepte, vas a ver acá la huella de carbono de tus envíos.`);
      document.querySelectorAll("[data-naviera]").forEach((n) => (n.textContent = H.C.NAVIERA));
      return;
    }
    if (cli.estado === "rechazado") {
      $("#contenido").innerHTML = caja("✕", "InterBarge no aceptó tu solicitud",
        `${cli.comentario ? `Motivo: ${esc(cli.comentario)}. ` : ""}Si creés que es un error, comunicate con InterBarge.`);
      return;
    }
    [CAT, RUTA] = await Promise.all([H.cargarCatalogos(), fetch("data/ruta.json").then((x) => x.json())]);
    pintarOrdenes(cli);
  }
  init().catch((e) => { console.error(e); $("#contenido").innerHTML = `<div class="notice">Error: ${esc(e.message)}</div>`; });
})();
