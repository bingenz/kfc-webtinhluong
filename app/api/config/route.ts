function isPublicKey(key: string): boolean {
  if (key.startsWith('sb_publishable_')) return true;
  if (key.startsWith('sb_secret_')) return false;
  try {
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    return claims.role === 'anon';
  } catch { return false; }
}
export async function GET() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || '';
  const valid = url.startsWith('https://') && isPublicKey(key);
  return Response.json({ url: valid ? url : '', key: valid ? key : '' }, { headers: { 'Cache-Control': 'no-store' } });
}
