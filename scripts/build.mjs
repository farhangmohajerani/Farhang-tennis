#!/usr/bin/env node
/**
 * Build: esbuild (TS/TSX → one JS bundle) + Tailwind v4 compile API (no PostCSS/Vite needed).
 *
 *   node scripts/build.mjs            → dist/ (index.html, app.js, app.css)  — deploy this folder
 *   node scripts/build.mjs --single   → also dist/tennis-progress.html (everything inlined, one file)
 *   node scripts/build.mjs --serve    → dev server on http://localhost:5173 with rebuild on change
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY (optional; enables Supabase auth + persistence).
 */
import * as esbuild from 'esbuild';
import { compile } from 'tailwindcss';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'dist');
const args = new Set(process.argv.slice(2));
const require = createRequire(import.meta.url);
const twDir = path.dirname(require.resolve('tailwindcss/package.json'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function walk(dir, exts, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, acc);
    else if (exts.some((x) => e.name.endsWith(x))) acc.push(p);
  }
  return acc;
}

async function buildCSS() {
  const input = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
  const compiler = await compile(input, {
    base: root,
    loadStylesheet: async (id, base) => {
      let file;
      if (id === 'tailwindcss') file = path.join(twDir, 'index.css');
      else if (id.startsWith('tailwindcss/')) file = path.join(twDir, id.slice('tailwindcss/'.length));
      else file = path.resolve(base, id);
      if (!fs.existsSync(file) && fs.existsSync(file + '.css')) file += '.css';
      return { path: file, base: path.dirname(file), content: fs.readFileSync(file, 'utf8') };
    },
  });
  // Candidate scan (what Tailwind's oxide scanner does): every token-like string in the sources.
  const candidates = new Set();
  for (const f of [...walk(path.join(root, 'src'), ['.tsx', '.ts']), path.join(root, 'index.html')]) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/[^\s"'`{}()<>;,\\]+/g)) candidates.add(m[0]);
  }
  const css = compiler.build([...candidates]);
  const min = await esbuild.transform(css, { loader: 'css', minify: true });
  return min.code;
}

const ignoreCss = {
  name: 'ignore-css',
  setup(b) {
    b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: 'ignore-css' }));
    b.onLoad({ filter: /.*/, namespace: 'ignore-css' }, () => ({ contents: '', loader: 'js' }));
  },
};

const jsOptions = {
  entryPoints: [path.join(root, 'src/main.tsx')],
  bundle: true,
  format: 'iife',
  target: ['es2020', 'safari15'],
  jsx: 'automatic',
  minify: !args.has('--serve'),
  sourcemap: args.has('--serve') ? 'inline' : false,
  outfile: path.join(out, 'app.js'),
  define: {
    'process.env.NODE_ENV': JSON.stringify(args.has('--serve') ? 'development' : 'production'),
    __SUPABASE_URL__: JSON.stringify(process.env.SUPABASE_URL ?? ''),
    __SUPABASE_ANON_KEY__: JSON.stringify(process.env.SUPABASE_ANON_KEY ?? ''),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [ignoreCss],
  logLevel: 'warning',
};

async function writeStatic() {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'app.css'), await buildCSS());
  fs.copyFileSync(path.join(root, 'index.html'), path.join(out, 'index.html'));
}

function writeSingle() {
  const js = fs.readFileSync(path.join(out, 'app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  const css = fs.readFileSync(path.join(out, 'app.css'), 'utf8').replace(/<\/style/gi, '<\\/style');
  const fonts = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&family=Vazirmatn:wght@400;500;600;700&display=swap';
  const html = `<title>Tennis Progress</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="theme-color" content="#0c1f38">
<link rel="stylesheet" href="${fonts}">
<style>${css}</style>
<div id="root"><p style="padding:24px;font:15px system-ui;color:#56677d">Loading Tennis Progress…</p></div>
<script>${js}</script>
`;
  fs.writeFileSync(path.join(out, 'tennis-progress.html'), html);
  return html.length;
}

if (args.has('--serve')) {
  await writeStatic();
  const ctx = await esbuild.context({
    ...jsOptions,
    plugins: [
      ignoreCss,
      { name: 'css-rebuild', setup(b) { b.onEnd(async () => { fs.writeFileSync(path.join(out, 'app.css'), await buildCSS()); }); } },
    ],
  });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: out, port: 5173 });
  console.log(`Dev server: http://localhost:${port}`);
} else {
  const t0 = Date.now();
  await writeStatic();
  await esbuild.build(jsOptions);
  const jsKB = (fs.statSync(path.join(out, 'app.js')).size / 1024).toFixed(0);
  const cssKB = (fs.statSync(path.join(out, 'app.css')).size / 1024).toFixed(0);
  let msg = `Built dist/ in ${Date.now() - t0} ms — app.js ${jsKB} KB, app.css ${cssKB} KB`;
  if (args.has('--single')) msg += `, tennis-progress.html ${(writeSingle() / 1024).toFixed(0)} KB`;
  console.log(msg);
}
