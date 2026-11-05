/* Calculadora de huella de transporte — carril costero patagónico
 * Datos editables en /data (puertos.json, ruta.json, modos.json).
 * Huella de un tramo = distancia (km) × carga (t) × factor del modo (kg CO2e / t·km)
 */
(() => {
  "use strict";

  const $ = (sel, el = document) => el.querySelector(sel);
  const fmt = (n, d = 1) => Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  let PUERTOS = [], CARRIL = [], ACCESOS = {}, MODOS = [], T_POR_M3 = 1;
  let map, puertosLayer;
  const tramos = []; // { el, desde, hasta, modoId, dist, distManual, peso, vol, ruta, layer, seq }

  // ---------- Geometría ----------
  function km(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const largo = (pts) => pts.slice(1).reduce((s, p, i) => s + km(pts[i], p), 0);

  function rutaMaritima(pA, pB) {
    const iA = CARRIL.findIndex((c) => c.id === pA.acceso);
    const iB = CARRIL.findIndex((c) => c.id === pB.acceso);
    if (iA < 0 || iB < 0) return null;
    const tramo = iA <= iB ? CARRIL.slice(iA, iB + 1) : CARRIL.slice(iB, iA + 1).reverse();
    const pts = [pA, ...(ACCESOS[pA.id] || []), ...tramo, ...(ACCESOS[pB.id] || []).slice().reverse(), pB];
    return { pts, km: largo(pts) };
  }

  async function rutaTerrestre(a, b) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      const ruta = j.routes && j.routes[0];
      if (!ruta) throw new Error("sin ruta");
      return { pts: ruta.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })), km: ruta.distance / 1000 };
    } catch (e) {
      // Sin servicio de rutas: línea recta × 1,3 como estimación
      return { pts: [a, b], km: km(a, b) * 1.3, estimada: true };
    }
  }

  // ---------- Mapa ----------
  function initMap() {
    map = L.map("map", { zoomControl: true, scrollWheelZoom: false }).setView([-44, -63], 4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);

    // Carril costero de fondo
    L.polyline(CARRIL.map((c) => [c.lat, c.lng]), { color: "#1d7a46", weight: 2, opacity: 0.25, dashArray: "4 6" }).addTo(map);

    puertosLayer = L.layerGroup().addTo(map);
    PUERTOS.forEach((p) => {
      L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "port-dot", iconSize: [10, 10] }) })
        .bindTooltip(p.nombre, { direction: "right" })
        .addTo(puertosLayer);
    });
    map.fitBounds(L.latLngBounds(PUERTOS.map((p) => [p.lat, p.lng])).pad(0.15));
  }

  function dibujar() {
    const bounds = [];
    tramos.forEach((t) => {
      if (t.layer) { map.removeLayer(t.layer); t.layer = null; }
      if (!t.ruta) return;
      const modo = MODOS.find((m) => m.id === t.modoId);
      const mar = modo && modo.tipo === "maritimo";
      const latlngs = t.ruta.pts.map((p) => [p.lat, p.lng]);
      t.layer = L.layerGroup([
        L.polyline(latlngs, { color: mar ? "#0e6fa8" : "#c4620a", weight: 4, opacity: 0.9, dashArray: t.ruta.estimada ? "6 6" : null }),
        L.circleMarker(latlngs[0], { radius: 6, color: "#fff", weight: 2, fillColor: "#0f4d33", fillOpacity: 1 }).bindTooltip(t.desde.label),
        L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, color: "#fff", weight: 2, fillColor: "#0f4d33", fillOpacity: 1 }).bindTooltip(t.hasta.label),
      ]).addTo(map);
      bounds.push(...latlngs);
    });
    $("#map-hint").textContent = bounds.length ? "" : "Elegí los lugares de Desde y Hasta en las sugerencias y el recorrido aparece acá.";
    if (bounds.length) map.fitBounds(L.latLngBounds(bounds).pad(0.2), { maxZoom: 9 });
  }

  // ---------- Cálculo ----------
  function toneladas(t) {
    if (t.peso > 0) return t.peso / 1000;
    if (t.vol > 0) return t.vol * T_POR_M3;
    return 0;
  }

  function recalcular() {
    let total = 0, kmTot = 0, tkm = 0;
    const lista = $("#desglose");
    lista.innerHTML = "";
    tramos.forEach((t, i) => {
      const modo = MODOS.find((m) => m.id === t.modoId);
      const ton = toneladas(t);
      const kg = modo && t.dist > 0 && ton > 0 ? t.dist * ton * modo.factor : 0;
      t.kg = kg;
      total += kg; kmTot += t.dist || 0; tkm += (t.dist || 0) * ton;
      $(".tramo-res", t.el).textContent = kg ? `→ ${fmt(kg)} kg CO₂e` : "";
      if (kg) {
        const li = document.createElement("li");
        const desde = t.desde ? t.desde.label : "?", hasta = t.hasta ? t.hasta.label : "?";
        li.innerHTML = `<span>${i + 1}. ${modo.icono} ${esc(desde)} → ${esc(hasta)} · ${fmt(t.dist, 0)} km · ${fmt(ton, 2)} t</span><span>${fmt(kg)} kg CO₂e</span>`;
        lista.appendChild(li);
      }
    });
    $("#total").textContent = fmt(total);
    $("#km-total").textContent = fmt(kmTot, 0);
    $("#tkm-total").textContent = fmt(tkm, 0);
    $("#n-tramos").textContent = tramos.length === 1 ? "1 tramo" : `${tramos.length} tramos`;
  }

  async function actualizarRuta(t) {
    const modo = MODOS.find((m) => m.id === t.modoId);
    const msg = $(".tramo-msg", t.el);
    msg.hidden = true;
    t.ruta = null;
    if (modo) $(".tramo-icon", t.el).textContent = modo.icono;

    if (t.desde && t.hasta && modo) {
      const seq = ++t.seq;
      let ruta = null;
      if (modo.tipo === "maritimo") {
        const pA = PUERTOS.find((p) => p.id === t.desde.puerto);
        const pB = PUERTOS.find((p) => p.id === t.hasta.puerto);
        if (pA && pB) ruta = rutaMaritima(pA, pB);
        else { msg.textContent = "Para el buque, elegí un puerto del carril en Desde y en Hasta."; msg.hidden = false; }
      } else {
        msg.textContent = "Calculando recorrido…"; msg.hidden = false;
        ruta = await rutaTerrestre(t.desde, t.hasta);
        if (seq !== t.seq) return; // llegó una respuesta vieja
        msg.hidden = !ruta.estimada;
        if (ruta.estimada) msg.textContent = "No se pudo trazar la ruta: la distancia es una estimación. Podés corregirla.";
      }
      t.ruta = ruta;
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
  let nominatimTimer;
  function autocompletar(input, onPick, getModo) {
    const list = input.parentElement.querySelector(".ac-list");
    let items = [], active = -1;

    const cerrar = () => { list.hidden = true; active = -1; };
    const render = (puertos, lugares) => {
      list.innerHTML = ""; items = [];
      const sec = (txt) => { const li = document.createElement("li"); li.className = "ac-sec"; li.textContent = txt; list.appendChild(li); };
      const add = (item, title, small) => {
        const li = document.createElement("li");
        li.innerHTML = `${esc(title)}<small>${esc(small)}</small>`;
        li.addEventListener("mousedown", (e) => { e.preventDefault(); elegir(item); });
        items.push({ li, item }); list.appendChild(li);
      };
      if (puertos.length) { sec("Puertos del carril"); puertos.forEach((p) => add({ label: p.nombre, lat: p.lat, lng: p.lng, puerto: p.id }, p.nombre, p.provincia)); }
      if (lugares.length) { sec("Otros lugares"); lugares.forEach((l) => add({ label: l.corto, lat: +l.lat, lng: +l.lon }, l.corto, l.display_name)); }
      list.hidden = !items.length;
    };
    const elegir = (item) => { input.value = item.label; cerrar(); onPick(item); };

    input.addEventListener("input", () => {
      onPick(null, true);
      const q = norm(input.value);
      const modo = getModo();
      const soloPuertos = modo && modo.tipo === "maritimo";
      const puertos = PUERTOS.filter((p) => !q || norm(p.nombre + " " + p.provincia).includes(q));
      render(puertos, []);
      clearTimeout(nominatimTimer);
      if (soloPuertos || q.length < 3) return;
      nominatimTimer = setTimeout(async () => {
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=es&countrycodes=ar,cl,uy,br,py&q=${encodeURIComponent(input.value)}`;
          const r = await fetch(url);
          const j = await r.json();
          if (norm(input.value) !== q) return;
          j.forEach((l) => (l.corto = l.name || l.display_name.split(",")[0]));
          render(puertos, j);
        } catch (e) { /* sin conexión al buscador: quedan los puertos */ }
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
      } else if (e.key === "Enter") {
        e.preventDefault(); elegir(items[Math.max(active, 0)].item);
      } else if (e.key === "Escape") cerrar();
    });
  }

  // ---------- Tramos ----------
  function nuevoTramo(prev) {
    const el = $("#tpl-tramo").content.firstElementChild.cloneNode(true);
    const t = { el, desde: null, hasta: null, modoId: "", dist: 0, distManual: false, peso: 0, vol: 0, ruta: null, layer: null, seq: 0 };
    tramos.push(t);
    $("#tramos").appendChild(el);

    const sel = $(".in-modo", el);
    sel.innerHTML = `<option value="">Elegí un modo (camión, buque, ferrocarril…)</option>` +
      MODOS.map((m) => `<option value="${m.id}">${m.icono} ${esc(m.nombre)}</option>`).join("");
    sel.addEventListener("change", () => { t.modoId = sel.value; t.distManual = false; actualizarRuta(t); });

    const getModo = () => MODOS.find((m) => m.id === t.modoId);
    autocompletar($(".in-desde", el), (item, tipeando) => { t.desde = item; if (!tipeando) { t.distManual = false; actualizarRuta(t); } }, getModo);
    autocompletar($(".in-hasta", el), (item, tipeando) => { t.hasta = item; if (!tipeando) { t.distManual = false; actualizarRuta(t); } }, getModo);

    const inDist = $(".in-dist", el);
    inDist.addEventListener("input", () => { t.dist = +inDist.value || 0; t.distManual = true; inDist.classList.remove("auto"); recalcular(); });
    $(".in-peso", el).addEventListener("input", (e) => { t.peso = +e.target.value || 0; recalcular(); });
    $(".in-vol", el).addEventListener("input", (e) => { t.vol = +e.target.value || 0; recalcular(); });

    $(".tramo-del", el).addEventListener("click", () => {
      if (tramos.length === 1) return;
      if (t.layer) map.removeLayer(t.layer);
      tramos.splice(tramos.indexOf(t), 1);
      el.remove();
      numerar(); dibujar(); recalcular();
    });

    if (prev) {
      // El nuevo tramo arranca donde terminó el anterior y lleva la misma carga
      if (prev.hasta) { t.desde = prev.hasta; $(".in-desde", el).value = prev.hasta.label; }
      if (prev.peso) { t.peso = prev.peso; $(".in-peso", el).value = prev.peso; }
      if (prev.vol) { t.vol = prev.vol; $(".in-vol", el).value = prev.vol; }
    }
    numerar(); recalcular();
    return t;
  }

  function numerar() { tramos.forEach((t, i) => ($(".tramo-n", t.el).textContent = i + 1)); }

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  // ---------- Inicio ----------
  async function init() {
    const get = (f) => fetch(f).then((r) => { if (!r.ok) throw new Error(f); return r.json(); });
    const [p, r, m] = await Promise.all([get("data/puertos.json"), get("data/ruta.json"), get("data/modos.json")]);
    PUERTOS = p.puertos; CARRIL = r.carril; ACCESOS = r.accesos || {}; MODOS = m.modos; T_POR_M3 = m.toneladas_por_m3 || 1;
    $("#aviso-factores").hidden = !MODOS.some((x) => x.verificar);

    initMap();
    nuevoTramo();

    $("#agregar").addEventListener("click", () => nuevoTramo(tramos[tramos.length - 1]));
    $("#limpiar").addEventListener("click", () => {
      tramos.splice(0).forEach((t) => { if (t.layer) map.removeLayer(t.layer); t.el.remove(); });
      nuevoTramo(); dibujar();
    });
    $("#imprimir").addEventListener("click", () => window.print());
  }

  init().catch((e) => {
    console.error(e);
    document.querySelector(".shell").insertAdjacentHTML("afterbegin",
      `<div class="notice">No se pudieron cargar los datos (${esc(e.message)}). Si abriste el archivo directo, usá Go Live / un servidor.</div>`);
  });
})();
