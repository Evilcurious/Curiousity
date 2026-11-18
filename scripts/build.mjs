import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');

export async function buildWeb({ watch = false } = {}) {
  if (!watch) rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  cpSync(join(root, 'public'), dist, { recursive: true, force: true });
  const options = {
    absWorkingDir: root,
    entryPoints: ['src/main.jsx'],
    outdir: join(dist, 'assets'),
    entryNames: 'clipforge-[hash]',
    assetNames: '[name]-[hash]',
    publicPath: '/assets',
    bundle: true,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
    target: ['es2022'],
    loader: { '.woff': 'file', '.woff2': 'file' },
    external: ['/images/*'],
    minify: !watch,
    legalComments: 'linked',
    metafile: true,
    plugins: [{
      name: 'clipforge-html',
      setup(builder) {
        builder.onEnd((result) => {
          if (result.errors.length) return;
          const [script, spec] = Object.entries(result.metafile.outputs).find(([, file]) => file.entryPoint === 'src/main.jsx');
          const css = spec.cssBundle ? `  <link rel="stylesheet" href="/assets/${basename(spec.cssBundle)}" />\n  ` : '';
          const html = readFileSync(join(root, 'index.html'), 'utf8')
            .replace('</head>', `${css}</head>`)
            .replace('/src/main.jsx', `/assets/${basename(script)}`);
          writeFileSync(join(dist, 'index.html.tmp'), html);
          renameSync(join(dist, 'index.html.tmp'), join(dist, 'index.html'));
        });
      },
    }],
  };
  if (watch) {
    const watcher = await context(options);
    await watcher.rebuild();
    await watcher.watch();
    return watcher;
  }
  await build(options);
  console.log('Built Clipforge into dist/.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await buildWeb();
