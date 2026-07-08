import type { Attachment, Conversation, MessageRole } from './schema';
import type { FetchImageResponse } from './messages';
import { generateId } from './extract-utils';

/**
 * Image capture pipeline.
 *
 * Collects content images (from the DOM or from API file references), fetches
 * them with the user's session cookies, and normalizes everything to PNG/JPEG
 * data URLs — the only formats pdfmake can embed. Failures are non-fatal: an
 * image that can't be fetched keeps its sourceUrl and is rendered as a note.
 */

export const MAX_IMAGE_DIMENSION = 1400;
export const MAX_IMAGES_PER_EXPORT = 40;
export const MIN_CONTENT_IMAGE_PX = 64;
const JPEG_QUALITY = 0.85;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export function isEmbeddableDataUrl(url: string): boolean {
  return /^data:image\/(png|jpe?g);base64,/i.test(url);
}

export function isImageDataUrl(url: string): boolean {
  return /^data:image\//i.test(url);
}

/** Scale (w, h) proportionally so neither side exceeds maxDim. */
export function fitDimensions(
  width: number,
  height: number,
  maxDim = MAX_IMAGE_DIMENSION,
): { width: number; height: number } {
  if (width <= maxDim && height <= maxDim) return { width, height };
  const scale = maxDim / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

interface EncodedImage {
  dataUrl: string;
  width: number;
  height: number;
}

function canvasEncode(
  draw: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void,
  width: number,
  height: number,
  preferPng: boolean,
): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    draw(ctx);
    return preferPng
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } catch {
    return null;
  }
}

async function encodeBitmapBlob(blob: Blob): Promise<EncodedImage | null> {
  if (typeof createImageBitmap !== 'function') return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }

  try {
    const { width, height } = fitDimensions(bitmap.width, bitmap.height);
    const withinLimits = width === bitmap.width && height === bitmap.height;
    const alreadyEmbeddable = blob.type === 'image/png' || blob.type === 'image/jpeg';

    if (alreadyEmbeddable && withinLimits) {
      const dataUrl = await blobToDataUrl(blob);
      return { dataUrl, width, height };
    }

    const preferPng = blob.type === 'image/png' || blob.type === 'image/svg+xml' || blob.type === 'image/gif';
    const dataUrl = canvasEncode((ctx) => {
      ctx.drawImage(bitmap, 0, 0, width, height);
    }, width, height, preferPng);
    return dataUrl ? { dataUrl, width, height } : null;
  } finally {
    bitmap.close?.();
  }
}

async function fetchImageBlobDirect(url: string, signal?: AbortSignal): Promise<Blob | null> {
  try {
    const response = await fetch(url, { credentials: 'include', signal });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size === 0 || blob.size > MAX_SOURCE_BYTES) return null;
    if (blob.type && !blob.type.startsWith('image/')) return null;
    return blob;
  } catch {
    return null;
  }
}

/** Cross-origin images: ask the background service worker (host permissions apply there). */
async function fetchImageBlobViaBackground(url: string): Promise<Blob | null> {
  try {
    if (typeof browser === 'undefined' || !browser.runtime?.sendMessage) return null;
    const response = (await browser.runtime.sendMessage({
      type: 'FETCH_IMAGE',
      payload: { url },
    })) as FetchImageResponse | undefined;
    if (!response?.ok || !response.dataUrl) return null;
    return await (await fetch(response.dataUrl)).blob();
  } catch {
    return null;
  }
}

/**
 * Fetch a URL and return a PNG/JPEG data URL (downscaled if needed).
 * Tries a direct fetch with the page session first, then the background
 * service worker for CORS-blocked hosts.
 */
export async function imageUrlToDataUrl(
  url: string,
  signal?: AbortSignal,
): Promise<EncodedImage | null> {
  try {
    if (url.startsWith('data:')) {
      if (!isImageDataUrl(url)) return null;
      const blob = await (await fetch(url)).blob();
      return encodeBitmapBlob(blob);
    }

    const blob =
      (await fetchImageBlobDirect(url, signal)) ?? (await fetchImageBlobViaBackground(url));
    if (!blob) return null;
    return encodeBitmapBlob(blob);
  } catch {
    return null;
  }
}

/** Last resort: re-encode an already-rendered <img> via canvas (fails if tainted). */
export function imageElementToDataUrl(img: HTMLImageElement): EncodedImage | null {
  const naturalWidth = img.naturalWidth || img.width;
  const naturalHeight = img.naturalHeight || img.height;
  if (!naturalWidth || !naturalHeight) return null;

  const { width, height } = fitDimensions(naturalWidth, naturalHeight);
  const dataUrl = canvasEncode((ctx) => {
    ctx.drawImage(img, 0, 0, width, height);
  }, width, height, true);
  return dataUrl ? { dataUrl, width, height } : null;
}

const EXCLUDED_IMAGE_ANCESTORS = 'button, [role="button"], nav, [class*="avatar" i], [data-testid*="avatar" i]';

/** True for images that are conversation content rather than UI chrome. */
export function isContentImage(img: HTMLImageElement): boolean {
  const src = img.currentSrc || img.src || '';
  if (!src) return false;
  if (src.startsWith('data:image/svg')) return false;
  if (img.closest(EXCLUDED_IMAGE_ANCESTORS)) return false;

  const width = img.naturalWidth || img.width || Number(img.getAttribute('width')) || 0;
  const height = img.naturalHeight || img.height || Number(img.getAttribute('height')) || 0;
  return width >= MIN_CONTENT_IMAGE_PX && height >= MIN_CONTENT_IMAGE_PX;
}

/** Collect content images inside a message element as image attachments. */
export function collectImageAttachmentsFromElement(
  el: Element,
  _role: MessageRole,
  platform: string,
  messageIndex: number,
): Attachment[] {
  const attachments: Attachment[] = [];
  const seen = new Set<string>();

  el.querySelectorAll('img').forEach((img) => {
    if (!(img instanceof HTMLImageElement)) return;
    if (!isContentImage(img)) return;
    const src = img.currentSrc || img.src;
    if (seen.has(src)) return;
    seen.add(src);

    attachments.push({
      id: generateId(`${platform}-image`, messageIndex * 10 + attachments.length),
      kind: 'image',
      name: img.alt?.trim() || 'Image',
      content: img.alt?.trim() || 'Image',
      sourceUrl: src,
    });
  });

  return attachments;
}

/** Find the already-rendered <img> matching an attachment's sourceUrl. */
export function findLiveImageElement(
  document: Document,
  sourceUrl?: string,
): HTMLImageElement | null {
  if (!sourceUrl) return null;
  for (const img of Array.from(document.images ?? [])) {
    if ((img.currentSrc || img.src) === sourceUrl) return img;
  }
  return null;
}

/**
 * Fetch data URLs for every image attachment in the conversation (in place).
 * Caps the number of embedded images; failures leave the attachment with only
 * its sourceUrl so the renderer can fall back to a note.
 */
export async function hydrateImageAttachments(
  conversation: Pick<Conversation, 'messages'>,
  signal?: AbortSignal,
  imageElementLookup?: (att: Attachment) => HTMLImageElement | null,
): Promise<void> {
  let embedded = 0;

  for (const message of conversation.messages) {
    if (!message.attachments) continue;
    for (const att of message.attachments) {
      if (att.kind !== 'image' || att.dataUrl) continue;
      if (embedded >= MAX_IMAGES_PER_EXPORT) return;
      if (signal?.aborted) return;
      if (!att.sourceUrl) continue;

      let encoded = await imageUrlToDataUrl(att.sourceUrl, signal);
      if (!encoded && imageElementLookup) {
        const img = imageElementLookup(att);
        if (img) encoded = imageElementToDataUrl(img);
      }

      if (encoded) {
        att.dataUrl = encoded.dataUrl;
        att.width = encoded.width;
        att.height = encoded.height;
        embedded++;
      }
    }
  }
}
