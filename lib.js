/* Funciones compartidas: Supabase, sesión, catálogos y cálculo. */
(() => {
  "use strict";
  const C = window.APP_CONFIG;
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const fmt = (n, d = 1) => Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const fmtFecha = (s) => (s ? new Date(s).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" }) : "–");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const kgTxt = (kg) => (kg >= 1000 ? `${fmt(kg / 1000, 2)} t CO₂e` : `${fmt(kg, 1)} kg CO₂e`);

  const ESTADOS = {
    borrador:      { txt: "Borrador", cls: "st-draft" },
    enviado:       { txt: "En revisión Coralia", cls: "st-wait" },
    en_validacion: { txt: "En validación Sylvera", cls: "st-wait" },
    validado:      { txt: "Validado", cls: "st-ok" },
    retirado:      { txt: "Créditos retirados", cls: "st-ok" },
    rechazado:     { txt: "Con observaciones", cls: "st-bad" },
  };
  const PASOS = ["Confirmá el presupuesto", "Revisión Coralia", "Validación Sylvera", "Certificado"];
  const ROLES = { cliente: "Cliente", coralia: "Coralia", sylvera: "Sylvera", bolsa: "Bolsa Paraguaya de Carbono", interbarge: "InterBarge" };
  const pasoDe = (estado) => ({ borrador: 0, enviado: 1, en_validacion: 2, validado: 3, retirado: 4, rechazado: 1 }[estado] ?? 0);

  // ---------- Catálogos (Supabase, con respaldo local) ----------
  async function cargarCatalogos() {
    const get = (f) => fetch(f).then((r) => { if (!r.ok) throw new Error(f); return r.json(); });
    const [puertos, local] = await Promise.all([get("data/puertos.json"), get("data/modos.json")]);
    let modos = local.modos, proyectos = local.proyectos, config = local.config, origen = "local";
    try {
      const [m, p, c] = await Promise.all([
        sb.from("modos").select("*").eq("activo", true).order("orden"),
        sb.from("proyectos").select("*").eq("activo", true).order("orden"),
        sb.from("config").select("clave,valor"),
      ]);
      if (m.error) throw m.error;
      // Si la base todavía no tiene el factor de la flota (falta correr la v3), se queda con el respaldo local
      if (m.data.some((x) => x.id === "flota-interbarge")) {
        modos = m.data; origen = "supabase";
        if (!p.error && p.data.length) proyectos = p.data;
        if (!c.error) c.data.forEach((r) => (config[r.clave] = r.valor));
      }
    } catch (e) { console.warn("Usando catálogos locales:", e.message || e); }
    return { puertos: puertos.puertos, modos, proyectos, config, origen };
  }

  // ---------- Cálculo (mismo criterio que la función calcular_tramos_v2 de la base) ----------
  function toneladas(t, config) {
    const q = Math.max(0, +t.cantidad || 0);
    switch (t.unidad) {
      case "kg": return q / 1000;
      case "t": return q;
      case "m3": return q * ((config.densidades || {})[t.tipo_carga || "general"] ?? 1);
      case "teu": return q * (config.toneladas_por_teu ?? 10);
      default: return 0;
    }
  }
  function calcularTramo(t, cat) {
    const modo = cat.modos.find((m) => m.id === t.modo);
    const ton = toneladas(t, cat.config);
    let ajuste = 1;
    if (modo && modo.via === "hidrovia" && t.sentido) ajuste = (cat.config.ajuste_sentido || {})[t.sentido] ?? 1;
    const dist = Math.max(0, +t.dist || 0);
    const kg = modo ? dist * ton * modo.factor * ajuste : 0;
    return { modo, ton, ajuste, dist, kg, tkm: dist * ton };
  }

  // ---------- Sesión ----------
  async function sesion() {
    await listo;
    const { data } = await sb.auth.getSession();
    return data.session;
  }
  async function rol() {
    const { data, error } = await sb.rpc("app_rol");
    return error ? "cliente" : data || "cliente";
  }
  async function enviarCodigo(email, volverA) {
    return sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: volverA || location.href } });
  }
  async function verificarCodigo(email, token) {
    return sb.auth.verifyOtp({ email, token, type: "email" });
  }
  async function entrarCon(proveedor, volverA) {
    const opts = { redirectTo: volverA || location.href };
    if (proveedor === "google") opts.queryParams = { hd: C.DOMINIO_CORALIA, prompt: "select_account" };
    if (proveedor === "azure") opts.scopes = "email";
    return sb.auth.signInWithOAuth({ provider: proveedor, options: opts });
  }
  // ---------- Email y contraseña ----------
  // "Recordarme": si no se tilda, la sesión se cierra al cerrar el navegador.
  const RECORDAR = "huella_recordar", VIVA = "huella_sesion_viva";
  const guardar = (k, v, ses) => { try { (ses ? sessionStorage : localStorage).setItem(k, v); } catch (e) {} };
  const leer = (k, ses) => { try { return (ses ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } };
  const sesionVencida = leer(RECORDAR) === "0" && !leer(VIVA, true);
  const listo = sesionVencida ? sb.auth.signOut({ scope: "local" }) : Promise.resolve();

  async function entrar(email, clave, recordar) {
    const r = await sb.auth.signInWithPassword({ email, password: clave });
    if (!r.error) { guardar(RECORDAR, recordar ? "1" : "0"); guardar(VIVA, "1", true); }
    return r;
  }
  async function registrar(email, clave, datos = {}, volverA) {
    return sb.auth.signUp({ email, password: clave, options: { data: datos, emailRedirectTo: volverA || new URL("index.html", location.href).href } });
  }
  // Datos del cliente (pendiente / aceptado / rechazado por InterBarge)
  async function miCliente() {
    const s = await sesion(); if (!s) return null;
    const { data } = await sb.from("clientes").select("*").eq("id", s.user.id).maybeSingle();
    return data;
  }
  const PERSONAL = ["coralia", "sylvera", "bolsa", "interbarge"];
  // Adónde va cada perfil después de entrar
  function destino(r) { return PERSONAL.includes(r) ? "admin.html" : "cliente.html"; }
  async function recuperarClave(email) {
    return sb.auth.resetPasswordForEmail(email, { redirectTo: new URL("clave.html", location.href).href });
  }
  async function cambiarClave(clave) { return sb.auth.updateUser({ password: clave }); }
  function errorAuth(e) {
    const m = (e && e.message) || String(e || "");
    if (/invalid login credentials/i.test(m)) return "Email o contraseña incorrectos.";
    if (/email not confirmed/i.test(m)) return "Todavía no confirmaste tu email. Buscá el mail que te mandamos y tocá el link.";
    if (/already registered|already exists/i.test(m)) return "Ya hay una cuenta con ese email. Iniciá sesión o recuperá tu contraseña.";
    if (/rate limit/i.test(m)) return "Se mandaron demasiados mails en poco tiempo. Probá de nuevo en un rato.";
    if (/password.*(at least|characters|weak)/i.test(m)) return "La contraseña es muy corta o débil: usá al menos 8 caracteres.";
    if (/same.*password/i.test(m)) return "La contraseña nueva tiene que ser distinta de la anterior.";
    return m;
  }

  async function salir() { await sb.auth.signOut(); location.href = "index.html"; }

  // Encabezado: muestra el usuario y el enlace al panel
  async function pintarCabecera() {
    const zona = document.getElementById("cuenta");
    if (!zona) return;
    if (DEMO) {
      zona.innerHTML = `<span class="demo-chip" title="Versión de demostración: sin inicio de sesión, los datos quedan en este navegador">Demo</span>
        <a class="nav-link" href="index.html#calcular">Calculadora</a>
        <a class="btn small" href="admin.html">Panel del equipo</a>`;
      return;
    }
    const s = await sesion();
    if (!s) { zona.innerHTML = `<a class="nav-link" href="panel.html">Ingresar</a>`; return; }
    const r = await rol();
    const etiqueta = ROLES[r] || r;
    if (r) {
      const links = r === "interbarge"
        ? `<a class="nav-link" href="index.html#calcular">Cargar orden</a><a class="nav-link" href="admin.html">Panel del equipo</a>`
        : PERSONAL.includes(r) ? `<a class="nav-link" href="admin.html">Panel del equipo</a>` : `<a class="nav-link" href="cliente.html">Mi huella</a>`;
      zona.innerHTML = `${links}<span class="who" title="${esc(s.user.email)}">${esc(s.user.email)} · <b>${etiqueta}</b></span>
        <button class="nav-link as-btn" id="btn-clave" type="button">Cambiar contraseña</button>
        <button class="nav-link as-btn" id="btn-salir" type="button">Salir</button>`;
      document.getElementById("btn-salir").onclick = salir;
      document.getElementById("btn-clave").onclick = () => dialogoClave(s.user.email);
      return;
    }
    zona.innerHTML = `<a class="nav-link" href="panel.html">${r === "cliente" ? "Mis cálculos" : "Panel"}</a>
      <span class="who" title="${esc(s.user.email)}">${esc(s.user.email)} · <b>${etiqueta}</b></span>
      <button class="nav-link as-btn" id="btn-salir" type="button">Salir</button>`;
    document.getElementById("btn-salir").onclick = salir;
  }


  // ---------- Cambiar contraseña desde adentro ----------
  function dialogoClave(email) {
    let d = document.getElementById("dlg-clave");
    if (!d) {
      d = document.createElement("dialog");
      d.id = "dlg-clave"; d.className = "dlg-clave";
      d.innerHTML = `<form method="dialog" class="dlg-clave-in">
        <button type="button" class="modal-cerrar" data-cerrar aria-label="Cerrar">✕</button>
        <h2>Cambiar contraseña</h2>
        <label>Contraseña actual<input type="password" name="actual" autocomplete="current-password" required /></label>
        <label>Contraseña nueva<input type="password" name="c1" autocomplete="new-password" minlength="8" required /></label>
        <label>Repetí la contraseña nueva<input type="password" name="c2" autocomplete="new-password" minlength="8" required /></label>
        <p class="dlg-msg" role="status"></p>
        <button type="submit" class="btn">Guardar contraseña</button>
      </form>`;
      document.body.appendChild(d);
      d.querySelector("[data-cerrar]").onclick = () => d.close();
      d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
      const f = d.querySelector("form"), msg = d.querySelector(".dlg-msg"), btn = f.querySelector("[type=submit]");
      const decir = (t, c) => { msg.textContent = t; msg.className = "dlg-msg " + (c || ""); };
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const actual = f.actual.value, c1 = f.c1.value, c2 = f.c2.value;
        if (c1.length < 8) return decir("La contraseña nueva tiene que tener al menos 8 caracteres.", "err");
        if (c1 !== c2) return decir("Las contraseñas nuevas no coinciden.", "err");
        if (c1 === actual) return decir("La contraseña nueva tiene que ser distinta de la actual.", "err");
        btn.disabled = true; decir("Guardando…");
        try {
          const chk = await sb.auth.signInWithPassword({ email: d.dataset.email, password: actual });
          if (chk.error) { btn.disabled = false; return decir("La contraseña actual no es correcta.", "err"); }
          const { error } = await cambiarClave(c1);
          if (error) { btn.disabled = false; return decir(errorAuth(error), "err"); }
          f.reset(); decir("¡Listo! Tu contraseña quedó cambiada.", "ok");
          setTimeout(() => { d.close(); btn.disabled = false; decir(""); }, 1800);
        } catch (err) { btn.disabled = false; decir("No se pudo guardar. Probá de nuevo.", "err"); }
      });
    }
    d.dataset.email = email;
    d.querySelector("form").reset(); d.querySelector(".dlg-msg").textContent = "";
    d.showModal();
  }

  // ---------- Modo demo (sin inicio de sesión, datos en el navegador) ----------
  const DEMO = Boolean(C.MODO_DEMO);
  const KEY_DEMO = "huella_demo_envios_v1";
  const ROL_NOMBRE = { coralia: "Coralia", sylvera: "Sylvera", bolsa: "Bolsa Paraguaya de Carbono" };
  const demo = {
    listar() { try { return JSON.parse(localStorage.getItem(KEY_DEMO)) || []; } catch (e) { return []; } },
    _guardar(l) { try { localStorage.setItem(KEY_DEMO, JSON.stringify(l)); } catch (e) {} },
    get(id) { return demo.listar().find((e) => e.id === id) || null; },
    porCertificado(c) { const k = String(c || "").trim().toUpperCase(); return demo.listar().find((e) => e.certificado === k && ["validado", "retirado"].includes(e.estado)) || null; },
    // Mismo cálculo que la base (calcular_tramos_v2)
    calcular(datos, cat) {
      const tramos = (datos.tramos || []).map((t) => {
        const r = calcularTramo(t, cat);
        return { ...t, toneladas: +r.ton.toFixed(4), kg: +r.kg.toFixed(3), factor: r.modo?.factor ?? null, ajuste: r.ajuste,
          fuente: r.modo?.fuente ?? null, modo_nombre: r.modo?.nombre ?? t.modo, via: r.modo?.via ?? null };
      });
      const total_kg = +tramos.reduce((a, t) => a + t.kg, 0).toFixed(3);
      const total_km = +tramos.reduce((a, t) => a + (+t.dist || 0), 0).toFixed(1);
      const total_tkm = +tramos.reduce((a, t) => a + (+t.dist || 0) * t.toneladas, 0).toFixed(1);
      const p = (cat.proyectos || []).find((x) => x.id === datos.proyecto_id);
      const creditos = p ? Math.ceil(total_kg / 1000) : null;
      return { tramos, total_kg, total_km, total_tkm, creditos, usd_estimado: p ? creditos * (+p.usd_por_t || 0) : null,
        proyecto_nombre: p?.nombre || null, proyecto_estandar: p?.estandar || null };
    },
    crear(datos, cat) {
      const ahora = new Date().toISOString();
      const e = { ...datos, ...demo.calcular(datos, cat), id: "demo-" + Math.random().toString(36).slice(2, 10),
        usuario_email: datos.usuario_email || "cliente de la demo", estado: datos.estado || "enviado",
        created_at: ahora, updated_at: ahora, enviado_at: ahora, comentario: null, revisado_at: null, revisado_por: null,
        certificado: null, rechazo_rol: null, retirado_at: null, retiro_ref: null };
      const l = demo.listar(); l.unshift(e); demo._guardar(l); return e;
    },
    // Mismas reglas de estados que la base (envios_guard)
    actualizar(id, cambios, rol) {
      const l = demo.listar(), e = l.find((x) => x.id === id);
      if (!e) throw new Error("No se encontró el envío");
      const de = e.estado, a = cambios.estado || de;
      const permitido = { coralia: { enviado: ["en_validacion", "rechazado"] }, sylvera: { en_validacion: ["validado", "rechazado"] }, bolsa: { validado: ["retirado"] } };
      if (a !== de && !(permitido[rol]?.[de] || []).includes(a)) throw new Error("Esta acción no corresponde a este perfil o a este estado");
      if (a === "rechazado" && !String(cambios.comentario || "").trim()) throw new Error("Escribí las observaciones");
      if (a === "retirado") {
        if (!e.proyecto_id) throw new Error("El envío no tiene proyecto de compensación");
        if (!String(cambios.retiro_ref || "").trim()) throw new Error("Falta la referencia del retiro");
      }
      const ahora = new Date().toISOString();
      if ("comentario" in cambios) e.comentario = cambios.comentario || null;
      if (a !== de) {
        e.estado = a;
        if (["en_validacion", "validado", "rechazado"].includes(a)) { e.revisado_at = ahora; e.revisado_por = ROL_NOMBRE[rol]; }
        if (a === "rechazado") e.rechazo_rol = rol;
        if (a === "retirado") { e.retiro_ref = cambios.retiro_ref.trim(); e.retirado_at = ahora; }
        if (["validado", "retirado"].includes(a) && !e.certificado) e.certificado = "HC-DEMO-" + Math.random().toString(36).slice(2, 8).toUpperCase();
      }
      e.updated_at = ahora; demo._guardar(l); return e;
    },
    borrar(id) { demo._guardar(demo.listar().filter((e) => e.id !== id)); },
    reiniciar() { demo._guardar([]); },
  };

  window.H = { sb, C, fmt, fmtFecha, esc, norm, kgTxt, ESTADOS, PASOS, ROLES, pasoDe, cargarCatalogos, toneladas, calcularTramo,
    sesion, rol, enviarCodigo, verificarCodigo, entrarCon, salir, pintarCabecera,
    entrar, registrar, recuperarClave, cambiarClave, errorAuth, DEMO, demo, ROL_NOMBRE, miCliente, destino, PERSONAL };
})();
