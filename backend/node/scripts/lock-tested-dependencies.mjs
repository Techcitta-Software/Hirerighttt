// Derive the standalone backend lock from the already-tested monorepo lock.
// Does not change the root lockfile or resolve newer dependency versions.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = JSON.parse(readFileSync(new URL('../../../package-lock.json', import.meta.url), 'utf8'))
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const packages = { '': { name: manifest.name, version: manifest.version, dependencies: manifest.dependencies } }
function include(name, parent = '') {
  let current = parent
  let key
  for (;;) {
    const candidate = `${current ? `${current}/` : ''}node_modules/${name}`
    if (root.packages[candidate] && !root.packages[candidate].link) { key = candidate; break }
    if (!current) return // Uninstalled optional peer dependency.
    const next = dirname(current).replaceAll('\\', '/')
    current = next === '.' ? '' : next
  }
  if (packages[key]) return
  const entry = structuredClone(root.packages[key])
  delete entry.dev
  delete entry.devOptional
  packages[key] = entry
  for (const dependency of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies })) include(dependency, key)
}
for (const name of Object.keys(manifest.dependencies)) include(name)
for (const name of Object.keys(manifest.dependencies)) {
  if (!packages[`node_modules/${name}`]) throw new Error(`Missing tested dependency: ${name}`)
}
const output = new URL('../package-lock.json', import.meta.url)
writeFileSync(output, JSON.stringify({ name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages }, null, 2) + '\n')
console.log(`Wrote tested backend dependency lock: ${fileURLToPath(output)}`)
