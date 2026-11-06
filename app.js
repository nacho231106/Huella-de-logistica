/* Presupuesto a partir de la orden de compra: tramo fluvial con el factor propio de la flota.
 * Huella = distancia por río (km) × carga (t) × factor de la flota (kg CO2e/t·km)
 */
(() => {
  "use strict";
  const { fmt, esc, kgTxt } = H;
  const $ = (sel, el = document) => el.querySelector(sel);
  const MODO = "flota-interbarge";

  let CAT;
  let archivo = null;      // File de la OC elegido por el cliente
  let ocArchivo = null;    // ruta ya subida (al editar un envío guardado)
  let proySel = "";        // "" = sin compensación
  let editId = null;
  let calc = { kg: 0 };    // último cálculo

  const usd = (n) => `USD ${fmt(n, 0)}`;
  const puerto = (id) => CAT.puertos.find((p) => p.id === id);
  const tipoCarga = () => $("#tipo-carga").value;

  // ---------- Formulario ----------
  function pintarPuertos() {
    const ops = `<option value="">Elegí un puerto</option>` + CAT.puertos
      .map((p) => `<option value="${p.id}">${esc(p.nombre)} (${p.pais})</option>`).join("");
    $("#origen").innerHTML = ops; $("#destino").innerHTML = ops;
  }
  function pintarUnidades() {
    const sel = $("#unidad"), prev = sel.value;
    const opts = tipoCarga() === "contenedor" ? [["teu", "TEU"], ["t", "toneladas"]] : [["t", "toneladas"], ["kg", "kg"], ["m3", "m³"]];
    sel.innerHTML = opts.map(([v, n]) => `<option value="${v}">${n}</option>`).join("");
    if (opts.some(([v]) => v === prev)) sel.value = prev;
  }

  function tramo() {
    const a = puerto($("#origen").value), b = puerto($("#destino").value);
    return {
      modo: MODO,
      desde: a ? { label: a.nombre, puerto: a.id } : null,
      hasta: b ? { label: b.nombre, puerto: b.id } : null,
      dist: a && b ? Math.abs(b.km - a.km) : 0,
      cantidad: +$("#cantidad").value || 0,
      unidad: $("#unidad").value,
      tipo_carga: tipoCarga() === "contenedor" ? "general" : tipoCarga(),
      sentido: null,
    };
  }

  // ---------- Cálculo y presupuesto ----------
  function recalcular() {
    const t = tramo();
    const r = H.calcularTramo(t, CAT);
    calc = { ...r, t };
    const conv = $("#conv");
    if (t.unidad === "m3" && t.cantidad) conv.textContent = `Conversión: ${fmt(t.cantidad)} m³ × ${fmt((CAT.config.densidades || {})[t.tipo_carga] ?? 1, 2)} t/m³ = ${fmt(r.ton, 1)} t`;
    else if (t.unidad === "teu" && t.cantidad) conv.textContent = `Conversión: ${fmt(t.cantidad)} TEU × ${fmt(CAT.config.toneladas_por_teu ?? 10)} t/TEU = ${fmt(r.ton, 1)} t`;
    else conv.textContent = "";

    const mismo = t.desde && t.hasta && t.desde.puerto === t.hasta.puerto;
    $("#huella-txt").innerHTML = mismo ? "El puerto de carga y el de descarga son el mismo. Revisalos."
      : r.kg > 0 ? `Huella del envío: <b>${kgTxt(r.kg)}</b> · ${esc(t.desde.label)} → ${esc(t.hasta.label)}, ${fmt(r.dist, 0)} km por río × ${fmt(r.ton, 1)} t × ${fmt(r.modo.factor, 4)} kg CO₂e/t·km (factor propio de la flota).`
      : "Completá los puertos y la cantidad para ver el presupuesto.";
    pintarOpciones();
  }

  function pintarOpciones() {
    const cont = $("#opciones");
    if (!(calc.kg > 0)) { cont.innerHTML = ""; return; }
    const flete = +$("#flete").value || 0;
    const cred = Math.ceil(calc.kg / 1000);
    const fila = (id, titulo, sub, detalle, monto, nota) => `
      <button type="button" class="opcion" role="radio" data-id="${esc(id)}" aria-checked="${proySel === id}">
        <span class="op-radio" aria-hidden="true"></span>
        <span class="op-txt"><strong>${titulo}</strong><span class="hint">${sub}</span>${detalle ? `<span class="op-det">${detalle}</span>` : ""}</span>
        <span class="op-monto"><b>${monto}</b>${nota ? `<span class="hint">${nota}</span>` : ""}</span>
      </button>`;
    let html = fila("", "Costo sin compensación de la huella de carbono", "Solo el flete de tu orden de compra.", "",
      flete ? usd(flete) : "—", flete ? "" : "Cargá el valor del flete");
    CAT.proyectos.forEach((p) => {
      const comp = cred * p.usd_por_t;
      const sub = [p.tag, p.lugar, p.estandar].filter(Boolean).map(esc).join(" · ") + (p.ejemplo ? " · <em>proyecto de ejemplo</em>" : "");
      html += fila(p.id, `Costo con compensación · ${esc(p.nombre)}`, sub,
        `${flete ? `Flete ${usd(flete)} + ` : ""}${cred} crédito${cred === 1 ? "" : "s"} × ${usd(p.usd_por_t)} = ${usd(comp)}`,
        flete ? usd(flete + comp) : `+ ${usd(comp)}`,
        flete ? `+${fmt((comp / flete) * 100, 1)} % sobre el flete` : "por compensar");
    });
    cont.innerHTML = html;
    cont.querySelectorAll(".opcion").forEach((b) => (b.onclick = () => { proySel = b.dataset.id; pintarOpciones(); }));
  }

  // ---------- Lectura de la OC ----------
  function estadoOC(txt, tipo = "") { const m = $("#oc-estado"); m.className = `msg ${tipo}`; m.innerHTML = txt; m.hidden = !txt; }

  async function elegirArchivo(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { estadoOC("El archivo pesa más de 10 MB. Probá con un PDF más liviano.", "err"); return; }
    archivo = file; ocArchivo = null;
    $("#drop").classList.add("con-archivo");
    $(".drop-txt", $("#drop")).innerHTML = `<b>${esc(file.name)}</b> · <u>cambiar archivo</u>`;
    document.querySelectorAll(".leido").forEach((e) => e.classList.remove("leido"));
    estadoOC("Leyendo la orden de compra…");
    let res;
    try { res = await LectorOC.leer(file, CAT.puertos); }
    catch (e) { estadoOC(`No pudimos leer el archivo (${esc(e.message)}). Completá los datos a mano.`, "err"); return; }
    if (!res.legible) { estadoOC("Guardamos el archivo, pero no pudimos leer su texto (puede ser una foto o un PDF escaneado). Completá los datos a mano.", ""); return; }
    const d = res.datos;
    const poner = (sel, v) => { if (v == null || v === "") return false; const el = $(sel); el.value = v; el.classList.add("leido"); return true; };
    if (d.tipo_carga) { $("#tipo-carga").value = d.tipo_carga; $("#tipo-carga").classList.add("leido"); }
    pintarUnidades();
    const ok = [
      poner("#oc-numero", d.oc_numero), poner("#empresa", d.empresa), poner("#origen", d.origen), poner("#destino", d.destino),
      poner("#carga", d.carga), poner("#cantidad", d.cantidad), poner("#flete", d.flete),
    ];
    if (d.unidad) poner("#unidad", d.unidad);
    const n = ok.filter(Boolean).length;
    estadoOC(n ? `Leímos <b>${n} de 7 datos</b> de la orden. Revisá los marcados en verde y completá el resto.`
      : "No encontramos los datos en el archivo. Completalos a mano: el archivo queda adjunto igual.", n ? "ok" : "");
    recalcular();
  }

  function initArchivo() {
    const drop = $("#drop"), input = $("#archivo");
    input.addEventListener("change", () => elegirArchivo(input.files[0]));
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("sobre"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("sobre"); }));
    drop.addEventListener("drop", (e) => elegirArchivo(e.dataTransfer.files[0]));
    // Al tocar un campo marcado, deja de estar marcado como leído
    document.querySelectorAll("#oc-datos input, #oc-datos select").forEach((el) => el.addEventListener("input", () => el.classList.remove("leido")));
  }

  // ---------- Envío ----------
  function pasos(i) { $("#steps").innerHTML = H.PASOS.map((s, k) => `<li class="${k < i ? "done" : k === i ? "now" : ""}">${s}</li>`).join(""); }
  function aviso(txt, tipo = "") { const m = $("#msg"); m.className = `msg ${tipo}`; m.innerHTML = txt; m.hidden = !txt; }

  function validar() {
    if (!$("#oc-numero").value.trim()) return "Falta el N° de orden de compra.";
    const t = calc.t || {};
    if (!t.desde || !t.hasta) return "Elegí el puerto de carga y el de descarga.";
    if (t.desde.puerto === t.hasta.puerto) return "El puerto de carga y el de descarga tienen que ser distintos.";
    if (!(calc.kg > 0)) return "Completá la cantidad transportada.";
    return "";
  }

  async function subirOC(uid) {
    if (!archivo) return ocArchivo;
    const limpio = archivo.name.normalize("NFD").replace(/[^\w.\-]+/g, "_").slice(-80);
    const ruta = `${uid}/${Date.now()}-${limpio}`;
    const { error } = await H.sb.storage.from("ordenes").upload(ruta, archivo, { contentType: archivo.type || undefined });
    if (error) { console.warn("No se pudo subir la OC:", error.message); return ocArchivo; }
    archivo = null; ocArchivo = ruta;
    return ruta;
  }

  async function guardar() {
    const err = validar();
    if (err) { aviso(err, "err"); return; }
    const s = await H.sesion();
    if (!s) {
      $("#login").hidden = false; $("#stepEmail").hidden = false; $("#stepCode").hidden = true;
      aviso(""); $("#email").focus();
      return;
    }
    aviso("Guardando…");
    const conArchivo = Boolean(archivo);
    const ruta = await subirOC(s.user.id);
    const datos = {
      oc_numero: $("#oc-numero").value.trim(), empresa: $("#empresa").value.trim() || null, carga: $("#carga").value.trim(),
      flete_usd: +$("#flete").value || null, oc_archivo: ruta, tramos: [calc.t], proyecto_id: proySel || null, estado: "enviado",
    };
    const q = editId ? H.sb.from("envios").update(datos).eq("id", editId).select().single() : H.sb.from("envios").insert(datos).select().single();
    const { data, error } = await q;
    if (error) { aviso(`No se pudo guardar: ${esc(error.message)}`, "err"); return; }
    editId = data.id;
    history.replaceState(null, "", `?id=${data.id}`);
    $("#login").hidden = true;
    mostrarOk(data, conArchivo && !ruta);
  }

  function mostrarOk(e, sinArchivo) {
    aviso(sinArchivo ? "El presupuesto se guardó, pero no pudimos adjuntar el archivo de la OC. Coralia te lo va a pedir por email." : "");
    pasos(H.pasoDe(e.estado));
    const p = CAT.proyectos.find((x) => x.id === e.proyecto_id);
    const flete = +e.flete_usd || 0;
    $("#ok").hidden = false;
    $("#ok").innerHTML = `<b>Presupuesto confirmado · OC ${esc(e.oc_numero || "")}</b>
      <span>${esc(e.tramos[0]?.desde?.label)} → ${esc(e.tramos[0]?.hasta?.label)} · ${fmt(e.total_km, 0)} km · huella calculada en el servidor: <b>${kgTxt(+e.total_kg)}</b></span>
      <span>${p ? `Con compensación: ${e.creditos} créditos de “${esc(p.nombre)}” (${usd(e.usd_estimado)})${flete ? ` · total ${usd(flete + +e.usd_estimado)}` : ""}` : `Sin compensación${flete ? ` · ${usd(flete)}` : ""}`}</span>
      <span class="hint">Te avisamos a ${esc(e.usuario_email)} cuando Coralia revise los datos y Sylvera valide el cálculo. Seguilo en <a href="panel.html">Mis cálculos</a>.</span>`;
    bloquear(e);
  }

  function bloquear(e) {
    const editable = ["borrador", "rechazado"].includes(e.estado);
    $("#btn-enviar").disabled = !editable;
    const av = $("#aviso-edicion");
    av.hidden = false;
    if (!editable) av.innerHTML = `Este presupuesto está <b>${H.ESTADOS[e.estado].txt.toLowerCase()}</b> y ya no se puede modificar. <a href="index.html">Subir otra orden</a>.`;
    else if (e.estado === "rechazado") av.innerHTML = `<b>Tiene observaciones:</b> ${esc(e.comentario || "revisá los datos")}. Corregí y volvé a confirmar.`;
    else av.innerHTML = `Estás editando un borrador guardado. <a href="index.html">Subir otra orden</a>.`;
  }

  function initEnvio() {
    pasos(0);
    $("#btn-enviar").onclick = guardar;
    $("#sendCode").onclick = async () => {
      const email = $("#email").value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $("#email").focus(); aviso("Revisá el email.", "err"); return; }
      $("#sendCode").disabled = true;
      const { error } = await H.enviarCodigo(email, location.origin + location.pathname);
      $("#sendCode").disabled = false;
      if (error) { aviso(`No se pudo enviar el código: ${esc(error.message)}`, "err"); return; }
      aviso(`Te mandamos un código a <b>${esc(email)}</b>. Revisá también el correo no deseado.`, "ok");
      $("#stepCode").hidden = false; $("#code").focus();
    };
    $("#verify").onclick = async () => {
      const token = ($("#code").value || "").replace(/\D/g, "");
      if (token.length !== 6) { $("#code").focus(); return; }
      $("#verify").disabled = true;
      const { error } = await H.verificarCodigo($("#email").value.trim(), token);
      $("#verify").disabled = false;
      if (error) { aviso("El código no es válido o venció. Pedí uno nuevo.", "err"); return; }
      pasos(1);
      await H.pintarCabecera();
      guardar();
    };
  }

  // ---------- Envío guardado (?id=) ----------
  async function cargarEnvio(id) {
    const { data, error } = await H.sb.from("envios").select("*").eq("id", id).maybeSingle();
    if (error || !data) return false;
    editId = data.id; ocArchivo = data.oc_archivo || null;
    const t = data.tramos[0] || {};
    $("#oc-numero").value = data.oc_numero || ""; $("#empresa").value = data.empresa || ""; $("#carga").value = data.carga || "";
    $("#flete").value = data.flete_usd ?? "";
    $("#tipo-carga").value = t.unidad === "teu" ? "contenedor" : t.tipo_carga || "solido";
    pintarUnidades();
    $("#origen").value = t.desde?.puerto || ""; $("#destino").value = t.hasta?.puerto || "";
    $("#cantidad").value = t.cantidad || ""; $("#unidad").value = t.unidad || "t";
    if (ocArchivo) $(".drop-txt", $("#drop")).innerHTML = `<b>Orden de compra adjunta</b> · <u>reemplazar archivo</u>`;
    proySel = data.proyecto_id || "";
    pasos(H.pasoDe(data.estado));
    bloquear(data);
    return true;
  }

  // ---------- Intro ----------
  function initIntro(saltar) {
    const entrar = (animar) => {
      const fin = () => { document.body.classList.remove("intro-on", "intro-saliendo"); window.scrollTo(0, 0); if (animar) $("#drop").focus({ preventScroll: true }); };
      if (!animar || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return fin();
      document.body.classList.add("intro-saliendo");
      setTimeout(fin, 340);
    };
    if (saltar) return entrar(false);
    $("#btn-empezar").onclick = () => { history.replaceState(null, "", "#calcular"); entrar(true); };
  }

  // ---------- Inicio ----------
  async function init() {
    CAT = await H.cargarCatalogos();
    CAT.puertos = CAT.puertos.filter((p) => p.via === "hidrovia").sort((a, b) => a.km - b.km);
    document.querySelectorAll("[data-naviera]").forEach((n) => (n.textContent = H.C.NAVIERA));

    const avisos = [];
    if (CAT.proyectos.some((p) => p.ejemplo)) avisos.push("los proyectos y precios de créditos son de ejemplo");
    if (CAT.origen === "local") avisos.push("sin conexión con la base: se usan datos locales y no se puede confirmar");
    if (avisos.length) { $("#aviso-factores").hidden = false; $("#aviso-factores").innerHTML = `<b>Prototipo:</b> ${avisos.join("; ")}.`; }

    pintarPuertos(); pintarUnidades();
    initArchivo(); initEnvio();
    H.pintarCabecera();
    ["#origen", "#destino", "#cantidad", "#unidad"].forEach((s) => $(s).addEventListener("input", recalcular));
    $("#flete").addEventListener("input", pintarOpciones);
    $("#tipo-carga").addEventListener("change", () => { pintarUnidades(); recalcular(); });

    const id = new URLSearchParams(location.search).get("id");
    const cargado = id && (await cargarEnvio(id));
    recalcular();
    initIntro(Boolean(cargado) || location.hash === "#calcular");
  }

  init().catch((e) => {
    console.error(e);
    document.querySelector(".wrap").insertAdjacentHTML("afterbegin",
      `<div class="notice">No se pudo iniciar la página (${esc(e.message)}). Si abriste el archivo con doble clic, usá Go Live o un servidor.</div>`);
  });
})();
