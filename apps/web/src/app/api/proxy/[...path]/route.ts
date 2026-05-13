import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'https://ps3mrselrg.execute-api.sa-east-1.amazonaws.com';
const API_LAMBDA_URL = process.env.API_LAMBDA_URL || 'https://n3nleydsrvwgfexg5u2ws3yuy40ujwyw.lambda-url.sa-east-1.on.aws';

async function proxyRequest(req: NextRequest, { params }: { params: { path: string[] } }) {
  const path = '/' + params.path.join('/');

  // Use Lambda Function URL for slow routes (no 30s timeout)
  const useLambdaUrl = path.startsWith('/agents/test-chat') || path.startsWith('/agents/scrape') || path.startsWith('/agents/feedback') || path.startsWith('/channels/waha') || path.startsWith('/onboarding') || path.startsWith('/golden') || path.startsWith('/regression');
  const baseUrl = useLambdaUrl ? API_LAMBDA_URL : API_URL;
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const tenantId = req.headers.get('x-tenant-id');
  if (tenantId) headers['x-tenant-id'] = tenantId;

  const body = req.method !== 'GET' ? await req.text() : undefined;

  const res = await fetch(url, {
    method: req.method,
    headers,
    body,
  });

  const data = await res.text();
  return new NextResponse(data, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const maxDuration = 300;

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
