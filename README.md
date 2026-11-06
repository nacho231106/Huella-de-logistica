# Huella de logística · InterBarge

App web para que los clientes de InterBarge vean el costo de su envío por la hidrovía Paraná-Paraguay **con y sin compensación de su huella de carbono**, con metodología de Coralia Environmental.

El cliente solo sube su **orden de compra**. La página lee los datos (puertos, producto, cantidad, flete), el cliente los revisa y ve el presupuesto:

- **Costo sin compensación de la huella de carbono:** el flete de la OC.
- **Costo con compensación:** una opción por cada proyecto de carbono, con su precio.

Elige una opción, confirma con su email y Coralia, Sylvera y la Bolsa Paraguaya de Carbono siguen el proceso desde el panel.

## Cómo se calcula

`huella = distancia por río (km) × carga (t) × factor de la flota (kg CO2e/t·km)`

Si el cliente elige **incluir la huella terrestre**, se suman dos tramos opcionales: **planta de fabricación → puerto de carga** y **puerto de descarga → planta de destino**. En cada uno elige el medio de transporte: `distancia × carga × factor del medio`.

| Medio | kg CO2e/t·km | Fuente |
|---|---|---|
| Camión articulado | 0,078 | DESNZ 2025, Freighting goods, fila 60 (HGV all diesel, All artics, average laden) |
| Camión rígido | 0,19748 | DESNZ 2025, Freighting goods, fila 51 (HGV all diesel, All rigids, average laden) |
| Tren de carga | 0,02779 | DESNZ 2025, Freighting goods, fila 106 (Rail, Freight train) |

DESNZ: UK Government GHG Conversion Factors 2025, condensed set, Open Government Licence v3.0, GWP AR5 a 100 años. Son de combustión (tanque a rueda), igual que el factor de la flota. Las plantas se leen de la OC o de un remito, o se cargan a mano. La distancia sale de OpenStreetMap por ruta (para el tren es aproximada) y se puede corregir. La hoja de vehículos terrestres del inventario no sirve para esto: son los autos y camionetas de la empresa, no camiones de carga.

El factor sale del **inventario GEI 2025 de InterBarge** (Coralia, ISO 14064-1):

| Dato | Valor |
|---|---|
| Emisiones operativas de la flota 2025 | 62.295 t CO2e |
| Toneladas transportadas 2025 | 1.826.094 t |
| Intensidad por tonelada | 34,1 kg CO2e/t |
| Distancia media por tonelada (**supuesto**) | 1.500 km |
| **Factor** | **0,0227 kg CO2e/t·km** |

Las emisiones operativas son: motores principales (55.173,5), generadores (4.280,4), embarcaciones auxiliares (444,1), lubricantes (389,6), refrigerantes (1.191,5), remolcadores de terceros (259,7) y slop (556,5). Quedan afuera oficinas, electricidad, vuelos, autos y basura común porque no son parte del servicio de transporte.

El inventario no trae toneladas-km, por eso se usa una distancia media supuesta. Si se ajusta, el factor se cambia en el panel de Coralia (Factores de emisión) y en `config.factor_flota`. Sin datos de consumo por sentido, no hay ajuste aguas arriba / aguas abajo.

Créditos: 1 crédito = 1 t CO2e, se redondea hacia arriba.

## Páginas

| Página | Para qué |
|---|---|
| `index.html` | Subir la OC, revisar datos, presupuesto con y sin compensación, confirmar con código por email |
| `panel.html` | Ingreso y panel según perfil |
| `certificado.html?c=CODIGO` | Certificado público y verificable |

## Perfiles

| Perfil | Cómo entra | Qué ve y hace |
|---|---|---|
| Cliente | Email + código de 6 dígitos | Sus presupuestos y certificados |
| Coralia | Google/Microsoft o código, emails `@coraliae.com` | Todo. Revisa, edita factores, administra las listas de Sylvera y la Bolsa, exporta CSV |
| Sylvera | Código por email, solo emails de `sylvera_autorizados` | Los enviados a validación: valida u observa |
| Bolsa Paraguaya de Carbono | Código por email, solo emails de `bolsa_autorizados` | Los validados que eligieron compensar: registra el retiro de créditos |

Flujo: enviado (revisión Coralia) → en validación (Sylvera) → validado (certificado) → créditos retirados (Bolsa o Coralia). Los permisos los aplica la base (RLS en Supabase).

## Archivos

| Archivo | Qué tiene |
|---|---|
| `index.html`, `panel.html`, `certificado.html`, `styles.css` | Diseño |
| `app.js` | Presupuesto a partir de la OC |
| `lector-oc.js` | Lee PDF, Excel o CSV en el navegador y busca N° de OC, empresa, puertos, producto, cantidad y flete. Sin IA: palabras clave y números |
| `panel.js`, `certificado.js`, `lib.js` | Panel, certificado y funciones compartidas |
| `config.js` | URL y clave pública de Supabase, nombre de la naviera |
| `data/puertos.json` | Puertos de la hidrovía con su km de río desde Nueva Palmira y cómo pueden aparecer escritos en una OC |
| `data/modos.json` | Respaldo local de factor y proyectos (solo sin conexión con la base) |
| `assets/` | Logos de InterBarge y Coralia |
| `data/ruta.json` | Geometría de las vías. Sin uso desde la v3 (ya no hay mapa) |
| `supabase/*.sql` | Estructura de la base, en orden |
| `lib/ef/standard.js` | Estándar Coralia de metadatos de factores (copia del de la plataforma) |
| `scripts/auditar-factores.mjs` | Verifica que los factores de `data/modos.json` cumplan el estándar: `node scripts/auditar-factores.mjs` |

## Puesta en marcha

1. **Base:** supabase.com → proyecto `Huella Logística Interbarge` (organización Coralia Environmental) → SQL Editor → correr en orden las que falten: `02_v2_hidrovia_compensacion.sql`, `03_oc_flota_bolsa.sql` y `04_tramos_camion.sql`.
2. **Emails con código:** Authentication → Email Templates → "Magic Link" y "Confirm signup": agregar `Tu código: {{ .Token }}`.
3. **URLs:** Authentication → URL Configuration: Site URL `https://huella-de-logistica.vercel.app` y Redirect URL `https://huella-de-logistica.vercel.app/**` (ya configurado).
4. **Google y Microsoft (Coralia):** Authentication → Providers.
5. **Publicación:** la app está en **Vercel** → https://huella-de-logistica.vercel.app. Cada push a `main` se publica solo (no se usa GitHub Pages).
   - Alternativa: Vercel (importar el repo, Framework: Other, sin build).
6. **Sylvera y Bolsa:** cargar sus emails desde el panel de Coralia.

Para probar en local: VS Code → **Go Live**. Con doble clic no anda.

## Pendiente

- [ ] Confirmar con InterBarge el uso de su logo (hoy `assets/interbarge.png`, tomado de interbarge.com) y pedir versión en alta calidad (SVG)
- [ ] Validar la distancia media de 1.500 km (o reemplazarla por t·km reales)
- [ ] Ajustar los km de río de cada puerto en `data/puertos.json`
- [ ] Proyectos y precios reales de Coralia
- [ ] Probar el lector con OC reales y sumar los formatos que haga falta
- [ ] Probar la lectura de plantas con OC y remitos reales
- [ ] Buscar factores terrestres con geografía sudamericana (hoy son del Reino Unido)
- [ ] Pago de los créditos: hoy se registra la elección y el retiro se carga a mano

## Ingreso

Email y contraseña (Supabase Auth): **Iniciar sesión**, **Crear cuenta** (llega un mail para confirmar), **Recordarme** (si no se tilda, la sesión se cierra al cerrar el navegador) y **¿Olvidaste tu contraseña?** (mail con link a `clave.html`). La tarjeta está en `auth.js` y se usa en la portada, en el panel y al confirmar un presupuesto. El perfil (cliente, Coralia, Sylvera, Bolsa) sale del email, igual que antes.

Foto de la portada: *Barcaza en el río Paraná*, Carla Antonini (2006), Wikimedia Commons, licencia CC BY-SA 2.5 AR (`assets/fondo-parana*.jpg`). El crédito se muestra en la portada.
