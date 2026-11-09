const releaseStatus = document.querySelector('#release-status');
async function loadRelease() {
  try {
    const response = await fetch('./release.json', {signal: AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error('metadata unavailable');
    const release = await response.json();
    if (!/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error('invalid version');
    document.querySelector('#version').textContent = release.tag_name + ' · 稳定版';
    for (const label of document.querySelectorAll('[data-platform-size]')) {
      const asset = release.assets?.find(item => item.name === 'studio-full-' + label.dataset.platformSize + '.zip');
      if (asset && Number.isSafeInteger(asset.size) && asset.size > 0) label.textContent = Math.round(asset.size / 1024 / 1024) + ' MB · 自带运行环境';
    }
    const date = new Date(release.published_at);
    releaseStatus.textContent = release.tag_name + (Number.isNaN(date.getTime()) ? '' : ' · 发布于 ' + date.toLocaleDateString('zh-CN', {timeZone: 'Asia/Shanghai'})) + ' · 无需登录 GitHub';
  } catch {
    releaseStatus.textContent = '版本信息暂不可用；仍可通过上方链接下载 GitHub 最新稳定版。';
  }
}
const tabs = [...document.querySelectorAll('[data-preview]')];
const compactPreview = matchMedia('(max-width: 520px)');
const updateTabOrientation = () => document.querySelector('.preview-tabs').setAttribute('aria-orientation', compactPreview.matches ? 'horizontal' : 'vertical');
compactPreview.addEventListener('change', updateTabOrientation);
updateTabOrientation();
function selectPreview(name, focus = false) {
  for (const tab of tabs) {
    const active = tab.dataset.preview === name;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    if (active && focus) tab.focus({preventScroll: true});
  }
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectPreview(tab.dataset.preview));
  tab.addEventListener('keydown', event => {
    const index = tabs.indexOf(tab);
    let next;
    if (['ArrowDown', 'ArrowRight'].includes(event.key)) next = (index + 1) % tabs.length;
    if (['ArrowUp', 'ArrowLeft'].includes(event.key)) next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); selectPreview(tabs[next].dataset.preview, true); }
  });
}
for (const link of document.querySelectorAll('[data-preview-link]')) link.addEventListener('click', () => selectPreview(link.dataset.previewLink));
const storyData = {
  scene: {file: 'look-scene.jpg', caption: '01 / 走进日常', alt: '分镜 1：自然光下的日常穿搭'},
  side: {file: 'look-side.jpg', caption: '02 / 换个视角', alt: '分镜 2：服饰侧身轮廓'},
  detail: {file: 'look-detail.jpg', caption: '03 / 细节有声', alt: '分镜 3：服饰面料细节'},
};
for (const option of document.querySelectorAll('[data-story]')) option.addEventListener('click', () => {
  const story = storyData[option.dataset.story];
  for (const button of document.querySelectorAll('[data-story]')) button.setAttribute('aria-pressed', String(button === option));
  const image = document.querySelector('#story-image');
  image.src = './assets/' + story.file;
  image.alt = story.alt;
  document.querySelector('#story-caption').textContent = story.caption;
});
void loadRelease();
