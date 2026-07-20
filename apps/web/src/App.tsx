import { useCallback,useEffect,useState } from "react";
import { cancelJob,createJob,getJob,getMe,googleLoginUrl,logout,retryJob,type Job,type User } from "./api";
import { JobForm } from "./components/JobForm";
import { JobPanel } from "./components/JobPanel";
import { useI18n } from "./i18n";
import "./auth.css";

export default function App(){
 const {locale,setLocale,t}=useI18n(),[job,setJob]=useState<Job|null>(null),[id,setId]=useState(()=>new URLSearchParams(location.search).get("job")),[user,setUser]=useState<User|null|undefined>();
 useEffect(()=>{void getMe().then(result=>setUser(result.user)).catch(()=>setUser(null))},[]);
 const refresh=useCallback(async()=>{if(id)setJob(await getJob(id))},[id]);
 useEffect(()=>{if(!id||!user)return;void refresh();const timer=setInterval(()=>{if(job?.status!=="completed"&&job?.status!=="failed"&&job?.status!=="canceled")void refresh()},2500);return()=>clearInterval(timer)},[id,user,job?.status,refresh]);
 async function create(data:FormData){const result=await createJob(data);history.replaceState(null,"",`/?job=${result.id}`);setId(result.id)}
 async function retry(){if(id){await retryJob(id);setJob(job?{...job,status:"queued",progress:5,stage:"等待重试"}:null)}}
 async function cancel(){if(id){await cancelJob(id);setJob(job?{...job,status:"canceled",stage:"已取消"}:null)}}
 function reset(){history.replaceState(null,"","/");setId(null);setJob(null)}
 async function signOut(){await logout();reset();setUser(null)}
 const english=locale==="en-US";
 return <><header><a className="brand" href="/"><span>PF</span> PodForge</a><div className="header-actions"><div className="tag">{t.tagline}</div><div className="locale-switch" role="group" aria-label={t.languageLabel}><button type="button" aria-pressed={!english} onClick={()=>setLocale("zh-CN")}>{t.zhShort}</button><button type="button" aria-pressed={english} onClick={()=>setLocale("en-US")}>{t.enShort}</button></div>{user&&<div className="user-menu">{user.picture&&<img src={user.picture} alt="" referrerPolicy="no-referrer"/>}<span>{user.name}</span><button type="button" onClick={()=>void signOut()}>{english?"Sign out":"退出"}</button></div>}</div></header><main><section className="hero"><p className="eyebrow">AI PODCAST STUDIO</p><h1>{t.heroLead} <em>{t.heroEmphasis}</em></h1><p>{t.heroCopy}</p></section>{user===undefined?<div className="auth-card">{english?"Checking your session…":"正在确认登录状态…"}</div>:user?<div className="layout"><JobForm onCreate={create}/><aside><JobPanel job={job} onRetry={retry} onCancel={cancel} onReset={reset}/></aside></div>:<section className="auth-card"><div className="record"><i/></div><h2>{english?"Sign in to start creating":"登录后开始创作"}</h2><p>{english?"Sign in with Google to protect your jobs and generated content and help us control service costs.":"使用 Google 登录以保护你的任务和生成内容，并帮助我们控制服务成本。"}</p><a className="google-login" href={googleLoginUrl()}><b>G</b>{english?"Continue with Google":"使用 Google 登录"}</a></section>}</main><footer>PodForge <span>·</span> Powered securely on Cloudflare <span>·</span> <a href="https://1991421.cn">Created by Alan H</a></footer></>
}
