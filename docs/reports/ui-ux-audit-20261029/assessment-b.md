# Assessment B — detector、浏览器与动画技术证据

日期：2026-10-29。审查者：`/root/motion_evidence`。目标：`src` 与 `http://127.0.0.1:4310`。本报告独立形成，未读取 Assessment A。仅分析与文档，无业务代码、配置、草稿更改，无提交/重试生成、AI 调用或上传。

## 方法与边界

- 独立创建隐藏 IAB 临时页；检查通用操作、详情图设计、一键对标、模型配置、算力统计、使用说明、参数矩阵与任务详情。所有业务输入保留原值。
- 浏览器实际 viewport：1280×1000、1440×1000、1920×1000、390×844。390 是浏览器窄屏布局模拟，没有触摸合成或真机测试；桌面为本项目主要场景。
- 检查源码、可访问树、实际几何、计算样式及截图；键盘检查 Select 的 Escape、Dialog/Sheet 初始焦点、Tab 循环及 Escape 退出。没有性能 trace、帧率基准、网络节流或 reduced-motion 媒体模拟，相关结论明确限定为源码证据。
- `impeccable context` 已由主审前序尝试并失败，本 agent 未重复执行。没有根目录 PRODUCT.md / DESIGN.md；存在原型目录下的 DESIGN.md，未将它视作当前界面的规范。
- **一次真实 detector 尝试**：`/Users/hc-sonic/.codex/skills/impeccable/scripts/impeccable detect --json src`。退出码 **127**。错误为无法下载 engine 0.1.14：`https://github.com/pbakaus/impeccable/releases/download/engine-v0.1.14/impeccable-darwin-x64`，并提示 cache `/Users/hc-sonic/.impeccable/bin/0.1.14` 需要网络与写入权限。未重试、未安装修复。因此 **确定性扫描不可用，不是扫描零问题**。
- 浏览器 evaluate 为只读；**未注入 detector、overlay 未启用，不存在可声称的用户可见检测叠层**。
- 结束时已 reset 临时 viewport override 并关闭 B 的隐藏页。没有启动或停止用户现有服务器。

## 技术健康评分（手工证据，非自动 WCAG 合规认证）

| 维度 | 评分 | 依据 |
|---|---:|---|
| Accessibility | 2/4 | 标签及 Radix 键盘基础较好；状态文字对比度、主输入焦点和弹层焦点恢复有具体缺口 |
| Performance | 3/4 | 图片 lazy、视频 metadata，无明显滚动脚本；空闲前台仍有密集轮询，未做性能 trace |
| Theming | 2/4 | 全局 token 存在；composer 大量绕过 token，无统一 motion token。未承诺深色模式，不把未提供深色模式本身当 bug |
| Responsive | 2/4 | 三种桌面宽度无横向溢出；390 窄屏主编辑区不可用，属于桌面主场景之外的适用性缺口 |
| Implementation Integrity | 2/4 | 产品领域结构明确；动画 class 与实际运行脱节、状态统计与队列语义不一致 |
| 合计 | **11/20** | 可用，但存在需要修复的技术与交互细节 |

## 优先发现

### B1 [P1] 成功状态与侧栏小字对比度不足

位置：`src/styles.css:39`、`:73`、`:175`、`:177`。

浏览器核实“已完成”状态为 `#059669` / `#ecfdf5`，12–13px、700 字重，WCAG 相对亮度计算 **3.58:1**，小文字需要 4.5:1。侧栏 `CREATIVE STUDIO / 01` 为 `#6366f1` / `#0f172a`，12px/500，**4.00:1**。这不是禁用态或装饰性图形。状态依赖颜色时，文字本身仍应可读。

建议：保留浅色状态背景，深调文字 token；先修 `--success` 的文字用途，再给 icon/点单独 token。侧栏副标使用更亮的 sidebar 专用品牌色。命令：`$impeccable colorize` / `$impeccable harden`。证据：`b-image-1440.jpg`、`b-details.jpg`。

### B2 [P1] 主创作输入的键盘焦点提示被覆盖，剩余边框过弱

位置：`src/styles.css:197`、`:198`、`:201`、`:203`；`src/components/creative-composer.tsx:67`。

浏览器将“创作要求”通过键盘聚焦后，textarea 的 computed outline 为 none、box-shadow none、边框宽度为 0；容器只把 1px border 变为 `#b4b3f8`。该边框对 `#f8fafc` 背景 **1.87:1**，对外部白色也未达到 3:1。输入面积很大，却没有可靠的高对比键盘定位。全局 `:focus-visible` 本来存在，随后被 composer 特例移除。

建议：在 composer-main 或 input-group 上恢复清晰的 `:focus-within` 2px ring，并为 `:focus-visible` 保留可区分的颜色和边界，不仅换浅色细边。标准：WCAG 1.4.11 / 2.4.7。命令：`$impeccable harden`。证据：`b-keyboard-focus.jpg`。

### B3 [P2] 关闭参数弹窗或详情侧栏后，焦点落回 BODY

位置：`src/components/common.tsx:30`、`src/components/results.tsx:81`；通用 Dialog/Sheet 用受控 open，但业务触发按钮没有接入对应 Trigger，也没有显式 `onCloseAutoFocus` 恢复。

实际核实：参数矩阵自动聚焦首个 Select；任务详情自动聚焦“使用这组设置”。任务详情内 Shift+Tab 到 Close，再 Tab 回首个动作，focus trap 正常。但 Escape 关闭两种弹层后，`document.activeElement.tagName === 'BODY'`，没有回到“参数矩阵”或“详情”。键盘操作者需要重新寻找上下文。

建议：通过 DialogTrigger/SheetTrigger 建立触发关系，或保留 trigger ref 并在关闭时恢复。命令：`$impeccable harden`。截图：`b-matrix.jpg`、`b-details.jpg`；焦点恢复为 DOM 观察，静态截图不能证明过程。

### B4 [P2] 弹窗、侧栏声明了入退场动画，运行时实际没有 keyframe 动画

位置：`src/components/ui/dialog.tsx:40`、`:62`；`src/components/ui/sheet.tsx:38`、`:62`；`src/components/ui/tooltip.tsx:44`；`src/styles.css:1`；`package.json`。

实际计算样式：参数矩阵 dialog-content 与 overlay 的 `animation: none`；任务详情 sheet-content 与 overlay 的 `animation-name: none`、`animation-duration: 0s`。源码使用 `animate-in/out`、`fade-in/out-0`、`zoom-in/out-95`、`slide-in-from-right`，但样式仅 import tailwindcss，未提供这些 keyframes 的定义或相应动画扩展。sheet 的 500/300ms 最终只影响 transition；初始条件渲染没有起始 transform，因此不等于存在滑入动画。

影响：这是“代码看起来有动画、实际骤现骤隐”的实现缺口，难以通过仅审 class 发现。Select 本身也是无动画，不过这属于刻意即时响应也合理，不能视为同样 bug。ConfirmDialog 源码无动画，属于一致性选择而非假装已实现。

建议：用现有 CSS 补齐实际入退场状态与 keyframes，或使用项目明确的动画工具；实际验证 enter/exit/重复点击/中途关闭。参数弹窗建议 180–220ms、侧栏 220–300ms、退出 140–180ms；自然减速 arrival，如 `cubic-bezier(.16,1,.3,1)`。无需引入大型 motion 库。命令：`$impeccable animate`。

### B5 [P2] 顶栏“后台队列就绪”的条件没有覆盖排队或依赖等待

位置：`src/App.tsx:40`、`:68`。

源码 active 只计媒体 `generating/saving` 与分析 `preparing/submitting`，未计 `queued`、`waiting_dependency`。因此当存在排队但没有执行中的任务时，可显示“后台队列就绪”；同一页面结果卡却显示排队中。当前已有样例均完成，本次未提交新任务复现，属于源代码确定的条件缺口。

建议：分别显示“执行中 N / 排队 N / 等待依赖 N”，至少让有未结束任务时避免声称队列已经就绪。后台完成或失败时提供一次可访问的低打扰通知；现有 ResultFeed/Status 没有 aria-live，不能假定屏幕阅读器能感知轮询后的状态变化。命令：`$impeccable clarify` / `$impeccable harden`。

### B6 [P2，窄屏适用范围] 390px 时侧栏与固定 composer 挤压主编辑区

位置：`src/styles.css:42`、`:71`、`:105`、`:185`、`:199`；1150px 以下只把 sidebar 改为 224px，没有窄屏抽屉/隐藏策略。

实际几何：390×844 时 sidebar 224px；main-shell 宽151px；composer-main 仅85px；composer-editor 宽 **0px** 且起点 x448；document.scrollWidth **589px**。dock 高约816px，覆盖几乎整个 viewport。无法完成正常输入。三种桌面宽度未发现文档横向溢出（scrollWidth 约 viewport−15px 是滚动条，不是内容溢出）。

建议：如果产品继续限定桌面，不把它误排为桌面核心 P0；明确最小支持宽度。如果需要手机查看结果，做窄屏结果只读布局并收起 sidebar/composer；若要求手机创作，则需要独立信息布局，不能仅加 flex-wrap。命令：`$impeccable adapt`。证据：`b-image-390.jpg`、`b-geometry.json`。

### B7 [P2] 预览计划的折叠控制没有暴露展开状态

位置：`src/components/submission.tsx:66`。

`plan-item-head` 是可点按钮，条件挂载 plan-prompt，但没有 `aria-expanded`、`aria-controls`；箭头也不随展开状态变化。与详情创作的“展开/收起配置”（`image-design.tsx:41` 已有 aria-expanded）不一致。未打开生成计划，因为 prepare 会 flushDraft；这里仅为源码证据。

建议：为各项使用唯一 id / aria-controls、aria-expanded；箭头旋转150ms即可，内容可用短 opacity 或无动画，避免大量项目逐个入场。命令：`$impeccable harden` / `$impeccable animate`。

### B8 [P2] 前台空闲仍维持约102次/分钟的基础轮询

位置：`src/lib/studio.tsx:22`；`src/components/analysis.tsx:22`、`:23`；`src/App.tsx:32`。

源码间隔分别 1200ms snapshot（50/min）、1500ms jobs（40/min）、5000ms config（12/min）；useAnalysis 在 App 全局挂载，即使正在浏览模型页/算力页且没有任务也持续。这里只给出调度上限，不伪称实际网络测量，缓存/并发会影响请求数。

**没有发现“隐藏页仍轮询”的已证实缺陷**：TanStack `queryObserver.ts:554` 仅当 refetchIntervalInBackground 或 focusManager.isFocused 时 fetch；这些查询未将前者打开。account/quote 更显式设 false。浏览器隐藏页后台暂停没有另做网络 trace。

建议：有活动任务时保持1–1.5s，闲时15–30s或停止；配置用长 staleTime/主动 invalidate。不要为追求实时而改变成后台常驻刷新。命令：`$impeccable optimize`。

## 动画现状与建议

| 交互 | 当前证据 | 评价与建议 |
|---|---|---|
| 按钮、Select trigger、Switch | 150ms，`cubic-bezier(.4,0,.2,1)` | 常规反馈足够快；Switch thumb 已是 transform。模型开关只读检查，未操作业务值 |
| 侧栏 hover、卡片 border/shadow | 200ms，含 transition-all | 可接受，但指定 color/background/border/shadow，避免未来 layout 变化意外动画化 |
| 图片 hover | scale(1.04)，500ms | 偏慢、每张图重复；桌面操作型界面用160–220ms，或只保留放大按钮 overlay |
| 图片 overlay | opacity 200ms | 有 hover 和 focus-visible 对等反馈，是可保留的好做法 |
| Select 菜单 | animation none | 即时展开不阻碍任务；有选中状态、键盘 Escape 回 trigger、碰撞边距 |
| 参数 Modal | 声明200ms，但 animation none | 修运行时动画支持，再检查 reduced motion |
| 任务 Sheet | 声明 open500/closed300ms，animation none | 当前并未滑入；即使补齐后500ms仍偏慢，缩短常规侧栏动画 |
| 配置折叠 | 条件挂载，即时；aria-expanded 正常 | 可保持即时；要加动画就只解释布局变化，别给整个表单加长时间 reveal |
| 保存/任务 loading | `.spin` 1.4s linear infinite；状态文字保留 | 语义相关 loading loop 可以保留；无装饰性常驻大动画，不需要额外背景动效 |
| Skeleton | Tailwind animate-pulse | 只在 loading 使用；无需把 pulse 当成永久装饰 |
| reduced motion | `styles.css:467` 全局0.01ms/1次；`:680`余额与usage spin none | 有基础偏好响应；但一刀切令所有反馈瞬停，没有按语义区分；应取消位移和缩放，保留短 opacity/color。当前状态文字仍在，不能称为状态丢失 |

`transition-all` 出现在按钮基类、Switch、Tabs、侧栏、attempt tile。未发现 will-change 滥用或 JS layout animation。shadow 与 backdrop-blur 多处存在（topbar、overlay、结果标签），没有实测掉帧证据，不把“使用 blur/shadow”直接等同于性能故障。

推荐 motion thesis：**用少量动画解释“编辑 → 预览 → 接单 → 队列 → 结果”，不要做整页入场编舞**。保留按钮短反馈、给结果完成一次轻量状态强调、给侧栏/弹窗建立层级；不为静态卡片增加悬浮升起或循环光效。

## 其他观察与正面证据

- 操作目标：桌面 icon 多为28–32px、suggestion 28px、数量步进24px、model Switch 32×18.4px、Close图标16px、帮助行高19.5px。低于44px建议尺寸，手机触摸尤其困难；不把所有低于44px都误报为 WCAG AA 失败，24px与间距例外需分别核实。建议优先增加 Close/help/Switch 命中区，视觉图标可保持原尺寸。
- composer `styles.css:186–237` 直接硬编码大量颜色、边框和渐变；现有全局 token 被局部绕过。建议新增 composer surface/control/focus token；不要以“尚无深色模式”为由擅自增加主题切换。
- 真正重试入口 `results.tsx:61` 直接 action(retry)，不像首次生成经过计划/报价确认；服务端 `generation-pricing.ts:31–40` 重取报价并预留上限，但没有客户端 maximumCost 确认。这是费用知情的一致性风险，当前媒体为模拟器，不能宣称本次已经扣费。后续真实媒体接入前应对“新生成”和“仅保存重试”分开确认。
- 标签基础良好：主导航有 aria-label，主要输入/模型Select有可访问名称，图标操作通过 IconButton label+tooltip；PropertyField 使用 htmlFor/id。模型页面未标记 aria-hidden 的隐藏 Radix input 属正常实现，不应误报为缺标签。
- 图片结果 lazy，视频 preload=metadata；无自动播放，MediaModal 需主动打开。
- 草稿保存 `role=status`、费用 `aria-live=polite`；提交有幂等、返回编辑、成功/错误 toast，报价上涨需重新确认。不错的恢复基础。
- 队列卡保留 step 与状态文字，失败、依赖等待和重试都有领域状态，而非单一 spinner。
- 详情拖排序没有触摸合成验证，但上下移动按钮提供键盘可用的替代路径，不能仅因 HTML draggable 就判断完全无法键盘排序。
- B tab console warnings/errors 查询返回空数组；这是本次观察窗口，不是全应用无错误保证。

## 证据索引

全部截图目录：`/Users/hc-sonic/Documents/douyin-creative-studio/output/playwright/ui-ux-audit/`。

| 文件 | 内容 |
|---|---|
| b-image-1280.jpg | 1280×1000 通用操作 |
| b-image-1440.jpg | 1440×1000 通用操作 |
| b-image-1920.jpg | 1920×1000 通用操作 |
| b-image-390.jpg | 390×844 窄屏布局 |
| b-geometry.json | 1280/1920/390 DOM几何 |
| b-keyboard-focus.jpg | 主输入键盘焦点 |
| b-select.jpg | 比例下拉 |
| b-matrix.jpg | 参数矩阵弹窗 |
| b-details.jpg | 任务详情侧栏 |
| b-help.jpg | 使用说明弹窗 |
| b-models.jpg | 模型开关和管理表单 |
| b-usage-1440.jpg | 算力页（捕获时处于初始加载态，不能用于断言最终数据） |
| b-detail-design-1440.jpg | 详情图设计 |
| b-agent-1440.jpg | 一键对标 |

后续修复建议顺序：`harden/colorize` 修对比度与键盘 → `animate` 修实际入退场与状态反馈 → `optimize` 减少空闲轮询 → 如纳入手机范围则 `adapt` → `polish` 验收。
