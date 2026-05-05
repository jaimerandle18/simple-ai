import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await getServerSession();
  return NextResponse.json({ session, env: { API_URL: process.env.API_URL ? 'set' : 'missing', NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ? 'set' : 'missing' } });
}
