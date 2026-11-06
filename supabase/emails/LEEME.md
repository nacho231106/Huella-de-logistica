# Plantillas de mail (Supabase → Authentication → Emails)

Pegar el HTML en **Magic Link** (`magic-link.html`) y en **Confirm signup** (`confirm-signup.html`).
Asunto sugerido: `Tu código para Huella · InterBarge`.

`{{ .Token }}` es el código de 6 dígitos que pide la app; `{{ .ConfirmationURL }}` es el link mágico.
