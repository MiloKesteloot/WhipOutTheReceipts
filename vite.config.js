import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/WhipOutTheReceipts/',
  test: {
    // .supabase-ui/ holds copies of supabase/ for the UI-testing stack
    exclude: [...configDefaults.exclude, '.supabase-ui/**'],
  },
})
