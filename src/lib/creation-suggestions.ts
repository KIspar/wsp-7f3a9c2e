import type {Draft,Skill} from '../../packages/contracts';

type Suggestion={label:string;prompt:string};
const general:Suggestion[]=[
  {label:'白底商品图',prompt:'制作服装白底商品图，背景干净，商品居中，保留原有颜色、版型与细节，阴影自然，不添加文案。'},
  {label:'平铺展示',prompt:'采用服装平铺构图，完整展示款式与轮廓，背景简洁，保留商品真实结构。'},
  {label:'面料细节',prompt:'近景展示服装可见的纹理、走线与细节，保持材质外观真实，不虚构面料成分。'},
  {label:'穿搭场景',prompt:'制作自然的服装穿搭场景图，突出商品，保持版型、颜色与细节一致，人物与场景协调。'},
];
const replica:Suggestion[]=[
  {label:'保留参考构图',prompt:'沿用参考图的构图、主体位置与留白，将商品替换为上传的自有服装，保留商品真实款式。'},
  {label:'保留场景光线',prompt:'保留参考图的场景与光线方向，让自有服装自然融入，阴影与环境一致。'},
  {label:'商品细节一致',prompt:'以自有商品图片为准，准确保留服装领口、门襟、袖口、图案与可见细节。'},
  {label:'去除文案',prompt:'去除参考画面中的宣传文案与装饰图标，保留场景和商品，不改变商品本身的标识。'},
];
const outfit:Suggestion[]=[
  {label:'自然换装',prompt:'将目标模特的指定服装替换为上传的自有商品，穿着贴合姿态，褶皱、遮挡与光影自然。'},
  {label:'保留原模特',prompt:'保留目标图中模特的面部、发型、体型与姿态，只替换指定服装，不改变人物身份。'},
  {label:'服装版型一致',prompt:'严格保留自有服装的轮廓、领型、门襟与袖口设计，不擅自增减图案或配件。'},
  {label:'真实面料质感',prompt:'保留上传服装可见的纹理与垂坠感，避免塑料感、过度磨皮或虚构面料细节。'},
];
const video:Suggestion[]=[
  {label:'缓慢推进',prompt:'镜头缓慢推进，突出服装主体，保持画面稳定。'},
  {label:'展示穿搭',prompt:'模特自然展示穿搭，动作舒展，保持人物与服装一致。'},
  {label:'细节特写',prompt:'近景展示服装领口、纹理与走线，保持商品可见细节一致。'},
  {label:'自然光线',prompt:'采用自然柔和光线，商品颜色真实，背景干净。'},
];
export function creationSuggestions(skill:Skill,draft:Draft):Suggestion[]{
  if(skill.category==='video')return video;
  if(skill.id==='model-outfit')return outfit;
  if(skill.imageDesign==='replica')return replica;
  if(skill.imageDesign==='edit'){
    const numbers=draft.selectedTargetIds.map(id=>draft.imageDesign?.bindings.find(binding=>binding.assetId===id)?.number).filter((n):n is number=>n!==undefined);
    const targets=numbers.length?numbers.map(n=>`图${n}`).join('、'):'待编辑图片';
    return [
      {label:'更换白底',prompt:`将${targets}的背景改为干净白底，保留服装主体、轮廓与细节，边缘自然。`},
      {label:'清理背景杂物',prompt:`去除${targets}背景中的杂物，保留服装与人物，自然补全背景。`},
      {label:'保留商品细节',prompt:`修改${targets}时保留服装的原有颜色、版型、图案与可见细节。`},
      {label:'统一色调',prompt:`统一${targets}的背景与光线色调，保持服装本身的真实颜色。`},
    ];
  }
  return general;
}
