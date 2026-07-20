export interface DialogueLine { speaker: "host" | "guest"; text: string }
export interface Job { id:string; title:string; status:"queued"|"processing"|"completed"|"failed"; progress:number; stage:string; error?:string; script?:{lines:DialogueLine[]}; audioUrl?:string }
const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
async function request<T>(path:string, init?:RequestInit):Promise<T>{const response=await fetch(`${base}${path}`,init);const data=await response.json() as T & {error?:string};if(!response.ok)throw new Error(data.error??"服务暂时不可用");return data}
export const createJob=(form:FormData)=>request<{id:string}>("/api/jobs",{method:"POST",body:form});
export const getJob=(id:string)=>request<Job>(`/api/jobs/${id}`);
export const retryJob=(id:string,token:string)=>{const form=new FormData();form.set("cf-turnstile-response",token);return request<{id:string}>(`/api/jobs/${id}/retry`,{method:"POST",body:form})};
export const audioUrl=(path:string)=>`${base}${path}`;
