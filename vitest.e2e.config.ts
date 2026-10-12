import { defineConfig } from 'vitest/config'

// The install lanes: build the package, scaffold a product, install the
// package into it (from a tarball, then from git) and run the product's own
// gate. Needs the network.
export default defineConfig({
	test: {
		include: ['src/e2e/**/*.test.ts'],
		testTimeout: 300_000,
		hookTimeout: 300_000,
	},
})
