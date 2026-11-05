import sharp from 'sharp';
/** Exact user-confirmed values are rendered locally, separate from model-generated lettering. */
export async function appendConfirmedFacts(input:Uint8Array,title:string,facts:string){
 const metadata=await sharp(input).metadata();if(!metadata.width||!metadata.height)throw Error('无法读取详情图尺寸');
 const width=metadata.width,pad=Math.max(24,Math.round(width*.04)),font=Math.max(18,Math.round(width*.023)),lineHeight=Math.round(font*1.65),maxChars=Math.max(12,Math.floor((width-pad*2)/font));
 const lines:string[]=[];
 for(const paragraph of facts.split(/\r?\n/)){const chars=Array.from(paragraph);if(!chars.length)lines.push('');for(let i=0;i<chars.length;i+=maxChars)lines.push(chars.slice(i,i+maxChars).join(''));}
 const height=pad*2+lineHeight*(lines.length+2);if(height>12000)throw Error('已确认资料过长，请精简为该屏必须展示的参数');
 const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
 const svg=Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g fill="#18212c" font-family="PingFang SC,Microsoft YaHei,Noto Sans CJK SC,sans-serif" font-size="${font}"><text x="${pad}" y="${pad+font}" font-weight="600">${escape(title)} · 已确认资料</text>${lines.map((line,i)=>`<text x="${pad}" y="${pad+font+lineHeight*(i+2)}">${escape(line)}</text>`).join('')}</g></svg>`);
 return sharp(input).extend({bottom:height,background:'white'}).composite([{input:svg,top:metadata.height,left:0}]).png().toBuffer();
}
