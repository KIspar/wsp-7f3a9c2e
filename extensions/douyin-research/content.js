(()=>{
 const core=globalThis.ResearchCollectorCore;
 const shown=e=>!!e&&!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const text=e=>(e?.textContent||'').trim();
 const find=(selectors,root=document)=>[...root.querySelectorAll(selectors)].filter(shown);
 const pageText=document.body.innerText||'',login=core.loginState(pageText,{blockingLogin:!!find('[data-e2e="login-dialog"], [class*="login-modal"], [class*="loginModal"]').length,verification:!!find('[id*="captcha"], [class*="captcha-container"]').length,account:!!find('[data-e2e="user-avatar"], [data-e2e="user-info"], a[href*="/user/self"], [data-e2e="user-tab"], [data-e2e="sidebar-user"]').length||[...document.querySelectorAll('button,a')].some(e=>shown(e)&&/退出登录|我的主页|个人主页/.test(text(e)))});
 const hash=s=>{let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0).toString(16);};
 function snapshot(){
  const root=find('[data-e2e="aweme-detail"], [data-e2e="video-detail"], [data-e2e="note-detail"]')[0]||document;
  const comments=[];
  for(const item of find('[data-e2e="comment-item"], [data-e2e="comment-list-item"]')){
   if(item.parentElement?.closest('[data-e2e="comment-item"], [data-e2e="comment-list-item"]'))continue;
   const main=find('[data-e2e="comment-item-content"], [data-e2e="comment-content"], [class*="comment-content"]',item)[0];
   const content=text(main);if(!content)continue;
   const id=item.getAttribute('data-comment-id')||item.getAttribute('data-id')||'dom-'+hash(text(find('a[href*="/user/"]',item)[0])+':'+content+':'+text(find('time,[data-e2e="comment-time"]',item)[0]));
   comments.push({id,level:'1',text:content.slice(0,3000),time:text(find('time,[data-e2e="comment-time"]',item)[0]),likes:text(find('[data-e2e="comment-like-count"]',item)[0]),kind:'content'});
   for(const reply of find('[data-e2e="comment-reply-item"], [data-e2e="reply-item"]',item)){
    if(reply.parentElement?.closest('[data-e2e="comment-reply-item"], [data-e2e="reply-item"]'))continue;
    const body=text(find('[data-e2e="comment-item-content"], [data-e2e="comment-content"]',reply)[0])||text(reply);if(body)comments.push({id:reply.getAttribute('data-comment-id')||id+'-reply-'+hash(text(reply)),parentId:id,level:'2',text:body.slice(0,3000),time:text(find('time',reply)[0]),likes:'',kind:'content'});
   }
  }
  const contentImages=find('[data-e2e="note-image"] img, [data-e2e="note-image"] , [data-e2e="note-detail"] img, [class*="note-image"] img',root).map(img=>({url:core.mediaUrl(img.currentSrc||img.src),role:'content',label:'图文图片'})).filter(m=>m.url);
  const productRoot=find('[data-e2e="product-detail"], [data-e2e="goods-detail"], [class*="product-detail"], [class*="goods-detail"]')[0];
  const productImages=productRoot?find('img',productRoot).filter(i=>i.naturalWidth>=200&&i.naturalHeight>=200).map(i=>({url:core.mediaUrl(i.currentSrc||i.src),role:i.closest('[class*="sku"], [data-e2e*="sku"]')?'sku':i.closest('[class*="description"], [class*="detail-content"]')?'product-detail':'product-main',label:'商品页可见图片'})).filter(m=>m.url):[];
  const video=find('video',root)[0],videoUrl=video&&core.mediaUrl(video.currentSrc||video.src);
  const title=text(find('[data-e2e="video-desc"], [data-e2e="note-desc"], h1',root)[0])||document.title;
  const list=find('[data-e2e="comment-list"]')[0];
  return {login,url:location.href,title:title.slice(0,500),text:text(find('[data-e2e="video-desc"], [data-e2e="note-desc"]',root)[0]).slice(0,12000),comments,media:[...contentImages,...productImages,...(videoUrl?[{url:videoUrl,role:'video',label:'同行视频'}]:[])],productInfo:productRoot?text(productRoot).slice(0,16000):'',hasProduct:!!productRoot,atBottom:!!list&&/暂时没有更多|没有更多评论|已经到底|到底了/.test(text(list)),sort:text(find('[data-e2e="comment-sort"]')[0])||'页面当前排序（未确认名称）',hasComments:!!list};
 }
 const operation=globalThis.__researchOperation||'snapshot';
 if(operation==='advance'){
  // Only expand first-level reply controls. Never descend into a reply's own reply tree.
  const controls=find('[data-e2e="comment-item"] button, [data-e2e="comment-item"] [role="button"], [data-e2e="comment-list-item"] button').filter(e=>/展开.*回复|查看.*回复|更多回复/.test(text(e))&&!e.closest('[data-e2e="comment-reply-item"], [data-e2e="reply-item"]'));
  if(controls[0])controls[0].click();
  else if(!globalThis.__researchRepliesOnly){const list=find('[data-e2e="comment-list"]')[0];let scroller=list;while(scroller&&scroller.scrollHeight<=scroller.clientHeight+8)scroller=scroller.parentElement;if(scroller)scroller.scrollBy({top:Math.max(300,scroller.clientHeight*.7),behavior:'instant'});}
 }
 if(operation==='open-product'){
  const links=find('[data-e2e="video-product"], [data-e2e="video-product-anchor"], [data-e2e="product-anchor"], [data-e2e="goods-anchor"]');
  if(links.length===1){links[0].click();return {clicked:true};}return {clicked:false,reason:links.length>1?'存在多个商品入口，请手动打开要研究的商品':'未找到可靠的商品入口，请手动打开商品页'};
 }
 return snapshot();
})();
