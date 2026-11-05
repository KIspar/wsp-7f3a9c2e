import {useEffect} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {ArrowUpRight,BookOpen,ChevronDown,Search,X} from 'lucide-react';
import {helpTopics,type HelpArticle,type HelpTopic} from '@/lib/help';
import {Button} from './ui/button';
import {Field,FieldLabel} from './ui/field';
import {InputGroup,InputGroupAddon,InputGroupInput,InputGroupButton} from './ui/input-group';
import {Empty,EmptyHeader,EmptyTitle,EmptyDescription} from './ui/empty';

function Article({article,topic,open,showTopic}:{article:HelpArticle;topic:HelpTopic;open:boolean;showTopic:boolean}){
  return <details className="help-article" open={open}>
    <summary><div>{showTopic&&<span className="help-result-topic">{topic.title}</span>}<h3>{article.title}</h3></div><ChevronDown aria-hidden="true"/></summary>
    <div className="help-article-body">{article.steps&&<ol>{article.steps.map(step=><li key={step}>{step}</li>)}</ol>}{article.paragraphs?.map(text=><p key={text}>{text}</p>)}</div>
  </details>;
}

export function HelpCenter(){
  const [params,setParams]=useSearchParams();
  const topic=helpTopics.find(topic=>topic.id===params.get('topic'))||helpTopics[0];
  useEffect(()=>{window.scrollTo(0,0);},[topic.id]);
  const value=params.get('q')||'',query=value.trim().toLocaleLowerCase();
  const terms=query.split(/\s+/).filter(Boolean);
  const results=helpTopics.flatMap(topic=>topic.articles.map(article=>({topic,article}))).filter(({topic,article})=>{
    const text=[topic.title,article.title,...article.paragraphs||[],...article.steps||[]].join(' ').toLocaleLowerCase();
    return terms.every(term=>text.includes(term));
  });
  function search(q:string){setParams(previous=>{const next=new URLSearchParams(previous);if(q)next.set('q',q);else next.delete('q');return next;},{replace:true});}
  return <div className="management-page help-center">
    <section className="management-heading"><div className="page-eyebrow">工作台管理 <span>/</span> HELP</div><h1>帮助中心</h1></section>
    <Field className="help-search"><FieldLabel htmlFor="help-search" className="sr-only">搜索帮助</FieldLabel><InputGroup><InputGroupInput id="help-search" type="search" placeholder="搜索功能、模型、分组或操作问题…" value={value} onChange={event=>search(event.target.value)}/><InputGroupAddon>{value?<InputGroupButton aria-label="清除搜索" onClick={()=>search('')}><X/></InputGroupButton>:<Search aria-hidden="true"/>}</InputGroupAddon></InputGroup></Field>
    <div className="help-layout">
      <nav className="help-topics" aria-label="帮助主题"><span className="help-nav-label">浏览主题</span>{helpTopics.map(item=><Link to={`/help?topic=${item.id}`} key={item.id} aria-current={!query&&topic.id===item.id?'page':undefined}><span>{item.title}</span><span>{item.articles.length}</span></Link>)}</nav>
      <section className="help-content" aria-label={query?'帮助搜索结果':topic.title}>
        <div className="help-content-heading"><div><BookOpen aria-hidden="true"/><h2>{query?'搜索结果':topic.title}</h2><span role="status">{query?results.length:topic.articles.length} 篇</span></div>{!query&&<Button variant="outline" size="sm" asChild><Link to={topic.href}>{topic.action}<ArrowUpRight data-icon="inline-end"/></Link></Button>}</div>
        {query?results.length?results.map(({topic,article})=><Article key={`${query}:${topic.id}:${article.id}`} topic={topic} article={article} open={false} showTopic/>):<Empty><EmptyHeader><EmptyTitle>没有找到相关说明</EmptyTitle><EmptyDescription>试试“分组”“验证码”或“下载”，也可从左侧选择主题。</EmptyDescription></EmptyHeader><Button variant="outline" onClick={()=>search('')}>清除搜索</Button></Empty>:topic.articles.map((article,index)=><Article key={`${topic.id}:${article.id}`} topic={topic} article={article} open={index===0} showTopic={false}/>)}
      </section>
    </div>
  </div>;
}
