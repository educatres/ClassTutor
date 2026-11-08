import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cpSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), {
    name: 'copy-doc',
    closeBundle() {
      cpSync(resolve(__dirname, 'doc'), resolve(__dirname, 'dist/doc'), { recursive: true })
    },
  }],
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        teacher: './teacher.html',
      },
    },
  },
})
