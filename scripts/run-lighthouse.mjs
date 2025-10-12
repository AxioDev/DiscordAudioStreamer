import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const reportsDir = path.join(rootDir, 'docs', 'performance');
const rawDir = path.join(reportsDir, 'raw');
const staticDir = path.join(reportsDir, 'static');
const manifestPath = path.join(publicDir, 'assets', 'manifest.json');
const configPath = path.join(rootDir, 'lighthouserc.json');
const summaryPath = path.join(reportsDir, 'lighthouse-summary.md');
const reportPath = path.join(reportsDir, 'lighthouse-report.json');

const SKIP_ENV = process.env.SKIP_LIGHTHOUSE ?? process.env.LIGHTHOUSE_SKIP ?? '';
const shouldSkipEnv = ['1', 'true', 'yes'].includes(SKIP_ENV.trim().toLowerCase());

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function rimraf(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
}

function getBinaryPath(command) {
  const suffix = process.platform === 'win32' ? '.cmd' : '';
  return path.join(rootDir, 'node_modules', '.bin', `${command}${suffix}`);
}

async function spawnAsync(command, args, options = {}) {
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

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectChromeBinary() {
  const envCandidates = [
    process.env.LIGHTHOUSE_CHROMIUM_PATH,
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_SHIM,
  ].filter((entry) => typeof entry === 'string' && entry.trim().length > 0);

  for (const candidate of envCandidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  const platformCandidates =
    process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/chromium-browser',
          '/usr/bin/chromium',
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        ];

  for (const candidate of platformCandidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function buildPreconnectTags(manifest) {
  if (!Array.isArray(manifest?.preconnects) || manifest.preconnects.length === 0) {
    return '';
  }
  const lines = [];
  for (const entry of manifest.preconnects) {
    if (!entry || typeof entry.href !== 'string') {
      continue;
    }
    const href = entry.href.trim();
    if (!href) {
      continue;
    }
    const attrs = [
      ['rel', 'preconnect'],
      ['href', href],
    ];
    if (entry.crossorigin) {
      attrs.push(['crossorigin', entry.crossorigin]);
    }
    lines.push(`    <link ${formatHtmlAttributes(attrs)} />`);
  }
  return lines.join('\n');
}

function buildPreloadTags(manifest) {
  if (!Array.isArray(manifest?.preloads) || manifest.preloads.length === 0) {
    return '';
  }
  const lines = [];
  for (const entry of manifest.preloads) {
    if (!entry || typeof entry.href !== 'string') {
      continue;
    }
    const rel = (entry.rel ?? 'preload').trim() || 'preload';
    const attrs = [
      ['rel', rel],
      ['href', entry.href],
    ];
    if (entry.as) {
      attrs.push(['as', entry.as]);
    }
    if (entry.type) {
      attrs.push(['type', entry.type]);
    }
    if (entry.crossorigin) {
      attrs.push(['crossorigin', entry.crossorigin]);
    }
    if (entry.media) {
      attrs.push(['media', entry.media]);
    }
    lines.push(`    <link ${formatHtmlAttributes(attrs)} />`);
  }
  return lines.join('\n');
}

function buildStyleTags(manifest) {
  if (!Array.isArray(manifest?.styles) || manifest.styles.length === 0) {
    return '';
  }
  const lines = [];
  if (typeof manifest.criticalCss === 'string' && manifest.criticalCss.trim().length > 0) {
    lines.push(`    <style data-critical="true">${manifest.criticalCss.trim()}</style>`);
  }
  for (const entry of manifest.styles) {
    if (!entry || typeof entry.href !== 'string') {
      continue;
    }
    const rel = (entry.rel ?? 'stylesheet').trim() || 'stylesheet';
    const attrs = [
      ['rel', rel],
      ['href', entry.href],
    ];
    if (entry.media) {
      attrs.push(['media', entry.media]);
    }
    if (entry.crossorigin) {
      attrs.push(['crossorigin', entry.crossorigin]);
    }
    if (entry.integrity) {
      attrs.push(['integrity', entry.integrity]);
    }
    lines.push(`    <link ${formatHtmlAttributes(attrs)} />`);
  }
  return lines.join('\n');
}

function buildScriptTags(manifest) {
  if (!Array.isArray(manifest?.scripts) || manifest.scripts.length === 0) {
    return '';
  }
  const lines = [];
  for (const entry of manifest.scripts) {
    if (!entry || typeof entry.src !== 'string') {
      continue;
    }
    const attrs = [
      ['type', (entry.type ?? 'module').trim() || 'module'],
      ['src', entry.src],
    ];
    if (entry.defer) {
      attrs.push(['defer', true]);
    }
    if (entry.async) {
      attrs.push(['async', true]);
    }
    if (entry.crossorigin) {
      attrs.push(['crossorigin', entry.crossorigin]);
    }
    if (entry.integrity) {
      attrs.push(['integrity', entry.integrity]);
    }
    lines.push(`    <script ${formatHtmlAttributes(attrs)}></script>`);
  }
  return lines.join('\n');
}

function formatHtmlAttributes(attributes) {
  return attributes
    .map(([key, value]) => {
      const trimmedKey = key.trim();
      if (!trimmedKey) {
        return null;
      }
      if (value === true) {
        return trimmedKey;
      }
      const trimmedValue = typeof value === 'string' ? value.trim() : '';
      if (!trimmedValue) {
        return trimmedKey;
      }
      return `${trimmedKey}="${escapeHtml(trimmedValue)}"`;
    })
    .filter((entry) => Boolean(entry))
    .join(' ');
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function stripFallbackAssets(html, { removeStyles, removeScripts, removeImportMap }) {
  let result = html;
  if (removeImportMap) {
    result = result.replace(/[\t ]*<script[^>]*data-fallback-importmap[^>]*>[\s\S]*?<\/script>(?:\r?\n)?/gi, '');
  }
  if (removeStyles) {
    result = result.replace(/[\t ]*<link[^>]*data-fallback-style[^>]*\/?>(?:\r?\n)?/gi, '');
  }
  if (removeScripts) {
    result = result.replace(/[\t ]*<script[^>]*data-fallback-script[^>]*><\/script>(?:\r?\n)?/gi, '');
  }
  return result;
}

function applyManifestToHtml(html, manifest) {
  if (!manifest || typeof html !== 'string') {
    return html;
  }
  const replacements = {
    '<!--ASSET_PRECONNECTS-->': buildPreconnectTags(manifest),
    '<!--ASSET_PRELOADS-->': buildPreloadTags(manifest),
    '<!--ASSET_STYLES-->': buildStyleTags(manifest),
    '<!--ASSET_SCRIPTS-->': buildScriptTags(manifest),
  };

  let result = html;
  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.replace(placeholder, value);
  }

  const removeStyles = (replacements['<!--ASSET_STYLES-->'] ?? '').trim().length > 0;
  const removeScripts = (replacements['<!--ASSET_SCRIPTS-->'] ?? '').trim().length > 0;
  const cleaned = stripFallbackAssets(result, {
    removeStyles,
    removeScripts,
    removeImportMap: removeScripts,
  });

  return cleaned;
}

async function prepareStaticCopy() {
  await rimraf(staticDir);
  await ensureDir(staticDir);
  await fs.cp(publicDir, staticDir, { recursive: true });

  if (!(await fileExists(manifestPath))) {
    return;
  }

  const raw = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);

  const indexPath = path.join(staticDir, 'index.html');
  if (await fileExists(indexPath)) {
    const html = await fs.readFile(indexPath, 'utf8');
    const rendered = applyManifestToHtml(html, manifest);
    await fs.writeFile(indexPath, `${rendered}\n`, 'utf8');
  }

  const offlinePath = path.join(staticDir, 'offline.html');
  if (await fileExists(offlinePath)) {
    const html = await fs.readFile(offlinePath, 'utf8');
    const rendered = applyManifestToHtml(html, manifest);
    await fs.writeFile(offlinePath, `${rendered}\n`, 'utf8');
  }
}

async function runLighthouseAudits(chromePath) {
  const lhciBin = getBinaryPath('lhci');
  const runs = [
    {
      label: 'desktop',
      preset: 'desktop',
      formFactor: 'desktop',
      throttlingMethod: 'devtools',
    },
    {
      label: 'mobile',
      preset: 'mobile',
      formFactor: 'mobile',
      throttlingMethod: 'simulate',
    },
  ];

  for (const run of runs) {
    const outputDir = path.join(rawDir, run.label);
    await ensureDir(outputDir);
    const args = [
      'autorun',
      '--config', configPath,
      `--collect.settings.preset=${run.preset}`,
      `--collect.settings.formFactor=${run.formFactor}`,
      `--collect.settings.emulatedFormFactor=${run.formFactor}`,
      `--collect.settings.screenEmulation.mobile=${run.formFactor === 'mobile' ? 'true' : 'false'}`,
      `--collect.settings.throttlingMethod=${run.throttlingMethod}`,
      `--collect.numberOfRuns=1`,
      `--upload.outputDir=${outputDir}`,
      '--upload.target=filesystem',
    ];

    if (chromePath) {
      args.push('--collect.chromePath', chromePath);
    }

    await spawnAsync(lhciBin, args, {
      cwd: rootDir,
      stdio: 'inherit',
      env: { ...process.env, LIGHTHOUSE_STRICT_NETWORK: '0' },
    });
  }
}

function formatMs(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} s`;
  }
  return `${Math.round(value)} ms`;
}

function formatCls(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  return value.toFixed(3);
}

function formatScore(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  return `${Math.round(value)}`;
}

function extractAuditValue(lhr, auditId) {
  const audit = lhr?.audits?.[auditId];
  const numeric = audit && typeof audit.numericValue === 'number' ? audit.numericValue : null;
  return Number.isFinite(numeric) ? numeric : null;
}

async function loadRunResults(label) {
  const directory = path.join(rawDir, label);
  if (!(await fileExists(directory))) {
    return [];
  }
  const entries = await fs.readdir(directory);
  const results = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json') || !entry.startsWith('lhr-')) {
      continue;
    }
    const filePath = path.join(directory, entry);
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const lhr = raw?.lhr ?? raw;
    if (!lhr || typeof lhr !== 'object') {
      continue;
    }
    const categories = lhr.categories ?? {};
    const performanceRaw = categories.performance?.score;
    const accessibilityRaw = categories.accessibility?.score;
    const bestPracticesRaw = categories['best-practices']?.score;
    const seoRaw = categories.seo?.score;

    const performanceScore = typeof performanceRaw === 'number' ? performanceRaw * 100 : null;
    const accessibilityScore = typeof accessibilityRaw === 'number' ? accessibilityRaw * 100 : null;
    const bestPracticesScore = typeof bestPracticesRaw === 'number' ? bestPracticesRaw * 100 : null;
    const seoScore = typeof seoRaw === 'number' ? seoRaw * 100 : null;

    const lcp = extractAuditValue(lhr, 'largest-contentful-paint');
    const tbt = extractAuditValue(lhr, 'total-blocking-time');
    const tti = extractAuditValue(lhr, 'interactive');
    const cls = extractAuditValue(lhr, 'cumulative-layout-shift');

    results.push({
      mode: label,
      url: lhr.finalUrl ?? lhr.requestedUrl ?? '',
      scores: {
        performance: performanceScore,
        accessibility: accessibilityScore,
        bestPractices: bestPracticesScore,
        seo: seoScore,
      },
      metrics: {
        lcpMs: lcp,
        tbtMs: tbt,
        ttiMs: tti,
        cls,
      },
    });
  }
  return results;
}

function buildSummaryMarkdown(report) {
  if (!report || !Array.isArray(report.results) || report.results.length === 0) {
    return [
      '# Lighthouse Performance Summary',
      '',
      '_No Lighthouse audits were executed._',
      '',
    ].join('\n');
  }

  const lines = [
    '# Lighthouse Performance Summary',
    '',
    `Generated at: ${report.generatedAt}`,
    '',
    '| Mode | URL | Performance | Accessibility | Best Practices | SEO | LCP | TBT | TTI | CLS |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const entry of report.results) {
    const urlCell = entry.url ? entry.url : 'n/a';
    lines.push(
      `| ${entry.mode} | ${urlCell} | ${formatScore(entry.scores.performance)} | ${formatScore(
        entry.scores.accessibility,
      )} | ${formatScore(entry.scores.bestPractices)} | ${formatScore(entry.scores.seo)} | ${formatMs(
        entry.metrics.lcpMs,
      )} | ${formatMs(entry.metrics.tbtMs)} | ${formatMs(entry.metrics.ttiMs)} | ${formatCls(
        entry.metrics.cls,
      )} |`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

async function writeReportOutputs(report) {
  await ensureDir(reportsDir);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(summaryPath, `${buildSummaryMarkdown(report)}\n`, 'utf8');
}

async function writeSkipOutputs(reason) {
  const payload = {
    status: 'skipped',
    reason,
    generatedAt: new Date().toISOString(),
  };
  await ensureDir(reportsDir);
  await fs.writeFile(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  const markdown = ['# Lighthouse Performance Summary', '', `Audit skipped: ${reason}.`, ''].join('\n');
  await fs.writeFile(summaryPath, `${markdown}\n`, 'utf8');
}

const CATEGORY_THRESHOLDS = {
  performance: { label: 'Performance', minimum: 95, level: 'error' },
  accessibility: { label: 'Accessibility', minimum: 95, level: 'warn' },
  bestPractices: { label: 'Best Practices', minimum: 95, level: 'warn' },
  seo: { label: 'SEO', minimum: 95, level: 'warn' },
};

class LighthouseValidationError extends Error {
  constructor(messages) {
    const list = Array.isArray(messages) && messages.length > 0 ? messages : ['Unknown validation failure'];
    super(`Lighthouse score requirements not met.\n${list.map((msg) => ` - ${msg}`).join('\n')}`);
    this.name = 'LighthouseValidationError';
    this.messages = list;
  }
}

async function collectReports() {
  const desktop = await loadRunResults('desktop');
  const mobile = await loadRunResults('mobile');
  const all = [...desktop, ...mobile];
  if (all.length === 0) {
    return null;
  }
  return {
    generatedAt: new Date().toISOString(),
    results: all,
  };
}

function evaluateCategoryScores(report) {
  const errors = [];
  const warnings = [];
  if (!report || !Array.isArray(report.results)) {
    return { errors: ['Report did not include any Lighthouse results'], warnings };
  }

  for (const entry of report.results) {
    const location = `${entry.mode} ${entry.url ? `(${entry.url})` : ''}`.trim();
    for (const [key, definition] of Object.entries(CATEGORY_THRESHOLDS)) {
      const score = entry?.scores?.[key];
      if (!Number.isFinite(score)) {
        errors.push(`${definition.label} score missing for ${location || 'unknown run'}`);
        continue;
      }

      if (score < definition.minimum) {
        const message = `${definition.label} score ${score.toFixed(1)} is below the required ${definition.minimum} for ${location || 'unknown run'}`;
        if (definition.level === 'warn') {
          warnings.push(message);
        } else {
          errors.push(message);
        }
      }
    }
  }

  return { errors, warnings };
}

async function cleanupWorkingDirectories() {
  await rimraf(rawDir);
  await rimraf(staticDir);
}

async function main() {
  await ensureDir(reportsDir);
  if (shouldSkipEnv) {
    await writeSkipOutputs('Skipped via SKIP_LIGHTHOUSE flag');
    return;
  }

  const chromePath = await detectChromeBinary();
  if (!chromePath) {
    await writeSkipOutputs('No Chromium/Chrome binary available for Lighthouse audits');
    return;
  }

  await rimraf(rawDir);
  await rimraf(staticDir);
  await ensureDir(rawDir);
  await prepareStaticCopy();

  try {
    await runLighthouseAudits(chromePath);
    const report = await collectReports();
    if (!report) {
      await writeSkipOutputs('Lighthouse produced no usable reports');
      return;
    }

    const { errors, warnings } = evaluateCategoryScores(report);
    for (const warning of warnings) {
      console.warn(`[run-lighthouse] ${warning}`);
    }

    await writeReportOutputs(report);

    if (errors.length > 0) {
      throw new LighthouseValidationError(errors);
    }
  } catch (error) {
    if (error instanceof LighthouseValidationError) {
      throw error;
    }
    await writeSkipOutputs(`Lighthouse execution failed: ${error.message}`);
    throw error;
  } finally {
    await cleanupWorkingDirectories();
  }
}

try {
  await main();
} catch (error) {
  console.error('[run-lighthouse] Failed to generate Lighthouse reports', error);
  process.exitCode = 1;
}
