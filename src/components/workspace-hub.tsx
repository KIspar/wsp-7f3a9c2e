import { useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowRight, Boxes, Check, ChevronDown, Globe2, Plus, Sparkles, Trash2, Video, WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormSelect } from "@/components/form-select";
import { ACTIVE_WORKSPACE_KEY, DEFAULT_WORKSPACE_ID, WORKSPACE_STORAGE_KEY } from "@/lib/workspace-scope";

export type WorkspaceProfile = {
  id: string;
  name: string;
  platform: string;
  platformLabel: string;
  country: string;
  countryLabel: string;
  category: string;
  categoryLabel: string;
  language: string;
  currency: string;
  updatedAt: number;
};

const starterProfiles: WorkspaceProfile[] = [
  { id: "douyin-cn-fashion", name: "国内抖音 · 服装", platform: "douyin", platformLabel: "抖音", country: "CN", countryLabel: "中国大陆", category: "fashion", categoryLabel: "服装", language: "中文", currency: "CNY", updatedAt: 0 },
  { id: "tiktok-ph-3c", name: "TikTok · 菲律宾 · 3C", platform: "tiktok", platformLabel: "TikTok", country: "PH", countryLabel: "菲律宾", category: "3c", categoryLabel: "3C 数码", language: "English / Filipino", currency: "PHP", updatedAt: 0 },
  { id: "tiktok-us-beauty", name: "TikTok · 美国 · 美妆", platform: "tiktok", platformLabel: "TikTok", country: "US", countryLabel: "美国", category: "beauty", categoryLabel: "美妆", language: "English", currency: "USD", updatedAt: 0 },
];

export function readWorkspaces(): WorkspaceProfile[] {
  try {
    const saved = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY) || "null");
    if (Array.isArray(saved)) return saved;
  } catch { /* Use the starter profiles when the local registry is unreadable. */ }
  localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(starterProfiles));
  return starterProfiles;
}

export function activeWorkspace(): WorkspaceProfile {
  const workspaces = readWorkspaces();
  const id = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  return workspaces.find((workspace) => workspace.id === id) || workspaces.find((workspace) => workspace.id === DEFAULT_WORKSPACE_ID) || workspaces[0] || starterProfiles[0];
}

type WorkspaceHubProps = { onEnter: (workspace: WorkspaceProfile) => void };
type FormState = { name: string; platform: string; country: string; category: string; language: string };
const initialForm: FormState = { name: "", platform: "tiktok", country: "PH", category: "3c", language: "English" };
const labels = {
  platform: { douyin: "抖音", tiktok: "TikTok", other: "其他平台" },
  country: { CN: ["中国大陆", "CNY", "中文"], PH: ["菲律宾", "PHP", "English / Filipino"], US: ["美国", "USD", "English"], JP: ["日本", "JPY", "日本語"], other: ["其他地区", "自定义", "自定义"] },
  category: { fashion: "服装", "3c": "3C 数码", beauty: "美妆", home: "家居", food: "食品", other: "其他品类" },
} as const;

export function WorkspaceHub({ onEnter }: WorkspaceHubProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isCreate = location.pathname.endsWith("/new");
  const [rows, setRows] = useState(readWorkspaces);
  const [form, setForm] = useState<FormState>(initialForm);
  const [query, setQuery] = useState("");
  const visibleRows = useMemo(() => rows.filter((row) => `${row.name} ${row.platformLabel} ${row.countryLabel} ${row.categoryLabel}`.toLowerCase().includes(query.toLowerCase())), [rows, query]);

  function persist(next: WorkspaceProfile[]) {
    setRows(next);
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(next));
  }
  function saveWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const country = labels.country[form.country as keyof typeof labels.country];
    const profile: WorkspaceProfile = {
      id: crypto.randomUUID(), name: form.name.trim(), platform: form.platform,
      platformLabel: labels.platform[form.platform as keyof typeof labels.platform], country: form.country,
      countryLabel: country[0], category: form.category,
      categoryLabel: labels.category[form.category as keyof typeof labels.category], language: form.language || country[2], currency: country[1], updatedAt: Date.now(),
    };
    persist([profile, ...rows]);
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, profile.id);
    onEnter(profile);
  }
  function enter(profile: WorkspaceProfile) {
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, profile.id);
    onEnter(profile);
  }
  function remove(profile: WorkspaceProfile) {
    const next = rows.filter((row) => row.id !== profile.id);
    persist(next.length ? next : starterProfiles);
  }

  return <div className="workspace-hub">
    <header className="hub-topbar">
      <a className="hub-brand" href="/workspaces" onClick={(event) => { event.preventDefault(); navigate("/workspaces"); }}><span><Sparkles /></span>灵感工坊</a>
      <div className="hub-topbar-meta"><span><i />本地创作环境</span><span className="hub-avatar">创</span></div>
    </header>
    {isCreate ? <main className="hub-create-page">
      <button className="hub-back" onClick={() => navigate("/workspaces")}><ArrowRight />返回工作台列表</button>
      <div className="hub-create-heading"><span className="hub-kicker">NEW WORKSPACE</span><h1>创建工作台</h1><p>为一个市场与内容方向设定默认创作环境，之后可随时切换。</p></div>
      <form className="hub-create-form" onSubmit={saveWorkspace}>
        <label className="hub-form-name">工作台名称<Input required maxLength={48} placeholder="例如：TikTok · 菲律宾 · 3C" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <div className="hub-form-grid">
          <label>销售平台<FormSelect aria-label="销售平台" value={form.platform} onValueChange={(platform) => setForm({ ...form, platform })} options={[{value:"douyin",label:"抖音"},{value:"tiktok",label:"TikTok"},{value:"other",label:"其他平台"}]}/></label>
          <label>目标市场<FormSelect aria-label="目标市场" value={form.country} onValueChange={(country) => setForm({ ...form, country, language: labels.country[country as keyof typeof labels.country][2] })} options={[{value:"CN",label:"中国大陆"},{value:"PH",label:"菲律宾"},{value:"US",label:"美国"},{value:"JP",label:"日本"},{value:"other",label:"其他地区"}]}/></label>
          <label>商品类目<FormSelect aria-label="商品类目" value={form.category} onValueChange={(category) => setForm({ ...form, category })} options={[{value:"fashion",label:"服装"},{value:"3c",label:"3C 数码"},{value:"beauty",label:"美妆"},{value:"home",label:"家居"},{value:"food",label:"食品"},{value:"other",label:"其他品类"}]}/></label>
          <label>内容语言<FormSelect aria-label="内容语言" value={form.language} onValueChange={(language) => setForm({ ...form, language })} options={[...new Set([labels.country[form.country as keyof typeof labels.country][2], "中文", "English", "Filipino", "日本語", "自定义"])]}/></label>
        </div>
        <div className="hub-form-note"><Globe2 />平台、市场、品类和语言将作为此工作台的默认创作背景。</div>
        <div className="hub-form-actions"><Button type="button" variant="outline" onClick={() => navigate("/workspaces")}>取消</Button><Button type="submit"><Check />创建并进入</Button></div>
      </form>
    </main> : <main className="hub-home">
      <section className="hub-welcome"><div><span className="hub-kicker">CREATIVE STUDIO</span><h1>先选一个工作台<br/><em>再开始创作。</em></h1><p>按市场与商品方向整理创作环境，默认语言和内容背景随工作台切换。</p></div><div className="hub-welcome-art" aria-hidden="true"><div className="hub-preview-label">MARKET / CONTENT</div><div className="hub-preview-board"><div className="hub-preview-nav"><span/><span/><span/></div><div className="hub-preview-main"><div className="hub-preview-copy"><small>PRODUCT STORY</small><b>为不同市场<br/>整理创作方向</b><i/></div><div className="hub-preview-product"><div className="hub-preview-object"><Boxes/></div></div></div><div className="hub-preview-footer"><span><Globe2/> Philippines</span><span><WandSparkles/> Localized content</span></div></div><div className="hub-preview-tag"><Sparkles/> 一个市场，一个创作空间</div></div></section>
      <section className="hub-list-section"><div className="hub-list-heading"><div><h2>我的工作台 <small>{rows.length.toString().padStart(2, "0")}</small></h2><p>选择一个工作台继续，或为新市场创建独立环境。</p></div><div className="hub-list-actions"><Input aria-label="搜索工作台" placeholder="搜索工作台" value={query} onChange={(event) => setQuery(event.target.value)} /><Button onClick={() => navigate("/workspaces/new")}><Plus />新建工作台</Button></div></div>
        <div className="hub-workspace-grid">{visibleRows.map((row, index) => <article className={`hub-workspace-card theme-${index % 3}`} key={row.id}><div className="hub-card-top"><span className="hub-card-icon">{row.platform === "douyin" ? <Video/> : <Globe2/>}</span><button className="hub-card-menu" aria-label={`删除${row.name}`} title="删除工作台" onClick={() => remove(row)}><Trash2/></button></div><div className="hub-card-title"><h3>{row.name}</h3><Badge variant="outline">{row.platformLabel}</Badge></div><div className="hub-card-market"><Globe2/><span>{row.countryLabel}</span><span className="hub-card-separator">·</span><span>{row.categoryLabel}</span></div><div className="hub-card-meta"><span>{row.language}</span><span>{row.currency}</span></div><div className="hub-card-footer"><span><span className="hub-ready-dot"/>创作环境就绪</span><Button variant="ghost" size="sm" onClick={() => enter(row)}>进入工作台<ArrowRight/></Button></div></article>)}
          <button className="hub-add-card" onClick={() => navigate("/workspaces/new")}><span><Plus/></span><strong>创建新的工作台</strong><small>添加平台、市场与商品类目</small></button>
        </div>
        {!visibleRows.length && <div className="hub-empty">没有找到匹配的工作台</div>}
      </section>
      <footer className="hub-footer"><span>灵感工坊 <b>·</b> 你的跨市场商品创作空间</span><button onClick={() => navigate("/workspaces/new")}>工作台设置<ChevronDown/></button></footer>
    </main>}
  </div>;
}
