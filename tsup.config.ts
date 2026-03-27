import { defineConfig } from 'tsup'

export default defineConfig(() => {
  const isDev = process.env.BUILD === 'dev'
  const outBase = isDev ? 'linuxdo-tool.dev.user' : 'linuxdo-tool.user'

  return {
    entry: { [outBase]: 'src/index.ts' },
    outDir: 'dist',
    format: ['iife'],
    target: 'es2020',
    platform: 'browser',
    sourcemap: isDev,
    minify: !isDev,
    splitting: false,
    clean: false,
    treeshake: true,
  }
})
