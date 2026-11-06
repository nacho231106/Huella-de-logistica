/* Tarjeta de ingreso con email y contraseña: iniciar sesión, crear cuenta y recuperar contraseña.
 * Uso: H.tarjetaLogin(contenedor, { alEntrar: (sesion) => {...}, compacta: false })
 */
(() => {
  "use strict";
  const { esc } = H;
  const ICON = {
    mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><circle cx="12" cy="16" r="1.2"/></svg>',
    ojo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    ojoNo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  };
  const emailOk = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

  function campo(tipo, id, ph, icono, auto) {
    const clave = tipo === "password";
    return `<label class="auth-field"><span class="auth-ico">${ICON[icono]}</span>
      <input id="${id}" type="${tipo}" placeholder="${ph}" autocomplete="${auto}" ${clave ? 'minlength="8"' : ""} required />
      ${clave ? `<button type="button" class="auth-eye" aria-label="Mostrar contraseña" data-ojo="${id}">${ICON.ojoNo}</button>` : ""}</label>`;
  }

  H.tarjetaLogin = function (el, opts = {}) {
    const p = "auth-" + Math.random().toString(36).slice(2, 7);
    let modo = opts.modo || "entrar";

    function pintar(msg = "", tipo = "") {
      const m = msg ? `<p class="auth-msg ${tipo}" role="status">${msg}</p>` : "";
      if (modo === "entrar") {
        el.innerHTML = `<form class="auth" novalidate>
          <h2 class="auth-t">Iniciá sesión</h2>
          <p class="auth-sub">Accedé a tu cuenta de Huella</p>
          ${campo("email", p + "-email", "Email", "mail", "email")}
          ${campo("password", p + "-clave", "Contraseña", "lock", "current-password")}
          <div class="auth-row">
            <label class="auth-check"><input type="checkbox" id="${p}-rec" checked /> Recordarme</label>
            <a href="#" class="auth-link" data-modo="olvido">¿Olvidaste tu contraseña?</a>
          </div>
          ${m}
          <button class="auth-btn" type="submit">Ingresar <span aria-hidden="true">→</span></button>
          <div class="auth-sep"><span>¿No tenés cuenta?</span></div>
          <button class="auth-btn ghost" type="button" data-modo="crear">Crear cuenta</button>
        </form>`;
      } else if (modo === "crear") {
        el.innerHTML = `<form class="auth" novalidate>
          <h2 class="auth-t">Creá tu cuenta</h2>
          <p class="auth-sub">Con el email de tu empresa</p>
          ${campo("email", p + "-email", "Email", "mail", "email")}
          ${campo("password", p + "-clave", "Contraseña (mínimo 8 caracteres)", "lock", "new-password")}
          ${campo("password", p + "-clave2", "Repetí la contraseña", "lock", "new-password")}
          ${m}
          <button class="auth-btn" type="submit">Crear cuenta <span aria-hidden="true">→</span></button>
          <div class="auth-sep"><span>¿Ya tenés cuenta?</span></div>
          <button class="auth-btn ghost" type="button" data-modo="entrar">Iniciar sesión</button>
        </form>`;
      } else {
        el.innerHTML = `<form class="auth" novalidate>
          <h2 class="auth-t">Recuperá tu contraseña</h2>
          <p class="auth-sub">Te mandamos un link para elegir una nueva</p>
          ${campo("email", p + "-email", "Email", "mail", "email")}
          ${m}
          <button class="auth-btn" type="submit">Enviarme el link <span aria-hidden="true">→</span></button>
          <div class="auth-sep"><span>¿Te acordaste?</span></div>
          <button class="auth-btn ghost" type="button" data-modo="entrar">Volver a iniciar sesión</button>
        </form>`;
      }
      const f = el.querySelector("form");
      f.addEventListener("submit", (e) => { e.preventDefault(); enviar(f); });
      el.querySelectorAll("[data-modo]").forEach((b) => b.addEventListener("click", (e) => {
        e.preventDefault();
        const email = (el.querySelector(`#${p}-email`) || {}).value || "";
        modo = b.dataset.modo; pintar();
        if (email) el.querySelector(`#${p}-email`).value = email;
        el.querySelector(`#${p}-email`).focus();
      }));
      el.querySelectorAll("[data-ojo]").forEach((b) => b.addEventListener("click", () => {
        const i = el.querySelector("#" + b.dataset.ojo), ver = i.type === "password";
        i.type = ver ? "text" : "password";
        b.innerHTML = ver ? ICON.ojo : ICON.ojoNo;
        b.setAttribute("aria-label", ver ? "Ocultar contraseña" : "Mostrar contraseña");
      }));
    }

    async function enviar(f) {
      const v = (s) => (el.querySelector(`#${p}-${s}`) || {}).value || "";
      const email = v("email").trim().toLowerCase();
      if (!emailOk(email)) return pintarConEmail("Revisá el email.", "err", email);
      const btn = f.querySelector('button[type="submit"]');
      btn.disabled = true; btn.classList.add("cargando");
      try {
        if (modo === "entrar") {
          if (!v("clave")) return pintarConEmail("Escribí tu contraseña.", "err", email);
          const { data, error } = await H.entrar(email, v("clave"), el.querySelector(`#${p}-rec`).checked);
          if (error) return pintarConEmail(esc(H.errorAuth(error)), "err", email);
          await H.pintarCabecera();
          if (opts.alEntrar) opts.alEntrar(data.session);
        } else if (modo === "crear") {
          if (v("clave").length < 8) return pintarConEmail("La contraseña tiene que tener al menos 8 caracteres.", "err", email);
          if (v("clave") !== v("clave2")) return pintarConEmail("Las contraseñas no coinciden.", "err", email);
          const { data, error } = await H.registrar(email, v("clave"));
          if (error) return pintarConEmail(esc(H.errorAuth(error)), "err", email);
          if (data.session) { await H.pintarCabecera(); if (opts.alEntrar) opts.alEntrar(data.session); return; }
          modo = "entrar";
          pintarConEmail(`¡Listo! Te mandamos un mail a <b>${esc(email)}</b>. Tocá el link para confirmar tu cuenta y después iniciá sesión. Revisá también el correo no deseado.`, "ok", email);
        } else {
          const { error } = await H.recuperarClave(email);
          if (error) return pintarConEmail(esc(H.errorAuth(error)), "err", email);
          modo = "entrar";
          pintarConEmail(`Si hay una cuenta con <b>${esc(email)}</b>, te llega un mail con un link para elegir una contraseña nueva.`, "ok", email);
        }
      } finally { if (btn.isConnected) { btn.disabled = false; btn.classList.remove("cargando"); } }
    }
    function pintarConEmail(msg, tipo, email) {
      pintar(msg, tipo);
      const i = el.querySelector(`#${p}-email`); if (i) i.value = email;
      const c = el.querySelector(`#${p}-clave`); if (c && tipo === "err" && email) c.focus();
    }

    pintar();
    return { modo: (m) => { modo = m; pintar(); } };
  };
})();
