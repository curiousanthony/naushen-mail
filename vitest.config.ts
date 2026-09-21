import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared'), '@': resolve('src/renderer') } },
  test: { include: ['tests/**/*.test.ts', 'src/**/*.test.ts'], environment: 'node' }
})
