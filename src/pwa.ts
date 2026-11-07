export function registerPwa() {
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      // Offline support is optional; the app remains usable if registration is blocked.
    })
  }, { once: true })
}
