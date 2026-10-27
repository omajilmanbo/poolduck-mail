import { readFileSync, writeFileSync } from 'node:fs';

/* global URL, process, console */

const contentPath = new URL('../src/help/content.json', import.meta.url);
const guidePath = new URL('../../docs/user-guide.md', import.meta.url);
const manual = JSON.parse(readFileSync(contentPath, 'utf8'));
const guide = readFileSync(guidePath, 'utf8');
const newline = guide.includes('\r\n') ? '\r\n' : '\n';
const start = '<!-- web-help:start -->';
const end = '<!-- web-help:end -->';
const section = [
  start,
  '## 网页手册共用内容',
  '',
  manual.intro,
  '',
  ...manual.sections.flatMap((entry) => [
    `### ${entry.title}`,
    '',
    ...entry.items.map((item) => `- ${item}`),
    '',
  ]),
  end,
].join(newline);
const region = new RegExp(`${start}[\\s\\S]*?${end}`);
if (!region.test(guide)) throw new Error('docs/user-guide.md is missing web-help markers');
const updated = guide.replace(region, section);

if (process.argv.includes('--check')) {
  if (updated !== guide) {
    console.error('Web help and docs/user-guide.md differ. Run npm --prefix frontend run help:sync.');
    process.exitCode = 1;
  }
} else {
  writeFileSync(guidePath, updated);
}
