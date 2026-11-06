# Plantillas de mail (Supabase → Authentication → Emails)

El ingreso es con **email y contraseña**. Pegar cada HTML en su plantilla:

| Plantilla en Supabase | Archivo | Asunto sugerido |
|---|---|---|
| Confirm signup | `confirm-signup.html` | Confirmá tu cuenta de Huella |
| Reset Password | `reset-password.html` | Elegí una contraseña nueva · Huella |
| Magic Link | `magic-link.html` | (ya no se usa en la app; se deja por si se vuelve al código) |

El link de "Reset Password" lleva a `clave.html`, donde se elige la contraseña nueva (cubierto por la Redirect URL `https://huella-de-logistica.vercel.app/**`).
