import {useState} from 'react';
import {NavLink, useLocation} from 'react-router-dom';
import {Activity,BookOpen,Box,Clapperboard,ClipboardList,Code2,Cpu,FolderClock,Image,Layers3,Search,Settings2,Shirt,Sparkles,WandSparkles,type LucideIcon} from 'lucide-react';
import {Input} from './ui/input';
import {ecommerceGroups} from '@/lib/ecommerce-features';

type Entry = {path:string; label:string; icon:LucideIcon; subgroup?:string};
type Section = {id:string; label:string; icon:LucideIcon; entries:Entry[]};
const ecommerceIcons:Record<string,LucideIcon>={product:Layers3,model:Shirt,pod:Box,tools:Image,derivative:WandSparkles,crossborder:Box,marketing:Sparkles,design:Layers3};
const subgroupRanges:Record<string,[string,number][]>= {
  product:[['套图上架',9],['服饰转化',7],['场景合成',7],['多视角与细节',4],['精修与光影',4]],
  model:[['穿搭与试衣',10],['模特与局部调整',9],['套图与场景',5]],
  pod:[['图案与印花',8],['衍生与合成',9],['文案与检测',2]],
  tools:[['创作与设计',10],['编辑与修复',13],['批量与本地工具',8]],
};
const ecommerceSections:Section[]=ecommerceGroups.map(group=>({id:group.id,label:group.name,icon:ecommerceIcons[group.id],entries:group.features.map((feature,index)=>{let end=0;const subgroup=subgroupRanges[group.id]?.find(([,count])=>{end+=count;return index<end;})?.[0];return {path:`/ecommerce/${feature.id}`,label:feature.name,icon:ecommerceIcons[group.id],subgroup};})}));
const sections:Section[] = [
  ...ecommerceSections,
  {id:'video',label:'视频创作',icon:Clapperboard,entries:[
    {path:'/studio/video-generate',label:'视频生成',icon:Clapperboard},
    {path:'/video-reverse',label:'视频反推',icon:Clapperboard},
  ]},
  {id:'agent',label:'智能体',icon:Sparkles,entries:[
    {path:'/agents/prompt-workbench',label:'提示词工作台',icon:ClipboardList},
    {path:'/studio/benchmark-agent',label:'一键对标',icon:Layers3},
  ]},
  {id:'catalog',label:'商品工坊',icon:Box,entries:[{path:'/catalog',label:'商品库',icon:Box}]},
  {id:'templates',label:'模板中心',icon:BookOpen,entries:[{path:'/templates',label:'全部模板',icon:BookOpen}]},
  {id:'management',label:'系统管理',icon:Settings2,entries:[
    {path:'/models',label:'模型配置',icon:Cpu},
    {path:'/history',label:'全部任务',icon:FolderClock},
    {path:'/delivery',label:'成套交付',icon:Layers3},
    {path:'/usage',label:'算力统计',icon:Activity},
    {path:'/skills',label:'技能管理',icon:Code2},
    {path:'/settings',label:'系统设置',icon:Settings2},
    {path:'/help',label:'帮助中心',icon:BookOpen},
  ]},
];
function matches(path:string, entry:Entry){return path===entry.path||path.startsWith(entry.path+'/');}
function currentSection(path:string){
  if(['/studio/product-kit','/studio/detail-design','/studio/image-replica'].includes(path))return sections[0];
  if(path==='/studio/model-outfit')return sections[1];
  if(['/studio/image-generate','/studio/image-edit'].includes(path))return sections[3];
  return sections.find(s=>s.entries.some(e=>matches(path,e)))||sections[0];
}

export function StudioCategoryTabs(){
  const {pathname}=useLocation(),current=currentSection(pathname);
  const tabs=ecommerceSections.some(s=>s.id===current.id)?ecommerceSections:[current];
  return <nav className="studio-category-tabs" aria-label="创作分类">{tabs.map(s=><NavLink key={s.id} to={s.entries[0].path} className={current.id===s.id?'is-current':''} aria-current={current.id===s.id?'page':undefined}><s.icon/><span>{s.label}</span></NavLink>)}</nav>;
}

export function StudioPrimaryNavigation(){
  const {pathname}=useLocation(),current=currentSection(pathname);
  const groups=[
    {label:'电商设计',path:'/ecommerce/ec-product-01',icon:Layers3,active:ecommerceSections.some(s=>s.id===current.id)},
    {label:'视频创作',path:'/studio/video-generate',icon:Clapperboard,active:current.id==='video'},
    {label:'智能体',path:'/agents/prompt-workbench',icon:Sparkles,active:current.id==='agent'},
    {label:'商品工坊',path:'/catalog',icon:Box,active:current.id==='catalog'},
    {label:'模板中心',path:'/templates',icon:BookOpen,active:current.id==='templates'},
    {label:'全部任务',path:'/history',icon:FolderClock,active:pathname==='/history'},
    {label:'系统管理',path:'/models',icon:Settings2,active:current.id==='management'&&pathname!=='/history'},
  ];
  return <nav className="studio-primary-nav" aria-label="主导航">{groups.map(g=><NavLink key={g.path} to={g.path} aria-label={g.label} title={g.label} className={g.active?'is-current':''} aria-current={g.active?'page':undefined}><g.icon/><span>{g.label}</span></NavLink>)}</nav>;
}

export function StudioFeatureNavigation(){
  const {pathname}=useLocation(),current=currentSection(pathname);
  const [search,setSearch]=useState('');
  const query=search.trim().toLocaleLowerCase();
  const source=query?sections.map(s=>({...s,entries:s.entries.filter(e=>e.label.toLocaleLowerCase().includes(query))})).filter(s=>s.entries.length):[current];
  const visible=source.flatMap(s=>{const names=[...new Set(s.entries.map(e=>e.subgroup||s.label))];return names.map(label=>({...s,id:`${s.id}-${label}`,label,entries:s.entries.filter(e=>(e.subgroup||s.label)===label)}));});
  return <aside className="studio-feature-rail" aria-label="功能列表">
    <div className="studio-feature-heading">功能列表<span>{query?'搜索':current.label}</span></div>
    <div className="studio-feature-search"><Search/><Input aria-label="搜索功能" placeholder="搜索功能…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
    <nav aria-label="当前分类功能">{visible.map(s=><section key={s.id}><h2>{s.label}<span>{s.entries.length}</span></h2>{s.entries.map(e=><NavLink key={e.path} to={e.path} onClick={()=>setSearch('')} className={matches(pathname,e)?'is-current':''} aria-current={matches(pathname,e)?'page':undefined}><e.icon/><span>{e.label}</span></NavLink>)}</section>)}{!visible.length&&<p className="studio-feature-empty">没有匹配功能</p>}</nav>
    <NavLink to="/history" className="studio-feature-history"><FolderClock/>我的生成记录</NavLink>
  </aside>;
}
