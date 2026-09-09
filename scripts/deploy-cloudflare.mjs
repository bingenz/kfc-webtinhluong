import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
  if (!process.env[key]) throw new Error(`Thiếu ${key}. Thêm vào GitHub Actions secrets trước khi triển khai.`);
}
const defaults = JSON.parse(readFileSync(new URL('../deployment/supabase-public.json', import.meta.url), 'utf8'));
const url = process.env.SUPABASE_URL || defaults.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY || defaults.SUPABASE_PUBLISHABLE_KEY;
if (!url.startsWith('https://') || !key.startsWith('sb_publishable_')) throw new Error('Cấu hình Supabase phải dùng URL HTTPS và publishable key.');
const name = process.env.CLOUDFLARE_WORKER_NAME || 'kfc-webtinhluong';
if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw new Error('Tên Worker không hợp lệ.');
const result = spawnSync(process.execPath, [
  'node_modules/wrangler/bin/wrangler.js', 'deploy',
  '--config', 'dist/server/wrangler.json', '--name', name, '--keep-vars',
  '--var', `SUPABASE_URL:${url}`, '--var', `SUPABASE_PUBLISHABLE_KEY:${key}`,
], {stdio:'inherit', env:{...process.env, WRANGLER_SEND_METRICS:'false'}});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
