# 下载首页改造 · 2026-11-09

## 设计方向

参考 lite.ego.app 首页的深蓝沉浸式背景、玻璃弧光、居中下载入口和大幅产品展示。独立编写 HTML / CSS，保留 Workspace 自有名称、产品内容和 GitHub Release 下载逻辑。无外部字体、框架或重型动画库。

## 页面内容

- 深蓝至浅色渐变首屏、CSS 玻璃半球与轻微高光动效。
- 电商设计 / 无限画布 / 视频创作三种可切换产品预览。
- 视频预览支持三分镜切换；明确是示例预览，不执行模型生成。
- 功能介绍、本地数据说明、Windows / 两种 Mac 芯片下载卡片、Linux 入口。
- 三步双击启动说明、原生 FAQ、底部下载入口。
- GitHub Release 元数据自动更新版本、发布日期和下载体积；读取失败不阻断下载链接。

示例图来自项目已有 public/examples/10-1.jpg 至 10-4.jpg，来源见 public/examples/sources.json；不是实际模型输出证明。未使用参考站品牌资产、文案或图片。

## 本地验证

通过 BrowserOS neo 的可见页面真实点击与键盘操作验证：

- 桌面首屏、大幅产品预览、FAQ 和底部布局；390 × 844 手机布局。
- 点击三个预览页签切换；方向键、Home、End 切换选中项。
- 视频第 2 / 3 个分镜切换图片、标题和选中状态。
- 功能卡“看看无限画布”切换预览并跳转；下载和使用指南锚点。
- FAQ 鼠标展开后，通过 Tab / Enter 切换下一项，并验证前一项自动收起。
- Windows / Mac / Linux 下载链接指向完整包的 releases/latest/download 稳定地址。
- 控制台未发现脚本错误；本地无 release.json 时展示降级提示。

静态检查：node --check site/download.js、git diff --check。动画仅涉及小范围透明度和 transform；prefers-reduced-motion 下关闭动画与平滑滚动。手机预览页签改为横向并同步 ARIA 方向，主要操作触控区域至少 44px。

## 发布范围

仅更新 site/ 首页及本记录，不修改工作台版本或 Release 安装包，不上传 data/ 或任何凭据。GitHub Pages 工作流在推送后自动部署，并从最新 Release 生成 release.json。线上版本与体积需要在部署后实页复核。

## 线上复核结果

- 首页提交：c5b5553；GitHub Pages 工作流 #9 成功（23 秒）。
- 部署记录：https://github.com/KIspar/wsp-7f3a9c2e/actions/runs/42578506207
- 公开首页已显示新设计；在线元数据读取 v0.1.6、发布日期 2026/11/9。
- 下载卡片显示 Windows 311 MB、Mac Apple 芯片 321 MB、Mac Intel 芯片 324 MB。
- 线上真实点击视频预览及第 3 个分镜，标题切换为“03 / 细节有声”。
