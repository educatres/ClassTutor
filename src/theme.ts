export type AppTheme = 'navy'

export const DEFAULT_THEME: AppTheme = 'navy'

export function readStoredTheme(): AppTheme {
  return DEFAULT_THEME
}

export function applyTheme(_theme: AppTheme) {
  document.documentElement.dataset.theme = 'navy'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#1f4968')
}
