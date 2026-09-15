import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Fontsource ships a `.woff` beside every `.woff2` for browsers that predate 2015. Its CSS lists
 * woff2 first, and every target here including the Tauri webview takes woff2, so the `.woff` files
 * are downloaded by nothing and only sit in the build. Dropping them takes about 2.5 MB off `dist`,
 * most of it the Korean face, which matters for a Tauri bundle shipped as a file on disk.
 *
 * The CSS reference goes too. A url nothing requests is still a url pointing at a file that no
 * longer exists.
 */
const dropLegacyWoff = (): Plugin => ({
  name: 'drop-legacy-woff',
  generateBundle(_options, bundle) {
    for (const [name, output] of Object.entries(bundle)) {
      if (name.endsWith('.woff')) {
        delete bundle[name]
        continue
      }
      if (output.type === 'asset' && name.endsWith('.css') && typeof output.source === 'string') {
        output.source = output.source.replace(
          /,\s*url\([^)]*\.woff\)\s*format\((["']?)woff\1\)/g,
          '',
        )
      }
    }
  },
})

export default defineConfig({
  plugins: [react(), dropLegacyWoff()],
  // Relative base so a built bundle also works from file:// and inside a Tauri webview.
  base: './',
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
})
