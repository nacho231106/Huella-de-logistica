# Estado de la base

## Proyecto en uso: `Huella Logística Interbarge` (organización Coralia Environmental)

- Ref: `buxprkoyckcclbfyrmyb` · URL: https://buxprkoyckcclbfyrmyb.supabase.co · Región: São Paulo
- Se creó el 06/11/2026 corriendo **`00_base_completa.sql`** (01 + 02 + 03 + 04 completos) en el SQL Editor.
- `config.js` apunta a este proyecto.
- **06 (19/11/2026):** `06_fecha_y_compensacion.sql` aplicado: fecha del envío y compensación por período (el cliente puede compensar envíos validados mientras no se retiren los créditos).
- **05 (19/11/2026):** `05_clientes_interbarge.sql` aplicado: perfil InterBarge, tabla `clientes` (pendiente/aceptado/rechazado) con alta automática al registrarse, y órdenes cargadas por InterBarge.
- Modos activos: `flota-interbarge` (0,0227), `camion-articulado` (0,078), `camion-rigido` (0,19748), `ferrocarril` (0,02779).

Pendiente en el panel (no se puede por SQL): Authentication → URL Configuration → Site URL `https://huella-de-logistica.vercel.app` y Redirect URL `https://huella-de-logistica.vercel.app/**`. Para el ingreso de Coralia/Sylvera/Bolsa con Google o Microsoft: Authentication → Providers.

## Proyecto anterior: `vergara-huella` (sin uso)

Fue la base de prueba. Tiene 01–04 aplicados (el 03 sin actualizar `verificar_envio`) y no tiene envíos guardados. La app ya no lo usa.
