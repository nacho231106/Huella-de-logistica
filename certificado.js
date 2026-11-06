/* Certificado público: se consulta con el código (función verificar_envio de la base). */
(() => {
  "use strict";
  const { fmt, fmtFecha, esc, kgTxt } = H;
  const $ = (s) => document.querySelector(s);

  async function verificar(codigo) {
    const cert = $("#cert");
    cert.hidden = false;
    cert.innerHTML = `<p class="hint">Buscando…</p>`;
    const { data, error } = await H.sb.rpc("verificar_envio", { codigo });
    const c = data && data[0];
    if (error || !c) {
      cert.innerHTML = `<h2>Certificado no encontrado</h2><p class="hint">Revisá el código. Solo se pueden verificar cálculos validados por Sylvera.</p>`;
      return;
    }
    history.replaceState(null, "", `?c=${encodeURIComponent(c.certificado)}`);
    cert.innerHTML = `
      <div class="cert-top">
        <div>
          <div class="cert-logos"><img src="assets/interbarge.png" alt="InterBarge" /><img src="assets/coralia.png" alt="Coralia Environmental" /></div>
          <span class="proto">Certificado de huella de carbono</span>
          <h1 style="margin-top:10px">${esc(c.empresa || "Envío")}</h1>
          <p class="hint">${esc(c.carga || "")}</p>
        </div>
        <div style="text-align:right">
          <div class="sello">${c.estado === "retirado" ? "Validado y compensado" : "Validado por Sylvera"}</div>
          <p class="cert-code">${esc(c.certificado)}</p>
        </div>
      </div>
      <div>
        <span class="eyebrow" style="color:var(--muted)">Huella del transporte</span>
        <div class="cert-big">${kgTxt(+c.total_kg)}</div>
        <p class="hint">${fmt(c.total_km, 0)} km · ${fmt(c.total_tkm, 0)} t·km · validado el ${fmtFecha(c.revisado_at)}</p>
      </div>
      <div class="table-wrap"><table class="mini">
        <thead><tr><th>#</th><th>Tramo</th><th class="num">km</th><th class="num">t</th><th class="num">Factor</th><th class="num">kg CO₂e</th></tr></thead>
        <tbody>${c.tramos.map((t, i) => `<tr><td>${i + 1}</td><td>${esc(t.modo_nombre || t.modo)}<br><span class="hint">${esc(t.desde?.label)} → ${esc(t.hasta?.label)}</span></td>
          <td class="num">${fmt(t.dist, 0)}</td><td class="num">${fmt(t.toneladas, 2)}</td>
          <td class="num">${fmt(t.factor, 4)}${t.ajuste && t.ajuste !== 1 ? ` × ${fmt(t.ajuste, 2)}` : ""}</td><td class="num">${fmt(t.kg, 1)}</td></tr>`).join("")}</tbody>
      </table></div>
      ${c.creditos ? `<div class="cert"><b>Compensación</b>
        <span>${c.creditos} crédito${c.creditos === 1 ? "" : "s"} de carbono (1 crédito = 1 t CO₂e) · ${esc(c.proyecto || "")} · ${esc(c.proyecto_estandar || "")}</span>
        <span>${c.estado === "retirado" ? `Retirados el ${fmtFecha(c.retirado_at)} · Ref.: ${esc(c.retiro_ref || "")}` : "Retiro de créditos pendiente."}</span></div>` : ""}
      <p class="hint">Metodología y cálculo: Coralia Environmental. Fórmula: distancia × toneladas × factor de emisión (kg CO₂e/t·km) × ajuste por sentido en hidrovía. Verificable en ${esc(location.origin + location.pathname)} con el código ${esc(c.certificado)}.</p>
      <div class="no-print"><button class="btn" type="button" onclick="window.print()">Descargar PDF</button></div>`;
  }

  document.querySelectorAll("[data-naviera]").forEach((n) => (n.textContent = H.C.NAVIERA));
  H.pintarCabecera();
  $("#verificar").onclick = () => { const v = $("#codigo").value.trim(); if (v) verificar(v); };
  $("#codigo").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#verificar").click(); });
  const c = new URLSearchParams(location.search).get("c");
  if (c) { $("#codigo").value = c; verificar(c); }
})();
