/**
 * Installing the app, and the shell cache behind it. Technical plan §1 and M5.
 *
 * Both halves are deliberately small. The service worker caches the shell and nothing else, and this
 * module is the only thing that talks to it.
 */

/**
 * Registers the shell cache.
 *
 * Production only. In dev a service worker would serve stale modules and fight Vite's HMR, which costs
 * an afternoon to work out the first time it happens.
 *
 * Fails quietly by design. A service worker needs a secure context, so this does nothing on `file://`
 * and nothing inside a Tauri webview, and neither case wants it: a Tauri build already has its assets
 * on disk. The app works offline either way, because the journal is in IndexedDB rather than on a
 * server.
 */
export const registerShellCache = (): void => {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {
      // No secure context, or the file is not being served. Nothing to tell the learner: this only
      // affects whether the shell loads without a network, and every other part still works.
    })
  })
}

/* ── the install prompt ───────────────────────────────────────────────────── */

/** What Chromium passes to `beforeinstallprompt`. Not in the DOM lib types. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let held: InstallPromptEvent | undefined
const listeners = new Set<(available: boolean) => void>()

const announce = () => {
  for (const l of listeners) l(held !== undefined)
}

/**
 * Catches the browser's install offer so it can be shown where it belongs.
 *
 * The event fires once, early, and is lost if not held onto. Chromium only fires it at all when the
 * app is installable and not already installed, which is why the button in Settings simply is not
 * there rather than being there and disabled.
 */
export const watchForInstall = (): void => {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Preventing the default is what stops Chromium showing its own mini-infobar, so the offer appears
    // in Settings instead of over the journal.
    e.preventDefault()
    held = e as InstallPromptEvent
    announce()
  })

  window.addEventListener('appinstalled', () => {
    held = undefined
    announce()
  })
}

export const onInstallAvailable = (listener: (available: boolean) => void): (() => void) => {
  listeners.add(listener)
  listener(held !== undefined)
  return () => listeners.delete(listener)
}

/** Shows the browser's own dialog. Returns what the learner chose. */
export const promptInstall = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
  if (!held) return 'unavailable'
  await held.prompt()
  const { outcome } = await held.userChoice
  // The event is single use. Whatever was chosen, it cannot be shown again from this one.
  held = undefined
  announce()
  return outcome
}

/** True when running from a home screen or an installed window rather than a browser tab. */
export const isInstalled = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: window-controls-overlay)').matches ||
  // iOS Safari, which does not report a display mode.
  (navigator as { standalone?: boolean }).standalone === true
