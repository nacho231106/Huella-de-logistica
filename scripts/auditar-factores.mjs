// Audita los factores de data/modos.json contra el estándar Coralia (lib/ef/standard.js).
// Uso: node scripts/auditar-factores.mjs   → sale con código 1 si algún factor no cumple un obligatorio.
import { readFileSync } from 'node:fs'
import { assessEf, STANDARDS } from '../lib/ef/standard.js'

const { modos } = JSON.parse(readFileSync(new URL('../data/modos.json', import.meta.url), 'utf8'))
let fallas = 0
for (const m of modos) {
  const r = assessEf(m.metadatos || {})
  const normas = Object.entries(r.cumple).map(([s, ok]) => `${STANDARDS[s].label} ${ok ? '✓' : '✗'}`).join(' · ')
  console.log(`\n${m.id} (${m.factor} kg CO2e/t·km) · completitud ${r.completitud}% · ${normas}`)
  for (const f of r.missing) console.log(`  ${f.level === 'obligatorio' ? '✗ FALTA' : '· recomendado'}: ${f.label}`)
  fallas += r.obligatoriosFaltantes
}
console.log(fallas ? `\n${fallas} obligatorio(s) sin cumplir.` : '\nTodos los factores cumplen los obligatorios.')
process.exit(fallas ? 1 : 0)
