import { useEffect, useMemo, useRef, useState } from 'react';
import { Group, Layer, Line, Rect, Stage, Image as KonvaImage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { useDebugLogger } from './useDebugLogger';
import DebugPanel from './DebugPanel';

type PlacedImage = {
  id: string;
  dataUrl: string;
  htmlImage: HTMLImageElement;
  originalWidth: number;
  originalHeight: number;
  baseWidth: number;
  baseHeight: number;
  scalePercent: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};
type SnapGuides = {
  vertical: number | null;
  horizontal: number | null;
};
type PageSizeKey = 'a4' | '6x4';

const MAX_FILES_PER_IMPORT = 12;
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const MAX_DECODED_PIXELS = 40_000_000;
const SNAP_DISTANCE_PX = 10;
const DELETE_ICON_SIZE = 24;
const DEFAULT_SCALE_PERCENT = 50;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PAGE_PRESETS: Record<PageSizeKey, { label: string; ratio: number; pdfWidthPt: number; pdfHeightPt: number }> = {
  a4: {
    label: 'A4',
    ratio: 210 / 297,
    pdfWidthPt: 595.28,
    pdfHeightPt: 841.89
  },
  '6x4': {
    label: '6 x 4',
    ratio: 6 / 4,
    pdfWidthPt: 432,
    pdfHeightPt: 288
  }
};
const createId = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const scaleFactorFromPercent = (percent: number) => {
  if (percent <= 50) {
    return 0.2 + (percent / 50) * 0.8;
  }
  return 1 + ((percent - 50) / 50) * 4;
};
const normalizeRotation = (value: number) => {
  const normalized = ((value % 360) + 360) % 360;
  return normalized === 0 && value > 0 ? 360 : normalized;
};
const getImageCenter = (x: number, y: number, width: number, height: number, rotation: number) => {
  const angle = (rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: x + (cos * width) / 2 - (sin * height) / 2,
    y: y + (sin * width) / 2 + (cos * height) / 2
  };
};
const getImageTopRight = (x: number, y: number, width: number, rotation: number) => {
  const angle = (rotation * Math.PI) / 180;
  return {
    x: x + Math.cos(angle) * width,
    y: y + Math.sin(angle) * width
  };
};
const getRotatedBounds = (x: number, y: number, width: number, height: number, rotation: number) => {
  const angle = (rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const corners = [
    { x, y },
    { x: x + width * cos, y: y + width * sin },
    { x: x - height * sin, y: y + height * cos },
    { x: x + width * cos - height * sin, y: y + width * sin + height * cos }
  ];

  let minX = corners[0].x;
  let maxX = corners[0].x;
  let minY = corners[0].y;
  let maxY = corners[0].y;
  for (const corner of corners) {
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
  }

  return { minX, maxX, minY, maxY };
};

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load image'));
    image.src = src;
  });

const normalizeImageFile = async (file: File) => {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to normalize image');
  }

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (bitmap.width * bitmap.height > MAX_DECODED_PIXELS) {
        bitmap.close();
        throw new Error(`Image is too large in dimensions (max ${MAX_DECODED_PIXELS.toLocaleString()} pixels).`);
      }
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();

      const normalizedDataUrl = canvas.toDataURL('image/png');
      const normalizedImage = await loadImage(normalizedDataUrl);
      return { dataUrl: normalizedDataUrl, htmlImage: normalizedImage };
    } catch {
      // Fallback to Image decode path below.
    }
  }

  const sourceDataUrl = await readFileAsDataUrl(file);
  const sourceImage = await loadImage(sourceDataUrl);
  const width = sourceImage.naturalWidth || sourceImage.width;
  const height = sourceImage.naturalHeight || sourceImage.height;
  if (width * height > MAX_DECODED_PIXELS) {
    throw new Error(`Image is too large in dimensions (max ${MAX_DECODED_PIXELS.toLocaleString()} pixels).`);
  }
  canvas.width = width;
  canvas.height = height;
  context.drawImage(sourceImage, 0, 0, width, height);

  const normalizedDataUrl = canvas.toDataURL('image/png');
  const normalizedImage = await loadImage(normalizedDataUrl);
  return { dataUrl: normalizedDataUrl, htmlImage: normalizedImage };
};

const App = () => {
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef<Record<string, Konva.Image | null>>({});

  const [items, setItems] = useState<PlacedImage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<'move' | 'transform'>('move');
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [darkThemeEnabled, setDarkThemeEnabled] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pageSize, setPageSize] = useState<PageSizeKey>('a4');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [maxStageHeight, setMaxStageHeight] = useState(0);
  const [snapGuides, setSnapGuides] = useState<SnapGuides>({ vertical: null, horizontal: null });
  const { debugEnabled, showDebug, setShowDebug, debugEntries, appendDebug, clearDebug } = useDebugLogger();
  const selectedItem = items.find((item) => item.id === selectedId) ?? null;
  const selectedPage = PAGE_PRESETS[pageSize];
  const isLayoutReady = containerWidth > 0 && maxStageHeight > 0;

  useEffect(() => {
    document.body.classList.toggle('theme-dark-body', darkThemeEnabled);
    return () => {
      document.body.classList.remove('theme-dark-body');
    };
  }, [darkThemeEnabled]);

  useEffect(() => {
    const element = stageContainerRef.current;
    if (!element) {
      return;
    }

    const updateLayout = () => {
      setContainerWidth(element.clientWidth);

      const rect = element.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const styles = window.getComputedStyle(element);
      const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
      const bottomSafeSpace = 8;
      const availableHeight = viewportHeight - rect.top - paddingTop - paddingBottom - bottomSafeSpace;
      setMaxStageHeight(Math.max(120, availableHeight));
    };

    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(element);
    window.addEventListener('resize', updateLayout);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateLayout);
    };
  }, []);

  const stageWidth = useMemo(() => {
    const fallbackWidth = typeof window === 'undefined' ? 320 : window.innerWidth - 32;
    const availableWidth = containerWidth || fallbackWidth;
    const widthFromHeight = (maxStageHeight || 360) * selectedPage.ratio;
    return clamp(Math.min(availableWidth, widthFromHeight), 220, 640);
  }, [containerWidth, maxStageHeight, selectedPage.ratio]);

  const stageHeight = stageWidth / selectedPage.ratio;
  const canvasPreviewFill = darkThemeEnabled ? '#0b1020' : '#ffffff';
  const canvasPreviewStroke = darkThemeEnabled ? '#4b5563' : '#cccccc';
  const selectedDeleteIconPosition = useMemo(() => {
    if (!selectedItem || draggingId === selectedItem.id) {
      return null;
    }
    const topRight = getImageTopRight(
      selectedItem.x,
      selectedItem.y,
      selectedItem.width,
      selectedItem.rotation
    );
    const padding = 8;
    return {
      x: clamp(topRight.x + padding, DELETE_ICON_SIZE / 2, stageWidth - DELETE_ICON_SIZE / 2),
      y: clamp(topRight.y - padding, DELETE_ICON_SIZE / 2, stageHeight - DELETE_ICON_SIZE / 2)
    };
  }, [selectedItem, draggingId, stageWidth, stageHeight]);
  const rotateAnchorOffset = -Math.abs(selectedItem?.height ?? 0) / 2;
  const constrainPositionByCenter = (x: number, y: number, width: number, height: number, rotation: number) => {
    const center = getImageCenter(x, y, width, height, rotation);
    const clampedCenterX = clamp(center.x, 0, stageWidth);
    const clampedCenterY = clamp(center.y, 0, stageHeight);
    return {
      x: x + (clampedCenterX - center.x),
      y: y + (clampedCenterY - center.y)
    };
  };
  useEffect(() => {
    setItems((current) =>
      current.map((item) => {
        const constrained = constrainPositionByCenter(item.x, item.y, item.width, item.height, item.rotation);
        if (constrained.x === item.x && constrained.y === item.y) {
          return item;
        }
        return {
          ...item,
          x: constrained.x,
          y: constrained.y
        };
      })
    );
  }, [stageWidth, stageHeight]);
  const findClosestSnap = (
    anchors: Array<{ value: number; kind: 'center' | 'edge' }>,
    targets: Array<{ value: number; kind: 'center' | 'edge' }>,
    preferredGuide: number | null
  ) => {
    if (preferredGuide !== null) {
      let preferredDistance = SNAP_DISTANCE_PX + 1;
      let preferredDelta = 0;
      for (const anchor of anchors) {
        const distance = Math.abs(preferredGuide - anchor.value);
        if (distance < preferredDistance) {
          preferredDistance = distance;
          preferredDelta = preferredGuide - anchor.value;
        }
      }
      if (preferredDistance <= SNAP_DISTANCE_PX) {
        return { delta: preferredDelta, guide: preferredGuide };
      }
    }

    const findByPriority = (anchorKind: 'center' | 'edge' | 'any', targetKind: 'center' | 'edge' | 'any') => {
      let bestDistance = SNAP_DISTANCE_PX + 1;
      let bestDelta = 0;
      let bestGuide: number | null = null;

      for (const anchor of anchors) {
        if (anchorKind !== 'any' && anchor.kind !== anchorKind) {
          continue;
        }
        for (const target of targets) {
          if (targetKind !== 'any' && target.kind !== targetKind) {
            continue;
          }
          const distance = Math.abs(target.value - anchor.value);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestDelta = target.value - anchor.value;
            bestGuide = target.value;
          }
        }
      }

      return bestGuide === null ? null : { delta: bestDelta, guide: bestGuide };
    };

    return (
      findByPriority('center', 'center') ??
      findByPriority('edge', 'edge') ??
      findByPriority('any', 'any') ?? { delta: 0, guide: null }
    );
  };
  const snapPositionToGuides = (
    movingId: string,
    x: number,
    y: number,
    width: number,
    height: number,
    rotation: number,
    preferredVerticalGuide: number | null,
    preferredHorizontalGuide: number | null
  ) => {
    const movingBounds = getRotatedBounds(x, y, width, height, rotation);
    const movingXAnchors = [
      { value: movingBounds.minX, kind: 'edge' as const },
      { value: (movingBounds.minX + movingBounds.maxX) / 2, kind: 'center' as const },
      { value: movingBounds.maxX, kind: 'edge' as const }
    ];
    const movingYAnchors = [
      { value: movingBounds.minY, kind: 'edge' as const },
      { value: (movingBounds.minY + movingBounds.maxY) / 2, kind: 'center' as const },
      { value: movingBounds.maxY, kind: 'edge' as const }
    ];

    const targetX = [
      { value: 0, kind: 'edge' as const },
      { value: stageWidth / 2, kind: 'center' as const },
      { value: stageWidth, kind: 'edge' as const }
    ];
    const targetY = [
      { value: 0, kind: 'edge' as const },
      { value: stageHeight / 2, kind: 'center' as const },
      { value: stageHeight, kind: 'edge' as const }
    ];
    for (const item of items) {
      if (item.id === movingId) {
        continue;
      }
      const bounds = getRotatedBounds(item.x, item.y, item.width, item.height, item.rotation);
      targetX.push(
        { value: bounds.minX, kind: 'edge' },
        { value: (bounds.minX + bounds.maxX) / 2, kind: 'center' },
        { value: bounds.maxX, kind: 'edge' }
      );
      targetY.push(
        { value: bounds.minY, kind: 'edge' },
        { value: (bounds.minY + bounds.maxY) / 2, kind: 'center' },
        { value: bounds.maxY, kind: 'edge' }
      );
    }

    const snapX = findClosestSnap(movingXAnchors, targetX, preferredVerticalGuide);
    const snapY = findClosestSnap(movingYAnchors, targetY, preferredHorizontalGuide);

    return {
      x: x + snapX.delta,
      y: y + snapY.delta,
      guideX: snapX.guide,
      guideY: snapY.guide
    };
  };

  useEffect(() => {
    setSnapGuides({ vertical: null, horizontal: null });
  }, [interactionMode, selectedId]);
  useEffect(() => {
    if (!snapEnabled) {
      setSnapGuides({ vertical: null, horizontal: null });
    }
  }, [snapEnabled]);
  useEffect(() => {
    if (!importError) {
      return;
    }
    const timeoutId = window.setTimeout(() => setImportError(null), 10000);
    return () => window.clearTimeout(timeoutId);
  }, [importError]);
  useEffect(() => {
    if (!exportError) {
      return;
    }
    const timeoutId = window.setTimeout(() => setExportError(null), 10000);
    return () => window.clearTimeout(timeoutId);
  }, [exportError]);
  const bindTransformer = () => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }
    if (!selectedId) {
      transformer.nodes([]);
      return;
    }
    const selectedNode = shapeRefs.current[selectedId];
    if (selectedNode) {
      transformer.nodes([selectedNode]);
      transformer.getLayer()?.batchDraw();
    }
  };

  const onFilesAdded = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setIsImporting(true);
    const fileList = event.target.files;
    if (!fileList?.length) {
      setIsImporting(false);
      return;
    }

    setImportError(null);
    try {
      const selectedFiles = Array.from(fileList);
      const filesToProcess = selectedFiles.slice(0, MAX_FILES_PER_IMPORT);
      if (selectedFiles.length > MAX_FILES_PER_IMPORT) {
        setImportError(
          `You selected ${selectedFiles.length} files. Only the first ${MAX_FILES_PER_IMPORT} were processed.`
        );
        appendDebug(`File count limited to ${MAX_FILES_PER_IMPORT}.`);
      }

      const incoming: PlacedImage[] = [];
      const failedNames: string[] = [];
      for (const file of filesToProcess) {
        if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
          failedNames.push(file.name);
          appendDebug(
            `Failed file: ${file.name} -> unsupported file type (${file.type || 'unknown'}). Allowed: JPEG, PNG, WebP.`
          );
          continue;
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
          failedNames.push(file.name);
          appendDebug(`Failed file: ${file.name} -> file too large (${file.size} bytes)`);
          continue;
        }

        try {
          const { dataUrl, htmlImage } = await normalizeImageFile(file);
          const baseWidth = Math.min(stageWidth * 0.35, htmlImage.width);
          const baseHeight = (baseWidth / htmlImage.width) * htmlImage.height;
          const initialFactor = scaleFactorFromPercent(DEFAULT_SCALE_PERCENT);
          const initialWidth = baseWidth * initialFactor;
          const initialHeight = baseHeight * initialFactor;
          incoming.push({
            id: createId(),
            dataUrl,
            htmlImage,
            originalWidth: baseWidth,
            originalHeight: baseHeight,
            baseWidth,
            baseHeight,
            scalePercent: DEFAULT_SCALE_PERCENT,
            x: stageWidth / 2 - initialWidth / 2,
            y: stageHeight / 2 - initialHeight / 2,
            width: initialWidth,
            height: initialHeight,
            rotation: 0
          });
        } catch (error) {
          failedNames.push(file.name);
          const message = error instanceof Error ? error.message : String(error);
          appendDebug(`Failed file: ${file.name} -> ${message}`);
        }
      }

      if (incoming.length) {
        setItems((current) => [...current, ...incoming]);
        setSelectedId(incoming[incoming.length - 1]?.id ?? null);
      }

      if (failedNames.length) {
        setImportError(
          failedNames.length === 1
            ? `Could not load "${failedNames[0]}".`
            : `Could not load ${failedNames.length} images.`
        );
      }
    } finally {
      event.target.value = '';
      setIsImporting(false);
    }
  };

  const updateItem = (id: string, patch: Partial<PlacedImage>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };
  const toggleInteractionMode = () => {
    setInteractionMode((current) => (current === 'move' ? 'transform' : 'move'));
  };
  const setItemScale = (id: string, nextScalePercent: number) => {
    const safeScalePercent = clamp(nextScalePercent, 0, 100);
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) {
          return item;
        }

        const factor = scaleFactorFromPercent(safeScalePercent);
        const nextWidth = item.baseWidth * factor;
        const nextHeight = item.baseHeight * factor;
        const angle = (item.rotation * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const centerX = item.x + (cos * item.width) / 2 - (sin * item.height) / 2;
        const centerY = item.y + (sin * item.width) / 2 + (cos * item.height) / 2;
        const nextX = centerX - (cos * nextWidth) / 2 + (sin * nextHeight) / 2;
        const nextY = centerY - (sin * nextWidth) / 2 - (cos * nextHeight) / 2;
        const constrained = constrainPositionByCenter(nextX, nextY, nextWidth, nextHeight, item.rotation);

        return {
          ...item,
          scalePercent: safeScalePercent,
          x: constrained.x,
          y: constrained.y,
          width: nextWidth,
          height: nextHeight,
          baseWidth: nextWidth / factor,
          baseHeight: nextHeight / factor
        };
      })
    );
  };
  const setItemRotation = (id: string, nextRotation: number) => {
    const normalized = normalizeRotation(nextRotation);
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) {
          return item;
        }

        const center = getImageCenter(item.x, item.y, item.width, item.height, item.rotation);
        const angle = (normalized * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const nextX = center.x - (cos * item.width) / 2 + (sin * item.height) / 2;
        const nextY = center.y - (sin * item.width) / 2 - (cos * item.height) / 2;
        const constrained = constrainPositionByCenter(nextX, nextY, item.width, item.height, normalized);

        return {
          ...item,
          x: constrained.x,
          y: constrained.y,
          rotation: normalized
        };
      })
    );
  };
  const resetSelectedAdjustments = () => {
    if (!selectedId) {
      return;
    }

    setItems((current) =>
      current.map((item) => {
        if (item.id !== selectedId) {
          return item;
        }

        const nextWidth = item.originalWidth;
        const nextHeight = item.originalHeight;
        const nextRotation = 0;
        const nextX = stageWidth / 2 - nextWidth / 2;
        const nextY = stageHeight / 2 - nextHeight / 2;
        const constrained = constrainPositionByCenter(nextX, nextY, nextWidth, nextHeight, nextRotation);

        return {
          ...item,
          x: constrained.x,
          y: constrained.y,
          width: nextWidth,
          height: nextHeight,
          baseWidth: item.originalWidth,
          baseHeight: item.originalHeight,
          scalePercent: DEFAULT_SCALE_PERCENT,
          rotation: nextRotation
        };
      })
    );
  };

  const deleteSelected = () => {
    if (!selectedId) {
      return;
    }
    setItems((current) => current.filter((item) => item.id !== selectedId));
    setSelectedId(null);
  };
  const deleteAll = () => {
    if (!items.length) {
      return;
    }
    setItems([]);
    setSelectedId(null);
    setDraggingId(null);
    setSnapGuides({ vertical: null, horizontal: null });
    setShowDeleteAllConfirm(false);
  };

  const runExportPdf = async () => {
    if (!items.length) {
      return;
    }
    try {
      const worker = new Worker(new URL('./pdfExportWorker.ts', import.meta.url), { type: 'module' });
      const pdfBytes = await new Promise<Uint8Array>((resolve, reject) => {
        worker.onmessage = (
          event: MessageEvent<{ type: 'success'; bytes: ArrayBuffer } | { type: 'error'; message: string }>
        ) => {
          const message = event.data;
          if (message.type === 'success') {
            resolve(new Uint8Array(message.bytes));
            return;
          }
          reject(new Error(message.message));
        };
        worker.onerror = () => {
          reject(new Error('PDF export worker failed'));
        };
        worker.postMessage({
          type: 'export',
          payload: {
            stageWidth,
            stageHeight,
            pageWidthPt: selectedPage.pdfWidthPt,
            pageHeightPt: selectedPage.pdfHeightPt,
            items: items.map((item) => ({
              dataUrl: item.dataUrl,
              x: item.x,
              y: item.y,
              width: item.width,
              height: item.height,
              rotation: item.rotation
            }))
          }
        });
      }).finally(() => {
        worker.terminate();
      });

      const safeBytes = new Uint8Array(pdfBytes.byteLength);
      safeBytes.set(pdfBytes);
      const blob = new Blob([safeBytes.buffer], { type: 'application/pdf' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `a4-composition-${Date.now()}.pdf`;
      link.click();
      URL.revokeObjectURL(link.href);
      setExportError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendDebug(`Export failed: ${message}`);
      setExportError('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };
  const exportPdf = () => {
    if (!items.length || isExporting || isImporting) {
      return;
    }
    setSelectedId(null);
    setDraggingId(null);
    setSnapGuides({ vertical: null, horizontal: null });
    setExportError(null);
    setIsExporting(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void runExportPdf();
      });
    });
  };

  bindTransformer();

  return (
    <div className={`app-shell${darkThemeEnabled ? ' theme-dark' : ''}`}>
      <div className="toolbar">
        <label className="button primary">
          Add Image
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={onFilesAdded}
            disabled={isImporting || isExporting}
          />
        </label>
        <button
          type="button"
          className="danger"
          onClick={() => setShowDeleteAllConfirm(true)}
          disabled={!items.length || isExporting || isImporting}
        >
          Delete All
        </button>
        <button type="button" className="success" onClick={exportPdf} disabled={isExporting || isImporting || !items.length}>
          {isExporting ? 'Exporting...' : 'Export As PDF'}
        </button>
        <label className="page-size-picker">
          Size
          <select
            value={pageSize}
            onChange={(event) => setPageSize(event.target.value as PageSizeKey)}
            disabled={isImporting || isExporting}
          >
            {(Object.keys(PAGE_PRESETS) as PageSizeKey[]).map((key) => (
              <option key={key} value={key}>
                {PAGE_PRESETS[key].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mode-row">
        <div className="switch-group">
          <label className="mode-switch" htmlFor="mode-switch">
            <span className="mode-label mode-label-move">Move</span>
            <input
              id="mode-switch"
              type="checkbox"
              checked={interactionMode === 'transform'}
              onChange={toggleInteractionMode}
              aria-label="Toggle between move mode and stretch mode"
            />
            <span className="mode-slider" aria-hidden="true" />
            <span className="mode-label mode-label-transform">Stretch</span>
          </label>
          <label className="mode-switch snap-switch" htmlFor="snap-switch">
            <span className="mode-label mode-label-snap">Snap</span>
            <input
              id="snap-switch"
              type="checkbox"
              checked={snapEnabled}
              onChange={() => setSnapEnabled((current) => !current)}
              aria-label="Toggle snapping guides and snapping behavior"
            />
            <span className="mode-slider" aria-hidden="true" />
          </label>
          <label className="mode-switch theme-switch" htmlFor="theme-switch">
            <span className="mode-label mode-label-theme-light" aria-hidden="true">
              <svg className="theme-icon" viewBox="0 0 24 24" focusable="false">
                <circle cx="12" cy="12" r="4" />
                <line x1="12" y1="2" x2="12" y2="5" />
                <line x1="12" y1="19" x2="12" y2="22" />
                <line x1="2" y1="12" x2="5" y2="12" />
                <line x1="19" y1="12" x2="22" y2="12" />
                <line x1="4.9" y1="4.9" x2="7" y2="7" />
                <line x1="17" y1="17" x2="19.1" y2="19.1" />
                <line x1="4.9" y1="19.1" x2="7" y2="17" />
                <line x1="17" y1="7" x2="19.1" y2="4.9" />
              </svg>
            </span>
            <input
              id="theme-switch"
              type="checkbox"
              checked={darkThemeEnabled}
              onChange={() => setDarkThemeEnabled((current) => !current)}
              aria-label="Toggle light and dark theme"
            />
            <span className="mode-slider" aria-hidden="true" />
            <span className="mode-label mode-label-theme-dark" aria-hidden="true">
              <svg className="theme-icon" viewBox="0 0 24 24" focusable="false">
                <path d="M21 13.2A9 9 0 1 1 10.8 3 7 7 0 1 0 21 13.2z" />
              </svg>
            </span>
          </label>
        </div>
        <button
          type="button"
          className="undo-button"
          onClick={resetSelectedAdjustments}
          disabled={!selectedItem || isImporting || isExporting}
          title="Reset selected image (scale 100%, rotation 0, undo stretch)"
          aria-label="Reset selected image"
        >
          {'\u21BA'}
        </button>
      </div>
      {selectedItem ? (
        <div className="selection-controls">
          <label htmlFor="scale-slider">Scale</label>
          <input
            id="scale-slider"
            type="range"
            min={0}
            max={100}
            value={selectedItem.scalePercent}
            onChange={(event) => setItemScale(selectedItem.id, Number(event.target.value))}
          />
          <span>{Math.round(scaleFactorFromPercent(selectedItem.scalePercent) * 100)}%</span>
          <label htmlFor="rotation-slider">Rotation</label>
          <input
            id="rotation-slider"
            type="range"
            min={0}
            max={360}
            value={Math.round(normalizeRotation(selectedItem.rotation))}
            onChange={(event) => setItemRotation(selectedItem.id, Number(event.target.value))}
          />
          <span>
            {Math.round(normalizeRotation(selectedItem.rotation))}
            {'\u00B0'}
          </span>
        </div>
      ) : null}
      {exportError ? <p className="import-error">{exportError}</p> : null}

      <DebugPanel
        debugEnabled={debugEnabled}
        showDebug={showDebug}
        onToggle={() => setShowDebug((current) => !current)}
        entries={debugEntries}
        onClear={clearDebug}
        importError={importError}
      />

      <div className="editor-panel">
        <div className="stage-wrap" ref={stageContainerRef}>
          {isExporting || isImporting ? (
            <div className="canvas-busy-overlay" aria-live="polite">
              <div className="canvas-spinner" />
            </div>
          ) : null}
          <Stage
            width={stageWidth}
            height={stageHeight}
            style={isLayoutReady ? undefined : { visibility: 'hidden' }}
            onMouseDown={(event) => {
              if (event.target === event.target.getStage()) {
                setSelectedId(null);
              }
            }}
            onTouchStart={(event) => {
              if (event.target === event.target.getStage()) {
                setSelectedId(null);
              }
            }}
          >
            <Layer>
              <Rect
                width={stageWidth}
                height={stageHeight}
                fill={canvasPreviewFill}
                stroke={canvasPreviewStroke}
                strokeWidth={2}
                cornerRadius={0}
              />
              {items.map((item) => (
                <KonvaImage
                  key={item.id}
                  ref={(node) => {
                    shapeRefs.current[item.id] = node;
                  }}
                  image={item.htmlImage}
                  x={item.x}
                  y={item.y}
                  width={item.width}
                  height={item.height}
                  rotation={item.rotation}
                  draggable={interactionMode === 'move'}
                  dragBoundFunc={(position) => {
                    const constrained = constrainPositionByCenter(
                      position.x,
                      position.y,
                      item.width,
                      item.height,
                      item.rotation
                    );
                    if (!snapEnabled) {
                      return constrained;
                    }
                    const snapped = snapPositionToGuides(
                      item.id,
                      constrained.x,
                      constrained.y,
                      item.width,
                      item.height,
                      item.rotation,
                      snapGuides.vertical,
                      snapGuides.horizontal
                    );
                    setSnapGuides((current) =>
                      current.vertical === snapped.guideX && current.horizontal === snapped.guideY
                        ? current
                        : { vertical: snapped.guideX, horizontal: snapped.guideY }
                    );
                    return constrainPositionByCenter(
                      snapped.x,
                      snapped.y,
                      item.width,
                      item.height,
                      item.rotation
                    );
                  }}
                  onTap={() => setSelectedId(item.id)}
                  onClick={() => setSelectedId(item.id)}
                  onDragMove={(event) => {
                    if (interactionMode !== 'move') {
                      return;
                    }
                    updateItem(item.id, { x: event.target.x(), y: event.target.y() });
                  }}
                  onDragStart={() => {
                    if (interactionMode !== 'move') {
                      return;
                    }
                    setSelectedId(item.id);
                    setDraggingId(item.id);
                  }}
                  onTransform={(event) => {
                    const node = event.target;
                    const transformer = transformerRef.current;
                    if (!transformer || transformer.nodes()[0] !== node) {
                      return;
                    }
                    transformer.rotateAnchorOffset(-Math.abs(node.height() * node.scaleY()) / 2);
                    transformer.getLayer()?.batchDraw();
                  }}
                  onDragEnd={(event) => {
                    setDraggingId(null);
                    setSnapGuides({ vertical: null, horizontal: null });
                    const constrained = constrainPositionByCenter(
                      event.target.x(),
                      event.target.y(),
                      item.width,
                      item.height,
                      item.rotation
                    );
                    updateItem(item.id, { x: constrained.x, y: constrained.y });
                  }}
                  onTransformEnd={(event) => {
                    const node = event.target;
                    const scaleX = node.scaleX();
                    const scaleY = node.scaleY();
                    node.scaleX(1);
                    node.scaleY(1);
                    const nextWidth = node.width() * scaleX;
                    const nextHeight = node.height() * scaleY;
                    const nextRotation = normalizeRotation(node.rotation());
                    const constrained = constrainPositionByCenter(
                      node.x(),
                      node.y(),
                      nextWidth,
                      nextHeight,
                      nextRotation
                    );
                    updateItem(item.id, {
                      x: constrained.x,
                      y: constrained.y,
                      width: nextWidth,
                      height: nextHeight,
                      baseWidth: nextWidth / scaleFactorFromPercent(item.scalePercent),
                      baseHeight: nextHeight / scaleFactorFromPercent(item.scalePercent),
                      rotation: nextRotation
                    });
                    const transformer = transformerRef.current;
                    if (transformer && transformer.nodes()[0] === node) {
                      transformer.rotateAnchorOffset(-Math.abs(nextHeight) / 2);
                    }
                  }}
                />
              ))}
              {interactionMode === 'move' && snapEnabled && snapGuides.vertical !== null ? (
                <Line
                  points={[snapGuides.vertical, 0, snapGuides.vertical, stageHeight]}
                  stroke="#a855f7"
                  strokeWidth={2}
                  dash={[6, 6]}
                  listening={false}
                />
              ) : null}
              {interactionMode === 'move' && snapEnabled && snapGuides.horizontal !== null ? (
                <Line
                  points={[0, snapGuides.horizontal, stageWidth, snapGuides.horizontal]}
                  stroke="#a855f7"
                  strokeWidth={2}
                  dash={[6, 6]}
                  listening={false}
                />
              ) : null}
              <Transformer
                ref={transformerRef}
                listening={interactionMode === 'transform'}
                rotateEnabled={false}
                anchorSize={14}
                rotateAnchorOffset={rotateAnchorOffset}
                borderStroke={interactionMode === 'move' ? '#16a34a' : '#2563eb'}
                borderStrokeWidth={interactionMode === 'move' ? 3 : 2}
                borderDash={interactionMode === 'move' ? [6, 4] : []}
                keepRatio={false}
                enabledAnchors={
                  interactionMode === 'transform'
                    ? ['middle-left', 'middle-right', 'top-center', 'bottom-center']
                    : []
                }
              />
              {selectedItem && selectedDeleteIconPosition ? (
                <Group
                  x={selectedDeleteIconPosition.x - DELETE_ICON_SIZE / 2}
                  y={selectedDeleteIconPosition.y - DELETE_ICON_SIZE / 2}
                  onClick={(event) => {
                    event.cancelBubble = true;
                    deleteSelected();
                  }}
                  onTap={(event) => {
                    event.cancelBubble = true;
                    deleteSelected();
                  }}
                >
                  <Rect
                    width={DELETE_ICON_SIZE}
                    height={DELETE_ICON_SIZE}
                    cornerRadius={6}
                    fill="#e5e7eb"
                    stroke="#9ca3af"
                    strokeWidth={1.5}
                  />
                  <Rect
                    x={7}
                    y={8}
                    width={10}
                    height={10}
                    cornerRadius={2}
                    fill="#f9fafb"
                    stroke="#6b7280"
                    strokeWidth={1.5}
                  />
                  <Line points={[6, 8, 18, 8]} stroke="#6b7280" strokeWidth={1.5} lineCap="round" />
                  <Line points={[9.5, 5.8, 14.5, 5.8]} stroke="#6b7280" strokeWidth={1.5} lineCap="round" />
                  <Line points={[10.2, 11, 10.2, 16]} stroke="#6b7280" strokeWidth={1.2} lineCap="round" />
                  <Line points={[12, 11, 12, 16]} stroke="#6b7280" strokeWidth={1.2} lineCap="round" />
                  <Line points={[13.8, 11, 13.8, 16]} stroke="#6b7280" strokeWidth={1.2} lineCap="round" />
                </Group>
              ) : null}
            </Layer>
          </Stage>
        </div>

      </div>
      {showDeleteAllConfirm ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Delete all confirmation">
          <div className="confirm-card">
            <p>Delete all images?</p>
            <div className="confirm-actions">
              <button type="button" className="danger" onClick={deleteAll}>Yes</button>
              <button type="button" onClick={() => setShowDeleteAllConfirm(false)}>No</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default App;



