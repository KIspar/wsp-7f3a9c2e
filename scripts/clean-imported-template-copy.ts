/** Remove publisher copy from imported template metadata, including historical UI versions. */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd(), importDir = path.join(root, 'data/imports');
const templateIds = new Set<string>();
for (const file of fs.readdirSync(importDir).filter(f => /^designkit-.*\.json$/.test(f))) {
  const record = JSON.parse(fs.readFileSync(path.join(importDir, file), 'utf8'));
  for (const t of Object.values(record.templates || {}) as { id: string }[]) templateIds.add(t.id);
}
const db = new DatabaseSync(path.join(root, 'data/studio.sqlite'));
db.exec('PRAGMA busy_timeout = 5000');
const changes: { id: string; before: string; after: string }[] = [];
for (const row of db.prepare("SELECT id, value FROM documents WHERE kind='prompt-version'").all()) {
  const v = JSON.parse(String(row.value));
  if (!templateIds.has(v.templateId)) continue;
  const old = v.value;
  const description = old.description
    .replace(/来源：美图设计室公开示例（https:\/\/www\.designkit\.cn\/shoppable-carousel）。逐页要求根据画面重建，非官方原始提示词。示例仅供查看，不自动参与生成。/g, '')
    .trim();
  const tags = old.tags.filter((t: string) => t !== '美图设计室参考');
  if (description !== old.description || tags.length !== old.tags.length) {
    v.value = { ...old, description, tags };
    changes.push({ id: String(row.id), before: String(row.value), after: JSON.stringify(v) });
  }
}
console.log(JSON.stringify({ templates: templateIds.size, versionsToClean: changes.length, apply: process.argv.includes('--apply') }));
if (process.argv.includes('--apply') && changes.length) {
  // Narrow rollback file stays outside the product; it contains no credentials or unrelated records.
  const folder = path.join(root, 'data/maintenance'); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `template-copy-${Date.now()}.json`), JSON.stringify(changes.map(c => ({ id: c.id, value: JSON.parse(c.before) }))));
  db.exec('BEGIN IMMEDIATE');
  try {
    const update = db.prepare("UPDATE documents SET value=? WHERE kind='prompt-version' AND id=? AND value=?");
    for (const c of changes) if (Number(update.run(c.after, c.id, c.before).changes) !== 1) throw Error('Template changed during cleanup');
    db.prepare('INSERT INTO events(type,created_at) VALUES (?,?)').run('snapshot', new Date().toISOString());
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
db.close();
