const esbuild = require('esbuild');

const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: !isProduction,
  minify: isProduction,
  treeShaking: true,
  logLevel: 'info',
};

async function main() {
  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('[esbuild] Watching for file changes...');
  } else {
    const startTime = Date.now();
    await esbuild.build(buildOptions);
    const duration = Date.now() - startTime;
    console.log(`[esbuild] Extension bundled successfully in ${duration}ms (production: ${isProduction})`);
  }
}

main().catch((err) => {
  console.error('[esbuild] Build failed:', err);
  process.exit(1);
});

