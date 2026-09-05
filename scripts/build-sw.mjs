import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const html = (await readFile('dist/index.html', 'utf8')).replace(
  '</head>',
  `<meta name="cutpeak-revision" content="${revision}"></head>`,
);
await writeFile('dist/index.html', html);
const walk = async (dir, prefix = '') =>
  (
    await Promise.all(
      (
        await readdir(dir, { withFileTypes: true })
      ).map(async (entry) =>
        entry.isDirectory()
          ? walk(`${dir}/${entry.name}`, `${prefix}/${entry.name}`)
          : `${prefix}/${entry.name}`,
      ),
    )
  ).flat();
const files = (await walk('dist')).filter(
  (f) => f != '/service-worker.js' && !f.endsWith('.map'),
);
const build = createHash('sha256')
  .update(await readFile('dist/index.html'))
  .digest('hex')
  .slice(0, 12);
await writeFile(
  'dist/service-worker.js',
  (await readFile('public/service-worker.js', 'utf8'))
    .replace('__BUILD__', build)
    .replace('__ASSETS__', JSON.stringify(files)),
);
