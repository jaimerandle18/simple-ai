import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { json, error } from '../lib/response';

const s3 = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME!;

export async function handleFiles(event: APIGatewayProxyEventV2) {
  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;
  const tenantId = event.headers['x-tenant-id'];

  if (!tenantId) return error('x-tenant-id header required', 401);

  // POST /files/upload-url — get a presigned URL for upload
  if (method === 'POST' && path === '/files/upload-url') {
    const body = JSON.parse(event.body || '{}');
    const { fileName, contentType } = body;

    if (!fileName) return error('fileName is required');

    const fileKey = `tenants/${tenantId}/agents/${Date.now()}_${fileName}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey,
      ContentType: contentType || 'application/octet-stream',
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    return json({ uploadUrl, fileKey, fileName });
  }

  // POST /files/download-url — get a presigned URL for download
  if (method === 'POST' && path === '/files/download-url') {
    const body = JSON.parse(event.body || '{}');
    const { fileKey } = body;

    if (!fileKey) return error('fileKey is required');
    if (!fileKey.startsWith(`tenants/${tenantId}/`)) return error('Unauthorized', 403);

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey,
    });

    const downloadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    return json({ downloadUrl });
  }

  // DELETE /files — delete a file
  if (method === 'DELETE' && path === '/files') {
    const body = JSON.parse(event.body || '{}');
    const { fileKey } = body;

    if (!fileKey) return error('fileKey is required');
    if (!fileKey.startsWith(`tenants/${tenantId}/`)) return error('Unauthorized', 403);

    await s3.send(new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey,
    }));

    return json({ deleted: true });
  }

  return error('Not found', 404);
}
