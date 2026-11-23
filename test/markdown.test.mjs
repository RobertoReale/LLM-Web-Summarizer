import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../modules/markdown.js';

test('renders core Markdown blocks and inline formatting cleanly', () => {
  const md = [
    '# Title',
    '',
    'Hello **bold**, *italic*, ~~strike~~, and `code`.',
    '',
    '- Item 1',
    '  - Nested item',
    '- Item 2',
    '',
    '> Quote line',
    '',
    '```js',
    'const x = 1 < 2;',
    '```',
    '',
    '| Col A | Col B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '[Safe Link](https://example.com/page)',
  ].join('\n');

  const html = renderMarkdown(md);
  assert.ok(html.includes('<h1>Title</h1>'));
  assert.ok(html.includes('<strong>bold</strong>'));
  assert.ok(html.includes('<em>italic</em>'));
  assert.ok(html.includes('<del>strike</del>'));
  assert.ok(html.includes('<code>code</code>'));
  assert.ok(html.includes('<ul><li>Item 1<ul><li>Nested item</li></ul></li><li>Item 2</li></ul>'));
  assert.ok(html.includes('<blockquote><p>Quote line</p></blockquote>'));
  assert.ok(html.includes('<pre><code>const x = 1 &lt; 2;</code></pre>'));
  assert.ok(html.includes('<table><thead><tr><th>Col A</th><th>Col B</th></tr></thead>'));
  assert.ok(html.includes('<a href="https://example.com/page" target="_blank" rel="noopener noreferrer">Safe Link</a>'));
});

test('neutralizes raw HTML and XSS payloads completely', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img id="xss-probe" src=x onerror="alert(1)">',
    '<iframe src="https://evil.example"></iframe>',
    '<svg onload="alert(1)">',
    '[Click me](javascript:alert(1))',
    '[Data link](data:text/html,<script>alert(1)</script>)',
    '**bold <img src=x onerror=alert(1)>**',
  ];

  for (const input of payloads) {
    const html = renderMarkdown(input);
    assert.ok(!/<script\b/i.test(html), `Unescaped <script> in: ${html}`);
    assert.ok(!/<img\b/i.test(html), `Unescaped <img> in: ${html}`);
    assert.ok(!/<iframe\b/i.test(html), `Unescaped <iframe> in: ${html}`);
    assert.ok(!/<svg\b/i.test(html), `Unescaped <svg> in: ${html}`);
    assert.ok(!/href\s*=\s*["']\s*(javascript|data):/i.test(html), `Dangerous href in: ${html}`);
    assert.ok(!/\sonerror=/i.test(html) || html.includes('&lt;img'), `Raw event handler in: ${html}`);
  }
});

test('handles unterminated fenced code blocks during streaming', () => {
  const html = renderMarkdown('Intro\n\n```py\nprint("streaming")');
  assert.ok(html.includes('<pre><code>print(&quot;streaming&quot;)</code></pre>'));
});

test('preserves balanced parentheses in Wikipedia-style Markdown links and bare URLs', () => {
  const md = '[Wiki](https://en.wikipedia.org/wiki/Python_(programming_language)) and https://en.wikipedia.org/wiki/Foo_(bar).';
  const html = renderMarkdown(md);
  assert.ok(html.includes('href="https://en.wikipedia.org/wiki/Python_(programming_language)"'));
  assert.ok(html.includes('href="https://en.wikipedia.org/wiki/Foo_(bar)"'));
});
