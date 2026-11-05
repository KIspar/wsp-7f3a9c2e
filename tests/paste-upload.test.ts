import {describe,expect,it,vi} from 'vitest';
import {pastedImageFiles,uploadPastedImages} from '../src/lib/paste-upload';
function event(files:File[],items:Partial<DataTransferItem>[]=[]){return {clipboardData:{files,items} as unknown as DataTransfer,preventDefault:vi.fn(),stopPropagation:vi.fn()};}
describe('图片剪贴板输入',()=>{
 it('extracts screenshot and copied image files without treating videos as images',()=>{const png=new File(['png'],'截图.png',{type:'image/png'}),webp=new File(['webp'],'同行.webp',{type:'image/webp'}),video=new File(['mp4'],'片段.mp4',{type:'video/mp4'});expect(pastedImageFiles(event([png,video,webp]))).toEqual([png,webp]);});
 it('uses clipboard file items when the browser supplies no FileList',()=>{const image=new File(['jpg'],'商品.jpg',{type:'image/jpeg'});expect(pastedImageFiles(event([],[{kind:'file',getAsFile:()=>image}]))).toEqual([image]);});
 it('consumes image paste once so a portalled picker cannot also upload through its parent',()=>{const image=new File(['png'],'截图.png',{type:'image/png'}),e=event([image]),upload=vi.fn();uploadPastedImages(e,upload);expect(upload).toHaveBeenCalledExactlyOnceWith([image]);expect(e.preventDefault).toHaveBeenCalledOnce();expect(e.stopPropagation).toHaveBeenCalledOnce();});
 it('preserves text paste and ignores unsupported image formats',()=>{for(const e of [event([]),event([new File(['gif'],'动图.gif',{type:'image/gif'})])]){const upload=vi.fn();uploadPastedImages(e,upload);expect(upload).not.toHaveBeenCalled();expect(e.preventDefault).not.toHaveBeenCalled();expect(e.stopPropagation).not.toHaveBeenCalled();}});
});
