import { type HandleUploadPresignedBody, handleUploadPresigned } from '@vercel/blob/client';
import { gate } from '@/lib/access';
import { isSameOriginWrite } from '@/lib/auth';
import { hasBlob } from '@/lib/blob-doc';
import { ownBatchPath, uploadToken } from '@/lib/cloud';
import { sessionOf } from '@/lib/session';

/*
 * Uploads of batch zips straight from the browser to the store (D79): the
 * page's `uploadPresigned` asks here for a presigned URL, and gets one only
 * for a zip under the signed-in account's own `batches/` folder, put-only,
 * for fifteen minutes, up to 300 MB. Needs the store (BLOB_STORE_ID or a
 * read-write token) and BLOB_WEBHOOK_PUBLIC_KEY, both set when the store is
 * connected on Vercel.
 */

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

export async function POST(request: Request) {
  if (!hasBlob()) return fail(503, 'No store here.');
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return fail(403, 'Forbidden');
  const session = sessionOf(request);
  if (!session) return fail(401, 'Sign in first.');
  const blocked = await gate(request);
  if (blocked) return blocked;
  let body: HandleUploadPresignedBody;
  try {
    body = (await request.json()) as HandleUploadPresignedBody;
  } catch {
    return fail(400, 'Bad request.');
  }
  if (body.type !== 'blob.generate-presigned-url') return fail(400, 'Bad request.');
  try {
    const result = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname) => {
        if (!ownBatchPath(session.user, pathname)) throw new Error('Not your folder.');
        return {
          token: await uploadToken(pathname),
          urlOptions: { allowOverwrite: true, addRandomSuffix: false },
        };
      },
    });
    return Response.json(result, { headers });
  } catch (error) {
    console.error('[pin] upload', (error as Error).message);
    return fail(400, 'The upload wasn’t allowed.');
  }
}
