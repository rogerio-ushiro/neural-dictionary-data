import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// Library build for @neural-dictionary/client. The barrel (src/index.ts)
// re-exports the model, loader, ego-graph and search. `resolveJsonModule` +
// this bundler step inline schema/v04/graph.schema.json (imported by
// validate.ts) into the emitted JS — a plain `tsc` would leave a dangling
// `../../../schema/...` specifier.
export default defineConfig({
  // Do NOT copy public/ into dist/ — the published package must not carry the
  // packs (D3: the app never has data). Pages publishes public/data separately.
  publicDir: false,
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      // ajv is a real dependency of the published package — keep it external so
      // the consumer dedupes it; everything else is inlined.
      external: ['ajv'],
    },
    sourcemap: true,
    target: 'es2023',
  },
  plugins: [
    dts({
      rollupTypes: true,
      include: ['src'],
      tsconfigPath: './tsconfig.app.json',
    }),
  ],
})
