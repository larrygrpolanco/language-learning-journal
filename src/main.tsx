// Fonts are self-hosted through Fontsource rather than linked from a CDN, because the app has to work
// offline and inside a Tauri webview. Technical plan §2 and §12.
//
// Subset imports, not the whole face. The bare `400.css` entry points pull Cyrillic, Vietnamese,
// symbols and math, none of which anything here renders. Latin plus latin-ext covers English and the
// European target languages; Hangul comes from Noto Serif KR's Korean subset alone.
import '@fontsource/cormorant-garamond/latin-400.css'
import '@fontsource/cormorant-garamond/latin-600.css'
import '@fontsource/cormorant-garamond/latin-400-italic.css'
import '@fontsource/cormorant-garamond/latin-ext-400.css'
import '@fontsource/lora/latin-400.css'
import '@fontsource/lora/latin-600.css'
import '@fontsource/lora/latin-400-italic.css'
import '@fontsource/lora/latin-ext-400.css'
import '@fontsource/noto-serif-kr/korean-400.css'

import './styles/tokens.css'
import './styles/app.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { registerShellCache, watchForInstall } from './storage/install'

/**
 * Ask for persistent storage on first run.
 *
 * IndexedDB is evictable. This upgrades the origin when the browser grants it, which is one of the
 * three boring mitigations in technical plan §4. It is fire and forget: a refusal changes nothing,
 * and the export reminder in Settings is the real backstop.
 */
void navigator.storage?.persist?.()

/**
 * The two halves of M5.
 *
 * `watchForInstall` has to run before React mounts, because `beforeinstallprompt` fires early and is
 * gone if nobody caught it. The shell cache waits for load and does nothing in dev.
 */
watchForInstall()
registerShellCache()

const root = document.getElementById('root')
if (!root) throw new Error('no #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
