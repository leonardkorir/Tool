import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const budgetFile = path.join(process.cwd(), 'performance-budgets.json')
const defaultBudget = {
  bundle: {
    file: path.join('dist', 'linuxdo-tool.user.js'),
    maxBytes: 250 * 1024,
    maxGzipBytes: 120 * 1024,
  },
}

let budget = defaultBudget
if (fs.existsSync(budgetFile)) {
  try {
    const raw = JSON.parse(fs.readFileSync(budgetFile, 'utf8'))
    const bundle = raw?.bundle && typeof raw.bundle === 'object' ? raw.bundle : {}
    budget = {
      bundle: {
        file: typeof bundle.file === 'string' ? bundle.file : defaultBudget.bundle.file,
        maxBytes: Number.isFinite(Number(bundle.maxBytes))
          ? Number(bundle.maxBytes)
          : defaultBudget.bundle.maxBytes,
        maxGzipBytes: Number.isFinite(Number(bundle.maxGzipBytes))
          ? Number(bundle.maxGzipBytes)
          : defaultBudget.bundle.maxGzipBytes,
      },
    }
  } catch {
    // ignore invalid budget file; fall back to defaults
  }
}

const target = path.join(process.cwd(), budget.bundle.file)
const limitBytes = budget.bundle.maxBytes
const limitGzipBytes = budget.bundle.maxGzipBytes

if (!fs.existsSync(target)) {
  console.error(`missing file: ${target}`)
  process.exit(1)
}

const buf = fs.readFileSync(target)
const size = buf.length
const gzipSize = zlib.gzipSync(buf).length
console.log(`size: ${size} bytes (${(size / 1024).toFixed(1)} KiB)`)
console.log(`gzip: ${gzipSize} bytes (${(gzipSize / 1024).toFixed(1)} KiB)`)

if (size > limitBytes) {
  console.error(`size budget exceeded: ${size} > ${limitBytes}`)
  process.exit(1)
}

if (gzipSize > limitGzipBytes) {
  console.error(`gzip size budget exceeded: ${gzipSize} > ${limitGzipBytes}`)
  process.exit(1)
}
