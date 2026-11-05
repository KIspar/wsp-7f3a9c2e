/** Import only the public examples recorded in the reviewed pack. Never calls AI providers. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { emptyPrompt, promptTemplateInputSchema } from '../packages/prompts';

const root = process.cwd();
const packArg = process.argv.indexOf('--pack');
if (packArg >= 0 && !process.argv[packArg + 1]) throw Error('--pack requires a JSON file');
const packFile = path.resolve(root, packArg >= 0 ? process.argv[packArg + 1] : 'docs/template-packs/designkit-shoppable.json');
const pack = JSON.parse(fs.readFileSync(packFile, 'utf8')) as {
  id: string; sourceUrl: string; collectedAt: string; note: string;
  templates: { name: string; summary: string; images: string[]; tags: string[]; categories: string[]; prompt: string; pages: { title: string; prompt: string }[] }[];
};
const base = new URL(process.env.STUDIO_IMPORT_URL || 'http://127.0.0.1:4310');
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw Error('Import target must be a local studio');
if (new Set(pack.templates.map(t => t.name)).size !== pack.templates.length) throw Error('Duplicate template names');
for (const t of pack.templates) {
  if (t.pages.length !== t.images.length || !t.pages.length) throw Error(`Incomplete page mapping: ${t.name}`);
  for (const image of t.images) {
    const u = new URL(image);
    if (u.protocol !== 'https:' || u.hostname !== 'xiuxiu-pro-new.meitudata.com' || !u.pathname.startsWith('/poster/')) throw Error('Unreviewed image source');
  }
  promptTemplateInputSchema.parse({ ...emptyPrompt('image', 'post'), name: t.name, prompt: t.prompt, pages: t.pages });
}
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ mode: 'preview', templates: pack.templates.length, examples: pack.templates.reduce((n, t) => n + t.images.length, 0), names: pack.templates.map(t => t.name) }, null, 2));
  process.exit(0);
}

const stateDir = path.join(root, 'data/imports');
fs.mkdirSync(stateDir, { recursive: true });
const stateFile = path.join(stateDir, `${pack.id}.json`);
const state: { images: Record<string, { id: string; sha256: string; bytes: number }>; templates: Record<string, { id: string; versionId: string }> } =
  fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { images: {}, templates: {} };
// Only reuse templates tracked by a previous import, never arbitrary user templates with a matching name.
const previous: typeof state = { images: {}, templates: {} };
for (const name of fs.readdirSync(stateDir).filter(name => name.endsWith('.json') && name.startsWith('designkit-'))) {
  if (path.join(stateDir, name) === stateFile) continue;
  const saved = JSON.parse(fs.readFileSync(path.join(stateDir, name), 'utf8')) as typeof state;
  Object.assign(previous.images, saved.images); Object.assign(previous.templates, saved.templates);
}
const persist = () => { fs.writeFileSync(stateFile + '.tmp', JSON.stringify(state, null, 2)); fs.renameSync(stateFile + '.tmp', stateFile); };
const bootstrap = await fetch(new URL('/api/bootstrap', base)).then(r => r.json()) as { token: string };
if (!bootstrap.token) throw Error('Local studio unavailable');
async function api(route: string, body: BodyInit, json = true, method = 'POST'): Promise<any> {
  const response = await fetch(new URL('/api' + route, base), { method, headers: { 'x-studio-token': bootstrap.token, ...(json ? { 'content-type': 'application/json' } : {}) }, body });
  if (!response.ok) throw Error(`Studio import failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return response.json();
}
for (const t of pack.templates) {
  const known = state.templates[t.name] || previous.templates[t.name];
  if (known) {
    const response = await fetch(new URL('/api/prompt-templates/' + known.id, base));
    if (!response.ok) throw Error(`Previously imported template unavailable: ${t.name}`);
    const detail = await response.json() as any;
    const tags = [...new Set([...detail.version.value.tags, ...t.tags])];
    if (tags.length > 20) throw Error(`Too many category tags: ${t.name}`);
    // Preserve edits, media and prompts. Only add missing category membership to shared templates.
    if (tags.length !== detail.version.value.tags.length) {
      if (detail.template.archived) throw Error(`Restore archived shared template before adding categories: ${t.name}`);
      const result = await api('/prompt-templates/' + known.id, JSON.stringify({ value: { ...detail.version.value, tags }, revision: detail.template.revision }), true, 'PUT');
      state.templates[t.name] = { id: known.id, versionId: result.version.id };
    } else state.templates[t.name] = { id: known.id, versionId: detail.version.id };
    persist(); console.log(`Reused: ${t.name} · ${known.id}`); continue;
  }
  const exampleIds: string[] = [];
  for (const url of t.images) {
    if (!state.images[url] && previous.images[url]) state.images[url] = previous.images[url];
    if (!state.images[url]) {
      const cacheFile = path.join(root, 'data/import-cache/designkit', createHash('sha256').update(url).digest('hex') + path.extname(new URL(url).pathname));
      let bytes: Buffer;
      if (fs.existsSync(cacheFile)) bytes = fs.readFileSync(cacheFile);
      else {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw Error(`Example download failed (${response.status})`);
      const chunks: Uint8Array[] = []; let size = 0;
      for await (const chunk of response.body!) {
        size += chunk.length;
        if (size > 12 * 1024 * 1024) throw Error('Example exceeds 12 MB');
        chunks.push(chunk);
      }
      bytes = Buffer.concat(chunks);
      }
      if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw Error('Example is empty or exceeds 12 MB');
      const meta = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format || '') || (meta.pages || 1) > 1) throw Error('Invalid example image');
      const form = new FormData(); form.append('file', new Blob([bytes], { type: `image/${meta.format}` }), path.basename(new URL(url).pathname));
      const asset = await api('/upload', form, false);
      state.images[url] = { id: asset.id, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }; persist();
    }
    exampleIds.push(state.images[url].id);
  }
  const value = promptTemplateInputSchema.parse({
    ...emptyPrompt('image', 'post'), name: t.name, tags: [...t.tags, '三页图文'], prompt: t.prompt, pages: t.pages,
    description: `${t.summary}。适用：${t.categories.join('、')}。`,
    exampleIds, referenceIds: [], settings: { aspectRatio: '3:4', parameters: {} },
  });
  const hash = createHash('sha256').update(t.name).digest('hex').slice(0, 20);
  const result = await api('/prompt-templates', JSON.stringify({ value, key: `${pack.id}-${hash}` }));
  state.templates[t.name] = { id: result.template.id, versionId: result.version.id }; persist();
  console.log(`Imported: ${t.name} · ${exampleIds.length} examples · ${result.template.id}`);
}
console.log(`Complete: ${Object.keys(state.templates).length} templates; ${Object.keys(state.images).length} local examples; no AI calls.`);
