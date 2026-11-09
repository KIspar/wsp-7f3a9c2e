const status = document.querySelector('#release-status');
async function loadRelease() {
  try {
    const response = await fetch('./release.json', {signal: AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error('metadata unavailable');
    const release = await response.json();
    if (!/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error('invalid version');
    const asset = release.assets?.find(asset => asset.name === 'studio-app.tar.gz');
    if (!asset || !Number.isSafeInteger(asset.size) || asset.size < 1) throw new Error('missing asset');
    document.querySelector('#version').textContent = release.tag_name + ' · 稳定版';
    document.querySelector('#size').textContent = (asset.size / 1024 / 1024).toFixed(1) + ' MB · 通用程序包';
    // The stable download URL follows GitHub's latest release even if this page is cached.
    const date = new Date(release.published_at);
    if (!Number.isNaN(date.getTime())) status.textContent = '发布于 ' + date.toLocaleDateString('zh-CN');
  } catch {
    status.textContent = '版本信息暂不可用，仍可下载 GitHub 最新稳定版。';
  }
}
document.querySelector('#copy').addEventListener('click', async () => {
  const feedback = document.querySelector('#copy-status');
  try {
    await navigator.clipboard.writeText('npm ci --omit=dev\nnpm start');
    feedback.textContent = '启动命令已复制';
  } catch {
    feedback.textContent = '无法访问剪贴板，请选中上方命令复制。';
  }
});
void loadRelease();
