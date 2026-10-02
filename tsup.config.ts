import { defineConfig } from 'tsup';

/**
 * The library ships ESM and CommonJS with declarations; the CLI is one ESM
 * file with a shebang. The known-address data is bundled, so the CLI reads
 * nothing at run time except the tree it is pointed at.
 */
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    target: 'es2022',
    platform: 'node',
    sourcemap: true,
    clean: true,
    treeshake: true,
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: false,
    target: 'es2022',
    platform: 'node',
    sourcemap: true,
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
