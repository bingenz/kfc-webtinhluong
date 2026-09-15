export async function GET() {
  const key = process.env.VAPID_PUBLIC_KEY || "";
  return Response.json(
    { key },
    { headers: { "Cache-Control": "no-store" } },
  );
}
