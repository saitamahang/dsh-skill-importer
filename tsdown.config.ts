/**
 * tsdown config for the dsh-skill-importer plugin.
 *
 * Emits two artifacts:
 * - `lib/index.js`   — the Node half (an empty host plugin; the package must
 *   be a resolvable Cordis row for the host Loader).
 * - `lib/client.js`  — the browser bundle. Follows the repository's client
 *   bundle contract (`packages/client/tsdown.client.ts`): a closure factory
 *   handed to `window.__ModuleLoader__.load({ id, factory })` whose externals
 *   resolve through the loader's module table (platform seed modules plus
 *   every `dsh.client` package the web profile composes).
 *
 * Everything not listed below is inlined into the bundle, so the plugin must
 * not value-import cross-plugin packages outside the loader table.
 */

const ID = 'dsh-skill-importer'

/** Platform seed modules (apps/web platform.ts) plus the loader-table packages this plugin requires. */
const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-api-remotes',
]

export default [
  {
    name: ID,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    // Keep the .js filename the package.json main points at (type: module).
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    name: `${ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    // Types ship from lib/types (tsc); dts here would wrap the banner/footer into .d.cts.
    dts: false,
    sourcemap: true,
    clean: false,
    external: EXTERNALS,
    noExternal: (id: string) => (EXTERNALS.includes(id) ? undefined : true),
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]
