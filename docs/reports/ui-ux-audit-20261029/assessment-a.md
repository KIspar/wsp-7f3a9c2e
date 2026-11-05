# Assessment A · 独立 UI/UX 设计评审（2026-10-29）

本评审只读查看真实页面与源码，未查看 detector 或另一评审的结果。未生成、分析、修改草稿或保存配置。截图根目录：/Users/hc-sonic/Documents/douyin-creative-studio/output/playwright/ui-ux-audit/。

## Design specificity verdict

**产品特异性中上：为服装运营定制的工作流，外观仍是常见 AI 工作台。**

事实：商品多角度资料与对标图片明确区分；“详情图设计”按屏规划并支持长图；“一键对标”逐目标显示商品参考张数、白底辅助、替换对象与结果。这些内容具有服装运营的产品性。另一方面，紫色渐变、左导航、卡片结果流和底部创作框本身可用于多数 AI 创作工具。差异主要来自语义和素材关系，而非外观。

证据：src/Workspace.tsx:128、src/Workspace.tsx:147、src/components/image-design.tsx:31、src/styles.css:30。截图：a-model-outfit.png、a-benchmark-map.png、a-detail-empty.png。

## Nielsen heuristics（0–4）

| # | 启发式 | 分数 | 依据与局限 |
|---|---|---:|---|
| 1 | 系统状态可见性 | 3 | 自动保存、队列、余额、报价、模拟/真实状态明确；跨任务状态分散，余额查询有短暂无值。 |
| 2 | 系统与现实匹配 | 3 | 商品/对标/白底等术语贴近运营；技能、智能体、参数矩阵和 token 仍需解释。 |
| 3 | 控制与自由 | 3 | 重置/替换草稿先确认、候选先预览；排版关闭时缺少未保存变更保护。 |
| 4 | 一致性 | 3 | shadcn 控件、状态、主导航一致；设置页不同控件存在立即保存/按钮保存两种模式。 |
| 5 | 错误预防 | 3 | 计划预览、最高报价、容量/数量约束、幂等接单；结果卡“重试”绕过新的报价预览。 |
| 6 | 识别而非回忆 | 2 | 素材映射与 active 导航明确；版本比较、批次识别和参考原图需要跨弹层记忆。 |
| 7 | 灵活高效 | 2 | Ctrl+Enter、历史复用、批量目标是基础；无选优/批量结果操作，版本选择缺少比较。 |
| 8 | 极简与审美 | 3 | 层级清楚、紧凑且图片优先；Dock 在 1280×720 占近四成视口，结果需额外滚动。 |
| 9 | 错误恢复 | 3 | 接单待核实、不自动重试、保留原结果、依赖恢复路径明确；错误仍散落在 toast/Alert/Sheet。 |
| 10 | 帮助与文档 | 2 | 有全局使用说明和字段提示；缺少素材角色/版本/费用的任务上下文解释。 |
| **总计** | | **27/40** | **Acceptable，上限 Good；主要短板是比较效率与上下文连贯性。** |

评分包含全站工具类工作流，所有十项适用。生产性操作未执行，错误状态主要依据源码，不声称已穷尽键盘/读屏测试。

## Strengths

1. **素材映射有领域结构。** 一键对标逐目标并排显示原图、商品参考张数、白底辅助、逐图要求和最近结果，比“上传一堆图片”可靠。事实见 src/Workspace.tsx:141–147；截图绝对路径：/Users/hc-sonic/Documents/douyin-creative-studio/output/playwright/ui-ux-audit/a-benchmark-map.png。
2. **付费与采纳边界清楚。** AI 辅助先显示输入快照、模型和候选，用户插入/替换才修改草稿；原文改变时禁止覆盖。生成计划区分参考费用、账户余额/当前可用和本地模拟。事实见 src/components/analysis.tsx:72–92、src/components/submission.tsx:60–67；截图：/Users/hc-sonic/Documents/douyin-creative-studio/output/playwright/ui-ux-audit/a-analysis-result.png。
3. **持续工作状态可理解。** 草稿自动保存、任务后台继续、保留原尝试、单项重试保存，以及清楚的模拟标签，能降低运营试错焦虑。事实见 src/components/creative-composer.tsx:55、src/components/results.tsx:38、src/components/results.tsx:55；截图：/Users/hc-sonic/Documents/douyin-creative-studio/output/playwright/ui-ux-audit/a-image-generate.png。

## Priority issues

### [P1] 结果缺少同一条目的选优与比较

**事实：** 通用操作将 #01 v1、#01 v2、#02 v1 按尝试平铺，预览 Modal 仅展示单张图；没有参考原图、相邻版本、参数差异或采用状态。每卡提供提示词/下载/编辑/重试，没有批量选优。src/components/results.tsx:43–74、src/components/common.tsx:32–35、src/components/results.tsx:115。截图：/Users/hc-sonic/Documents/douyin-creative-studio/output/playwright/ui-ux-audit/a-result-preview.png。

**影响：** 服装运营判断版型、面料、Logo 和场景质量时，要在卡片/提示词/详情之间来回记忆；生成更多版本并未形成更高效的选择路径。

**建议：** 按 item 聚合版本；增加“原图 / v1 / v2”并排或滑动比较、差异摘要、选为采用版本与批量下载。优先 $impeccable shape。

### [P1，若移动属于支持范围] 390px 下工作区被固定侧栏挤坏

**事实：** 在 390×844 实测，侧栏仍约224px，内容只剩窄列，Dock 参数逐行溢出，横向滚动出现；创作要求和发送/报价无法完整同时阅读。src/styles.css:448–478 只缩小桌面控件，未折叠导航。截图：/Users/hc-sonic/Documents/douyin-creative-studio/output/playwright/ui-ux-audit/a-mobile-image.png。

**影响：** 手机检查任务、调整草稿或下载结果基本不可用。桌面优先的内部工具若明确不支持手机，此项应降为范围决定，不能直接要求投入完整移动改造。

**建议：** 若要支持手机，<760px 导航抽屉/底部入口、Dock 改为文档流或折叠编辑器，保留单行报价+确认；管理表格允许受控横向滚动。优先 $impeccable adapt。

### [P2] 全部任务入口的优先级偏离“找回创作”

**事实：** /history 首屏是供应商任务号查询；随后八条 AI 辅助任务，最后才是本地创作批次和搜索。模型/密钥/token 等技术信息位于本地任务前。src/App.tsx:92，src/components/analysis.tsx:110–117。截图：/Users/hc-sonic/Documents/douyin-creative-studio/output/playwright/ui-ux-audit/a-history.png。

**影响：** 运营点击“全部任务”想找某件服装的上一批结果，要先跨过供应商支持工具和 token 表格；批次只有短ID、技能、时间和状态，缺少商品名/缩略图。

**建议：** 顶部先统一检索与创作批次，按“媒体创作 / AI辅助”切换；供应商查询收进“高级查询”。批次显示商品名、代表图、结果数、当前状态与继续编辑。优先 $impeccable layout。

### [P2] 素材与完整绑定信息还停留在技术记录层

**事实：** 任务详情“完整提示词与绑定”展开后显示长提示词与 references ID 列表（现场为 example-6-1、example-6-2 等）；没有商品/对标缩略图映射。src/components/results.tsx:87。截图：/Users/hc-sonic/Documents/douyin-creative-studio/output/playwright/ui-ux-audit/a-batch-detail.png。

**影响：** 在历史详情中判断“哪个商品多角度图绑定到了哪个目标”，需要记住 ID 或回到工作区，不能直接验证物料关系。

**建议：** 摘要层直接展示商品资料组→目标图→版本结果，技术ID留在折叠的诊断信息中；能定位回相应替换条目。优先 $impeccable clarify。

### [P2] 高密度 Dock 把编辑与结果审查同时塞入一个视口

**事实：** 1280×720 默认 Dock 从约 y=424 到底部，约占38%高度；首屏结果卡图像仅露上部。Dock 同时有2类素材、4个快捷要求、模型/比例/语言/分辨率/数量/差异/参数矩阵/重置/提交。src/styles.css:185–227，src/components/creative-composer.tsx:64–91。截图：/Users/hc-sonic/Documents/douyin-creative-studio/output/playwright/ui-ux-audit/a-image-generate.png。滚动后能看到完整结果，并非永久遮挡；工作区通过 ResizeObserver 和 padding-bottom 留出空间（src/Workspace.tsx:30–38、src/styles.css:138）。

**影响：** 重复运营编辑时高效，但进入结果审查时持续占用空间；为了看版型和全身图必须额外滚动。

**建议：** 提供“收起创作框 / 专注结果”，折叠时保留草稿状态、报价和继续编辑；保留用户偏好。次要参数用一层渐进披露，避免牺牲熟练运营的效率。优先 $impeccable distill。

## Cognitive load

- **Wall of options：** 通用操作 Dock 至少8组可见决策，主导航图片创作有5个同层入口；需要推荐默认值/次级设置收起。4个快捷要求本身不超阈值。
- **Memory bridge：** 单张预览丢失条目/版本/参考图上下文；完整绑定显示ID，让用户必须记住物料。
- **Hidden navigation：** 桌面 active 状态与中文导航清楚；移动侧栏固定造成内容挤压。
- **Jargon barrier：** 参数矩阵、生成尝试、供应商任务号、token 属于技术或内部模型，首次使用要翻译理解。
- **Visual noise：** 主按钮权重明确，但顶部余额/队列/刷新、结果筛选、Dock 参数三组同时争夺注意力。
- **Context switch：** 结果→提示词Modal→任务详情Sheet→算力统计→模型配置；缺少一次比较决策的统一视图。
- **Multitask：** 一键对标的01/02/03有好分组，仍需要在长页中回看商品参考与白底任务。

## Emotional journey

进入时“服务已连接/后台就绪/账户余额”令人安心；准备素材时，区分商品与对标带来信心，但“白底任务/手动绑定/参数矩阵”引入迟疑。提交前的计划预览、模拟说明、最高报价和余额是安心峰值。等待时“后台继续执行”与状态标签缓解离开页面的焦虑。完成后图片和ZIP形成正反馈，但多版本选优缺少比较，把收尾阶段变为选择疲劳。复盘时能查到提示词和尝试记录，却缺少商品缩略图与直达采用版本，难以形成清晰的结束感。

## Persona red flags

**Alex / Power user：** 有 Ctrl+Enter、逐图覆盖和历史复用；批量自然但结果只能逐卡下载、重试、编辑，无“选优后导出”路径。参数矩阵可用，但没有全局快捷键总览。

**Jordan / First-timer：** 空状态提供示例且标明“非生成结果”，但使用说明只有4步，未解释商品/目标/参考/白底的边界。“确认发送”实际先打开计划，另一个详情表单叫“预览生成”，命名应统一；可见按钮不代表立即付费，但需要用户先理解。

**Sam / Keyboard or screen-reader：** IconButton 有 aria-label 和 tooltip（src/components/common.tsx:18–22），焦点环存在（src/styles.css:63），排序有上/下移按钮；属于优点。Dialog/Sheet关闭可读名称仍为英文Close（src/components/ui/dialog.tsx:74、src/components/ui/sheet.tsx:79）。此轮未声称完整键盘/读屏流程通过。

**Casey / Mobile：** 390px下导航侧栏占去大半宽度，任务内容与Dock出现窄列/横向溢出；若移动只是查看结果，也至少需要折叠导航与可用的下载列表。

## IA / 空状态 / 素材映射 / 排版范围

- **整体IA：** 技能按图片/视频/智能体分类，管理独立，符合熟练操作者；“视频反推”独立于“视频生成”，副标题明确分析目标。名称与历史存档有差异：现入口“通用操作”对应历史“图片生成”，现“爆款复刻”与旧“场景复刻”共存，应标明历史名称或迁移映射。
- **空状态：** 详情图真实0批次，出现“这一组创作，从这里开始”、4张示例、“载入示例到草稿”“原型素材·非生成结果”，有明确行动且不冒充输出。截图绝对路径：/Users/hc-sonic/Documents/douyin-creative-studio/output/playwright/ui-ux-audit/a-detail-empty.png。
- **素材映射：** 当前一键对标3张商品参考、4张对标图，重复勾选状态在上传区与逐图工作台同步，视觉关系明确；但只显示“商品参考3张”，未在逐项卡片直接显示被绑定商品缩略图。
- **详情排版：** 当前详情图0批次，没有可打开的“排版”入口；为遵守不改草稿/不生成约束，未创建样本，因此**排版抽屉只做源码审核，未实测**。src/components/results.tsx:115 仅有 groupIndex 且有成功结果才启用排版。src/components/long-image-layout.tsx:45–58 支持版本下拉、选择屏、拖动/上下移、宽度间距、背景格式、300px预览、保存和下载；未保存改动关闭会丢失，下载也会保存布局。应显示未保存状态并明确“保存并下载”。
- **复用路径：** 真实打开批次详情可见“使用这组设置”；源码中已有非默认草稿时确认覆盖（src/Workspace.tsx:61–69），历史页也先显示“使用历史设置？”（src/App.tsx:92）。未点击确认、未改草稿。
- **移动范围：** 仅实测390×844通用操作；并不据此声称所有移动页面都有同样问题。CSS共用固定侧栏使风险具有全站性。临时viewport已reset。

## 动画与细节（独立源码+视觉判断）

- 页面没有大面积装饰动画，符合高频内部工作台；hover影子、图像放大、折叠箭头和spin表达状态。src/styles.css:67、148–167、324–325。
- reduced-motion全局规则存在，动画/transition缩到.01ms并停用平滑滚动；账户余额/usage spin另行禁用。src/styles.css:466–468、679–680。
- **不要仅依据源码class声称抽屉实际有500ms动画。** Sheet含animate-in/slide类和500ms duration，Dialog含zoom/fade，但src/styles.css只import tailwindcss，package.json未见tw-animate依赖/插件；需进一步检查computed animation确认这些类是否有CSS输出。此处保留为待核验，不能当成已观察的慢动画。
- Dock部分边框/背景/主色硬编码（src/styles.css:185–227），与已建立的语义主题变量并行，主题维护存在分叉；不建议为了外观重新设计已有shadcn组件。
- Close的读屏名称应中文化；截图所见关闭图标视觉上清楚，问题在可读名称和触控面积，不是“无法关闭”。

## Questions for synthesis

1. 运营的主工作单元究竟是单图、同商品成套图，还是多商品批量？结果比较与导航需要跟随这个答案，当前不假定已决定。
2. 最终交付应该是ZIP、采用版本集合，还是排好顺序的长图？哪个动作代表本次工作结束？
3. 手机是否属于正式支持范围，还是桌面为主、手机只查看任务与下载？

## Run notes

- 已浏览9个请求页面，独立后台临时tab，未用或关闭用户tab。
- 未运行detector、未注入overlay、未启动服务器；这些属于另一独立Assessment。
- 当前数据详情设计0批次，排版未实测；结果单图预览、批次详情与分析历史Sheet已真实打开。
- 未生成/分析/保存配置/改草稿；源码只读，唯一写入为本报告与截图。
