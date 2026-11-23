// modules/markdown.js — Dependency-free, XSS-safe Markdown renderer for API output.
// Safety model: every piece of text is HTML-escaped BEFORE any HTML tag is added,
// and links are emitted ONLY for http(s) URLs. Raw HTML tags in LLM output are
// rendered harmlessly as escaped text, never parsed into DOM elements.

const ESC_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ESC_MAP[ch]);
}

function inlineEmphasis(escaped) {
  return escaped
    .replace(/\*\*(?=\S)([^*]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)(.*?\S)__(?![\w])/g, '$1<strong>$2</strong>')
    .replace(/~~(?=\S)(.*?\S)~~/g, '<del>$1</del>')
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_])_(?![\w])/g, '$1<em>$2</em>');
}

function renderInline(src) {
  const slots = [];
  const hold = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = String(src ?? '');

  // Inline code spans first so emphasis/links cannot touch code contents.
  s = s.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`));

  // Markdown links [label](url) — strictly allow only http:// and https:// URLs,
  // including one level of balanced parentheses (e.g. Wikipedia URLs).
  s = s.replace(/\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (whole, label, url) => {
    if (!/^https?:\/\//i.test(url)) return whole;
    const safeUrl = escapeHtml(url);
    const safeLabel = inlineEmphasis(escapeHtml(label));
    return hold(`<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`);
  });

  // Bare http(s) URLs (allow balanced parentheses inside URLs, strip trailing punctuation).
  s = s.replace(
    /\bhttps?:\/\/(?:[^\s<>()\u0000]|\([^\s<>()\u0000]*\))*(?:[^\s<>()\u0000.,;:!?'"]|\([^\s<>()\u0000]*\))/g,
    (url) => hold(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`)
  );

  s = inlineEmphasis(escapeHtml(s));
  return s.replace(/\u0000(\d+)\u0000/g, (_, idx) => slots[Number(idx)]);
}

const RE = {
  fence: /^\s{0,3}(```|~~~)\s*([\w+-]*)\s*$/,
  heading: /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/,
  hr: /^\s{0,3}([-*_])(\s*\1){2,}\s*$/,
  quote: /^\s{0,3}>\s?(.*)$/,
  item: /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/,
  tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
};

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());

function renderList(lines) {
  let html = '';
  const stack = [];
  for (const line of lines) {
    const match = RE.item.exec(line);
    if (!match) continue;
    const [, ws, marker, body] = match;
    const indent = ws.replace(/\t/g, '    ').length;
    const tag = /\d/.test(marker) ? 'ol' : 'ul';

    while (stack.length && indent < stack[stack.length - 1].indent) {
      html += `</li></${stack.pop().tag}>`;
    }
    const top = stack[stack.length - 1];
    if (!top || indent > top.indent) {
      const startNum = tag === 'ol' ? parseInt(marker, 10) : 1;
      const startAttr = tag === 'ol' && startNum !== 1 ? ` start="${startNum}"` : '';
      html += `<${tag}${startAttr}>`;
      stack.push({ indent, tag });
    } else if (top.tag !== tag) {
      html += `</li></${stack.pop().tag}><${tag}>`;
      stack.push({ indent, tag });
    } else {
      html += '</li>';
    }
    html += `<li>${renderInline(body)}`;
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}

export function renderMarkdown(text) {
  if (!text) return '';
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(renderInline).join('<br>')}</p>`);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.trim()) {
      flushPara();
      continue;
    }

    const fence = RE.fence.exec(line);
    if (fence) {
      flushPara();
      const body = [];
      const closeRe = new RegExp(`^\\s{0,3}${fence[1]}\\s*$`);
      for (i++; i < lines.length && !closeRe.test(lines[i]); i++) {
        body.push(lines[i]);
      }
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = RE.heading.exec(line);
    if (heading) {
      flushPara();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    if (RE.hr.test(line)) {
      flushPara();
      out.push('<hr>');
      continue;
    }

    if (RE.quote.test(line)) {
      flushPara();
      const body = [];
      while (i < lines.length && RE.quote.test(lines[i])) {
        body.push(RE.quote.exec(lines[i++])[1]);
      }
      i--;
      out.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`);
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
      flushPara();
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i++]));
      }
      i--;
      const thead = '<thead><tr>' + head.map((c) => `<th>${renderInline(c)}</th>`).join('') + '</tr></thead>';
      const tbody =
        '<tbody>' +
        rows
          .map((r) => '<tr>' + head.map((_, idx) => `<td>${renderInline(r[idx] ?? '')}</td>`).join('') + '</tr>')
          .join('') +
        '</tbody>';
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    if (RE.item.test(line)) {
      flushPara();
      const block = [];
      while (i < lines.length) {
        const cur = lines[i];
        if (RE.item.test(cur)) {
          block.push(cur);
          i++;
          continue;
        }
        if (!cur.trim() && i + 1 < lines.length && RE.item.test(lines[i + 1])) {
          i++;
          continue;
        }
        if (cur.trim() && /^\s{2,}/.test(cur) && block.length) {
          block[block.length - 1] += ' ' + cur.trim();
          i++;
          continue;
        }
        break;
      }
      i--;
      out.push(renderList(block));
      continue;
    }

    para.push(line.trim());
  }

  flushPara();
  return out.join('\n');
}
