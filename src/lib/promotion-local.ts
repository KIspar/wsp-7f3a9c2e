import {postModeOf,type PostMode,type PromotionDraft} from '../../packages/promotion';
type LocalStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function legacyPromotionMode(storage:LocalStorage,productId:string):PostMode|undefined{
 try{const pending=JSON.parse(storage.getItem(`promotion-submit:${productId}:post`)||'null');if(pending)return pending.creativeContext?.postMode||(pending.draft?.outputReferenceIds?.length?'replicate':'creative');const draft=JSON.parse(storage.getItem(`promotion-draft:${productId}:post`)||'null')?.value;return draft?.value?postModeOf(draft.value):undefined;}catch{return undefined;}
}
/** Preserve unsaved browser input and ambiguous submissions when document IDs gain a mode suffix. */
export function migratePromotionLocal(storage:LocalStorage,source:PromotionDraft){
 if(source.purpose!=='post')return;
 const mode=postModeOf(source.value),oldId=`${source.productId}:post`;
 for(const kind of ['promotion-draft','promotion-submit']){
  const oldKey=`${kind}:${oldId}`,nextKey=`${kind}:${source.id}`,raw=storage.getItem(oldKey);if(!raw||oldKey===nextKey||storage.getItem(nextKey))continue;
  try{const cached=JSON.parse(raw);const oldMode:PostMode=kind==='promotion-draft'?postModeOf(cached.value.value):cached.creativeContext?.postMode||(cached.draft?.outputReferenceIds?.length?'replicate':'creative');if(oldMode!==mode)continue;
   // Keep the old revision: a conflict must ask for recovery, never silently overwrite a newer server edit.
   const migrated=kind==='promotion-draft'?JSON.stringify({...cached,value:{...cached.value,id:source.id,value:{...cached.value.value,postMode:mode}}}):raw;
   storage.setItem(`${kind}-legacy-backup:${oldId}`,raw);storage.setItem(nextKey,migrated);storage.removeItem(oldKey);
  }catch{/* Malformed legacy data stays at its original key for manual recovery. */}
 }
}
