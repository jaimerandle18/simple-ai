import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { json, error } from '../lib/response';
import { keys, getItem, putItem } from '../lib/dynamo';

const s3 = new S3Client({});
const BUCKET_NAME = process.env.BUCKET_NAME!;

async function extractText(buffer: Buffer, fileName: string): Promise<string> {
  const ext = fileName.toLowerCase().split('.').pop();

  if (ext === 'txt' || ext === 'csv' || ext === 'md') {
    return buffer.toString('utf-8');
  }

  if (ext === 'pdf') {
    const pdfMod = await import('pdf-parse');
    const pdfParse = (pdfMod as any).default || pdfMod;
    const result = await pdfParse(buffer);
    return result.text;
  }

  // Fallback: intentar como texto
  return buffer.toString('utf-8');
}

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

  // POST /files/process — extraer texto de un archivo y asociarlo al agente
  if (method === 'POST' && path === '/files/process') {
    const body = JSON.parse(event.body || '{}');
    const { fileKey, fileName } = body;

    if (!fileKey || !fileName) return error('fileKey and fileName are required');
    if (!fileKey.startsWith(`tenants/${tenantId}/`)) return error('Unauthorized', 403);

    try {
      // Descargar archivo de S3
      const getRes = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: fileKey }));
      const chunks: Uint8Array[] = [];
      for await (const chunk of getRes.Body as any) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      // Extraer texto
      const text = await extractText(buffer, fileName);
      if (!text || text.trim().length < 10) {
        return error('No se pudo extraer texto del archivo', 400);
      }

      // Guardar texto extraído en S3
      const extractedKey = `${fileKey}.extracted.txt`;
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: extractedKey,
        Body: text,
        ContentType: 'text/plain',
      }));

      // Actualizar attachedFiles en el agente
      const agent = await getItem(keys.agent(tenantId, 'main'));
      if (!agent) return error('Agent not found', 404);

      const agentConfig = agent.agentConfig || {};
      const currentFiles: any[] = agentConfig.attachedFiles || [];

      // Evitar duplicados
      if (!currentFiles.find((f: any) => f.fileKey === fileKey)) {
        currentFiles.push({
          fileKey,
          extractedKey,
          fileName,
          textLength: text.length,
          uploadedAt: new Date().toISOString(),
        });
      }

      await putItem({
        ...agent,
        agentConfig: { ...agentConfig, attachedFiles: currentFiles },
      });

      return json({
        fileName,
        textLength: text.length,
        extractedKey,
        preview: text.slice(0, 200),
      });
    } catch (err: any) {
      console.error('File process error:', err);
      return error('Error procesando archivo: ' + err.message, 500);
    }
  }

  // DELETE /files/detach — sacar un archivo del agente
  if (method === 'DELETE' && path === '/files/detach') {
    const body = JSON.parse(event.body || '{}');
    const { fileKey } = body;

    if (!fileKey) return error('fileKey is required');

    const agent = await getItem(keys.agent(tenantId, 'main'));
    if (!agent) return error('Agent not found', 404);

    const agentConfig = agent.agentConfig || {};
    const currentFiles: any[] = agentConfig.attachedFiles || [];
    const file = currentFiles.find((f: any) => f.fileKey === fileKey);

    // Borrar archivos de S3
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: fileKey }));
      if (file?.extractedKey) {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: file.extractedKey }));
      }
    } catch {}

    // Actualizar agente
    const updatedFiles = currentFiles.filter((f: any) => f.fileKey !== fileKey);
    await putItem({
      ...agent,
      agentConfig: { ...agentConfig, attachedFiles: updatedFiles },
    });

    return json({ detached: true });
  }

  return error('Not found', 404);
}
