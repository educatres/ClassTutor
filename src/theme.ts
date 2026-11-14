export type AppTheme = 'deep-tea' | 'navy'

export const DEFAULT_THEME: AppTheme = 'deep-tea'
export const THEME_STORAGE = 'classtutor.theme.v1'

export const THEME_LABELS: Record<AppTheme, string> = {
  'deep-tea': '深茶色主色 × 橘色輔色 × 少量紅色（預設）',
  navy: '海軍藍學習系',
}

export function isAppTheme(value: unknown): value is AppTheme {
  return value === 'deep-tea' || value === 'navy'
}

export function readStoredTheme(): AppTheme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE)
    return isAppTheme(saved) ? saved : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function saveTheme(theme: AppTheme) {
  try { localStorage.setItem(THEME_STORAGE, theme) } catch { /* memory-only fallback */ }
}

export function applyTheme(theme: AppTheme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'navy' ? '#1f4968' : '#4a2f24')
}
