# Estado de la base (proyecto Supabase `vergara-huella`)

| Archivo | Estado | Notas |
|---|---|---|
| `01_esquema_inicial.sql` | Aplicado | |
| `02_v2_hidrovia_compensacion.sql` | Aplicado (06/11/2026) | Tal cual. |
| `03_oc_flota_bolsa.sql` | Aplicado (06/11/2026) | Versión **sin `drop`**: las políticas de `envios` se cambiaron con `alter policy` y las nuevas se crearon solo si no existían. **No se actualizó `verificar_envio`**, así que el certificado público todavía no devuelve `oc_numero`. Para sumarlo, correr a mano en el SQL Editor la parte "Verificación pública del certificado" del 03. |
| `04_tramos_camion.sql` | Aplicado (06/11/2026) | Tal cual. |

Modos activos después de aplicar: `flota-interbarge` (0,0227), `camion-articulado` (0,078), `camion-rigido` (0,19748), `ferrocarril` (0,02779).

Pendiente en el panel de Supabase (no se puede hacer por SQL): Authentication → URL Configuration → Site URL `https://huella-de-logistica.vercel.app` y Redirect URL `https://huella-de-logistica.vercel.app/**`.
