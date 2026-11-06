/* Calculadora de huella por tramos: hidrovía Paraná-Paraguay y tramos terrestres.
 * Huella del tramo = distancia (km) × carga (t) × factor (kg CO2e/t·km) × ajuste por sentido (solo hidrovía)
 */
(() => {
  "use strict";
  const { fmt, esc, norm, kgTxt } = H;
  const $ = (sel, el = document) => el.querySelector(sel);

  let CAT;                    // catálogos
  let map;
  const tramos = [];          // { el, modo, desde, hasta, dist, distManual, cantidad, unidad, sentido, ruta, layer, seq, kg }
  let proySel = null;         // id de proyecto o null
  let editId = null;          // id de envío que se está editando
  let envioActual = null;

  const VIAS = { hidrovia: "Hidrovía Paraná-Paraguay", terrestre: "Terrestre" };
  const COLOR = { hidrovia: "#1a7f4b", terrestre: "#c4620a" };
  const modoDe = (t) => CAT.modos.find((m) => m.id === t.modo);
  const tipoCarga = () => $("#tipo-carga").value;

  // ---------- Geometría ----------
  function km(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const largo = (pts) => pts.slice(1).reduce((s, p, i) => s + km(pts[i], p), 0);

  function rutaHidrovia(pA, pB) {
    const puntos = CAT.ruta.hidrovia.puntos;
    const iA = puntos.findIndex((p) => p.puerto === pA.id), iB = puntos.findIndex((p) => p.puerto === pB.id);
    if (iA < 0 || iB < 0) return null;
    const pts = iA <= iB ? puntos.slice(iA, iB + 1) : puntos.slice(iB, iA + 1).reverse();
    const sentido = pB.km > pA.km ? "arriba" : pB.km < pA.km ? "abajo" : null;
    return { pts, km: Math.abs(pB.km - pA.km), sentido };
  }

  async function rutaTerrestre(a, b) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status);
      const ruta = (await r.json()).routes?.[0];
      if (!ruta) throw new Error("sin ruta");
      return { pts: ruta.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })), km: ruta.distance / 1000 };
    } catch (e) {
      return { pts: [a, b], km: km(a, b) * 1.3, estimada: true };
    }
  }

  // ---------- Mapa ----------
  function initMap() {
    map = L.map("map", { scrollWheelZoom: false }).setView([-35, -60], 4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 18,
    }).addTo(map);
    L.polyline(CAT.ruta.hidrovia.puntos.map((c) => [c.lat, c.lng]), { color: COLOR.hidrovia, weight: 3, opacity: 0.35 }).addTo(map);
    CAT.puertos.forEach((p) => {
      L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "port-dot", iconSize: [10, 10] }) })
        .bindTooltip(`${p.nombre}${p.km != null ? ` · km ${fmt(p.km, 0)}` : ""}`, { direction: "right" }).addTo(map);
    });
    map.fitBounds(L.latLngBounds(CAT.puertos.map((p) => [p.lat, p.lng])).pad(0.1));
  }

  function dibujar() {
    const bounds = [];
    tramos.forEach((t) => {
      if (t.layer) { map.removeLayer(t.layer); t.layer = null; }
      if (!t.ruta) return;
      const via = modoDe(t)?.via || "terrestre";
      const ll = t.ruta.pts.map((p) => [p.lat, p.lng]);
      const punto = (p, txt) => L.circleMarker(p, { radius: 6, color: "#fff", weight: 2, fillColor: "#1f5a43", fillOpacity: 1 }).bindTooltip(txt);
      t.layer = L.layerGroup([
        L.polyline(ll, { color: COLOR[via], weight: 4, opacity: 0.95, dashArray: t.ruta.estimada ? "6 6" : null }),
        punto(ll[0], t.desde.label), punto(ll[ll.length - 1], t.hasta.label),
      ]).addTo(map);
      bounds.push(...ll);
    });
    $("#map-hint").hidden = bounds.length > 0;
    if (bounds.length) map.fitBounds(L.latLngBounds(bounds).pad(0.2), { maxZoom: 9 });
  }

  // ---------- Cálculo y resultado ----------
  const datosTramo = (t) => ({
    modo: t.modo, desde: t.desde, hasta: t.hasta, dist: t.dist, cantidad: t.cantidad, unidad: t.unidad,
    tipo_carga: tipoCarga() === "contenedor" ? "general" : tipoCarga(), sentido: t.sentido || null,
  });

  function recalcular() {
    let total = 0, kmTot = 0, tkm = 0;
    const lista = $("#desglose");
    lista.innerHTML = "";
    tramos.forEach((t, i) => {
      const r = H.calcularTramo(datosTramo(t), CAT);
      t.kg = r.kg;
      total += r.kg; kmTot += r.dist; tkm += r.tkm;
      // Conversión visible
      const conv = $(".conv", t.el);
      if (t.unidad === "m3" && t.cantidad) conv.textContent = `Conversión: ${fmt(t.cantidad)} m³ × ${fmt((CAT.config.densidades || {})[datosTramo(t).tipo_carga] ?? 1, 2)} t/m³ = ${fmt(r.ton, 2)} t`;
      else if (t.unidad === "teu" && t.cantidad) conv.textContent = `Conversión: ${fmt(t.cantidad)} TEU × ${fmt(CAT.config.toneladas_por_teu ?? 10)} t/TEU = ${fmt(r.ton, 2)} t`;
      else conv.textContent = r.kg ? "" : "Completá modo, origen, destino y cantidad.";
      if (r.kg) {
        const li = document.createElement("li");
        const aj = r.ajuste !== 1 ? ` × ${fmt(r.ajuste, 2)} (${t.sentido === "arriba" ? "aguas arriba" : "aguas abajo"})` : "";
        li.innerHTML = `<span>${i + 1}. ${r.modo.icono} ${esc(t.desde?.label)} → ${esc(t.hasta?.label)}</span><b>${kgTxt(r.kg)}</b>
          <small>${fmt(r.dist, 0)} km × ${fmt(r.ton, 2)} t × ${fmt(r.modo.factor, 4)} kg/t·km${aj}</small>`;
        lista.appendChild(li);
      }
    });
    $("#total").innerHTML = total
      ? (total >= 1000 ? `${fmt(total / 1000, 2)} <small>t CO₂e</small>` : `${fmt(total, 1)} <small>kg CO₂e</small>`)
      : "–";
    $("#r-km").textContent = kmTot ? `${fmt(kmTot, 0)} km` : "–";
    $("#r-tkm").textContent = tkm ? fmt(tkm, 0) : "–";
    $("#r-n").textContent = tramos.length;
    $("#r-int").textContent = tkm ? `${fmt((total * 1000) / tkm, 1)} g CO₂e/t·km` : "–";
    pintarCheckout(total);
  }

  async function actualizarRuta(t) {
    const modo = modoDe(t);
    const msg = $(".tramo-msg", t.el), sent = $(".sentido", t.el);
    msg.hidden = true; sent.hidden = true;
    t.ruta = null; t.sentido = null;
    t.el.dataset.via = modo?.via || "terrestre";
    $(".tramo-icon", t.el).textContent = modo?.icono || "🚚";

    if (t.desde && t.hasta && modo) {
      const seq = ++t.seq;
      let ruta = null;
      const pA = CAT.puertos.find((p) => p.id === t.desde.puerto), pB = CAT.puertos.find((p) => p.id === t.hasta.puerto);
      if (modo.via === "hidrovia") {
        if (pA && pB && pA.via === modo.via && pB.via === modo.via) {
          ruta = rutaHidrovia(pA, pB);
        } else {
          msg.textContent = `Para este modo elegí puertos de la ${VIAS[modo.via].toLowerCase()} en Desde y Hasta.`;
          msg.hidden = false;
        }
      } else {
        msg.textContent = "Calculando recorrido…"; msg.hidden = false;
        ruta = await rutaTerrestre(t.desde, t.hasta);
        if (seq !== t.seq) return;
        msg.hidden = !ruta.estimada;
        if (ruta.estimada) msg.textContent = "No se pudo trazar la ruta: la distancia es una estimación. Podés corregirla.";
      }
      t.ruta = ruta;
      if (ruta?.sentido) {
        t.sentido = ruta.sentido;
        const aj = (CAT.config.ajuste_sentido || {})[ruta.sentido] ?? 1;
        sent.innerHTML = ruta.sentido === "arriba"
          ? `<span class="chip up">↑ Aguas arriba</span> contra la corriente: más consumo (× ${fmt(aj, 2)}).`
          : `<span class="chip down">↓ Aguas abajo</span> a favor de la corriente: menos consumo (× ${fmt(aj, 2)}).`;
        sent.hidden = false;
      }
      if (ruta && !t.distManual) {
        t.dist = Math.round(ruta.km);
        const inDist = $(".in-dist", t.el);
        inDist.value = t.dist; inDist.classList.add("auto");
      }
    }
    dibujar();
    recalcular();
  }

  // ---------- Autocompletar ----------
  let geoTimer;
  function autocompletar(input, onPick, getModo) {
    const list = input.parentElement.querySelector(".ac-list");
    let items = [], active = -1;
    const cerrar = () => { list.hidden = true; active = -1; };
    const elegir = (item) => { input.value = item.label; cerrar(); onPick(item); };
    const render = (puertos, lugares) => {
      list.innerHTML = ""; items = [];
      const sec = (txt) => { const li = document.createElement("li"); li.className = "ac-sec"; li.textContent = txt; list.appendChild(li); };
      const add = (item, title, small) => {
        const li = document.createElement("li");
        li.innerHTML = `${esc(title)}<small>${esc(small)}</small>`;
        li.addEventListener("mousedown", (e) => { e.preventDefault(); elegir(item); });
        items.push({ li, item }); list.appendChild(li);
      };
      ["hidrovia"].forEach((via) => {
        const ps = puertos.filter((p) => p.via === via);
        if (!ps.length) return;
        sec(VIAS[via]);
        ps.forEach((p) => add({ label: p.nombre, lat: p.lat, lng: p.lng, puerto: p.id }, p.nombre,
          `${p.provincia}, ${p.pais}${p.km != null ? ` · km ${fmt(p.km, 0)} de río` : ""}`));
      });
      if (lugares.length) { sec("Otros lugares"); lugares.forEach((l) => add({ label: l.corto, lat: +l.lat, lng: +l.lon }, l.corto, l.display_name)); }
      list.hidden = !items.length;
    };

    input.addEventListener("input", () => {
      onPick(null, true);
      const q = norm(input.value), modo = getModo();
      const via = modo && modo.via !== "terrestre" ? modo.via : null;
      const puertos = CAT.puertos
        .filter((p) => (!via || p.via === via) && (!q || norm(`${p.nombre} ${p.provincia} ${p.pais}`).includes(q)))
        .sort((a, b) => (q && norm(b.nombre).includes(q)) - (q && norm(a.nombre).includes(q)));
      render(puertos, []);
      clearTimeout(geoTimer);
      if (via || q.length < 3) return;
      geoTimer = setTimeout(async () => {
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=es&countrycodes=ar,uy,py,br,bo,cl&q=${encodeURIComponent(input.value)}`;
          const j = await (await fetch(url)).json();
          if (norm(input.value) !== q) return;
          j.forEach((l) => (l.corto = l.name || l.display_name.split(",")[0]));
          render(puertos, j);
        } catch (e) { /* sin buscador: quedan los puertos */ }
      }, 400);
    });
    input.addEventListener("focus", () => input.dispatchEvent(new Event("input")));
    input.addEventListener("blur", () => setTimeout(cerrar, 120));
    input.addEventListener("keydown", (e) => {
      if (list.hidden || !items.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items.forEach((it, i) => it.li.classList.toggle("active", i === active));
      } else if (e.key === "Enter") { e.preventDefault(); elegir(items[Math.max(active, 0)].item); }
      else if (e.key === "Escape") cerrar();
    });
  }

  // ---------- Tramos ----------
  function unidades() {
    return tipoCarga() === "contenedor" ? [["teu", "TEU"], ["t", "toneladas"], ["kg", "kg"]] : [["t", "toneladas"], ["kg", "kg"], ["m3", "m³"]];
  }
  function pintarUnidades(t) {
    const sel = $(".in-unidad", t.el), opts = unidades();
    sel.innerHTML = opts.map(([v, n]) => `<option value="${v}">${n}</option>`).join("");
    if (!opts.some(([v]) => v === t.unidad)) t.unidad = opts[0][0];
    sel.value = t.unidad;
  }

  function nuevoTramo(prev, datos) {
    const el = $("#tpl-tramo").content.firstElementChild.cloneNode(true);
    const t = { el, modo: "", desde: null, hasta: null, dist: 0, distManual: false, cantidad: 0, unidad: "", sentido: null, ruta: null, layer: null, seq: 0, kg: 0 };
    tramos.push(t);
    $("#tramos").appendChild(el);

    const sel = $(".in-modo", el);
    sel.innerHTML = `<option value="">Elegí un modo (convoy de barcazas, camión, tren…)</option>` +
      ["hidrovia", "terrestre"].map((via) => {
        const ms = CAT.modos.filter((m) => m.via === via);
        return ms.length ? `<optgroup label="${VIAS[via]}">${ms.map((m) => `<option value="${m.id}">${m.icono} ${esc(m.nombre)}</option>`).join("")}</optgroup>` : "";
      }).join("");
    sel.addEventListener("change", () => {
      t.modo = sel.value; t.distManual = false;
      // Si los puertos elegidos no son de la vía del modo, se limpian
      const via = modoDe(t)?.via;
      ["desde", "hasta"].forEach((k) => {
        const p = t[k]?.puerto && CAT.puertos.find((x) => x.id === t[k].puerto);
        if (via && via !== "terrestre" && (!p || p.via !== via)) { t[k] = null; $(`.in-${k}`, el).value = ""; }
      });
      actualizarRuta(t);
    });

    const getModo = () => modoDe(t);
    autocompletar($(".in-desde", el), (item, tipeando) => { t.desde = item; if (!tipeando) { t.distManual = false; actualizarRuta(t); } }, getModo);
    autocompletar($(".in-hasta", el), (item, tipeando) => { t.hasta = item; if (!tipeando) { t.distManual = false; actualizarRuta(t); } }, getModo);

    const inDist = $(".in-dist", el);
    inDist.addEventListener("input", () => { t.dist = +inDist.value || 0; t.distManual = true; inDist.classList.remove("auto"); recalcular(); });
    $(".in-cant", el).addEventListener("input", (e) => { t.cantidad = +e.target.value || 0; recalcular(); });
    $(".in-unidad", el).addEventListener("change", (e) => { t.unidad = e.target.value; recalcular(); });

    $(".tramo-del", el).addEventListener("click", () => {
      if (tramos.length === 1) return;
      if (t.layer) map.removeLayer(t.layer);
      tramos.splice(tramos.indexOf(t), 1);
      el.remove();
      numerar(); dibujar(); recalcular();
    });

    if (datos) {
      Object.assign(t, { modo: datos.modo || "", desde: datos.desde || null, hasta: datos.hasta || null, dist: +datos.dist || 0,
        distManual: true, cantidad: +datos.cantidad || 0, unidad: datos.unidad || "" });
      sel.value = t.modo;
      $(".in-desde", el).value = t.desde?.label || "";
      $(".in-hasta", el).value = t.hasta?.label || "";
      inDist.value = t.dist || "";
      $(".in-cant", el).value = t.cantidad || "";
    } else if (prev) {
      // Arranca donde terminó el anterior, con la misma carga
      if (prev.hasta) { t.desde = prev.hasta; $(".in-desde", el).value = prev.hasta.label; }
      t.cantidad = prev.cantidad; t.unidad = prev.unidad;
      $(".in-cant", el).value = prev.cantidad || "";
    }
    pintarUnidades(t);
    numerar();
    if (datos) {
      // Recalcula el dibujo sin pisar la distancia guardada
      actualizarRuta(t);
    } else recalcular();
    return t;
  }
  function numerar() { tramos.forEach((t, i) => ($(".tramo-n", t.el).textContent = i + 1)); }

  // ---------- Compensación ----------
  function pintarProyectos() {
    $("#projects").innerHTML = CAT.proyectos.map((p) => `
      <button type="button" class="proj" data-id="${esc(p.id)}" aria-pressed="${p.id === proySel}">
        <span class="tag">${esc(p.tag)}${p.ejemplo ? " · ejemplo" : ""}</span><strong>${esc(p.nombre)}</strong>
        <span class="meta">${esc(p.lugar || "")}<br>${esc(p.estandar || "")}</span>
        <span class="price"><span class="meta">por t CO₂e</span><b>USD ${fmt(p.usd_por_t, 0)}</b></span>
      </button>`).join("") +
      `<button type="button" class="proj none" data-id="" aria-pressed="${proySel === null}"><strong>No compensar por ahora</strong><span class="meta">Solo medir la huella</span></button>`;
    document.querySelectorAll(".proj").forEach((b) => (b.onclick = () => { proySel = b.dataset.id || null; pintarProyectos(); recalcular(); }));
  }
  function pintarCheckout(totalKg) {
    const p = CAT.proyectos.find((x) => x.id === proySel);
    const cred = Math.ceil((totalKg || 0) / 1000);
    $("#checkoutTxt").innerHTML = !totalKg ? "Completá los tramos para ver cuántos créditos necesitás."
      : p ? `<b>${cred} crédito${cred === 1 ? "" : "s"}</b> de “${esc(p.nombre)}” · total estimado <b>USD ${fmt(cred * p.usd_por_t, 0)}</b>. Se confirma cuando Sylvera valide el cálculo.`
      : `Tu huella equivale a <b>${cred} crédito${cred === 1 ? "" : "s"}</b>. Elegí un proyecto si querés compensarla.`;
  }

  // ---------- Envío ----------
  function pasos(i) {
    $("#steps").innerHTML = H.PASOS.map((s, k) => `<li class="${k < i ? "done" : k === i ? "now" : ""}">${s}</li>`).join("");
  }
  function aviso(txt, tipo = "") {
    const m = $("#msg");
    m.className = `msg ${tipo}`; m.innerHTML = txt; m.hidden = !txt;
  }

  function validar() {
    if (!tramos.length || !tramos.some((t) => t.kg > 0)) return "Completá al menos un tramo con modo, origen, destino y cantidad.";
    const inc = tramos.findIndex((t) => !(t.kg > 0));
    if (inc >= 0) return `El tramo ${inc + 1} está incompleto. Completalo o quitalo.`;
    return "";
  }

  function payload(estado) {
    return {
      carga: $("#carga").value.trim(), booking: $("#booking").value.trim() || null, empresa: $("#empresa").value.trim() || null,
      tramos: tramos.map(datosTramo), proyecto_id: proySel, estado,
    };
  }

  let estadoPendiente = null;
  async function guardar(estado) {
    const err = validar();
    if (err) { aviso(err, "err"); return; }
    const s = await H.sesion();
    if (!s) {
      estadoPendiente = estado;
      $("#login").hidden = false; $("#stepEmail").hidden = false; $("#stepCode").hidden = true;
      $("#verify").textContent = estado === "enviado" ? "Confirmar y enviar" : "Confirmar y guardar";
      aviso("");
      $("#email").focus();
      return;
    }
    aviso("Guardando…");
    const datos = payload(estado);
    const q = editId ? H.sb.from("envios").update(datos).eq("id", editId).select().single() : H.sb.from("envios").insert(datos).select().single();
    const { data, error } = await q;
    if (error) { aviso(`No se pudo guardar: ${esc(error.message)}`, "err"); return; }
    envioActual = data; editId = data.id;
    history.replaceState(null, "", `?id=${data.id}`);
    $("#login").hidden = true;
    mostrarOk(data);
  }

  function mostrarOk(e) {
    aviso("");
    pasos(H.pasoDe(e.estado));
    const p = CAT.proyectos.find((x) => x.id === e.proyecto_id);
    const enviado = e.estado === "enviado";
    $("#ok").hidden = false;
    $("#ok").innerHTML = `<b>${enviado ? "Cálculo enviado a revisión" : "Borrador guardado"} · <code>${esc(e.id.slice(0, 8).toUpperCase())}</code></b>
      <span>${esc(e.carga || "Envío")} · ${e.tramos.length} tramo${e.tramos.length === 1 ? "" : "s"} · ${fmt(e.total_km, 0)} km</span>
      <span>Huella calculada en el servidor: <b>${kgTxt(+e.total_kg)}</b>${p ? ` · ${e.creditos} créditos de “${esc(p.nombre)}” (USD ${fmt(e.usd_estimado, 0)} estimado)` : ""}</span>
      <span class="hint">${enviado ? `Te avisamos a ${esc(e.usuario_email)} cuando Coralia revise los datos y Sylvera valide el cálculo. Seguilo en <a href="panel.html">Mis cálculos</a>.` : `Podés seguir editándolo o enviarlo cuando quieras desde <a href="panel.html">Mis cálculos</a>.`}</span>`;
    bloquearSiEnviado(e);
  }

  function bloquearSiEnviado(e) {
    const editable = ["borrador", "rechazado"].includes(e.estado);
    $("#btn-borrador").disabled = !editable; $("#btn-enviar").disabled = !editable;
    const av = $("#aviso-edicion");
    if (!editable) { av.hidden = false; av.innerHTML = `Este cálculo está <b>${H.ESTADOS[e.estado].txt.toLowerCase()}</b> y ya no se puede modificar. <a href="index.html">Empezar uno nuevo</a>.`; }
    else if (e.estado === "rechazado") { av.hidden = false; av.innerHTML = `<b>Tiene observaciones:</b> ${esc(e.comentario || "revisá los datos")}. Corregí y volvé a enviar.`; }
    else { av.hidden = false; av.innerHTML = `Estás editando un borrador guardado. <a href="index.html">Empezar uno nuevo</a>.`; }
  }

  function initEnvio() {
    pasos(0);
    $("#btn-borrador").onclick = () => guardar("borrador");
    $("#btn-enviar").onclick = () => guardar("enviado");
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
      guardar(estadoPendiente || "enviado");
    };
  }

  // ---------- Cargar un envío guardado (?id=) ----------
  async function cargarEnvio(id) {
    const { data, error } = await H.sb.from("envios").select("*").eq("id", id).maybeSingle();
    if (error || !data) return false;
    envioActual = data; editId = data.id;
    $("#carga").value = data.carga || ""; $("#booking").value = data.booking || ""; $("#empresa").value = data.empresa || "";
    const tc = data.tramos[0]?.unidad === "teu" ? "contenedor" : data.tramos[0]?.tipo_carga || "solido";
    $("#tipo-carga").value = tc;
    proySel = data.proyecto_id; pintarProyectos();
    data.tramos.forEach((t) => nuevoTramo(null, t));
    pasos(H.pasoDe(data.estado));
    bloquearSiEnviado(data);
    return true;
  }

  // ---------- Intro ----------
  function initIntro(saltar) {
    const entrar = (animar) => {
      const fin = () => {
        document.body.classList.remove("intro-on", "intro-saliendo");
        window.scrollTo(0, 0);
        map.invalidateSize();
        dibujar();
        if (!tramos.some((t) => t.ruta)) map.fitBounds(L.latLngBounds(CAT.puertos.map((p) => [p.lat, p.lng])).pad(0.1));
        if (animar) $("#carga").focus({ preventScroll: true });
      };
      const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!animar || quieto) return fin();
      document.body.classList.add("intro-saliendo");
      setTimeout(fin, 340);
    };
    if (saltar) return entrar(false);
    $("#btn-empezar").onclick = () => { history.replaceState(null, "", "#calcular"); entrar(true); };
  }

  // ---------- Inicio ----------
  async function init() {
    CAT = await H.cargarCatalogos();
    document.querySelectorAll("[data-naviera]").forEach((n) => (n.textContent = H.C.NAVIERA));
    $("#cta-coralia").href = H.C.CONTACTO_CORALIA;

    const avisos = [];
    if (CAT.modos.some((m) => m.verificar)) avisos.push("algunos factores de emisión son de referencia o de ejemplo y faltan verificar");
    if ((CAT.config.ajuste_sentido || {}).ilustrativo) avisos.push("el ajuste por sentido en la hidrovía es ilustrativo");
    if (CAT.proyectos.some((p) => p.ejemplo)) avisos.push("los proyectos y precios de créditos son de ejemplo");
    if (CAT.origen === "local") avisos.push("sin conexión con la base: se usan datos locales");
    if (avisos.length) { $("#aviso-factores").hidden = false; $("#aviso-factores").innerHTML = `<b>Prototipo:</b> ${avisos.join("; ")}.`; }

    initMap();
    pintarProyectos();
    initEnvio();
    H.pintarCabecera();

    $("#tipo-carga").addEventListener("change", () => { tramos.forEach(pintarUnidades); recalcular(); });
    $("#agregar").addEventListener("click", () => nuevoTramo(tramos[tramos.length - 1]));

    const id = new URLSearchParams(location.search).get("id");
    if (!(id && (await cargarEnvio(id)))) nuevoTramo();
    initIntro(Boolean(id) || location.hash === "#calcular");
  }

  init().catch((e) => {
    console.error(e);
    document.querySelector(".wrap").insertAdjacentHTML("afterbegin",
      `<div class="notice">No se pudo iniciar la calculadora (${esc(e.message)}). Si abriste el archivo con doble clic, usá Go Live o un servidor.</div>`);
  });
})();
