import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

/** Mirror the build-time define from tsdown.config.ts so tests see the same version. */
const PACKAGE_MANIFEST = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
)
const PACKAGE_VERSION = PACKAGE_MANIFEST.version as string

const PI_AI_VERSION = PACKAGE_MANIFEST.dependencies['@earendil-works/pi-ai'] as string
if (!/^\d+\.\d+\.\d+$/u.test(PI_AI_VERSION)) throw new Error('pi-ai must have an exact runtime version')

export default defineConfig({
  define: {
    __DSH_WORKBUDDY_VERSION__: JSON.stringify(PACKAGE_VERSION),
    __DSH_WORKBUDDY_PI_AI_VERSION__: JSON.stringify(PI_AI_VERSION),
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
