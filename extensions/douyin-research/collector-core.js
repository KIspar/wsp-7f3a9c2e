/** Shared deterministic rules; no page text is executed. */
globalThis.ResearchCollectorCore={
 mediaUrl(value){try{const u=new URL(value,location.href);return u.protocol==='https:'&&['douyin.com','douyinpic.com','douyinvod.com','byteimg.com','ibytedtos.com'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d))?u.href:null;}catch{return null;}},
 mergeComments(before,incoming){const map=new Map(before.map(c=>[c.id,c]));for(const c of incoming){if(!c.id||!c.text||!['1','2'].includes(c.level))continue;if(c.level==='1'&&!map.has(c.id)&&[...map.values()].filter(x=>x.level==='1').length>=100)continue;if(c.level==='2'&&!map.has(c.parentId))continue;map.set(c.id,c);}return [...map.values()];},
 loginState(body,selectors){if(selectors.blockingLogin||/登录后(?:即可|才能|查看)|扫码登录|短信登录|手机号登录/.test(body))return 'waiting-login';if(selectors.verification||/请完成(?:安全)?验证|拖动滑块|访问过于频繁/.test(body))return 'paused';if(selectors.account)return 'ready';return 'unconfirmed';},
 contentId(url){try{const u=new URL(url);return u.searchParams.get('modal_id')||u.pathname.match(/\/(?:video|note)\/(\d+)/)?.[1]||null;}catch{return null;}}
};
