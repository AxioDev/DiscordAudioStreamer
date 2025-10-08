import { build } from 'esbuild';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const assetsDir = path.join(publicDir, 'assets');
const jsOutDir = assetsDir;
const cssOutDir = path.join(assetsDir, 'css');
const fontsOutDir = path.join(assetsDir, 'fonts');

const tailwindInput = path.join(rootDir, 'web', 'styles', 'app.css');
const tailwindConfig = path.join(rootDir, 'tailwind.config.cjs');

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
    entryNames: 'js/[name]-[hash]',
    chunkNames: 'js/[name]-[hash]',
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
  const cssFileName = `app-${cssHash}.css`;
  const cssFinalPath = path.join(cssOutDir, cssFileName);
  await fs.rename(cssTempPath, cssFinalPath);

  const styles = [{ href: `/assets/css/${cssFileName}`, rel: 'stylesheet' }];
  const preloads = await copyFonts();

  const manifest = {
    scripts,
    styles,
    preloads,
    entries: entryScripts,
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
