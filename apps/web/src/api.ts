export interface DialogueLine { speaker: "host" | "guest"; text: string }
export interface Job { id:string; title:string; status:"queued"|"processing"|"completed"|"failed"|"canceled"; progress:number; stage:string; error?:string; script?:{lines:DialogueLine[]}; audioUrl?:string }
const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
async function request<T>(path:string, init?:RequestInit):Promise<T>{const response=await fetch(`${base}${path}`,{...init,credentials:"include"});const data=await response.json() as T & {error?:string};if(!response.ok)throw new Error(data.error??"服务暂时不可用");return data}
export interface User { id:string; email:string; name:string; picture:string|null }
export const getMe=()=>request<{user:User|null}>("/api/auth/me");
export const logout=()=>request<{ok:true}>("/api/auth/logout",{method:"POST"});
export const googleLoginUrl=()=>`${base}/api/auth/google`;
export const createJob=(form:FormData)=>request<{id:string}>("/api/jobs",{method:"POST",body:form});
export const getJob=(id:string)=>request<Job>(`/api/jobs/${id}`);
export const retryJob=(id:string)=>request<{id:string}>(`/api/jobs/${id}/retry`,{method:"POST"});
export const cancelJob=(id:string)=>request<{id:string;status:"canceled"}>(`/api/jobs/${id}/cancel`,{method:"POST"});
export const audioUrl=(path:string)=>`${base}${path}`;
