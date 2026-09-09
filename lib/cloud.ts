import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Ledger } from './payroll';
let client: SupabaseClient | null = null;
export async function cloudClient() {
  if(client) return client;
  const response=await fetch('/api/config');
  if(!response.ok) throw new Error('Không tải được cấu hình kết nối. Hãy thử lại.');
  const config=await response.json() as {url?:string;key?:string};
  if(!config.url || !config.key) return null;
  client=createClient(config.url,config.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  return client;
}
export type Profile={id:string;username:string;display_name:string};
export async function loadLedger(c:SupabaseClient,id:string) {
  const {data,error}=await c.from('ledgers').select('payload,revision').eq('owner_id',id).maybeSingle();
  if(error) throw error;
  return data as {payload:Ledger;revision:number}|null;
}
export async function saveLedger(c:SupabaseClient,payload:Ledger,revision:number) {
  const {data,error}=await c.rpc('save_ledger',{document:payload,expected_revision:revision});
  if(error) {
    if(error.message.includes('REVISION_CONFLICT')) throw new Error('Dữ liệu đã thay đổi trên thiết bị khác. Tải lại trang trước khi lưu tiếp; thay đổi này chưa được lưu.');
    throw error;
  }
  return Number(data);
}
