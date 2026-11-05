import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
// This directory is deliberately outside the SQLite/media/skills backup allowlist.
export function credentialVault(dataDir:string) {
  const dir=path.join(dataDir,'private'); fs.mkdirSync(dir,{recursive:true,mode:0o700}); fs.chmodSync(dir,0o700);
  const masterFile=path.join(dir,'master.key'), indexFile=path.join(dir,'credentials.json');
  if(!fs.existsSync(masterFile)) fs.writeFileSync(masterFile,randomBytes(32),{mode:0o600,flag:'wx'});
  fs.chmodSync(masterFile,0o600);
  const master=fs.readFileSync(masterFile);
  type Entry={modelId:string;iv:string;tag:string;data:string};
  type Index={current:Partial<Record<string,string>>;versions:Record<string,Entry>};
  const read=():Index=>fs.existsSync(indexFile)?JSON.parse(fs.readFileSync(indexFile,'utf8')):{current:{},versions:{}};
  const write=(index:Index)=>{
    fs.writeFileSync(indexFile+'.tmp',JSON.stringify(index),{mode:0o600});fs.renameSync(indexFile+'.tmp',indexFile);fs.chmodSync(indexFile,0o600);
  };
  const encryptMany=(ids:string[],key:string)=>{
    const index=read(),versions:Record<string,string>={};
    for(const id of [...new Set(ids)]){
      const version=randomUUID(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',master,iv);
      cipher.setAAD(Buffer.from(id));
      index.versions[version]={modelId:id,iv:iv.toString('base64'),tag:'',data:Buffer.concat([cipher.update(key,'utf8'),cipher.final()]).toString('base64')};
      index.versions[version].tag=cipher.getAuthTag().toString('base64');index.current[id]=version;versions[id]=version;
    }
    write(index);return versions;
  };
  return {
    current:(id:string)=>read().current[id],
    set(id:string,key:string){
      return this.setMany([id],key)[id];
    },
    setMany(ids:string[],key:string){
      if(!/^sk-[A-Za-z0-9_-]{12,200}$/.test(key)) throw Object.assign(new Error('请输入有效的 API 密钥'),{statusCode:400});
      return encryptMany(ids,key);
    },
    setPrivate(id:string,value:string){
      if(!value||value.length>16384)throw new Error('私有凭据格式异常');
      return encryptMany([id],value)[id];
    },
    removePrivate(id:string){
      const index=read();delete index.current[id];
      for(const [version,entry] of Object.entries(index.versions))if(entry.modelId===id)delete index.versions[version];
      write(index);
    },
    get(id:string,version:string){
      const entry=read().versions[version];if(!entry||entry.modelId!==id) throw new Error('任务凭据不可用，请检查本机私有凭据存储');
      const decipher=createDecipheriv('aes-256-gcm',master,Buffer.from(entry.iv,'base64'));decipher.setAAD(Buffer.from(id));decipher.setAuthTag(Buffer.from(entry.tag,'base64'));
      return Buffer.concat([decipher.update(Buffer.from(entry.data,'base64')),decipher.final()]).toString('utf8');
    },
  };
}
