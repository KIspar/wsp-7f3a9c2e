import {registerResearchRoutes} from './research';
import {registerResearchGeneration} from './research-generation';
import {registerResearchExtension,guardResearchExtension} from './research-extension';
import type {AnalysisService} from './analysis';
import type {RemoteReader} from './remote';
import {migrateCurrentResults} from './current-results';
import {registerWearRoutes} from './wear';
import {registerPromptRoutes} from './prompts';
import {registerWorkbenchRoutes} from './prompt-workbench';
import Fastify from "fastify";
import {createProviderService as createProviderServiceForApp,type ProviderTransport} from "./provider";
import { registerProviderRoutes } from "./provider-routes";
import { registerAccountRoutes } from "./account";
import {credentialVault} from "./credentials";
import {createGenerationPricing} from './generation-pricing';
import {registerVideoRemakeRoutes} from './video-remake';
import {registerInspirationRoutes} from './promotion-inspiration';
import { registerAnalysisRoutes } from "./analysis-routes";
import multipart from "@fastify/multipart";
import serveStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { backup } from "node:sqlite";
import archiver from "archiver";
import sharp from "sharp";
import { z, ZodError } from "zod";
import { draftSchema, layoutSchema, modelSchema, settingsSchema, submissionSchema, type Asset, type Bootstrap, type Skill } from "../../packages/contracts";
import { editAttempt, fail } from "./engine";
import { parseSkill } from "./skills";
import type { Store } from "./store";
import { exportLayout, inspectLayout } from "./layout";
import { registerCreativeRoutes } from './creative-routes';
import { analysisModelIds } from '../../packages/analysis';
import { providerCredentialIds } from '../../packages/provider';
import {token01ModelIds} from '../../packages/token01';
import {createToken01Service} from './token01';
import {createRelayService,relayModelAvailable} from './relays';
import {relayIds} from '../../packages/relays';
import {createToken01Account,token01SmsSchema,token01PhoneLoginSchema} from './token01-account';
import {createRelayCatalog} from './relay-catalog';
import {createToken01Keys} from './token01-keys';
import {createToken01Routing} from './token01-routing';
import {publicAccessFromEnv,validBasicAuth,type PublicAccess} from './access';

import {createMediaWorker} from './media-worker';
import {registerCatalogRoutes} from './catalog';
import {registerPromotionRoutes} from './promotion';
import { DEFAULT_WORKSPACE_ID } from './store';

export async function createApp(store: Store, options: { worker?: boolean; providerTransport?: ProviderTransport; analysisService?: AnalysisService; mediaRemote?: RemoteReader; publicAccess?: PublicAccess | null } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const publicAccess = options.publicAccess === undefined ? publicAccessFromEnv() : options.publicAccess;
  const token = randomBytes(32).toString("hex");
  const worker = createMediaWorker(store,{transport:options.providerTransport,remote:options.mediaRemote});
  const generationPricing=createGenerationPricing(store,options.providerTransport);
  const relays=createRelayService(store,options.providerTransport);
  const token01Account=createToken01Account(store,options.providerTransport);
  const chuheCatalog=createRelayCatalog(store,options.providerTransport);
  const token01Keys=createToken01Keys(store,options.providerTransport);
  const token01Routing=createToken01Routing(store,options.providerTransport);
  const localHost = (host: string) => ["127.0.0.1", "localhost", "[::1]"].includes(host);
  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/healthz" && request.method === "GET") return;
    const requestedWorkspace = request.headers["x-studio-workspace"];
    const workspaceId = typeof requestedWorkspace === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(requestedWorkspace) ? requestedWorkspace : DEFAULT_WORKSPACE_ID;
    store.enterWorkspace(workspaceId);
    const host = new URL(`http://${request.headers.host || "invalid"}`);
    if (publicAccess) {
      if (host.host.toLowerCase() !== publicAccess.host.toLowerCase()) return reply.code(403).send({ message: "访问地址不匹配" });
    } else if (!localHost(host.hostname)) return reply.code(403).send({ message: "仅接受本机访问" });
    if(request.url.startsWith('/api/research-extension/')){guardResearchExtension(store,request,reply);return;}
    if (publicAccess && !validBasicAuth(request.headers.authorization, publicAccess)) {
      return reply.header("WWW-Authenticate", 'Basic realm="AI Creative Studio", charset="UTF-8"')
        .code(401).send({ message: "请登录工作台" });
    }
    const origin = request.headers.origin;
    if (origin) {
      let valid = false;
      try { const url = new URL(origin); valid = publicAccess ? origin === publicAccess.origin : localHost(url.hostname) && url.protocol === "http:"; } catch { /* Invalid origins are rejected. */ }
      if (!valid) return reply.code(403).send({ message: "来源不被允许" });
    }
    if (!["GET", "HEAD"].includes(request.method) && request.headers["x-studio-token"] !== token) {
      return reply.code(403).send({ code: "SESSION_EXPIRED", message: "会话已失效，请刷新页面" });
    }
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    if (request.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
  });
  app.setErrorHandler((error, _request, reply) => {
    const err = error as Error & { statusCode?: number; code?: string };
    const message = err instanceof ZodError ? err.issues.map((i) => `${i.path.join(".")}：${i.message}`).join("；") : err.message;
    reply.code(err instanceof ZodError ? 400 : err.statusCode || 500)
      .send({ message: err.statusCode === 500 ? "操作失败，请检查本地服务日志" : message });
  });
  await app.register(multipart, { limits: { fileSize: 30 * 1024 * 1024, files: 1, fields: 0, parts: 1 } });
  await app.register(serveStatic, { root: path.join(store.dataDir, "media"), prefix: "/media/", decorateReply: true });
  await app.register(serveStatic, { root: path.join(store.projectRoot, "public/examples"), prefix: "/examples/", decorateReply: false });
  app.get("/healthz", async () => ({ ok: true }));
  const health = () => {
    let freeBytes: number | null = null;
    try { const stats = fs.statfsSync(store.dataDir); freeBytes = stats.bavail * stats.bsize; } catch { /* Some filesystems do not report capacity. */ }
    return { database: true, worker: options.worker !== false, freeBytes, mode: "live" as const };
  };
  app.get("/api/bootstrap", async () => ({
    token,
    skills: store.skills(), models: store.models().map(model=>({...model,enabled:model.enabled&&relayModelAvailable(store,model.id)!==false,relayAvailable:relayModelAvailable(store,model.id)!==false,credentialConfigured:!!credentialVault(store.dataDir).current(model.id)})), settings: store.settings(),
    drafts: store.skills().map((s) => store.readDraft(s.id)),
    examples: store.list<Asset>("asset").filter((a) => a.source === "example"),
    health: health(),
  } satisfies Bootstrap & { token: string }));
  app.get("/api/snapshot", async () => store.snapshot());
  app.get('/api/history/compositions',async()=>store.list<import('../../packages/video-remake').VideoRemakeJob>('video-remake').flatMap(j=>j.compositions.map(c=>({id:c.id,jobId:j.id,name:j.productTitle,createdAt:c.createdAt,asset:store.get<Asset>('asset',c.assetId),prompt:c.shots.map(s=>`[${s.start}–${s.end}] ${s.text.videoPrompt}`).join('\n')}))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
  registerCreativeRoutes(app,store);
  registerPromptRoutes(app,store);
  registerCatalogRoutes(app,store,generationPricing,{worker:options.worker});
  registerPromotionRoutes(app,store,generationPricing);
  registerWearRoutes(app,store,generationPricing);
  if(options.worker!==false)migrateCurrentResults(store);
  app.get("/api/health", async () => ({ ...health(), eventId: store.eventId(), dataDir: store.dataDir, node: process.version }));
  app.put<{ Params: { id: string } }>("/api/drafts/:id", async (request) => {
    const body = z.object({ draft: draftSchema, revision: z.number().int().nonnegative() }).parse(request.body);
    return store.transaction(() => store.saveDraft(request.params.id, body.draft, body.revision));
  });
  app.post("/api/plan", async (request) => {
    const body = z.object({ skillId: z.string(), draft: draftSchema, action: submissionSchema.shape.action }).parse(request.body);
    return generationPricing.plan(body.skillId,body.draft,body.action);
  });
  app.post('/api/generation/estimate',async request=>{
    const body=z.object({skillId:z.string(),draft:draftSchema,action:submissionSchema.shape.action}).parse(request.body);
    return generationPricing.estimate(body.skillId,body.draft,body.action);
  });
  app.get<{Params:{key:string}}>('/api/submissions/:key',async request=>{const row=store.db.prepare('SELECT batch_id FROM workspace_idempotency WHERE workspace_id=? AND key=?').get(store.currentWorkspace(),request.params.key);return {batch:row?store.readBatch(row.batch_id as string):null};});
  app.post("/api/submit", async (request) => generationPricing.admit(submissionSchema.parse(request.body)));
  app.post<{ Params: { id: string } }>("/api/attempts/:id/retry", async (request) => {
    const body = z.object({ revision: z.number().int(), prompt: z.string().max(16000).optional(),maximumCost:z.number().finite().nonnegative().optional() }).parse(request.body);
    return generationPricing.retry(request.params.id, body.revision, body.prompt,body.maximumCost);
  });
  app.post<{Params:{id:string}}>('/api/attempts/:id/retry-quote',async request=>{
    const {revision}=z.object({revision:z.number().int()}).parse(request.body);
    return generationPricing.retryQuote(request.params.id,revision);
  });
  app.patch<{ Params: { id: string } }>("/api/attempts/:id", async (request) => {
    const body = z.object({ revision: z.number().int(), prompt: z.string().max(16000), rebindOriginal: z.boolean().default(false) }).parse(request.body);
    return editAttempt(store, request.params.id, body.revision, body.prompt, body.rebindOriginal);
  });
  const layoutParams = z.object({id:z.string(),group:z.coerce.number().int().min(1).max(100)});
  app.get("/api/batches/:id/groups/:group/layout",async request=>{
    const {id,group}=layoutParams.parse(request.params);
    const batch=store.readBatch(id)||fail("批次不存在",404);
    if(!batch.attempts.some(a=>a.groupIndex===group)) fail("详情组不存在",404);
    return {layout:store.get("layout",`${id}-${group}`)||null};
  });
  app.put("/api/batches/:id/groups/:group/layout",async request=>{
    const {id,group}=layoutParams.parse(request.params);const layout=layoutSchema.parse(request.body);
    const info=await inspectLayout(store,id,group,layout);
    store.transaction(()=>store.put("layout",`${id}-${group}`,layout));
    return {layout,width:info.width,height:info.height,upscale:info.upscale};
  });
  app.post("/api/batches/:id/groups/:group/export",async request=>{
    const {id,group}=layoutParams.parse(request.params);
    return exportLayout(store,id,group,layoutSchema.parse(request.body));
  });
  app.get<{Params:{id:string}}>("/api/exports/:id/download",async(request,reply)=>{
    const doc=store.get<{filename:string;mime?:string}>("export",request.params.id)||fail("导出文件不存在",404);
    return reply.type(doc.mime|| (doc.filename.endsWith(".png")?"image/png":"image/jpeg")).header("Content-Disposition",`attachment; filename="${path.basename(doc.filename)}"`).send(fs.createReadStream(path.join(store.dataDir,"exports",path.basename(doc.filename))));
  });
  const analysis=registerAnalysisRoutes(app, store, options.worker !== false,options.analysisService);
  registerWorkbenchRoutes(app,store,analysis,options.worker!==false);
  registerInspirationRoutes(app,store,analysis);
  registerResearchRoutes(app,store,analysis,options.worker!==false);
  registerResearchGeneration(app,store,generationPricing);
  registerResearchExtension(app,store);
  registerVideoRemakeRoutes(app,store,analysis,generationPricing,options.worker!==false,options.providerTransport);
  const providerService=createProviderServiceForApp(store,options.providerTransport);
  registerProviderRoutes(app, store, providerService);
  registerAccountRoutes(app,store,providerService);
  app.post("/api/upload", async (request) => {
    const part = await request.file({ limits: { fileSize: store.settings().maxFileMb * 1024 * 1024 } });
    if (!part) fail("请选择图片");
    const buffer = await part.toBuffer();
    if (!buffer.length) fail("图片为空");
    const meta = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata().catch(() => fail("图片损坏或格式不支持"));
    const format = meta.format;
    if (!["jpeg", "png", "webp"].includes(format || "") || (meta.pages || 1) > 1) fail("仅接受静态 JPG、PNG、WebP 图片");
    const id = store.id("upload");
    const ext = format === "jpeg" ? "jpg" : format;
    const filename = `${id}.${ext}`;
    const file = path.join(store.dataDir, "media", filename);
    fs.writeFileSync(file + ".tmp", buffer, { flag: "wx" });
    fs.renameSync(file + ".tmp", file);
    const asset: Asset = {
      id, url: `/media/${filename}`, type: "image", mime: `image/${format}`,
      bytes: buffer.length, source: "upload", createdAt: new Date().toISOString(),
    };
    try { store.transaction(() => store.put("asset", id, asset)); } catch (error) { fs.unlinkSync(file); throw error; }
    return asset;
  });
  app.put("/api/settings", async (request) => {
    const settings = settingsSchema.parse(request.body);
    store.transaction(() => store.put("settings", "global", settings));
    return settings;
  });
  app.put<{Params:{id:string}}>('/api/models/:id/credential',async request=>{
    const model=store.models().find(m=>m.id===request.params.id)||fail('模型不存在',404);
    const {key}=z.object({key:z.string().min(1).max(220)}).parse(request.body);
    credentialVault(store.dataDir).set(model.id,key);return {configured:true};
  });
  app.put('/api/credentials/unified',async request=>{
    const {key}=z.object({key:z.string().min(1).max(250)}).parse(request.body);
    const ids=[...new Set<string>([...providerCredentialIds,...analysisModelIds,...store.models().filter(model=>model.provider!=='token01').map(model=>model.id)])];
    relays.save('chuhe',key);
    return {configured:ids.length};
  });
  app.put('/api/credentials/token01',async request=>{
    const {key}=z.object({key:z.string().min(1).max(220)}).parse(request.body);
    relays.save('token01',key);
    return {configured:token01ModelIds.length};
  });
  app.post('/api/credentials/token01/check',async()=>{
    const service=createToken01Service(store,options.providerTransport);
    const models=await Promise.all(token01ModelIds.map(async id=>({id,available:(await service.models(id)).includes(store.models().find(m=>m.id===id)!.upstreamId)})));
    return {models};
  });
  app.get('/api/relays',async()=>relays.list());
  app.get('/api/relays/chuhe/catalog',()=>chuheCatalog.catalog());
  app.get('/api/relays/token01/balance',()=>token01Account.balance());
  app.get('/api/token01/account',()=>token01Account.state());
  app.get('/api/token01/account/login-config',()=>token01Account.config());
  app.post('/api/token01/account/sms',request=>token01Account.send(token01SmsSchema.parse(request.body)));
  app.post('/api/token01/account/login',request=>token01Account.login(token01PhoneLoginSchema.parse(request.body)));
  app.post('/api/token01/account/logout',()=>token01Account.logout());
  app.get('/api/token01/keys',()=>token01Keys.list());
  app.post('/api/token01/keys',request=>{const input=z.object({name:z.string().trim().min(1).max(80),key:z.string().trim().min(1).max(220),group:z.string().trim().min(1).max(100).optional()}).parse(request.body);return token01Keys.add(input.name,input.key,input.group);});
  app.post('/api/token01/keys/:id/sync',request=>token01Keys.sync(z.object({id:z.string().uuid()}).parse(request.params).id));
  app.delete('/api/token01/keys/:id',request=>token01Keys.remove(z.object({id:z.string().uuid()}).parse(request.params).id));
  app.put('/api/relays/:id/credential',async request=>{
    const {id}=z.object({id:z.enum(relayIds)}).parse(request.params);
    const {key}=z.object({key:z.string().trim().min(1).max(220)}).parse(request.body);
    return relays.save(id,key);
  });
  app.post('/api/relays/:id/sync',async request=>relays.sync(z.object({id:z.enum(relayIds)}).parse(request.params).id));
  app.get('/api/token01/routing',async()=>token01Routing.config());
  app.post('/api/token01/routing/refresh',async()=>token01Routing.config(true));
  app.put('/api/token01/groups/credential',async request=>{
    const {group,key}=z.object({group:z.string().min(1).max(100),key:z.string().trim().min(1).max(220)}).parse(request.body);
    return token01Routing.saveGroup(group,key);
  });
  app.post('/api/token01/groups/sync',async request=>token01Routing.syncGroup(z.object({group:z.string().min(1).max(100)}).parse(request.body).group));
  app.put('/api/token01/models/:id/route',async request=>{
    const {id}=z.object({id:z.enum(token01ModelIds)}).parse(request.params);
    const {group,revision,keyId}=z.object({group:z.string().min(1).max(100).nullable(),revision:z.number().int().positive(),keyId:z.string().uuid().nullable().optional()}).parse(request.body);
    return token01Routing.route(id,group,revision,keyId);
  });
  app.post('/api/video-remakes/audio',async request=>{
    const part=await request.file({limits:{fileSize:30*1024*1024}});if(!part)fail('请选择音频');
    const bytes=await part.toBuffer(),id=store.id('audio'),temp=path.join(store.dataDir,'media',id+'.tmp');fs.writeFileSync(temp,bytes);
    try{const {probeAudio}=await import('./video-audio');const info=await probeAudio(temp);const filename=id+info.extension;fs.renameSync(temp,path.join(store.dataDir,'media',filename));
    const a:Asset={id,url:'/media/'+filename,type:'audio',mime:info.mime,bytes:bytes.length,source:'upload',createdAt:new Date().toISOString()};store.put('asset',id,a);return a;
    }finally{fs.rmSync(temp,{force:true});}
  });
  app.put<{ Params: { id: string } }>("/api/models/:id", async (request) => {
    const model = modelSchema.parse(request.body);
    const current = store.models().find((m) => m.id === request.params.id) || fail("模型不存在", 404);
    if (model.id !== current.id || model.category !== current.category || model.revision !== current.revision) fail("模型版本已变化或标识不匹配", 409);
    // Capabilities stay pinned until a real adapter has passed its contract tests.
    const next = { ...current, enabled: model.enabled, points: model.points, revision: current.revision + 1 };
    store.transaction(() => store.put("model", next.id, next));
    return next;
  });
  app.post("/api/skills/validate", async (request) => {
    const { source } = z.object({ source: z.string().max(100_000) }).parse(request.body);
    const skill = parseSkill(source);
    return { id: skill.id, hash: skill.hash, sections: Object.keys(skill.sections), valid: true };
  });
  app.post<{ Params: { id: string } }>("/api/skills/:id/publish", async (request) => {
    const { source, revision } = z.object({ source: z.string().max(100_000), revision: z.number().int() }).parse(request.body);
    const current = store.skills().find((s) => s.id === request.params.id) || fail("技能不存在", 404);
    const parsed = parseSkill(source);
    if (parsed.id !== current.id || parsed.executor !== current.executor || parsed.category !== current.category) fail("首版不支持改变技能标识、类别或执行器");
    if (current.revision !== revision) fail("技能已发布新版本，请重新加载", 409);
    const next: Skill = { ...parsed, source, revision: revision + 1, unpublished: false };
    const file = path.join(store.projectRoot, "skills", current.id, "技能提示词.md");
    fs.writeFileSync(file + ".tmp", source, "utf8");
    fs.renameSync(file + ".tmp", file);
    store.transaction(() => store.put("skill", next.id, next));
    return next;
  });
  app.get<{ Params: { id: string } }>("/api/assets/:id/download", async (request, reply) => {
    // Native download links cannot send the API client's workspace header.
    const scope = !request.headers['x-studio-workspace'] && store.workspaceOf('asset', request.params.id);
    const asset = (scope ? store.withWorkspace(scope, () => store.get<Asset>('asset', request.params.id)) : store.get<Asset>('asset', request.params.id)) || fail("素材不存在", 404);
    const filename = path.basename(asset.url);
    const root = asset.source === "example" ? path.join(store.projectRoot, "public/examples") : path.join(store.dataDir, "media");
    return reply.type(asset.mime).header("Content-Disposition", `attachment; filename="${filename}"`).send(fs.createReadStream(path.join(root, filename)));
  });
  app.get<{ Params: { id: string } }>("/api/batches/:id/download", async (request, reply) => {
    const scope = !request.headers['x-studio-workspace'] && store.workspaceOf('batch', request.params.id);
    const batch = (scope ? store.withWorkspace(scope, () => store.readBatch(request.params.id)) : store.readBatch(request.params.id)) || fail("批次不存在", 404);
    const completed = batch.attempts.filter((a) => a.status === "completed" && a.assetId);
    if (!completed.length) fail("暂无已保存的成品");
    const zip = archiver("zip", { zlib: { level: 5 } });
    zip.on("error", (error) => reply.raw.destroy(error));
    for (const attempt of completed) {
      const asset = (scope ? store.withWorkspace(scope, () => store.get<Asset>('asset', attempt.assetId!)) : store.get<Asset>('asset', attempt.assetId!))!;
      const file = path.basename(asset.url);
      zip.file(path.join(store.dataDir, "media", file), { name: `${attempt.index}-${attempt.id.slice(-8)}${path.extname(file)}` });
    }
    zip.append(JSON.stringify({ ...batch, note: batch.simulated?"历史本地模拟记录，非模型生成。":"真实供应商生成，费用及退款以结算为准。" }, null, 2), { name: "task-snapshot.json" });
    void zip.finalize();
    return reply.type("application/zip").header("Content-Disposition", `attachment; filename="${batch.id}.zip"`).send(zip);
  });
  app.get("/api/backup", async (_request, reply) => {
    const file = path.join(store.dataDir, "exports", `${store.id("backup")}.sqlite`);
    await backup(store.db, file);
    const zip = archiver("zip", { zlib: { level: 3 } });
    zip.on("error", (error) => reply.raw.destroy(error));
    zip.on("end", () => fs.rmSync(file, { force: true }));
    zip.file(file, { name: "data/studio.sqlite" });
    zip.directory(path.join(store.dataDir, "media"), "data/media", (entry) => entry.name.endsWith(".tmp") ? false : entry);
    if(fs.existsSync(path.join(store.dataDir,"video-remakes")))zip.directory(path.join(store.dataDir,"video-remakes"),"data/video-remakes",entry=>entry.name.endsWith(".tmp")?false:entry);
    zip.directory(path.join(store.projectRoot, "skills"), "skills");
    zip.append("AI 创作工作台 v0.1.0\n工作台备份。恢复前先关闭应用；包含历史任务、商品工坊及真实生成与分析任务、上传素材，不含模型凭据。\n", { name: "README.txt" });
    void zip.finalize();
    return reply.type("application/zip").header("Content-Disposition", 'attachment; filename="creative-studio-backup.zip"').send(zip);
  });
  const dist = path.join(store.projectRoot, "dist");
  if (fs.existsSync(dist)) {
    await app.register(serveStatic, { root: dist, prefix: "/", decorateReply: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/") || request.url.startsWith("/media/")) return reply.code(404).send({ message: "资源不存在" });
      return reply.type("text/html").send(fs.createReadStream(path.join(dist, "index.html")));
    });
  }
  if (options.worker !== false) worker.start();
  app.addHook("onClose", async () => worker.stop());
  return app;
}
