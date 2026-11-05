import {sellingLayouts} from '../../packages/selling-layouts';
import {token01Models} from '../../packages/token01';
import {emptyPrompt,type PromptTemplate,type PromptVersion} from '../../packages/prompts';
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Asset, Attempt, Batch, Draft, LedgerEntry, Model, SavedDraft, Settings, Skill, Snapshot, ProductProfile, ResultSelection } from "../../packages/contracts";
import { defaultDraft, restoreDraft } from "../../packages/contracts";
import { readSkillSources } from "./skills";
import {ecommerceControls} from '../../packages/ecommerce/controls';
import {ecommerceCommonKeys,ecommerceImageRatios} from '../../packages/ecommerce/settings';

export const DEFAULT_WORKSPACE_ID = "douyin-cn-fashion";
const GLOBAL_DOCUMENT_KINDS = new Set([
  "analysis-model", "analysis-settings", "model", "settings", "skill", "skill-history", "bundled-skill",
  "prompt-template", "prompt-version", "prompt-save", "relay-catalog", "token01-account",
  "token01-group", "token01-key", "token01-routing", "token01-user-session",
  "research-extension-code", "research-extension-pair",
]);

export function createStore(dataDir: string, projectRoot: string) {
  fs.mkdirSync(path.join(dataDir, "media"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "exports"), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "studio.sqlite"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS documents (kind TEXT, id TEXT, value TEXT NOT NULL, PRIMARY KEY (kind, id));
    CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, batch_id TEXT NOT NULL, fingerprint TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ledger (attempt_id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_documents (kind TEXT NOT NULL, workspace_id TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind, workspace_id, id));
    CREATE INDEX IF NOT EXISTS workspace_documents_lookup ON workspace_documents(kind, id);
    CREATE TABLE IF NOT EXISTS workspace_idempotency (workspace_id TEXT NOT NULL, key TEXT NOT NULL, batch_id TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(workspace_id, key));
  `);
  const workspaceContext = new AsyncLocalStorage<string>();
  const currentWorkspaceId = () => workspaceContext.getStore();
  const globalKind = (kind: string) => GLOBAL_DOCUMENT_KINDS.has(kind);
  const rowFor = (kind: string, id: string, workspaceId?: string) => workspaceId
    ? db.prepare("SELECT workspace_id, value FROM workspace_documents WHERE kind=? AND id=? AND workspace_id=?").get(kind, id, workspaceId)
    : db.prepare("SELECT workspace_id, value FROM workspace_documents WHERE kind=? AND id=? ORDER BY CASE WHEN workspace_id=? THEN 0 WHEN workspace_id='global' THEN 1 ELSE 2 END LIMIT 1").get(kind, id, DEFAULT_WORKSPACE_ID);

  // Migrate the legacy unpartitioned documents once; existing user data belongs to the original workspace.
  const migrated = db.prepare("SELECT value FROM workspace_documents LIMIT 1").get();
  if (!migrated) {
    const legacy = db.prepare("SELECT kind, id, value FROM documents").all() as { kind: string; id: string; value: string }[];
    const insert = db.prepare("INSERT OR IGNORE INTO workspace_documents(kind,workspace_id,id,value) VALUES (?,?,?,?)");
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of legacy) {
        let workspaceId = globalKind(row.kind) ? "global" : DEFAULT_WORKSPACE_ID;
        if (row.kind === "asset") {
          try { const source = (JSON.parse(row.value) as {source?: string}).source; if (source === "example" || source === "template") workspaceId = "global"; } catch { /* Preserve invalid legacy records in the default workspace. */ }
        }
        insert.run(row.kind, workspaceId, row.id, row.value);
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function targetWorkspace(kind: string, id: string, value: unknown): string {
    if (globalKind(kind)) return "global";
    if (kind === "asset") {
      const source = (value as {source?: string})?.source;
      if (source === "example" || source === "template") return "global";
    }
    const scope = currentWorkspaceId();
    if (scope) return scope;
    const storedWorkspace = (value as {workspaceId?: unknown} | null)?.workspaceId;
    if (typeof storedWorkspace === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(storedWorkspace)) return storedWorkspace;
    const existing = rowFor(kind, id)?.workspace_id as string | undefined;
    if (existing) return existing;
    const refs = value as Record<string, unknown> | null;
    if (kind === "asset" && id.startsWith("provider-")) {
      const attempt = rowFor("attempt", id.slice("provider-".length));
      if (attempt) return attempt.workspace_id as string;
    }
    const references: [string, unknown][] = [["batch", refs?.batchId], ["attempt", refs?.attemptId], ["catalog-product", refs?.productId], ["workbench-creation", refs?.creationId], ["workbench-project", refs?.projectId]];
    for (const [refKind, refId] of references) {
      if (typeof refId !== "string") continue;
      const found = rowFor(refKind, refId);
      if (found) return found.workspace_id as string;
    }
    const assetIds = Array.isArray(refs?.assetIds) ? refs.assetIds : Array.isArray((refs?.input as Record<string, unknown> | undefined)?.assetIds) ? ((refs?.input as Record<string, unknown>).assetIds as unknown[]) : [];
    for (const assetId of assetIds) if (typeof assetId === "string") {
      const found = rowFor("asset", assetId);
      if (found && found.workspace_id !== "global") return found.workspace_id as string;
    }
    const skillId = typeof refs?.skillId === "string" ? refs.skillId : typeof (refs?.input as Record<string, unknown> | undefined)?.skillId === "string" ? String((refs?.input as Record<string, unknown>).skillId) : "";
    if (skillId.startsWith("prompt-workbench:")) {
      const found = rowFor("workbench-creation", skillId.slice("prompt-workbench:".length));
      if (found) return found.workspace_id as string;
    }
    return DEFAULT_WORKSPACE_ID;
  }
  const get = <T>(kind: string, id: string): T | undefined => {
    const scope = currentWorkspaceId();
    let row = rowFor(kind, id, globalKind(kind) ? "global" : scope);
    if (!row && kind === "asset" && scope) row = rowFor(kind, id, "global");
    if (!row && !scope && !globalKind(kind)) row = rowFor(kind, id);
    return row ? JSON.parse(row.value as string) as T : undefined;
  };
  const list = <T>(kind: string): T[] => {
    const scope = currentWorkspaceId();
    if (globalKind(kind)) return db.prepare("SELECT value FROM workspace_documents WHERE kind=? AND workspace_id='global'").all(kind).map((row) => JSON.parse(row.value as string) as T);
    if (kind === "asset" && scope) return db.prepare("SELECT value FROM workspace_documents WHERE kind=? AND workspace_id IN (?, 'global')").all(kind, scope).map((row) => JSON.parse(row.value as string) as T);
    if (scope) return db.prepare("SELECT value FROM workspace_documents WHERE kind=? AND workspace_id=?").all(kind, scope).map((row) => JSON.parse(row.value as string) as T);
    return db.prepare("SELECT value FROM workspace_documents WHERE kind=?").all(kind).map((row) => JSON.parse(row.value as string) as T);
  };
  const put = (kind: string, id: string, value: unknown) => {
    const workspaceId = targetWorkspace(kind, id, value);
    return db.prepare("INSERT INTO workspace_documents(kind,workspace_id,id,value) VALUES (?,?,?,?) ON CONFLICT(kind,workspace_id,id) DO UPDATE SET value=excluded.value").run(kind, workspaceId, id, JSON.stringify(value));
  };
  const remove = (kind: string, id: string) => {
    const scope = currentWorkspaceId();
    if (globalKind(kind)) return db.prepare("DELETE FROM workspace_documents WHERE kind=? AND workspace_id='global' AND id=?").run(kind, id);
    if (scope) return db.prepare("DELETE FROM workspace_documents WHERE kind=? AND workspace_id=? AND id=?").run(kind, scope, id);
    return db.prepare("DELETE FROM workspace_documents WHERE kind=? AND id=?").run(kind, id);
  };
  const withWorkspace = <T>(workspaceId: string, fn: () => T): T => workspaceContext.run(workspaceId, fn);
  const enterWorkspace = (workspaceId: string) => workspaceContext.enterWith(workspaceId);
  const workspaceOf = (kind: string, id: string) => rowFor(kind, id)?.workspace_id as string | undefined;
  const currentWorkspace = () => currentWorkspaceId() || DEFAULT_WORKSPACE_ID;
  const listeners = new Set<(id: number) => void>();
  const eventId = () => Number(db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM events").get()!.id);
  const transaction = <T>(fn: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    let result: T;
    try {
      result = fn();
      db.prepare("INSERT INTO events(type,created_at) VALUES (?,?)").run("snapshot", new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const id = eventId();
    for (const listener of listeners) {
      try { listener(id); } catch { /* A disconnected observer must not roll back a committed task. */ }
    }
    return result;
  };
  const initialModels: Model[] = [
    {
      id: "tt-image", name: "TT Image 2.5", upstreamId: "tt-image-2.5", category: "image",
      provider: "chuhe", revision: 1, enabled: true, maxReferences: 16,
      aspectRatios: [...ecommerceImageRatios], durations: [], points: null,
      parameters: {
        resolution: { label: "输出分辨率", type: "select", default: "1K", options: ["1K", "2K", "4K", "auto"] },
        version: { label: "模型版本", type: "select", default: "flare", options: ["flare", "sunburst"] },
        quality: { label: "质量档位", type: "select", default: "auto", options: ["auto", "low", "medium", "high", "xhigh", "max"] },
        background: { label: "背景模式", type: "select", default: "opaque", options: ["opaque", "transparent", "auto"] },
      },
    },
    {
      id: "omni", name: "Omni Flash", upstreamId: "omni-flash", category: "video",
      provider: "chuhe", revision: 1, enabled: true, maxReferences: 3,
      aspectRatios: ["9:16", "16:9"], durations: [4, 6, 8, 10], points: null,
      parameters: {
        enhance_prompt: { label: "提示词增强", type: "boolean", default: false },
        enable_upsample: { label: "超分处理", type: "boolean", default: false },
      },
    },
    {id:'gk-video-3.5',name:'GK 视频 3.5',upstreamId:'gk-video-3.5',category:'video',provider:'chuhe',revision:1,enabled:true,maxReferences:1,aspectRatios:['9:16','16:9','1:1','3:2','2:3'],durations:Array.from({length:15},(_,i)=>i+1),points:null,parameters:{resolution:{label:'视频画质',type:'select',default:'720p',options:['720p','480p']}}},
  ];
  for (const model of [...initialModels,...token01Models]) {
    const existing=get<Model>("model",model.id);
    if(!existing)put("model",model.id,model);
    else if(existing.provider==='simulator')put("model",model.id,{...existing,provider:'chuhe',revision:existing.revision+1,points:null});
    else if(existing.id==='tt-image'&&existing.provider==='chuhe'&&ecommerceImageRatios.some(ratio=>!existing.aspectRatios.includes(ratio)))put('model',existing.id,{...existing,aspectRatios:[...new Set([...existing.aspectRatios,...ecommerceImageRatios])],revision:existing.revision+1});
  }
  if (!get("settings", "global")) put("settings", "global", {
    imageConcurrency: 20, videoConcurrency: 1, referenceQuota: null,
    maxBatch: 40, maxFileMb: 15,
  } satisfies Settings);
  const stockHashes: Record<string,string> = {"image-generate":"cb9a9ba1b2a4eed4ea04fd9bbf32e2e659127986f882a7111e4f22593587b842","scene-recreate":"08ee0358ce49cd649c6bf49692e5def5503ccb9ae7e2ce6b3b6470c226557ffa"};
  for (const skill of readSkillSources(path.join(projectRoot, "skills"))) {
    const previous = get<Skill>("skill", skill.id);
    const bundled = get<{hash:string;revision:number;managed:boolean}>("bundled-skill", skill.id);
    const originalEcommerce = !bundled && skill.id.startsWith("ec-") && previous?.revision === 1
      && previous.source.includes('你是电商视觉设计师。当前任务是「')
      && previous.source.includes('不得捏造商品材质、尺寸');
    const managedEcommerce = skill.id.startsWith('ec-') && (!previous || originalEcommerce
      || bundled?.managed === true && bundled.hash === previous.hash && bundled.revision === previous.revision);
    if (!previous) put("skill", skill.id, skill);
    else if ((managedEcommerce || [stockHashes[skill.id],...(skill.id === "scene-recreate" ? ["1ed2f517801ecd62070e8d33c1ad1b550f4da3da504de4b97fedacc45513fa14"] : skill.id === "detail-design" ? ["485117f9367b6243bada08f0c2cd91d113df7fb1392baa91a9d141b6ae0b3e85","9ddd7ae910b2cacd5ad728c0bb59418f05ba94775274989ab2092e220e7499ba"] : [])].includes(previous.hash)) && previous.hash !== skill.hash) {
      // Upgrade only the shipped original. Custom published skills stay untouched.
      put("skill-history", `${previous.id}-${previous.revision}`, previous);
      put("skill", skill.id, {...skill, revision:previous.revision+1});
      const drafts = db.prepare("SELECT workspace_id,value FROM workspace_documents WHERE kind='draft' AND id=?").all(skill.id);
      for (const row of drafts) {
        const saved = JSON.parse(row.value as string) as SavedDraft;
        let source = saved.value;
        if (skill.id.startsWith('ec-')) {
          // Option numbers can move when page controls change. Match saved choices by their label.
          const fields = Object.fromEntries(Object.entries(skill.fields).map(([key,field]) => {
            const oldKey = ecommerceCommonKeys.includes(key)&&previous.fields[key]?key:Object.keys(previous.fields).find(name => previous.fields[name].label === field.label);
            let value = oldKey ? source.fields[oldKey] : undefined;
            if(field.type==='boolean'&&typeof value!=='boolean')value=field.default;
            if (field.options?.length && value !== undefined) {
              const aliases=ecommerceControls[skill.id]?.controls.find(c=>c.label===field.label)?.aliases||{};
              const mapped=aliases[String(value)]||String(value);
              const allowed = mapped.split('、').map(part=>aliases[part]||part).filter(part => field.options!.includes(part));
              value = field.type === 'select' ? (field.options.includes(mapped) ? mapped : field.default) : (mapped===''?'':allowed.join('、') || field.default);
            }
            return [key,value ?? field.default ?? ''];
          }));
          source = {...source,fields};
        }
        const value = restoreDraft(skill,modelsForMigration(),source);
        withWorkspace(row.workspace_id as string, () => {
          put("draft-history",`${skill.id}-${saved.revision}`,saved);
          put("draft",skill.id,{skillId:skill.id,revision:saved.revision+1,value});
        });
      }
    }
    if (skill.id.startsWith('ec-')) put('bundled-skill',skill.id,{hash:skill.hash,revision:get<Skill>('skill',skill.id)!.revision,managed:managedEcommerce});
  }
  // Seed once; subsequent user edits and archived templates remain intact.
  for(const layout of sellingLayouts){
    if(get<PromptTemplate>('prompt-template',layout.id))continue;
    const file=path.join(projectRoot,'public/selling-layouts',`${layout.id.slice(-2)}.webp`);
    if(!fs.existsSync(file))continue;
    const stamp=new Date().toISOString(),assetId=`${layout.id}-preview`,versionId=`${layout.id}-v1`;
    fs.copyFileSync(file,path.join(dataDir,'media',`${assetId}.webp`));
    put('asset',assetId,{id:assetId,url:`/media/${assetId}.webp`,type:'image',mime:'image/webp',bytes:fs.statSync(file).size,createdAt:stamp,source:'template'} satisfies Asset);
    const value={...emptyPrompt('image-layout','image'),name:layout.name,description:layout.rules,tags:['卖点版式','通用'],prompt:layout.rules,exampleIds:[assetId],layout:{structure:layout.rules,textDensity:layout.textDensity,productPosition:'依据布局规则安排',ratios:layout.ratios,fields:layout.fields,categories:[layout.category]}};
    put('prompt-version',versionId,{id:versionId,templateId:layout.id,number:1,createdAt:stamp,value} satisfies PromptVersion);
    put('prompt-template',layout.id,{id:layout.id,revision:1,currentVersionId:versionId,createdAt:stamp,updatedAt:stamp,archived:false} satisfies PromptTemplate);
  }
  function modelsForMigration() { return list<Model>("model"); }
  const exampleNames = ["10-1.jpg", "10-2.jpg", "10-3.jpg", "10-4.jpg", "6-1.jpg", "6-2.jpg", "6-3.jpg", "6-4.jpg", "6-5.jpg", "9-1.jpg"];
  for (const filename of exampleNames) {
    const file = path.join(projectRoot, "public/examples", filename);
    const id = `example-${filename.replace(".jpg", "")}`;
    if (fs.existsSync(file) && !get("asset", id)) put("asset", id, {
      id, url: `/examples/${filename}`, type: "image", mime: "image/jpeg",
      bytes: fs.statSync(file).size, createdAt: new Date().toISOString(), source: "example",
    } satisfies Asset);
  }
  function readBatch(id: string): Batch | undefined {
    const batch = get<Batch>("batch", id);
    if (!batch) return;
    batch.attempts = list<Attempt>("attempt").filter((attempt) => attempt.batchId === id)
      .sort((a, b) => a.index - b.index || a.attemptNumber - b.attemptNumber);
    return batch;
  }
  const settings = () => get<Settings>("settings", "global")!;
  const models = () => list<Model>("model");
  const skills = () => list<Skill>("skill").map((skill) => {
    const file = path.join(projectRoot, "skills", skill.id, "技能提示词.md");
    return { ...skill, ...(skill.id==='model-outfit'?{name:'服饰穿戴'}:{}), unpublished: fs.existsSync(file) && fs.readFileSync(file, "utf8") !== skill.source };
  });
  const readDraft = (skillId: string): SavedDraft => {
    const saved = get<SavedDraft>("draft", skillId);
    if (saved) return saved;
    const skill = get<Skill>("skill", skillId);
    if (!skill) throw new Error("技能不存在");
    return { skillId, revision: 0, value: defaultDraft(skill, models()) };
  };
  const snapshot = (): Snapshot => {
    const batches = list<Batch>("batch").map((batch) => readBatch(batch.id)!).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const batchIds = new Set(batches.map((batch) => batch.id));
    return {
      batches, assets: list<Asset>("asset"),
      ledger: db.prepare("SELECT value FROM ledger ORDER BY rowid DESC").all().map((row) => JSON.parse(row.value as string) as LedgerEntry).filter((entry) => !currentWorkspaceId() || batchIds.has(entry.batchId)),
      eventId: eventId(), products: list<ProductProfile>('product').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),
      selections: list<ResultSelection>('result-selection'),
    };
  };
  const saveDraft = (skillId: string, value: Draft, expectedRevision: number) => {
    const current = readDraft(skillId);
    if (current.revision !== expectedRevision) throw Object.assign(new Error("草稿已在其他窗口更新，本地输入已保留。"), { statusCode: 409 });
    const next = { skillId, revision: current.revision + 1, value };
    put("draft", skillId, next);
    return next;
  };
  return {
    db, dataDir, projectRoot, get, list, put, remove, withWorkspace, enterWorkspace, workspaceOf, currentWorkspace, transaction, eventId, listeners, readBatch,
    settings, models, skills, readDraft, saveDraft, snapshot,
    id: (prefix: string) => `${prefix}-${randomUUID()}`,
    close: () => db.close(),
  };
}
export type Store = ReturnType<typeof createStore>;
