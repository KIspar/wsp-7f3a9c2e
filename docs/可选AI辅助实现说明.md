# 可选 AI 辅助与双模型

当前实现：文字/图片辅助默认 TT-6.1 sol，在模型配置的聊天类卡片勾选默认辅助模型。普通媒体生成不创建分析任务；五个图片技能的 AI 润色、详情图的 AI 编写、参考图的反推提示词，均先打开侧栏，点击开始分析后才发送请求。视频反推有独立页面，固定使用 GEM 原生视频输入，不接续媒体生成。

## 使用

1. 模型配置 → 聊天类，在模型卡片下方勾选默认 AI 辅助模型（单选）。切换仅影响后续接单。
2. 模型配置 → AI 辅助，分别启停模型或更新密钥。前端只收到配置状态。
3. TT 携带本地图片前，先选择已知商品图和已知特征，执行小图真实验证。特征只在本机核验，不泄漏到识图提示词。验证最长边 512px、≤48KB；识图不符、无输入用量、输入超过 8000 token 或最终费用未确认，均维持图片调用阻止。文字可单独使用。
4. 普通图片分析最多选择 4 张，默认显示全部已关联素材供选择；超过 4 张要求主动选择。后端合成最长边 1024px、≤128KB 的带图号预览，保留原图与 SHA-256。图像编辑的稳定图号随所选子集保留。
5. 分析候选可编辑、复制和下载 Markdown。只有显式插入/替换会修改草稿；原文有新输入时禁用替换，插入从最新文本开始合并。关闭面板不取消已提交的后台请求。结果可从全部任务重开。
6. 视频单个 MP4/WebM，≤30MB、≤120 秒。上传时和发送前调用 ffprobe 检查真实格式、视频流和时长；不截断。时间段与镜头字段缺失时保存原文并标为失败，不能当作动态理解验收通过。

## 接口与任务

- `GET /api/analysis/config`：模型状态、能力和设置。
- `PUT /api/analysis/models/:id`：启停、修订和密钥更新。密钥更新使本地识图验证失效。
- `PUT /api/analysis/settings`：默认模型。
- `POST /api/analysis/jobs`：包含 action、text、productName、assetIds、可选 imageNumbers、idempotencyKey。
- `GET /api/analysis/jobs`、`GET /api/analysis/jobs/:id`：历史和状态。
- `GET /api/analysis/by-key/:key`：仅核查本地接单，不重新发送供应商 POST。
- `POST /api/analysis/jobs/:id/billing`：单独查询费用，不重新生成结果。
- `POST /api/analysis/video`：视频上传和真实元数据校验。
- `POST /api/selling-points`：复用统一任务服务，需要相同幂等凭据。

后台分析并发固定 1；`queued → preparing → submitting → completed / failed / unknown`。提交前持久化模型、密钥版本引用、文字、素材及哈希快照；保存 `submitting` 后才发送供应商 POST。准备阶段重启可继续；提交阶段重启改为 unknown，不自动重提。后台关闭等待在途处理；中断请求进入待核实。

TT 使用 `/v1/chat/completions`；GEM 使用 `/v1beta/models/gem-3.8-flash:generateContent`，图片/整段视频在 `contents[].parts[].inline_data`，不使用顶层 attachments。不传未验证的思考强度参数，GEM 的 thought part 不作为候选输出。

收到响应头后立即持久化 `X-Task-Id`。内容先保存，再单独 GET `/v1/skills/task-status?task_id=...` 查询 cost/token。费用失败不清除内容，可手动补查。保留响应 usage 与最终计费 token 两套证据，供应商口径不一致时不静默覆盖；供应商已明确 cost 单位为算力，不换算人民币；终态消费使用退款后的净额。真实分析历史/用量独立于媒体模拟批次及点数。

## 凭据与备份

`data/private/master.key` 与版本化 `credentials.json` 使用 AES-256-GCM，目录 0700、文件 0600，按模型 ID 绑定 AAD，两个模型的密钥不能互借。旧密钥版本仅用于已接单任务/费用补查。普通数据库、日志、任务快照均不包含密钥。

备份仍采用 SQLite、media、skills 明确允许列表，不打包 private。保管/恢复私有目录需另行人工处理；恢复普通备份后如缺少原密钥版本，不能恢复这部分任务的凭据。媒体生成仍为模拟 Worker；AI 分析是真实接口，两者不会混为一笔费用。

## 验证

`npm test` 运行持久化/传输/凭据/门禁/视频限制测试；`npm run test:e2e` 运行原七技能回归及 AI 面板浏览器回归（后者 POST 使用模拟响应，不花费）。`scripts/live-analysis-test.ts` 是显式、可续查的真实验收脚本，不在应用启动或自动测试中执行。保留接单凭据，已有任务只查询，不自动重新发送付费 POST。

详见 [真实能力与费用报告](reports/analysis-live-20261028/验收报告.md)。
