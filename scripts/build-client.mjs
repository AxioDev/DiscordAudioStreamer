import { build } from 'esbuild';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import Critters from 'critters';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const assetsDir = path.join(publicDir, 'assets');
const jsOutDir = assetsDir;
const cssOutDir = path.join(assetsDir, 'css');
const fontsOutDir = path.join(assetsDir, 'fonts');
const mediaOutDir = path.join(assetsDir, 'media');
const htmlTemplatePath = path.join(publicDir, 'index.html');

const tailwindInput = path.join(rootDir, 'web', 'styles', 'app.css');
const tailwindConfig = path.join(rootDir, 'tailwind.config.cjs');

const rasterExtensions = new Set(['.png', '.jpg', '.jpeg']);
const skipDirectories = new Set(['assets', 'scripts', 'styles']);
const preconnectOrigins = (process.env.PRECONNECT_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const fontSources = [
  {
    source: path.join(rootDir, 'node_modules', '@fontsource-variable', 'inter', 'files', 'inter-latin-wght-normal.woff2'),
    fileName: 'inter-latin-wght-normal.woff2',
    type: 'font/woff2',
  },
];

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

async function rimraf(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
}

function getBinaryPath(command) {
  const suffix = process.platform === 'win32' ? '.cmd' : '';
  return path.join(rootDir, 'node_modules', '.bin', `${command}${suffix}`);
}

async function runTailwind(outputFile) {
  const tailwindBin = getBinaryPath('tailwindcss');
  const args = ['-i', tailwindInput, '-o', outputFile, '--minify'];
  if (await fileExists(tailwindConfig)) {
    args.unshift('-c', tailwindConfig);
  }

  await spawnAsync(tailwindBin, args, { stdio: 'inherit' });
}

async function spawnAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

async function hashFile(filePath) {
  const data = await fs.readFile(filePath);
  return createHash('sha256').update(data).digest('hex').slice(0, 10);
}

function sanitizeFileStem(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

async function walkForImages(directory, results) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (skipDirectories.has(entry.name)) {
        continue;
      }
      await walkForImages(entryPath, results);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!rasterExtensions.has(extension)) {
      continue;
    }

    const relative = path.relative(publicDir, entryPath);
    if (relative.startsWith('..')) {
      continue;
    }

    results.push({ absolute: entryPath, relative });
  }
}

async function collectRasterImages() {
  const results = [];
  if (!(await fileExists(publicDir))) {
    return results;
  }
  await walkForImages(publicDir, results);
  return results;
}

async function optimizeRasterImages() {
  const files = await collectRasterImages();
  if (files.length === 0) {
    return [];
  }

  await ensureDir(mediaOutDir);
  const optimized = [];

  for (const file of files) {
    try {
      const inputBuffer = await fs.readFile(file.absolute);
      const hash = createHash('sha256').update(inputBuffer).digest('hex').slice(0, 10);
      const stem = sanitizeFileStem(path.basename(file.relative, path.extname(file.relative))) || 'asset';
      const baseName = `${stem}-${hash}`;

      const webpName = `${baseName}.webp`;
      const avifName = `${baseName}.avif`;
      const webpPath = path.join(mediaOutDir, webpName);
      const avifPath = path.join(mediaOutDir, avifName);

      await sharp(inputBuffer)
        .webp({ effort: 5, quality: 82 })
        .toFile(webpPath);

      await sharp(inputBuffer)
        .avif({ effort: 4, quality: 50 })
        .toFile(avifPath);

      optimized.push({
        source: `/${toPosixPath(file.relative)}`,
        webp: `/assets/media/${webpName}`,
        avif: `/assets/media/${avifName}`,
      });
    } catch (error) {
      console.warn(`[build-client] Failed to optimise image ${file.relative}`, error);
    }
  }

  return optimized;
}

async function generateCriticalCss(cssHref) {
  try {
    const template = await fs.readFile(htmlTemplatePath, 'utf8');
    const placeholderHtml = template.replace(
      '<!--ASSET_STYLES-->',
      `<link rel="stylesheet" href="${cssHref}" />`,
    );

    const critters = new Critters({
      path: publicDir,
      publicPath: '/',
      inlineThreshold: 0,
      preload: 'swap',
      pruneSource: false,
      reduceInlineStyles: true,
      inlineFonts: true,
    });

    const processed = await critters.process(placeholderHtml);
    const match = processed.match(/<style[^>]*data-critical[^>]*>([\s\S]*?)<\/style>/i);
    if (match && typeof match[1] === 'string') {
      return match[1].trim();
    }
  } catch (error) {
    console.warn('[build-client] Failed to generate critical CSS', error);
  }
  return '';
}

function buildPreconnectDescriptors() {
  return preconnectOrigins.map((href) => ({
    href,
    crossorigin: href.startsWith('http') ? 'anonymous' : undefined,
  }));
}

async function copyFonts() {
  const preloads = [];
  await ensureDir(fontsOutDir);

  for (const font of fontSources) {
    if (!(await fileExists(font.source))) {
      throw new Error(`Font source missing: ${font.source}`);
    }
    const destination = path.join(fontsOutDir, font.fileName);
    await fs.copyFile(font.source, destination);
    preloads.push({
      href: `/assets/fonts/${font.fileName}`,
      as: 'font',
      type: font.type,
      crossorigin: 'anonymous',
    });
  }

  return preloads;
}

async function buildClient() {
  await ensureDir(publicDir);
  await rimraf(assetsDir);
  await ensureDir(jsOutDir);

  const result = await build({
    entryPoints: [
      path.join(publicDir, 'scripts', 'main.js'),
      path.join(publicDir, 'scripts', 'admin.tsx'),
    ],
    outdir: jsOutDir,
    format: 'esm',
    bundle: true,
    splitting: true,
    sourcemap: false,
    minify: true,
    target: ['es2020'],
    entryNames: 'js/[name].min.[hash]',
    chunkNames: 'js/[name].chunk.[hash]',
    assetNames: 'media/[name]-[hash]',
    treeShaking: true,
    metafile: true,
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    loader: {
      '.ts': 'ts',
      '.tsx': 'tsx',
    },
    jsx: 'automatic',
    jsxImportSource: 'react',
  });

  const scripts = [];
  const entryScripts = {};
  for (const [outputPath, metadata] of Object.entries(result.metafile.outputs)) {
    if (!metadata.entryPoint) {
      continue;
    }
    const relative = toPosixPath(path.relative(publicDir, path.join(rootDir, outputPath)));
    const entryName = path.basename(metadata.entryPoint, path.extname(metadata.entryPoint));
    const descriptor = { src: `/${relative}`, type: 'module', defer: true };
    entryScripts[entryName] = descriptor;
    if (entryName === 'main') {
      scripts.push(descriptor);
    }
  }

  if (scripts.length === 0) {
    const fallbackEntry = Object.values(entryScripts)[0];
    if (fallbackEntry) {
      scripts.push(fallbackEntry);
    }
  }

  if (scripts.length === 0) {
    throw new Error('Failed to locate main entry in build output.');
  }

  await ensureDir(cssOutDir);
  const cssTempPath = path.join(cssOutDir, 'app.css');
  await runTailwind(cssTempPath);
  const cssHash = await hashFile(cssTempPath);
  const cssFileName = `app.min.${cssHash}.css`;
  const cssFinalPath = path.join(cssOutDir, cssFileName);
  await fs.rename(cssTempPath, cssFinalPath);

  const cssPublicPath = `/assets/css/${cssFileName}`;
  const styles = [{ href: cssPublicPath, rel: 'stylesheet' }];

  const [fontPreloads, optimizedImages] = await Promise.all([
    copyFonts(),
    optimizeRasterImages(),
  ]);

  const scriptPreloads = scripts.map((script) => {
    if (!script || typeof script.src !== 'string') {
      return null;
    }
    const rel = script.type === 'module' ? 'modulepreload' : 'preload';
    const descriptor = { href: script.src, rel };
    if (rel !== 'modulepreload') {
      descriptor.as = 'script';
    }
    return descriptor;
  });

  const tentativePreloads = [
    ...fontPreloads,
    { href: cssPublicPath, rel: 'preload', as: 'style' },
    ...scriptPreloads,
  ];

  const seenPreloads = new Set();
  const preloads = tentativePreloads
    .filter((entry) => entry && typeof entry.href === 'string')
    .map((entry) => ({ ...entry, href: entry.href.trim() }))
    .filter((entry) => {
      if (!entry.href) {
        return false;
      }
      const key = `${entry.rel ?? 'preload'}::${entry.href}::${entry.as ?? ''}`;
      if (seenPreloads.has(key)) {
        return false;
      }
      seenPreloads.add(key);
      return true;
    });

  const criticalCss = await generateCriticalCss(cssPublicPath);
  const preconnects = buildPreconnectDescriptors();

  const manifest = {
    generatedAt: new Date().toISOString(),
    scripts,
    styles,
    preloads,
    preconnects,
    entries: entryScripts,
    criticalCss: criticalCss || undefined,
    images: optimizedImages,
  };

  const manifestPath = path.join(assetsDir, 'manifest.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

try {
  await buildClient();
} catch (error) {
  console.error('[build-client] Failed to build frontend assets:', error);
  process.exitCode = 1;
}
