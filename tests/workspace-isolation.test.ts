import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore, DEFAULT_WORKSPACE_ID, type Store } from "../apps/server/store";
import { createApp } from "../apps/server/app";
import { createAnalysisService } from "../apps/server/analysis";
import { defaultDraft, type Asset, type ProductProfile } from "../packages/contracts";
import { compilePlan, submit } from "../apps/server/engine";

let store: Store;
let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-isolation-")); store = createStore(directory, process.cwd()); });
afterEach(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });

const product = (id: string): ProductProfile => ({
  id, name: id, facts: "", assetIds: ["image"], revision: 1, updatedAt: new Date().toISOString(),
});
const asset = (id: string): Asset => ({
  id, url: `/media/${id}.jpg`, type: "image", mime: "image/jpeg", bytes: 10,
  createdAt: new Date().toISOString(), source: "upload",
});

describe("工作台数据隔离", () => {
  it('downloads saved results without a workspace header and respects an explicit scope', async () => {
    fs.writeFileSync(path.join(directory,'media','ph-download.jpg'),'saved image');
    const batch=store.withWorkspace('tiktok-ph-3c',()=>{
      const image=asset('ph-download');store.put('asset',image.id,image);
      const draft=defaultDraft(store.skills().find(s=>s.id==='image-generate')!,store.models());
      draft.requirements='下载测试';const plan=compilePlan(store,'image-generate',draft);
      const batch=submit(store,{skillId:plan.skillId,draft,planHash:plan.hash,action:'generate',idempotencyKey:crypto.randomUUID(),expectedDraftRevision:0},undefined,false).batch;
      const attempt=batch.attempts[0];store.put('attempt',attempt.id,{...attempt,status:'completed',assetId:image.id});return batch;
    });
    const app=await createApp(store,{worker:false});
    try{
      const file=await app.inject('/api/assets/ph-download/download');
      expect(file.statusCode).toBe(200);expect(file.body).toBe('saved image');
      expect(file.headers['content-disposition']).toContain('attachment');
      const zip=await app.inject(`/api/batches/${batch.id}/download`);
      expect(zip.statusCode).toBe(200);expect(zip.rawPayload.subarray(0,2).toString()).toBe('PK');
      expect(zip.headers['content-type']).toContain('application/zip');
      for(const url of ['/api/assets/ph-download/download',`/api/batches/${batch.id}/download`])expect((await app.inject({url,headers:{'x-studio-workspace':DEFAULT_WORKSPACE_ID}})).statusCode).toBe(404);
    }finally{await app.close();}
  });
  it('downloads an export from its owning workspace through a native link while rejecting an explicit foreign scope', async () => {
    fs.writeFileSync(path.join(directory,'exports','scoped-delivery.zip'),'PK scoped delivery');
    store.withWorkspace('tiktok-ph-3c',()=>store.put('export','scoped-delivery',{filename:'scoped-delivery.zip',mime:'application/zip'}));
    const app=await createApp(store,{worker:false});
    try {
      const native=await app.inject('/api/exports/scoped-delivery/download');
      expect(native.statusCode).toBe(200);
      expect(native.body).toBe('PK scoped delivery');
      expect(native.headers['content-type']).toContain('application/zip');
      expect(native.headers['content-disposition']).toContain('scoped-delivery.zip');
      const owner=await app.inject({url:'/api/exports/scoped-delivery/download',headers:{'x-studio-workspace':'tiktok-ph-3c'}});
      expect(owner.statusCode).toBe(200);
      const foreign=await app.inject({url:'/api/exports/scoped-delivery/download',headers:{'x-studio-workspace':DEFAULT_WORKSPACE_ID}});
      expect(foreign.statusCode).toBe(404);
      expect((await app.inject('/api/exports/missing-delivery/download')).statusCode).toBe(404);
    } finally {await app.close();}
  });
  it("partitions user documents and assets while keeping model and prompt definitions global", () => {
    store.withWorkspace(DEFAULT_WORKSPACE_ID, () => {
      store.put("product", "cn-product", product("cn-product"));
      store.put("asset", "cn-image", asset("cn-image"));
      store.put("model", "shared-model", { id: "shared-model" });
      store.put("prompt-template", "shared-prompt", { id: "shared-prompt" });
    });
    store.withWorkspace("tiktok-ph-3c", () => {
      expect(store.get("product", "cn-product")).toBeUndefined();
      expect(store.get("asset", "cn-image")).toBeUndefined();
      expect(store.get("model", "shared-model")).toEqual({ id: "shared-model" });
      expect(store.get("prompt-template", "shared-prompt")).toEqual({ id: "shared-prompt" });
      store.put("product", "ph-product", product("ph-product"));
    });
    store.withWorkspace(DEFAULT_WORKSPACE_ID, () => {
      expect(store.list<ProductProfile>("product").map((p) => p.id)).toEqual(["cn-product"]);
    });
  });

  it("applies the request workspace to snapshots and saved drafts", async () => {
    const app = await createApp(store, { worker: false });
    try {
      const token = (await app.inject("/api/bootstrap")).json().token;
      const cn = { "x-studio-token": token, "x-studio-workspace": DEFAULT_WORKSPACE_ID };
      const ph = { "x-studio-token": token, "x-studio-workspace": "tiktok-ph-3c" };
      store.withWorkspace(DEFAULT_WORKSPACE_ID, () => store.put("asset", "cn-image", asset("cn-image")));
      store.put("asset", "example-shared", { ...asset("example-shared"), source: "example" });
      const saveProduct = await app.inject({ method: "POST", url: "/api/products", headers: cn, payload: { name: "国内商品", facts: "", assetIds: ["cn-image"] } });
      expect(saveProduct.statusCode).toBe(200);
      const [cnConcurrent, phConcurrent] = await Promise.all([
        app.inject({ method: "POST", url: "/api/products", headers: cn, payload: { name: "国内并发商品", facts: "", assetIds: ["example-shared"] } }),
        app.inject({ method: "POST", url: "/api/products", headers: ph, payload: { name: "菲律宾并发商品", facts: "", assetIds: ["example-shared"] } }),
      ]);
      expect(cnConcurrent.statusCode).toBe(200);
      expect(phConcurrent.statusCode).toBe(200);
      expect((await app.inject({ url: "/api/snapshot", headers: cn })).json().products).toHaveLength(2);
      expect((await app.inject({ url: "/api/snapshot", headers: ph })).json().products).toHaveLength(1);
      const phBoot = (await app.inject({ url: "/api/bootstrap", headers: ph })).json();
      expect(phBoot.drafts.find((d: { skillId: string }) => d.skillId === "image-generate").revision).toBe(0);
    } finally { await app.close(); }
  });

  it("keeps overlapping asynchronous workspace scopes independent", async () => {
    const readAfterYield = (workspaceId: string, id: string) => store.withWorkspace(workspaceId, async () => {
      store.put("product", id, product(id));
      await new Promise((resolve) => setTimeout(resolve, 5));
      return store.list<ProductProfile>("product").map((p) => p.id);
    });
    const [cn, ph] = await Promise.all([
      readAfterYield(DEFAULT_WORKSPACE_ID, "cn-concurrent"),
      readAfterYield("tiktok-ph-3c", "ph-concurrent"),
    ]);
    expect(cn).toEqual(["cn-concurrent"]);
    expect(ph).toEqual(["ph-concurrent"]);
  });

  it("restores the owning workspace while an analysis worker handles a text-only job", async () => {
    const transport = async () => Response.json({ choices: [{ message: { content: "保留商品原有细节" } }] });
    const analysis = createAnalysisService(store, transport);
    analysis.configure("tt-6.1-sol", { key: "sk-workspace-test-key-1234567890" });
    const job = store.withWorkspace("tiktok-ph-3c", () => analysis.submit({
      action: "polish", text: "整理提示词", productName: "测试商品", assetIds: [], idempotencyKey: "ph-analysis-worker-1",
    }));

    analysis.tick();
    await analysis.idle();

    store.withWorkspace("tiktok-ph-3c", () => expect(analysis.job(job.id).status).toBe("completed"));
    store.withWorkspace(DEFAULT_WORKSPACE_ID, () => expect(analysis.jobs()).toHaveLength(0));
    expect(store.workspaceOf("analysis-job", job.id)).toBe("tiktok-ph-3c");
  });
});
