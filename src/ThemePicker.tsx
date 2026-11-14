import { useEffect, useState } from 'react'
import { applyTheme, readStoredTheme, saveTheme, THEME_LABELS, type AppTheme } from './theme'

export default function ThemePicker() {
  const [theme, setTheme] = useState<AppTheme>(() => readStoredTheme())

  useEffect(() => {
    applyTheme(theme)
    saveTheme(theme)
  }, [theme])

  return <label className="theme-picker" htmlFor="theme-picker-select"><span>介面主題</span><select id="theme-picker-select" value={theme} onChange={(event) => setTheme(event.target.value as AppTheme)} aria-label="選擇介面主題"><option value="deep-tea">{THEME_LABELS['deep-tea']}</option><option value="navy">{THEME_LABELS.navy}</option></select></label>
}
