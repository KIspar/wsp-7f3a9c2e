import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['apps/server/index.ts'],
  format: ['esm'], platform: 'node', target: 'node24', outDir: 'dist-server',
  external: ['node:sqlite'], removeNodeProtocol: false,
});
