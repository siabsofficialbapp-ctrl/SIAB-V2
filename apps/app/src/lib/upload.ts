/**
 * Image upload.
 *
 * This is the two-step flow, and BOTH steps matter:
 *
 *   1. ask the API for a signed URL           -> the file may be written
 *   2. PUT the bytes                          -> the file exists
 *   3. tell the API the path                  -> the row exists, so it renders
 *
 * Skipping step 3 is the classic reason an image "uploads" and then never
 * appears. If step 3 fails, the orphaned object is cleaned up so the storage
 * quota is not quietly consumed by files nothing points at.
 */
import { apiFetch } from './api';

export interface PickedImage {
  uri: string;
  mimeType?: string;
  fileSize?: number;
}

interface SignedUpload {
  uploadUrl: string;
  token: string;
  path: string;
  bucket: string;
}

async function putBytes(uploadUrl: string, image: PickedImage, contentType: string): Promise<void> {
  // React Native cannot read a file:// URI as a Buffer, so fetch it into a
  // Blob first. This works identically on web.
  const fileRes = await fetch(image.uri);
  const blob = await fileRes.blob();

  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': contentType, 'x-upsert': 'true' },
    body: blob,
  });
  if (!res.ok) {
    throw new Error(`Upload failed with ${res.status}`);
  }
}

export async function uploadProductImage(
  productId: string,
  image: PickedImage,
  sortOrder = 0,
): Promise<{ id: string; url: string }> {
  const contentType = image.mimeType ?? 'image/jpeg';

  const signed = await apiFetch<SignedUpload>(`/seller/products/${productId}/images/upload-url`, {
    method: 'POST',
    body: { contentType, bytes: image.fileSize ?? 0 },
  });

  await putBytes(signed.uploadUrl, image, contentType);

  try {
    const { image: row } = await apiFetch<{ image: { id: string; url: string } }>(
      `/seller/products/${productId}/images`,
      { method: 'POST', body: { storagePath: signed.path, sortOrder } },
    );
    return row;
  } catch (err) {
    // The bytes landed but the row did not. Leaving the file behind would
    // waste quota and confuse the next upload, so remove it.
    await apiFetch(`/seller/products/${productId}/images/orphan`, {
      method: 'DELETE',
      body: { storagePath: signed.path },
    }).catch(() => undefined);
    throw err;
  }
}

export async function uploadChatImage(conversationId: string, image: PickedImage): Promise<string> {
  const contentType = image.mimeType ?? 'image/jpeg';
  const signed = await apiFetch<SignedUpload>(`/conversations/${conversationId}/images/upload-url`, {
    method: 'POST',
    body: { contentType },
  });
  await putBytes(signed.uploadUrl, image, contentType);
  return signed.path;
}
