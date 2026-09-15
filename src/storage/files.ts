/**
 * The only module in the app that touches files. Technical plan §4 and §12.
 *
 * Browser: a download for save, an `<input type="file">` for open. Tauri later swaps in the fs plugin
 * and nothing else changes, which is the whole reason this is one file with two functions.
 */

/** Hands the bytes to the browser as a download. */
export const saveBundle = async (bytes: Uint8Array, filename: string): Promise<void> => {
  // Copy into a fresh buffer. A Uint8Array from fflate may be a view onto a larger ArrayBuffer, and
  // handing that straight to Blob writes the whole underlying buffer.
  const exact = new Uint8Array(bytes.length)
  exact.set(bytes)
  const url = URL.createObjectURL(new Blob([exact], { type: 'application/zip' }))

  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.append(a)
  a.click()
  a.remove()

  // Revoking immediately can cancel the download in some browsers, so give it a tick.
  await new Promise((r) => setTimeout(r, 0))
  URL.revokeObjectURL(url)
}

/**
 * Asks for a bundle and resolves with its bytes, or undefined if the learner cancelled.
 *
 * There is no reliable cancel event on a file input, so the promise resolves on the first of `change`
 * or the window regaining focus. Without that, cancelling would leave the caller waiting forever and
 * the import screen stuck.
 */
export const openBundle = (accept = '.lljournal,.zip'): Promise<Uint8Array | undefined> =>
  new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    document.body.append(input)

    let settled = false
    const finish = (value: Uint8Array | undefined) => {
      if (settled) return
      settled = true
      window.removeEventListener('focus', onFocus)
      input.remove()
      resolve(value)
    }

    const onFocus = () => {
      // Focus returns before `change` fires, so wait a beat to see whether a file arrived.
      setTimeout(() => {
        if (!input.files || input.files.length === 0) finish(undefined)
      }, 300)
    }

    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) {
        finish(undefined)
        return
      }
      void file.arrayBuffer().then((buf) => finish(new Uint8Array(buf)))
    })

    window.addEventListener('focus', onFocus)
    input.click()
  })
