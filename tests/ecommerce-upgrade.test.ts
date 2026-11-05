import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStore,type Store} from '../apps/server/store';
import {parseSkill} from '../apps/server/skills';
import {defaultDraft,type SavedDraft,type Skill} from '../packages/contracts';

let root:string,store:Store|undefined;
const id='ec-product-01';
const original=fs.readFileSync(path.join(process.cwd(),'skills',id,'技能提示词.md'),'utf8');
function write(source:string){fs.writeFileSync(path.join(root,'skills',id,'技能提示词.md'),source);}
function reopen(){store?.close();store=createStore(path.join(root,'data'),root);return store;}
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'ecommerce-upgrade-'));fs.mkdirSync(path.join(root,'skills',id),{recursive:true});write(original);});
afterEach(()=>{store?.close();store=undefined;fs.rmSync(root,{recursive:true,force:true});});

describe('bundled ecommerce configuration upgrades',()=>{
  it('upgrades legacy built-ins and migrates drafts by label in every stored scope',()=>{
    const db=reopen(),current=db.get<Skill>('skill',id)!;
    const oldSource=original.replaceAll('option1','oldMode');
    const old={...parseSkill(oldSource),source:oldSource,revision:1,unpublished:false};
    db.put('skill',id,old);db.remove('bundled-skill',id);
    for(const scope of ['douyin-cn-fashion','test-market'])db.withWorkspace(scope,()=>{
      const value=defaultDraft(old,db.models());value.fields.oldMode='自定义套图';value.requirements=scope;
      db.saveDraft(id,value,0);
    });
    const upgraded=reopen();expect(upgraded.get<Skill>('skill',id)!.revision).toBe(2);
    expect(upgraded.get<Skill>('skill',id)!.hash).toBe(current.hash);
    expect(upgraded.get<Skill>('skill-history',`${id}-1`)!.hash).toBe(old.hash);
    for(const scope of ['douyin-cn-fashion','test-market'])upgraded.withWorkspace(scope,()=>{
      const saved=upgraded.readDraft(id);expect(saved.revision).toBe(2);
      expect(saved.value.requirements).toBe(scope);expect(saved.value.fields.option1).toBe('自定义套图');
      expect(saved.value.fields).not.toHaveProperty('oldMode');
      expect(upgraded.get<SavedDraft>('draft-history',`${id}-1`)!.value.fields.oldMode).toBe('自定义套图');
    });
    expect(reopen().get<Skill>('skill',id)!.revision).toBe(2);
  });
  it('updates successive bundled versions while preserving a published user revision',()=>{
    const initial=reopen().get<Skill>('skill',id)!;
    write(original+'\n新版内置说明\n');
    const second=reopen().get<Skill>('skill',id)!;expect(second.revision).toBe(2);
    const customSource=second.source+'\n用户自定义说明\n';
    store!.put('skill',id,{...parseSkill(customSource),source:customSource,revision:3,unpublished:false});
    write(customSource);reopen(); // Publishing also changes the local source file.
    write(original+'\n第三版内置说明\n');
    const preserved=reopen().get<Skill>('skill',id)!;
    expect(preserved.revision).toBe(3);expect(preserved.source).toBe(customSource);
    expect(preserved.hash).not.toBe(initial.hash);
  });
  it('preserves user versions when no bundled-version record exists',()=>{
    const db=reopen(),skill=db.get<Skill>('skill',id)!;
    db.put('skill',id,{...skill,revision:2});db.remove('bundled-skill',id);
    write(original+'\n新版内置说明\n');
    expect(reopen().get<Skill>('skill',id)!.hash).toBe(skill.hash);
    expect(store!.get<Skill>('skill',id)!.revision).toBe(2);
  });
});
