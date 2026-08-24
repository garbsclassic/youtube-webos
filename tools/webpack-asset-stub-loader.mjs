// ESM loader hook used by `npm test`. Source modules `import` CSS/image/font
// files that only webpack's asset-module rules know how to handle -- plain
// Node has no loader for them. Stub them out to an empty default export so
// modules with those side-effect imports (sponsorblock.js -> *.css,
// Sponsorblock-UI.js -> *.css/*.png) can be imported directly in tests
// without pulling webpack into the test runner.
const ASSET_RE = /\.(?:css|png|jpe?g|svg|woff2?)$/i;

/** @type {import('node:module').ResolveHook} */
export async function resolve(specifier, context, nextResolve) {
  if (ASSET_RE.test(specifier)) {
    return { url: `asset-stub:${specifier}`, shortCircuit: true };
  }

  // Source imports omit the extension, and some import a directory expecting
  // its index file (webpack/TS "bundler" resolution fills both in); plain
  // Node ESM requires an exact file match, so retry with .ts/.js and
  // /index.ts//index.js when the bare specifier doesn't resolve.
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const code = err instanceof Error && 'code' in err ? err.code : undefined;
    const retryable = code === 'ERR_MODULE_NOT_FOUND' || code === 'ERR_UNSUPPORTED_DIR_IMPORT';
    if (!retryable || !specifier.startsWith('.')) throw err;
    for (const suffix of ['.ts', '.js', '/index.ts', '/index.js']) {
      // Candidates must be tried in order and stop at the first hit, so this
      // can't be parallelized with Promise.all.
      // eslint-disable-next-line no-await-in-loop
      const result = await Promise.resolve(nextResolve(specifier + suffix, context)).catch(
        () => null
      );
      if (result) return result;
    }
    throw err;
  }
}

/** @type {import('node:module').LoadHook} */
export async function load(url, context, nextLoad) {
  if (url.startsWith('asset-stub:')) {
    return { format: 'module', source: 'export default "";', shortCircuit: true };
  }
  return nextLoad(url, context);
}
