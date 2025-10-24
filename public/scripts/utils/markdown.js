import { Marked, Renderer } from 'marked';

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderer = new Renderer();

renderer.link = (href, title, text) => {
  const safeHref = typeof href === 'string' ? href.trim() : '';
  const safeTitle = typeof title === 'string' ? title.trim() : '';
  const titleAttribute = safeTitle ? ` title="${escapeHtml(safeTitle)}"` : '';
  const hrefAttribute = safeHref ? ` href="${escapeHtml(safeHref)}"` : '';
  return `<a${hrefAttribute}${titleAttribute}>${text}</a>`;
};

renderer.code = (code, infostring) => {
  const info = typeof infostring === 'string' ? infostring.trim() : '';
  const normalized = info.toLowerCase();
  const language = /^[a-z0-9+#.-]{1,30}$/i.test(normalized) ? normalized : '';
  const classAttribute = language ? ` class="language-${escapeHtml(language)}"` : '';
  return `<pre><code${classAttribute}>${escapeHtml(code ?? '')}</code></pre>`;
};

renderer.codespan = (code) => `<code>${escapeHtml(code ?? '')}</code>`;
renderer.paragraph = (text) => `<p>${text}</p>`;
renderer.blockquote = (quote) => `<blockquote>${quote}</blockquote>`;
renderer.strong = (text) => `<strong>${text}</strong>`;
renderer.em = (text) => `<em>${text}</em>`;
renderer.del = (text) => `<del>${text}</del>`;
renderer.br = () => '<br />';
renderer.hr = () => '<hr />';
renderer.list = (body, ordered, start) => {
  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && start && start !== 1 ? ` start="${start}"` : '';
  return `<${tag}${startAttr}>${body}</${tag}>`;
};
renderer.listitem = (text) => `<li>${text}</li>`;
renderer.heading = (text, level) => {
  const clamped = Math.min(Math.max(level, 1), 3);
  return `<h${clamped}>${text}</h${clamped}>`;
};
renderer.table = () => '';
renderer.tablerow = () => '';
renderer.tablecell = () => '';
renderer.image = () => '';
renderer.html = () => '';

const markedInstance = new Marked({
  gfm: true,
  breaks: true,
  smartypants: true,
  headerIds: false,
  mangle: false,
  renderer,
});

const allowedTags = new Set([
  'P',
  'BR',
  'EM',
  'STRONG',
  'DEL',
  'A',
  'UL',
  'OL',
  'LI',
  'PRE',
  'CODE',
  'BLOCKQUOTE',
  'H1',
  'H2',
  'H3',
  'HR',
]);

const allowedAttributes = new Map([
  ['A', new Set(['href', 'title'])],
  ['CODE', new Set(['class'])],
  ['OL', new Set(['start'])],
]);

const allowedProtocols = new Set(['http:', 'https:', 'mailto:']);

const sanitizeAttributes = (element) => {
  const tagName = element.tagName;
  const allowed = allowedAttributes.get(tagName) ?? new Set();
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (!allowed.has(name)) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (tagName === 'A' && name === 'href') {
      const hrefValue = attribute.value.trim();
      if (!hrefValue) {
        element.removeAttribute('href');
        continue;
      }

      let url;
      try {
        url = new URL(hrefValue, typeof window !== 'undefined' ? window.location?.origin ?? '' : 'http://localhost');
      } catch (error) {
        element.replaceWith(element.ownerDocument.createTextNode(element.textContent ?? ''));
        return;
      }

      if (!allowedProtocols.has(url.protocol)) {
        element.replaceWith(element.ownerDocument.createTextNode(element.textContent ?? ''));
        return;
      }

      element.setAttribute('href', url.href);
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer nofollow');
    }

    if (tagName === 'A' && name === 'title') {
      element.setAttribute('title', attribute.value.trim());
    }

    if (tagName === 'CODE' && name === 'class') {
      const className = attribute.value.trim();
      if (!/^language-[a-z0-9+#.-]{1,30}$/i.test(className)) {
        element.removeAttribute('class');
      }
    }

    if (tagName === 'OL' && name === 'start') {
      const numericStart = Number.parseInt(attribute.value, 10);
      if (!Number.isFinite(numericStart) || numericStart < 1) {
        element.removeAttribute('start');
      } else {
        element.setAttribute('start', String(numericStart));
      }
    }
  }
};

const sanitizeNode = (node) => {
  if (!node) {
    return;
  }

  if (node.nodeType === Node.COMMENT_NODE) {
    node.remove();
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }

  const element = node;
  if (!allowedTags.has(element.tagName)) {
    const parent = element.parentNode;
    if (!parent) {
      element.remove();
      return;
    }

    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }
    parent.removeChild(element);
    return;
  }

  sanitizeAttributes(element);

  for (const child of Array.from(element.childNodes)) {
    sanitizeNode(child);
  }
};

const sanitizeHtml = (html) => {
  if (typeof document === 'undefined') {
    return escapeHtml(html);
  }

  const container = document.createElement('div');
  container.innerHTML = html;

  for (const child of Array.from(container.childNodes)) {
    sanitizeNode(child);
  }

  const sanitized = container.innerHTML.trim();
  return sanitized || escapeHtml(container.textContent ?? '');
};

export const renderMarkdown = (markdown) => {
  if (typeof markdown !== 'string') {
    return '';
  }

  const trimmed = markdown.trim();
  if (!trimmed) {
    return '';
  }

  let rawHtml = '';
  try {
    rawHtml = markedInstance.parse(trimmed, { async: false });
  } catch (error) {
    console.warn('renderMarkdown: failed to parse markdown', error);
    return escapeHtml(trimmed);
  }

  const sanitized = sanitizeHtml(rawHtml);
  return sanitized || escapeHtml(trimmed);
};

