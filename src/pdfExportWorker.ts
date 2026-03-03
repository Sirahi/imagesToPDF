import { PDFDocument, degrees, type PDFImage } from 'pdf-lib';

type WorkerExportItem = {
  dataUrl: string;
  mimeType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

type ExportRequestMessage = {
  type: 'export';
  payload: {
    stageWidth: number;
    stageHeight: number;
    pageWidthPt: number;
    pageHeightPt: number;
    items: WorkerExportItem[];
  };
};

type ExportSuccessMessage = {
  type: 'success';
  bytes: ArrayBuffer;
};

type ExportErrorMessage = {
  type: 'error';
  message: string;
};
type WorkerScope = {
  postMessage: (message: ExportSuccessMessage | ExportErrorMessage, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<ExportRequestMessage>) => void) | null;
};

const workerScope = self as unknown as WorkerScope;

const dataUrlToBytes = (dataUrl: string) => {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    throw new Error('Invalid data URL');
  }

  const header = dataUrl.slice(0, commaIndex);
  const dataPart = dataUrl.slice(commaIndex + 1);
  if (header.includes(';base64')) {
    const binary = atob(dataPart);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  return new TextEncoder().encode(decodeURIComponent(dataPart));
};

const inferMimeType = (item: WorkerExportItem) => {
  if (item.mimeType) {
    return item.mimeType.toLowerCase();
  }
  const commaIndex = item.dataUrl.indexOf(',');
  if (commaIndex === -1) {
    return '';
  }
  const header = item.dataUrl.slice(0, commaIndex).toLowerCase();
  if (!header.startsWith('data:')) {
    return '';
  }
  const semicolonIndex = header.indexOf(';');
  if (semicolonIndex === -1) {
    return '';
  }
  return header.slice(5, semicolonIndex);
};

const convertWebpDataUrlToPngBytes = async (dataUrl: string) => {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    throw new Error('WebP export is not supported in this browser environment.');
  }

  const webpBytes = dataUrlToBytes(dataUrl);
  const webpBlob = new Blob([webpBytes], { type: 'image/webp' });
  const bitmap = await createImageBitmap(webpBlob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to prepare WebP conversion canvas.');
    }
    context.drawImage(bitmap, 0, 0);
    const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await pngBlob.arrayBuffer());
  } finally {
    bitmap.close();
  }
};

const embedImage = async (pdfDoc: PDFDocument, item: WorkerExportItem) => {
  const mimeType = inferMimeType(item);
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return pdfDoc.embedJpg(dataUrlToBytes(item.dataUrl));
  }
  if (mimeType === 'image/png') {
    return pdfDoc.embedPng(dataUrlToBytes(item.dataUrl));
  }
  if (mimeType === 'image/webp') {
    const pngBytes = await convertWebpDataUrlToPngBytes(item.dataUrl);
    return pdfDoc.embedPng(pngBytes);
  }
  throw new Error(`Unsupported image type for export: ${mimeType || 'unknown'}`);
};

const createPdfBytes = async (payload: ExportRequestMessage['payload']) => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([payload.pageWidthPt, payload.pageHeightPt]);
  const scaleX = payload.pageWidthPt / payload.stageWidth;
  const scaleY = payload.pageHeightPt / payload.stageHeight;
  const imageCache = new Map<string, Promise<PDFImage>>();

  for (const item of payload.items) {
    const cacheKey = `${inferMimeType(item)}:${item.dataUrl}`;
    let embeddedImagePromise = imageCache.get(cacheKey);
    if (!embeddedImagePromise) {
      embeddedImagePromise = embedImage(pdfDoc, item);
      imageCache.set(cacheKey, embeddedImagePromise);
    }
    const embeddedImage = await embeddedImagePromise;
    const width = item.width * scaleX;
    const height = item.height * scaleY;

    page.drawImage(embeddedImage, {
      x: item.x * scaleX,
      y: payload.pageHeightPt - (item.y * scaleY) - height,
      width,
      height,
      rotate: degrees(-item.rotation)
    });
  }

  const bytes = await pdfDoc.save();
  return Uint8Array.from(bytes);
};

workerScope.onmessage = async (event: MessageEvent<ExportRequestMessage>) => {
  const message = event.data;
  if (!message || message.type !== 'export') {
    return;
  }

  try {
    const bytes = await createPdfBytes(message.payload);
    const success: ExportSuccessMessage = {
      type: 'success',
      bytes: bytes.buffer.slice(0)
    };
    workerScope.postMessage(success, [success.bytes]);
  } catch (error) {
    const failure: ExportErrorMessage = {
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    };
    workerScope.postMessage(failure);
  }
};
