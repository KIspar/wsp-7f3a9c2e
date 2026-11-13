import {promises as fs, createWriteStream, createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import archiver from 'archiver';
import {findNpm} from './launch.mjs';

const root = path.resolve(import.meta.dirname, '..');
if (process.env.RUNTIME_PLATFORM && process.env.RUNTIME_PLATFORM !== `${process.platform}-${process.arch}`) throw Error('Unexpected runner architecture');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'release/runtime');
await fs.mkdir(output, {recursive: true});
const name = `studio-runtime-${process.platform}-${process.arch}.zip`;
const archive = path.join(output, name);
const zip = archiver('zip', {zlib: {level: 6}}), stream = createWriteStream(archive);
const done = new Promise((resolve, reject) => {
  stream.on('close', resolve); stream.on('error', reject);
  zip.on('error', reject); zip.on('warning', reject);
});
zip.pipe(stream);
async function tree(source, prefix) {
  for (const entry of await fs.readdir(source, {withFileTypes: true})) {
    if (['.bin', '.cache', '.package-lock.json', '.studio-launch-ready'].includes(entry.name)) continue;
    const file = path.join(source, entry.name), name = prefix + '/' + entry.name;
    if (entry.isSymbolicLink()) throw Error('Runtime contains unsupported link: ' + name);
    if (entry.isDirectory()) await tree(file, name);
    else if (entry.isFile()) zip.file(file, {name, mode: (await fs.stat(file)).mode & 0o777});
  }
}
const bin = path.dirname(process.execPath);
const license = await Promise.any([path.join(bin, 'LICENSE'), path.resolve(bin, '../LICENSE')].map(async file => { await fs.access(file); return file; }));
zip.file(process.execPath, {name: '.runtime/node/' + (process.platform === 'win32' ? 'node.exe' : 'node'), mode: 0o755});
zip.file(license, {name: '.runtime/node/NODE-LICENSE.txt', mode: 0o644});
await tree(path.resolve(path.dirname(await findNpm()), '..'), '.runtime/node/node_modules/npm');
await tree(path.join(root, 'node_modules'), 'node_modules');
const lock = (await fs.readFile(path.join(root, 'package-lock.json'), 'utf8')).replace(/\r\n/g, '\n');
const fingerprint = createHash('sha256').update(lock).update(`${process.platform}/${process.arch}/${process.versions.node.split('.')[0]}`).digest('hex');
zip.append(fingerprint, {name: 'node_modules/.studio-launch-ready', mode: 0o644});
zip.append(JSON.stringify({version: pkg.version, node: process.version, platform: process.platform, arch: process.arch}), {name: '.runtime/node/runtime.json', mode: 0o644});
await zip.finalize(); await done;
const hash = createHash('sha256'); for await (const chunk of createReadStream(archive)) hash.update(chunk);
await fs.writeFile(archive + '.sha256', hash.digest('hex') + '  ' + name + '\n');
console.log(`Runtime ${name}: ${(await fs.stat(archive)).size} bytes`);
