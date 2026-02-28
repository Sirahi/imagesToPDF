import { PDFDocument, degrees } from 'pdf-lib';

type WorkerExportItem = {
  dataUrl: string;
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

const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
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

const createPdfBytes = async (payload: ExportRequestMessage['payload']) => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
  const scaleX = A4_WIDTH_PT / payload.stageWidth;
  const scaleY = A4_HEIGHT_PT / payload.stageHeight;

  for (const item of payload.items) {
    const imageBytes = dataUrlToBytes(item.dataUrl);
    const embeddedImage = await pdfDoc.embedPng(imageBytes);
    const width = item.width * scaleX;
    const height = item.height * scaleY;

    page.drawImage(embeddedImage, {
      x: item.x * scaleX,
      y: A4_HEIGHT_PT - (item.y * scaleY) - height,
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
