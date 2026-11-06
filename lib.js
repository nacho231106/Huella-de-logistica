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
  const PASOS = ["Confirmá tu email", "Revisión Coralia", "Validación Sylvera", "Certificado"];
  const ROLES = { cliente: "Cliente", coralia: "Coralia", sylvera: "Sylvera", bolsa: "Bolsa Paraguaya de Carbono" };
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
  async function salir() { await sb.auth.signOut(); location.href = "index.html"; }

  // Encabezado: muestra el usuario y el enlace al panel
  async function pintarCabecera() {
    const zona = document.getElementById("cuenta");
    if (!zona) return;
    const s = await sesion();
    if (!s) { zona.innerHTML = `<a class="nav-link" href="panel.html">Ingresar</a>`; return; }
    const r = await rol();
    const etiqueta = ROLES[r] || r;
    zona.innerHTML = `<a class="nav-link" href="panel.html">${r === "cliente" ? "Mis cálculos" : "Panel"}</a>
      <span class="who" title="${esc(s.user.email)}">${esc(s.user.email)} · <b>${etiqueta}</b></span>
      <button class="nav-link as-btn" id="btn-salir" type="button">Salir</button>`;
    document.getElementById("btn-salir").onclick = salir;
  }

  window.H = { sb, C, fmt, fmtFecha, esc, norm, kgTxt, ESTADOS, PASOS, ROLES, pasoDe, cargarCatalogos, toneladas, calcularTramo,
    sesion, rol, enviarCodigo, verificarCodigo, entrarCon, salir, pintarCabecera };
})();
