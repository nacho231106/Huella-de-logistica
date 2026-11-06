# Huella de logística · Interbarge

App web para calcular la huella de carbono del transporte de cargas de Interbarge, con metodología de Coralia Environmental. Junta dos versiones: la calculadora por tramos con mapa y el prototipo fluvial (`prototipos/huella-fluvial-naviera.html`).

- **Vías:** hidrovía Paraná-Paraguay (convoyes de barcazas, con ajuste por sentido de la corriente) y tramos terrestres (camión, tren) hasta o desde el puerto. Un envío puede combinar varios tramos.
- **Fórmula:** `huella del tramo = distancia (km) × carga (t) × factor (kg CO2e/t·km) × ajuste por sentido (solo hidrovía)`. El cálculo que se guarda se rehace en el servidor con los factores vigentes.
- **Compensación** opcional con créditos de carbono (1 crédito = 1 t CO2e, se redondea hacia arriba).
- **Flujo:** borrador → enviado (revisión Coralia) → en validación (Sylvera) → validado (certificado) → créditos retirados. Cualquier revisión puede dejar observaciones.

## Páginas

| Página | Para qué |
|---|---|
| `index.html` | Calculadora: tramos, mapa, compensación y envío con código por email |
| `panel.html` | Ingreso y panel según perfil (ver abajo) |
| `certificado.html?c=CODIGO` | Certificado público y verificable, imprimible a PDF |

## Perfiles

| Perfil | Cómo entra | Qué ve |
|---|---|---|
| Cliente | Email + código de 6 dígitos o link mágico. N° de booking opcional | Solo sus cálculos y certificados |
| Coralia | Google o Microsoft, solo emails `@coraliae.com` | Todo: cálculos, factores, estados, exportes CSV y lista de Sylvera |
| Sylvera | Google o Microsoft, solo emails de la lista `sylvera_autorizados` | Solo los cálculos enviados a validación |

Los permisos los aplica la base (RLS en Supabase), no la página, así que nadie ve datos ajenos aunque modifique el código.

## Archivos

| Archivo | Qué tiene |
|---|---|
| `index.html`, `panel.html`, `certificado.html`, `styles.css` | Diseño |
| `app.js`, `panel.js`, `certificado.js`, `lib.js` | Lógica |
| `config.js` | URL y clave pública de Supabase, nombre de la naviera. **Para mudar a otro Supabase se cambia solo esto.** |
| `data/puertos.json` | Puertos de la hidrovía (coordenadas y km de río) |
| `data/ruta.json` | Geometría del río |
| `data/modos.json` | Respaldo local de factores y proyectos (se usa solo sin conexión con la base) |
| `supabase/*.sql` | Estructura de la base, en orden |

## Datos que se editan en Supabase (proyecto `vergara-huella`)

- `modos`: factores de emisión. Coralia también los edita desde el panel.
- `proyectos`: proyectos de compensación y precio por t.
- `config`: densidades (m³ → t), toneladas por TEU y ajuste por sentido.
- `sylvera_autorizados`: emails de Sylvera. También se edita desde el panel de Coralia.

## Puesta en marcha (pendiente)

1. **Correr `supabase/02_v2_hidrovia_compensacion.sql`:** supabase.com → proyecto `vergara-huella` → SQL Editor → pegar todo → Run. Hasta que se corra, la calculadora funciona con los datos locales pero no se puede guardar.
2. **Emails con código:** en Authentication → Email Templates, en "Magic Link" y en "Confirm signup", agregar `Tu código: {{ .Token }}` para que el mail traiga el código además del link.
3. **URLs:** en Authentication → URL Configuration, poner la URL de Vercel como Site URL y agregar `https://TU-URL/**` en Redirect URLs.
4. **Google y Microsoft (Coralia/Sylvera):** en Authentication → Providers, activar Google y Azure con sus credenciales. En Azure conviene restringir al tenant de Coralia.
5. **Vercel:** importar el repo (Framework: Other, sin build). Cada push a `main` se publica solo.

## Pendiente de datos

- [ ] Logo de Interbarge (hoy dice `[Logo]`)
- [ ] Factor propio de la flota de los convoyes con su fuente
- [ ] Tabla real de distancias entre puertos
- [ ] Ajuste por sentido con datos de consumo (hoy es ilustrativo)
- [ ] Proyectos y precios reales de Coralia
- [ ] Factores terrestres con fuente
- [ ] Validar el N° de booking contra datos de Interbarge (hoy es opcional y no se valida)
- [ ] Pago de los créditos: hoy se registra la intención y Coralia gestiona el retiro

Para probar en local: VS Code → **Go Live**. Con doble clic no anda.
