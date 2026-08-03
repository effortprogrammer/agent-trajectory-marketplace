#!/usr/bin/env node
/**
 * Assembles the publishable package in packages/fnf/publish/.
 *
 * The workspace package (@higgsfield/fnf, private, version 0.0.0, exports
 * pointing at TypeScript source) is never touched — in-repo consumers keep
 * resolving raw source through yarn workspaces. This script derives a
 * publish-only package.json for external consumption from GitHub Packages,
 * where the scope must match the org: @higgsfield-ai/fnf.
 *
 * Usage: node scripts/make-publish-package.mjs <version>
 * Expects `vite build` to have populated dist/ first.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PUBLISH_NAME = '@higgsfield-ai/fnf'
const REGISTRY = 'https://npm.pkg.github.com'

const packageRoot = dirname(fileURLToPath(new URL('.', import.meta.url)))
const distDir = join(packageRoot, 'dist')
const publishDir = join(packageRoot, 'publish')

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/.test(version)) {
  console.error(`Usage: make-publish-package.mjs <semver>. Got: ${JSON.stringify(version)}`)
  process.exit(1)
}

if (!existsSync(join(distDir, 'index.js'))) {
  console.error('dist/index.js not found — run `yarn workspace @higgsfield/fnf build` first.')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

const exports = {}
for (const [subpath, target] of Object.entries(pkg.exports)) {
  if (!target.endsWith('.ts'))
    continue
  const entryName = subpath === '.' ? 'index' : subpath.slice(2)
  exports[subpath] = {
    // d.ts files mirror the src/ layout (dist/jobs/index.d.ts); js entries are flat.
    types: target.replace('./src', './dist').replace(/\.ts$/, '.d.ts'),
    default: `./dist/${entryName}.js`,
  }
}
exports['./package.json'] = './package.json'

// Deliberately minimal: no repository, author, or any other field that points
// back at the source repo or people. Only what consumers need to install and
// resolve the package.
const publishPkg = {
  name: PUBLISH_NAME,
  version,
  description: pkg.description,
  license: pkg.license,
  type: pkg.type,
  // src/media/errors.ts registers media error codes at import time. After
  // bundling it lives in a shared chunk (or the media entry), so mark both
  // patterns side-effectful to keep tree-shakers from dropping the registrations.
  sideEffects: ['./dist/chunks/*.js', './dist/media.js'],
  exports,
  files: ['dist'],
  // No peerDependencies: zod is bundled into dist by the vite build.
  publishConfig: {
    registry: REGISTRY,
    access: 'restricted',
  },
}

rmSync(publishDir, { recursive: true, force: true })
mkdirSync(publishDir, { recursive: true })
writeFileSync(join(publishDir, 'package.json'), `${JSON.stringify(publishPkg, null, 2)}\n`)
cpSync(distDir, join(publishDir, 'dist'), { recursive: true })

// Published docs must reference the published name, not the workspace name.
const readme = readFileSync(join(packageRoot, 'README.md'), 'utf8')
writeFileSync(join(publishDir, 'README.md'), readme.replaceAll('@higgsfield/fnf', PUBLISH_NAME))

console.log(`Prepared ${PUBLISH_NAME}@${version} in ${publishDir}`)
