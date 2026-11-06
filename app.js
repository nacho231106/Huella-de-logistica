/* Presupuesto a partir de la orden de compra: tramo fluvial con el factor propio de la flota
 * y, si el cliente quiere, tramos terrestres (camión o tren) antes y después del puerto.
 * Huella de cada tramo = distancia (km) × carga (t) × factor (kg CO2e/t·km)
 */
(() => {
  "use strict";
  const { fmt, esc, kgTxt } = H;
  const $ = (sel, el = document) => el.querySelector(sel);
  const MODO = "flota-interbarge";
  const CAMION = "camion-articulado";   // medio terrestre por defecto

  let CAT;
  let archivo = null;      // File de la OC elegido por el cliente
  let ocArchivo = null;    // ruta ya subida (al editar un envío guardado)
  let proySel = "";        // "" = sin compensación
  let editId = null;
  let calc = { kg: 0 };    // último cálculo
  let terrestre = false;   // ¿incluye tramos en camión?

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

  function tramoFluvial() {
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

  // Tramos en camión: retiro (lugar → puerto de carga) y entrega (puerto de descarga → lugar)
  function tramos() {
    const fl = tramoFluvial();
    if (!terrestre) return [fl];
    const base = { cantidad: fl.cantidad, unidad: fl.unidad, tipo_carga: fl.tipo_carga, sentido: null };
    const pierna = (etapa) => {
      const lugar = $(`#${etapa}-lugar`).value.trim(), km = +$(`#${etapa}-km`).value || 0;
      if (!lugar && !km) return null;
      const sitio = { label: lugar || (etapa === "retiro" ? "Lugar de retiro" : "Lugar de entrega") };
      return { ...base, modo: $(`#${etapa}-modo`).value || CAMION, etapa, dist: km, desde: etapa === "retiro" ? sitio : fl.hasta, hasta: etapa === "retiro" ? fl.desde : sitio };
    };
    return [pierna("retiro"), fl, pierna("entrega")].filter(Boolean);
  }
  const esFluvial = (t) => t.modo === MODO || t.via === "hidrovia";

  function pintarModosTerrestres() {
    const ms = CAT.modos.filter((m) => m.via === "terrestre");
    const ops = ms.map((m) => `<option value="${esc(m.id)}">${m.icono} ${esc(m.nombre)}</option>`).join("");
    ["#retiro-modo", "#entrega-modo"].forEach((sel) => { $(sel).innerHTML = ops; if (ms.some((m) => m.id === CAMION)) $(sel).value = CAMION; });
  }

  // ---------- Cálculo y presupuesto ----------
  function recalcular() {
    const lista = tramos();
    const rs = lista.map((t) => ({ t, ...H.calcularTramo(t, CAT) }));
    const fl = rs.find((r) => esFluvial(r.t));
    const camion = rs.filter((r) => !esFluvial(r.t));
    const kgCamion = camion.reduce((a, r) => a + r.kg, 0);
    calc = { kg: fl.kg > 0 ? fl.kg + kgCamion : 0, fl, camion, tramos: lista };

    const t = fl.t;
    const conv = $("#conv");
    if (t.unidad === "m3" && t.cantidad) conv.textContent = `Conversión: ${fmt(t.cantidad)} m³ × ${fmt((CAT.config.densidades || {})[t.tipo_carga] ?? 1, 2)} t/m³ = ${fmt(fl.ton, 1)} t`;
    else if (t.unidad === "teu" && t.cantidad) conv.textContent = `Conversión: ${fmt(t.cantidad)} TEU × ${fmt(CAT.config.toneladas_por_teu ?? 10)} t/TEU = ${fmt(fl.ton, 1)} t`;
    else conv.textContent = "";

    const mismo = t.desde && t.hasta && t.desde.puerto === t.hasta.puerto;
    let txt = "Completá los puertos y la cantidad para ver el presupuesto.";
    if (mismo) txt = "El puerto de carga y el de descarga son el mismo. Revisalos.";
    else if (fl.kg > 0) {
      const linea = (r, nombre) => `${nombre}${esFluvial(r.t) ? "" : ` (${esc(r.modo?.nombre || "sin medio")})`}: ${esc(r.t.desde?.label)} → ${esc(r.t.hasta?.label)}, ${fmt(r.dist, 0)} km × ${fmt(r.ton, 1)} t × ${fmt(r.modo?.factor ?? 0, 5)} kg CO₂e/t·km = <b>${kgTxt(r.kg)}</b>`;
      txt = `Huella del envío: <b>${kgTxt(calc.kg)}</b>${camion.length ? ` (fluvial ${kgTxt(fl.kg)} + terrestre ${kgTxt(kgCamion)})` : ""}.<br>` +
        [...camion.filter((r) => r.t.etapa === "retiro"), fl, ...camion.filter((r) => r.t.etapa === "entrega")]
          .map((r) => linea(r, esFluvial(r.t) ? "Fluvial (factor propio de la flota)" : r.t.etapa === "retiro" ? "Planta → puerto" : "Puerto → planta")).join("<br>");
    }
    $("#huella-txt").innerHTML = txt;
    if (terrestre && !CAT.modos.some((m) => m.via === "terrestre")) $("#terr-hint").textContent = "Faltan los factores terrestres en la base: corré la migración 04.";
    pintarOpciones();
  }

  // ---------- Distancia por ruta (OpenStreetMap) ----------
  const rutaSeq = { retiro: 0, entrega: 0 };
  async function rutaCamion(etapa) {
    const lugar = $(`#${etapa}-lugar`).value.trim(), inKm = $(`#${etapa}-km`);
    const p = puerto($(etapa === "retiro" ? "#origen" : "#destino").value);
    const hint = $("#terr-hint");
    if (!lugar || (inKm.value && !inKm.classList.contains("auto"))) return;
    if (!p) { hint.textContent = `Elegí el puerto de ${etapa === "retiro" ? "carga" : "descarga"} para calcular la distancia.`; return; }
    const seq = ++rutaSeq[etapa];
    hint.textContent = "Calculando la distancia por ruta…";
    try {
      const g = await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=es&countrycodes=ar,uy,py,br,bo,cl&q=${encodeURIComponent(lugar)}`)).json();
      if (!g.length) throw new Error(`no encontramos “${lugar}”`);
      const a = { lat: +g[0].lat, lng: +g[0].lon }, b = { lat: p.lat, lng: p.lng };
      const [o, d] = etapa === "retiro" ? [a, b] : [b, a];
      const r = await (await fetch(`https://router.project-osrm.org/route/v1/driving/${o.lng},${o.lat};${d.lng},${d.lat}?overview=false`)).json();
      const km = r.routes?.[0]?.distance / 1000;
      if (!km) throw new Error("no hay ruta");
      if (seq !== rutaSeq[etapa]) return;
      inKm.value = Math.round(km); inKm.classList.add("auto");
      const sitio = g[0].display_name.split(",").slice(0, 3).join(",");
      hint.textContent = `${etapa === "retiro" ? `${sitio} → ${p.nombre}` : `${p.nombre} → ${sitio}`}: ${fmt(km, 0)} km por ruta. Podés corregirlo.`;
    } catch (e) {
      if (seq === rutaSeq[etapa]) hint.textContent = `No pudimos calcular la distancia (${e.message}). Cargá los km a mano.`;
    }
    recalcular();
  }

  function setTerrestre(v) {
    terrestre = v;
    $("#terr-si").setAttribute("aria-checked", v); $("#terr-no").setAttribute("aria-checked", !v);
    $("#terrestre").hidden = !v;
    if (v) { rutaCamion("retiro"); rutaCamion("entrega"); }
    recalcular();
  }

  function initTerrestre() {
    $("#terr-si").onclick = () => setTerrestre(true);
    $("#terr-no").onclick = () => setTerrestre(false);
    ["retiro", "entrega"].forEach((et) => {
      $(`#${et}-lugar`).addEventListener("change", () => { $(`#${et}-km`).value = ""; $(`#${et}-km`).classList.add("auto"); rutaCamion(et); });
      $(`#${et}-lugar`).addEventListener("input", recalcular);
      $(`#${et}-km`).addEventListener("input", (e) => { e.target.classList.remove("auto"); recalcular(); });
      $(`#${et}-modo`).addEventListener("change", recalcular);
    });
    // Si cambia un puerto, se recalculan las distancias automáticas
    $("#origen").addEventListener("change", () => terrestre && rutaCamion("retiro"));
    $("#destino").addEventListener("change", () => terrestre && rutaCamion("entrega"));
    $("#remito").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const m = $("#remito-estado");
      m.hidden = false; m.className = "msg"; m.textContent = "Leyendo el remito…";
      try {
        const { legible, datos } = await LectorOC.leer(f, CAT.puertos);
        const n = ponerLugares(datos);
        m.className = `msg ${n ? "ok" : ""}`;
        m.innerHTML = !legible ? "No pudimos leer el texto del remito. Completá las plantas a mano."
          : n ? `Leímos ${n === 2 ? "la planta de fabricación y la de destino" : "una planta"} del remito (${esc(f.name)}). Revisalos.`
          : "No encontramos plantas de fabricación o destino en el remito. Completalas a mano.";
      } catch (err) { m.className = "msg err"; m.textContent = `No pudimos leer el remito (${err.message}).`; }
    });
  }

  // Pone los lugares leídos de la OC o del remito y calcula sus distancias
  function ponerLugares(d) {
    let n = 0;
    [["retiro", d.lugar_retiro], ["entrega", d.lugar_entrega]].forEach(([et, v]) => {
      if (!v) return;
      const el = $(`#${et}-lugar`);
      el.value = v; el.classList.add("leido");
      $(`#${et}-km`).value = ""; $(`#${et}-km`).classList.add("auto");
      n++;
      if (terrestre) rutaCamion(et);
    });
    recalcular();
    return n;
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
    const lugares = ponerLugares(d);
    const extra = !lugares ? "" : terrestre ? " También leímos las plantas para los tramos terrestres."
      : " La orden trae la planta de fabricación o de destino: si querés sumar la huella terrestre, elegí “Sí” arriba.";
    estadoOC((n ? `Leímos <b>${n} de 7 datos</b> de la orden. Revisá los campos marcados y completá el resto.`
      : "No encontramos los datos en el archivo. Completalos a mano: el archivo queda adjunto igual.") + extra, n ? "ok" : "");
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
    const t = calc.fl?.t || {};
    if (!t.desde || !t.hasta) return "Elegí el puerto de carga y el de descarga.";
    if (t.desde.puerto === t.hasta.puerto) return "El puerto de carga y el de descarga tienen que ser distintos.";
    if (!(calc.kg > 0)) return "Completá la cantidad transportada.";
    const sinKm = (calc.camion || []).find((r) => !(r.t.dist > 0));
    const nombre = (t) => (t.etapa === "retiro" ? "planta de fabricación → puerto" : "puerto → planta de destino");
    if (sinKm) return `Falta la distancia del tramo ${nombre(sinKm.t)}. Cargala o dejá la planta vacía.`;
    const sinModo = (calc.camion || []).find((r) => !r.modo);
    if (sinModo) return `Elegí el medio de transporte del tramo ${nombre(sinModo.t)}.`;
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
    if (H.DEMO) {
      const e = H.demo.crear({
        oc_numero: $("#oc-numero").value.trim(), empresa: $("#empresa").value.trim() || null, carga: $("#carga").value.trim(),
        flete_usd: +$("#flete").value || null, oc_archivo: null, tramos: calc.tramos, proyecto_id: proySel || null, estado: "enviado",
      }, CAT);
      editId = e.id;
      history.replaceState(null, "", `?id=${e.id}#calcular`);
      mostrarOk(e, false);
      return;
    }
    const s = await H.sesion();
    if (!s) {
      $("#login").hidden = false; aviso("");
      $("#login").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    aviso("Guardando…");
    const conArchivo = Boolean(archivo);
    const ruta = await subirOC(s.user.id);
    const datos = {
      oc_numero: $("#oc-numero").value.trim(), empresa: $("#empresa").value.trim() || null, carga: $("#carga").value.trim(),
      flete_usd: +$("#flete").value || null, oc_archivo: ruta, tramos: calc.tramos, proyecto_id: proySel || null, estado: "enviado",
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
      <span>${esc(e.tramos[0]?.desde?.label)} → ${esc(e.tramos[e.tramos.length - 1]?.hasta?.label)} · ${e.tramos.length} tramo${e.tramos.length === 1 ? "" : "s"} · ${fmt(e.total_km, 0)} km · huella${H.DEMO ? "" : " calculada en el servidor"}: <b>${kgTxt(+e.total_kg)}</b></span>
      <span>${p ? `Con compensación: ${e.creditos} créditos de “${esc(p.nombre)}” (${usd(e.usd_estimado)})${flete ? ` · total ${usd(flete + +e.usd_estimado)}` : ""}` : `Sin compensación${flete ? ` · ${usd(flete)}` : ""}`}</span>
      ${H.DEMO
        ? `<span class="hint">Demo: seguilo en la <a href="admin.html">Parte administrativa</a>. Ahí Coralia lo revisa, Sylvera lo valida y la Bolsa registra el retiro de créditos.</span>`
        : `<span class="hint">Te avisamos a ${esc(e.usuario_email)} cuando Coralia revise los datos y Sylvera valide el cálculo. Seguilo en <a href="panel.html">Mis cálculos</a>.</span>`}`;
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
    // Si no hay sesión al confirmar, se muestra la tarjeta de ingreso y al entrar se guarda
    H.tarjetaLogin($("#login-confirmar"), { alEntrar: () => { $("#login").hidden = true; pasos(1); guardar(); } });
  }

  // ---------- Envío guardado (?id=) ----------
  async function cargarEnvio(id) {
    let data, error;
    if (H.DEMO) data = H.demo.get(id);
    else ({ data, error } = await H.sb.from("envios").select("*").eq("id", id).maybeSingle());
    if (error || !data) return false;
    editId = data.id; ocArchivo = data.oc_archivo || null;
    const t = data.tramos.find(esFluvial) || data.tramos[0] || {};
    data.tramos.filter((x) => !esFluvial(x)).forEach((x) => {
      if (!["retiro", "entrega"].includes(x.etapa)) return;
      $(`#${x.etapa}-lugar`).value = (x.etapa === "retiro" ? x.desde : x.hasta)?.label || "";
      $(`#${x.etapa}-km`).value = x.dist || "";
      if (x.modo) $(`#${x.etapa}-modo`).value = x.modo;
      terrestre = true;
    });
    $("#oc-numero").value = data.oc_numero || ""; $("#empresa").value = data.empresa || ""; $("#carga").value = data.carga || "";
    $("#flete").value = data.flete_usd ?? "";
    $("#tipo-carga").value = t.unidad === "teu" ? "contenedor" : t.tipo_carga || "solido";
    pintarUnidades();
    $("#origen").value = t.desde?.puerto || ""; $("#destino").value = t.hasta?.puerto || "";
    $("#cantidad").value = t.cantidad || ""; $("#unidad").value = t.unidad || "t";
    if (ocArchivo) $(".drop-txt", $("#drop")).innerHTML = `<b>Orden de compra adjunta</b> · <u>reemplazar archivo</u>`;
    proySel = data.proyecto_id || "";
    if (terrestre) { $("#terrestre").hidden = false; $("#terr-si").setAttribute("aria-checked", true); $("#terr-no").setAttribute("aria-checked", false); }
    pasos(H.pasoDe(data.estado));
    bloquear(data);
    return true;
  }

  // ---------- Intro (portada con inicio de sesión) ----------
  function entrarApp(animar) {
    const fin = () => {
      document.body.classList.remove("intro-on", "intro-saliendo");
      if (location.hash !== "#calcular") history.replaceState(null, "", location.pathname + location.search + "#calcular");
      window.scrollTo(0, 0);
      if (animar && $("#drop")) $("#drop").focus({ preventScroll: true });
    };
    if (!animar || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return fin();
    document.body.classList.add("intro-saliendo");
    setTimeout(fin, 340);
  }
  async function initIntro(saltar) {
    if (saltar) return entrarApp(false);
    if (H.DEMO) {
      $("#login-intro").innerHTML = `<div class="auth">
        <h2 class="auth-t">Entrá a Huella</h2>
        <p class="auth-sub">Versión de demostración, sin inicio de sesión.</p>
        <button class="auth-btn" type="button" id="demo-entrar">Subir mi orden de compra <span aria-hidden="true">→</span></button>
        <div class="auth-sep"><span>¿Sos de Coralia, Sylvera o la Bolsa?</span></div>
        <a class="auth-btn ghost" href="admin.html">Parte administrativa</a>
      </div>`;
      $("#demo-entrar").onclick = () => entrarApp(true);
      return;
    }
    if (await H.sesion()) return entrarApp(false);
    H.tarjetaLogin($("#login-intro"), { alEntrar: () => entrarApp(true) });
  }

  // ---------- Inicio ----------
  async function init() {
    CAT = await H.cargarCatalogos();
    CAT.puertos = CAT.puertos.filter((p) => p.via === "hidrovia").sort((a, b) => a.km - b.km);
    document.querySelectorAll("[data-naviera]").forEach((n) => (n.textContent = H.C.NAVIERA));
    if (H.DEMO) {
      const h = document.querySelector("#sec-enviar .sec-head .hint");
      if (h) h.textContent = "Versión de demostración: confirmá sin iniciar sesión. Después seguilo en la Parte administrativa (arriba a la derecha): Coralia revisa, Sylvera valida y la Bolsa registra el retiro de créditos.";
    }

    const avisos = [];
    if (CAT.proyectos.some((p) => p.ejemplo)) avisos.push("los proyectos y precios de créditos son de ejemplo");
    if (CAT.origen === "local") avisos.push("sin conexión con la base: se usan datos locales y no se puede confirmar");
    if (avisos.length) { $("#aviso-factores").hidden = false; $("#aviso-factores").innerHTML = `<b>Prototipo:</b> ${avisos.join("; ")}.`; }

    pintarPuertos(); pintarUnidades(); pintarModosTerrestres();
    initArchivo(); initEnvio(); initTerrestre();
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
