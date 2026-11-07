const saves=new Set<()=>Promise<unknown>>();
export function registerBackgroundSave(save:()=>Promise<unknown>){saves.add(save);return ()=>{saves.delete(save);};}
export async function flushBackgroundSaves(){for(const save of [...saves])await save();}
