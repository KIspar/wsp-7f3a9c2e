/** Explicit one-time migration of authorized model credentials; never prints plaintext. */
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createDecipheriv} from 'node:crypto';
import {credentialVault} from '../apps/server/credentials';
const source=path.resolve(process.argv[2]||''),target=path.resolve(process.argv[3]||'data');
if(!process.argv[2])throw Error('Pass the authorized source data directory');
const db=new DatabaseSync(path.join(source,'studio.sqlite'),{readOnly:true}),vault=credentialVault(target);
try{for(const id of ['tt-image','omni']){
 if(vault.current(id)){console.log(id+': already configured');continue;}
 const row=db.prepare('SELECT data FROM models WHERE id=?').get(id);if(!row)throw Error(id+': model missing');const model=JSON.parse(row.data as string);
 const provider=JSON.parse(db.prepare('SELECT data FROM providers WHERE id=?').get(model.providerId)!.data as string);
 if(provider.protocol!=='chuhe'||new URL(provider.baseUrl).origin!=='https://api.lk888.ai')throw Error('Unexpected provider');
 const head=db.prepare('SELECT credential_id FROM model_credential_heads WHERE model_id=?').get(id);if(!head)throw Error(id+': credential missing');
 const encrypted=db.prepare('SELECT secret FROM model_credentials WHERE id=? AND model_id=?').get(head.credential_id,id)!.secret as string;
 const bytes=Buffer.from(encrypted,'base64'),decipher=createDecipheriv('aes-256-gcm',fs.readFileSync(path.join(source,'.master-key')),bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));
 const key=Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');vault.set(id,key);console.log(id+': encrypted credential imported');
}}finally{db.close();}
