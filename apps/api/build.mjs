/**
 * Production build for the SIAB API.
 *
 * Why bundle rather than plain `tsc`:
 *
 * `@siab/core` is a workspace package that ships TypeScript source, because
 * the Expo app consumes it directly through Metro. Node cannot run that in
 * production, so a plain `tsc` build emits an `import '@siab/core'` that
 * resolves to a .ts file and crashes on boot.
 *
 * esbuild inlines the workspace code and leaves every real npm dependency
 * external, so node_modules is still used at runtime. That keeps pino's
 * worker transports and Fastify's dynamic requires working — both of which
 * break when bundled.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(HERE, 'package.json'), 'utf8'));

// Everything published to npm stays external. Workspace packages (declared
// as "workspace:*") are deliberately absent from this list so they get
// bundled in.
const external = Object.entries(pkg.dependencies ?? {})
  .filter(([, version]) => !String(version).startsWith('workspace:'))
  .map(([name]) => name);

const result = await esbuild.build({
  entryPoints: [resolve(HERE, 'src/index.ts')],
  outfile: resolve(HERE, 'dist/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  minify: false, // a readable stack trace is worth more than a smaller file
  external,
  logLevel: 'info',
  // Fastify and pino reach for CommonJS globals that do not exist in an ESM
  // bundle; this shims them.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __pathDirname } from 'node:path';",
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __pathDirname(__filename);',
    ].join('\n'),
  },
});

if (result.errors.length) {
  console.error(result.errors);
  process.exit(1);
}
console.log(`Bundled apps/api/dist/index.js (external: ${external.length} packages)`);
