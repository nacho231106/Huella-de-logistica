# Huella de logística — Calculadora de transporte

App web para calcular la huella de carbono del transporte de cargas por el carril costero patagónico. Cada viaje se carga por tramos (camión, buque, ferrocarril) y la app calcula:

```
huella del tramo (kg CO2e) = distancia (km) × carga (t) × factor del modo (kg CO2e / t·km)
```

Es HTML/CSS/JS puro, sin compilar. Se puede subir tal cual a Vercel (proyecto estático) o abrir en VS Code con **Go Live**. Si se abre con doble clic no anda, porque los datos se leen con `fetch`.

## Archivos

| Archivo | Qué tiene | Quién lo toca |
|---|---|---|
| `index.html`, `styles.css` | Diseño y estructura | Diseño |
| `app.js` | Lógica: rutas, mapa, cálculo | Diseño/código |
| `data/modos.json` | Modos de transporte y **factores de emisión** | Datos |
| `data/puertos.json` | Puertos del carril (nombre, coordenadas, punto de acceso) | Datos |
| `data/ruta.json` | Puntos del carril en el mar, de norte a sur | Datos |

## Para cargar datos (`data/`)

- **Factores** (`modos.json`): `factor` va en kg CO2e por tonelada·km. Completá `fuente` y poné `"verificar": false` cuando el valor ya esté confirmado. Mientras quede alguno con `verificar: true`, la app muestra el aviso "Versión de prueba". **Los valores que hay ahora son de ejemplo.**
- **Volumen → toneladas**: `toneladas_por_m3` (por ahora 1 m³ = 1 t). Ajustarlo al criterio de Vergara.
- **Puertos** (`puertos.json`): cada puerto tiene `acceso`, que es el id del punto del carril donde se engancha a la ruta del buque.
- **Carril** (`ruta.json`): la distancia marítima es la suma de los tramos entre puntos. Si Vergara tiene las distancias reales entre puertos, conviene usarlas; hoy son estimaciones geométricas.

## Servicios externos (gratis, sin clave)

- Mapa: OpenStreetMap + Leaflet.
- Buscador de lugares: Nominatim (OSM).
- Ruta en camión: OSRM demo. Si no responde, se usa la línea recta × 1,3 y se avisa.

Para producción con mucho tráfico conviene pasar a un proveedor con clave (MapTiler, Mapbox o Google).

## Pendiente

- [ ] Logo y colores de Vergara (hoy: `[Logo Vergara]`)
- [ ] Factores de emisión reales con su fuente
- [ ] Confirmar puertos y recorrido real del carril (¿hasta dónde llega?)
- [ ] Distancias reales entre puertos, si las tienen
