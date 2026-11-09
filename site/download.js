const status = document.querySelector('#release-status');
async function loadRelease() {
  try {
    const response = await fetch('./release.json', {signal: AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error('metadata unavailable');
    const release = await response.json();
    if (!/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error('invalid version');
    const asset = release.assets?.find(asset => asset.name === 'studio-app.zip') || release.assets?.find(asset => asset.name === 'studio-app.tar.gz');
    if (!asset || !Number.isSafeInteger(asset.size) || asset.size < 1) throw new Error('missing asset');
    document.querySelector('#version').textContent = release.tag_name + ' · 稳定版';
    for (const link of document.querySelectorAll('[data-app-download]')) link.href = 'https://github.com/KIspar/wsp-7f3a9c2e/releases/latest/download/' + asset.name;
    document.querySelector('#size').textContent = (asset.size / 1024 / 1024).toFixed(1) + ' MB · 通用程序包';
    // The stable download URL follows GitHub's latest release even if this page is cached.
    const date = new Date(release.published_at);
    if (!Number.isNaN(date.getTime())) status.textContent = '发布于 ' + date.toLocaleDateString('zh-CN');
  } catch {
    status.textContent = '版本信息暂不可用，仍可下载 GitHub 最新稳定版。';
  }
}
// LeiBox Glass Folder interaction adapted to three real links. Native buttons keep
// touch and keyboard behavior; the sheets leave the tab order while closed.
const folder = document.querySelector('#package');
const folderToggle = document.querySelector('#package-toggle');
const folderFiles = document.querySelector('#package-files');
function setFolderOpen(open, restoreFocus = false) {
  if (restoreFocus) folderToggle.focus({preventScroll: true});
  folder.toggleAttribute('data-open', open);
  folderToggle.setAttribute('aria-expanded', String(open));
  folderToggle.setAttribute('aria-label', open ? '收起程序包内容' : '展开程序包内容');
  folderFiles.inert = !open;
  folderFiles.setAttribute('aria-hidden', String(!open));
}
folderToggle.addEventListener('click', () => setFolderOpen(!folder.hasAttribute('data-open')));
folder.addEventListener('keydown', event => {
  if (event.key === 'Escape' && folder.hasAttribute('data-open')) {
    event.preventDefault();
    setFolderOpen(false, true);
  }
});
document.addEventListener('pointerdown', event => {
  if (!folder.contains(event.target) && folder.hasAttribute('data-open')) {
    setFolderOpen(false, folderFiles.contains(document.activeElement));
  }
});
folderFiles.addEventListener('click', event => {
  if (event.target.closest('a')) setFolderOpen(false, true);
});
void loadRelease();
