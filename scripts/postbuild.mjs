import fs from 'node:fs'
import path from 'node:path'

function renameIfExists(fromPath, toPath) {
  if (!fs.existsSync(fromPath)) return
  fs.renameSync(fromPath, toPath)
}

function readPackageMeta(cwd) {
  const raw = fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')
  const pkg = JSON.parse(raw)
  return {
    version: typeof pkg?.version === 'string' ? pkg.version : '0.0.0',
    description:
      typeof pkg?.description === 'string' && pkg.description.trim().length > 0
        ? pkg.description.trim()
        : 'Linux.do Tool',
    author:
      typeof pkg?.author === 'string' && pkg.author.trim().length > 0 ? pkg.author.trim() : 'MoMo',
  }
}

function buildUserscriptHeader({ version, description, author }) {
  return [
    '// ==UserScript==',
    '// @name         Linux.do Tool',
    '// @namespace    https://linux.do/',
    `// @version      ${version}`,
    `// @description  ${description}`,
    `// @author       ${author}`,
    '// @homepageURL  https://github.com/leonardkorir/Tool',
    '// @supportURL   https://github.com/leonardkorir/Tool/issues',
    '// @match        https://linux.do/*',
    '// @match        https://meta.discourse.org/*',
    '// @noframes',
    '// @grant        GM_getValue',
    '// @grant        GM_setValue',
    '// @grant        GM_deleteValue',
    '// @grant        GM_addStyle',
    '// @grant        GM_download',
    '// @grant        GM_xmlhttpRequest',
    '// @connect      *',
    '// @grant        unsafeWindow',
    '// @run-at       document-end',
    '// @license      MIT',
    '// ==/UserScript==',
    '',
    '',
  ].join('\n')
}

function prependUserscriptHeader({ jsPath, header }) {
  const content = fs.readFileSync(jsPath, 'utf8')
  if (content.includes('==UserScript==')) return 0
  fs.writeFileSync(jsPath, header + content, 'utf8')
  return (header.match(/\n/g) || []).length
}

function normalizeSourceMappingUrl({ jsPath, mapFileName }) {
  const content = fs.readFileSync(jsPath, 'utf8')
  const stripped = content.replace(/\/\/# sourceMappingURL=.*$/gm, '').trimEnd()
  const next = `${stripped}\n//# sourceMappingURL=${mapFileName}\n`
  fs.writeFileSync(jsPath, next, 'utf8')
}

function shiftSourceMap({ mapPath, lineOffset, fileName }) {
  if (!fs.existsSync(mapPath)) return
  const raw = fs.readFileSync(mapPath, 'utf8')
  const map = JSON.parse(raw)
  if (typeof map.mappings === 'string' && lineOffset > 0) {
    map.mappings = `${';'.repeat(lineOffset)}${map.mappings}`
  }
  if (typeof fileName === 'string') map.file = fileName
  fs.writeFileSync(mapPath, JSON.stringify(map), 'utf8')
}

const mode = process.argv[2] ?? 'prod'
const base = mode === 'dev' ? 'linuxdo-tool.dev.user' : 'linuxdo-tool.user'
const cwd = process.cwd()
const distDir = path.join(cwd, 'dist')

renameIfExists(path.join(distDir, `${base}.global.js`), path.join(distDir, `${base}.js`))
renameIfExists(path.join(distDir, `${base}.global.js.map`), path.join(distDir, `${base}.js.map`))

const jsPath = path.join(distDir, `${base}.js`)
if (fs.existsSync(jsPath)) {
  const meta = readPackageMeta(cwd)
  const header = buildUserscriptHeader(meta)
  const lineOffset = prependUserscriptHeader({ jsPath, header })

  if (mode === 'dev') {
    const mapFileName = `${base}.js.map`
    normalizeSourceMappingUrl({ jsPath, mapFileName })
    shiftSourceMap({ mapPath: path.join(distDir, mapFileName), lineOffset, fileName: `${base}.js` })
  }
}
