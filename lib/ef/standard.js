/**
 * lib/ef/standard.js — Estándar Coralia de metadatos de factores de emisión.
 *
 * COPIA del archivo del mismo nombre en el repo de la plataforma de huella de Coralia.
 * Si cambia allá, hay que actualizarlo acá. En este repo lo usa scripts/auditar-factores.mjs.
 *
 * Define QUÉ información tiene que tener cada factor de emisión para que sea
 * defendible frente a ISO 14067, GHG Protocol (Product y Corporate), PEF e
 * ISO 14064-1. Lo usan:
 *   · el agente de formulación (valida su resultado antes de guardarlo)
 *   · la auditoría de la base (scripts/auditar-factores.mjs)
 *   · la armonización de la base (etapa siguiente del plan)
 *
 * Cada requisito dice a qué normas aplica, a qué módulo (producto /
 * corporativo) y si es obligatorio o recomendado. `assessEf(ef)` devuelve qué
 * falta y si el factor cumple con cada norma.
 *
 * Referencias (cláusulas citadas en el texto de cada requisito):
 *   ISO 14067:2018 §6.3.5 (calidad de datos), §6.4.6 (asignación), y los
 *     requisitos de documentar por separado emisiones fósiles, biogénicas y
 *     de cambio de uso del suelo
 *   GHG Protocol Product Standard (2011) cap. 8 (calidad de datos), cap. 9
 *     (asignación), cap. 10 (incertidumbre), cap. 11/13 (biogénico y LUC)
 *   PEF (Rec. UE 2021/2279) — DQR con TeR/GeR/TiR/P, cambio climático
 *     desagregado en fósil / biogénico / uso del suelo
 *   ISO 14064-1:2018 y GHG Protocol Corporate — reporte por gas y por categoría
 */

export const STANDARDS = Object.freeze({
  iso14067:      { label: 'ISO 14067',               modulo: 'producto' },
  ghgp_product:  { label: 'GHG Protocol Producto',   modulo: 'producto' },
  pef:           { label: 'PEF (UE)',                modulo: 'producto' },
  iso14064:      { label: 'ISO 14064-1',             modulo: 'corporativo' },
  ghgp_corp:     { label: 'GHG Protocol Corporativo', modulo: 'corporativo' },
})

const P = ['iso14067', 'ghgp_product', 'pef']
const C = ['iso14064', 'ghgp_corp']
const ALL = [...P, ...C]

const has = v => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '') && !(Array.isArray(v) && v.length === 0)
const num = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))

/**
 * Requisitos. `check(ef)` → true si está cumplido. `applies(ef)` opcional.
 * group: para agrupar en la UI y en la auditoría.
 */
export const REQUIREMENTS = [
  // ── Identidad ───────────────────────────────────────────────
  { id: 'nombre_es', group: 'identidad', level: 'obligatorio', standards: ALL,
    label: 'Nombre en español', check: ef => has(ef.name) },
  { id: 'nombre_en', group: 'identidad', level: 'obligatorio', standards: ALL,
    label: 'Nombre en inglés (para la plataforma en inglés)', check: ef => has(ef.name_en) },
  { id: 'unidad_declarada', group: 'identidad', level: 'obligatorio', standards: ALL,
    label: 'Unidad declarada (kg CO₂e por unidad de actividad)', check: ef => has(ef.unit) },
  { id: 'cas', group: 'identidad', level: 'recomendado', standards: P,
    label: 'Número CAS (químicos)', applies: ef => ef.section === 'ingredients' && isChemical(ef), check: ef => has(ef.cas_number) },

  // ── Método de evaluación de impacto ─────────────────────────
  { id: 'gwp', group: 'metodo', level: 'obligatorio', standards: ALL,
    label: 'Versión de GWP (IPCC AR6 recomendado) y horizonte de 100 años',
    check: ef => has(ef.gwp_source) && (ef.gwp_horizonte == null || Number(ef.gwp_horizonte) === 100) },
  { id: 'gwp_ar6', group: 'metodo', level: 'recomendado', standards: [...P, ...C],
    label: 'Valor en GWP de IPCC AR6 (o convertible)', check: ef => /ar6/i.test(ef.gwp_source || '') || num(ef.ef_value_ar6) },

  // ── Alcance del dato ────────────────────────────────────────
  { id: 'limites_sistema', group: 'alcance', level: 'obligatorio', standards: P,
    label: 'Límites del sistema (cuna a puerta, cuna a tumba…)', check: ef => has(ef.limites_sistema) },
  { id: 'modelo_sistema', group: 'alcance', level: 'recomendado', standards: ['pef', 'iso14067'],
    label: 'Modelo de sistema / asignación de la base de datos (cut-off, APOS…)', check: ef => has(ef.system_model) || has(ef.metodo_asignacion) },
  { id: 'tipo_factor', group: 'alcance', level: 'obligatorio', standards: C,
    label: 'Tipo de factor (combustión, WTT, red por ubicación/mercado, gasto…)', check: ef => has(ef.tipo_factor) },
  { id: 'categoria_ghg', group: 'alcance', level: 'obligatorio', standards: C,
    label: 'Alcance y categoría GHG Protocol / ISO 14064-1', check: ef => has(ef.categoria_ghg) || has(ef.categoria_iso14064) },

  // ── Desagregación (ISO 14067, PEF, GHG Protocol Producto) ─
  { id: 'fosil', group: 'desagregacion', level: 'obligatorio', standards: P,
    label: 'Emisiones fósiles separadas', check: ef => num(ef.ef_fosil) },
  { id: 'biogenico', group: 'desagregacion', level: 'obligatorio', standards: P,
    label: 'Emisiones y remociones biogénicas separadas (0 si no aplica)',
    check: ef => num(ef.ef_biogenico) || num(ef.ef_co2_biogenico) },
  { id: 'dluc', group: 'desagregacion', level: 'obligatorio', standards: P,
    label: 'Cambio directo de uso del suelo (dLUC) declarado (0 si no aplica)', check: ef => num(ef.ef_dluc) },
  { id: 'carbono_biogenico', group: 'desagregacion', level: 'recomendado', standards: ['iso14067', 'pef'],
    label: 'Contenido de carbono biogénico (kg C/kg) en materiales de origen biológico',
    applies: ef => ef.section === 'ingredients' || ef.section === 'packaging', check: ef => num(ef.contenido_carbono_biogenico) },
  // GHG Protocol Corporativo e ISO 14064-1 piden el reporte por gas en las emisiones directas
  // y de energía (Alcances 1 y 2). El upstream de combustibles (WTT) y el resto del Alcance 3
  // se reportan en CO₂e: las fuentes (DESNZ, ADEME) los publican así (Etapa A8, oct 2026).
  { id: 'por_gas', group: 'desagregacion', level: 'obligatorio', standards: C,
    label: 'Desagregado por gas (CO₂, CH₄, N₂O)',
    applies: ef => ['combustion', 'fugitivas', 'proceso'].includes(ef.tipo_factor) && alcanceDe(ef) !== 3,
    check: ef => (num(ef.ef_co2) || num(ef.gas_kg_co2)) && (num(ef.ef_ch4) || num(ef.gas_kg_ch4)) && (num(ef.ef_n2o) || num(ef.gas_kg_n2o)) },

  // ── Representatividad ───────────────────────────────────────
  { id: 'geografia', group: 'representatividad', level: 'obligatorio', standards: ALL,
    label: 'Geografía del dato (país ISO-3 o región)', check: ef => has(ef.pais_iso3) || has(ef.region) || has(ef.location_code) },
  { id: 'anio', group: 'representatividad', level: 'obligatorio', standards: ALL,
    label: 'Año de referencia del dato', check: ef => num(ef.data_year) },
  { id: 'tecnologia', group: 'representatividad', level: 'recomendado', standards: P,
    label: 'Tecnología / ruta de producción descripta', check: ef => has(ef.representatividad_tecnologica) || has(ef.variante) || has(ef.tipo) },

  // ── Calidad e incertidumbre ─────────────────────────────────
  { id: 'dqr', group: 'calidad', level: 'obligatorio', standards: P,
    label: 'Calidad de datos (DQR: TeR, GeR, TiR, P)', check: ef => num(ef.dqr_total) },
  { id: 'incertidumbre', group: 'calidad', level: 'recomendado', standards: [...P, ...C],
    label: 'Incertidumbre (rango o desvío)', check: ef => (num(ef.incertidumbre_p025) && num(ef.incertidumbre_p975)) || has(ef.incertidumbre) },
  { id: 'asignacion', group: 'calidad', level: 'obligatorio', standards: ['iso14067', 'ghgp_product'],
    label: 'Método de asignación y su justificación (si hay coproductos)',
    applies: ef => ef.origen_calculo === 'rrem' || ef.tiene_coproductos === true,
    check: ef => has(ef.metodo_asignacion) && has(ef.justificacion_asignacion) },

  // ── Fuente y trazabilidad ───────────────────────────────────
  { id: 'fuente', group: 'trazabilidad', level: 'obligatorio', standards: ALL,
    label: 'Fuente identificada (organismo / documento / versión)', check: ef => has(ef.fuente_documento) || has(ef.fuente_organismo) || has(ef.fuente_codigo) },
  { id: 'fuente_localizable', group: 'trazabilidad', level: 'obligatorio', standards: ALL,
    label: 'Fuente localizable (URL o archivo + tabla/fila o evidencia)',
    check: ef => (has(ef.fuente_url) || has(ef.fuente_archivo) || has(ef.traceability_report_id)) },
  { id: 'valor_original', group: 'trazabilidad', level: 'recomendado', standards: ALL,
    label: 'Valor y unidad originales + conversión aplicada', check: ef => num(ef.valor_original) && has(ef.unidad_original) },
  { id: 'licencia', group: 'trazabilidad', level: 'obligatorio', standards: ALL,
    label: 'Licencia y uso comercial permitido', check: ef => has(ef.licencia) && ef.uso_comercial != null },
  { id: 'verificacion', group: 'trazabilidad', level: 'recomendado', standards: ALL,
    label: 'Estado de verificación (tercera parte / consultor / IA)', check: ef => has(ef.verificacion) || has(ef.certification_status) },
]

export const GROUP_LABELS = Object.freeze({
  identidad: 'Identidad e idioma',
  metodo: 'Método (GWP)',
  alcance: 'Alcance del dato',
  desagregacion: 'Fósil / biogénico / dLUC / gases',
  representatividad: 'Representatividad',
  calidad: 'Calidad e incertidumbre',
  trazabilidad: 'Fuente y trazabilidad',
})

/** Alcance GHG del factor (1, 2 o 3), por la columna `alcance` o por la categoría; null si no se sabe. */
export function alcanceDe(ef) {
  const a = String(ef.alcance || '').match(/(\d)/)
  if (a) return Number(a[1])
  const c = String(ef.categoria_ghg || '').match(/^S(\d)/i)
  if (c) return Number(c[1])
  const sc = ef.corp_config?.scope
  return sc ? Number(sc) : null
}

/**
 * Actividades del catálogo corporativo que no son un factor sino una regla de cálculo
 * (factor de red del país, GWP del gas, dato del proveedor o del franquiciado): no se
 * evalúan contra las normas; las evalúa el factor que usan al calcular.
 */
export function esPlantillaCorporativa(ef) {
  return ['proveedor', 'grid', 'gridShare', 'gwpGas'].includes(ef?.corp_config?.modo)
}

function isChemical(ef) {
  const c = `${ef.category || ''} ${ef.subcategoria || ''}`.toLowerCase()
  return !/(fruta|verdura|cereal|carne|lácteo|lacteo|alimento|agribalyse|food)/.test(c)
}

/** Módulo(s) de un factor: por la columna `modulos` o por la sección. */
export function modulosDe(ef) {
  if (Array.isArray(ef.modulos) && ef.modulos.length) return ef.modulos
  return ['ingredients', 'packaging'].includes(ef.section) ? ['producto'] : ['producto', 'corporativo']
}

/**
 * Evalúa un factor contra el estándar.
 * @returns {{ missing: Array<{id,label,group,level,standards}>, cumple: Object<string,boolean>,
 *             completitud: number, obligatoriosFaltantes: number }}
 */
export function assessEf(ef) {
  const mods = modulosDe(ef)
  const relevantStd = Object.keys(STANDARDS).filter(s => mods.includes(STANDARDS[s].modulo))
  if (esPlantillaCorporativa(ef)) {
    return { missing: [], cumple: Object.fromEntries(relevantStd.map(s => [s, true])), completitud: 100, obligatoriosFaltantes: 0, plantilla: true }
  }
  const missing = []
  let aplicables = 0, cumplidos = 0
  for (const r of REQUIREMENTS) {
    const stds = r.standards.filter(s => relevantStd.includes(s))
    if (!stds.length) continue
    if (r.applies && !r.applies(ef)) continue
    aplicables++
    if (r.check(ef)) { cumplidos++; continue }
    missing.push({ id: r.id, label: r.label, group: r.group, level: r.level, standards: stds })
  }
  const cumple = {}
  for (const s of relevantStd) cumple[s] = !missing.some(m => m.level === 'obligatorio' && m.standards.includes(s))
  return {
    missing,
    cumple,
    completitud: aplicables ? Math.round((cumplidos / aplicables) * 100) : 100,
    obligatoriosFaltantes: missing.filter(m => m.level === 'obligatorio').length,
  }
}
