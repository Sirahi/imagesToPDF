import { useEffect, useMemo, useRef, useState } from 'react';
import { Layer, Rect, Stage, Image as KonvaImage, Transformer } from 'react-konva';
import { PDFDocument, degrees } from 'pdf-lib';
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

const A4_RATIO = 210 / 297;
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const MAX_FILES_PER_IMPORT = 12;
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const DEFAULT_SCALE_PERCENT = 50;
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

const App = () => {
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef<Record<string, Konva.Image | null>>({});

  const [items, setItems] = useState<PlacedImage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<'move' | 'transform'>('move');
  const [isExporting, setIsExporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [maxStageHeight, setMaxStageHeight] = useState(0);
  const { debugEnabled, showDebug, setShowDebug, debugEntries, appendDebug, clearDebug } = useDebugLogger();
  const selectedItem = items.find((item) => item.id === selectedId) ?? null;

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
    const widthFromHeight = (maxStageHeight || 360) * A4_RATIO;
    return clamp(Math.min(availableWidth, widthFromHeight), 220, 640);
  }, [containerWidth, maxStageHeight]);

  const stageHeight = stageWidth / A4_RATIO;
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
    const fileList = event.target.files;
    if (!fileList?.length) {
      return;
    }

    setImportError(null);
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
      if (!file.type.startsWith('image/')) {
        failedNames.push(file.name);
        appendDebug(`Failed file: ${file.name} -> unsupported file type (${file.type || 'unknown'})`);
        continue;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        failedNames.push(file.name);
        appendDebug(`Failed file: ${file.name} -> file too large (${file.size} bytes)`);
        continue;
      }

      try {
        const dataUrl = await readFileAsDataUrl(file);
        const htmlImage = await loadImage(dataUrl);
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

    event.target.value = '';
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

  const exportPdf = async () => {
    if (!items.length) {
      return;
    }
    setIsExporting(true);
    try {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
      const scaleX = A4_WIDTH_PT / stageWidth;
      const scaleY = A4_HEIGHT_PT / stageHeight;

      for (const item of items) {
        const imageBytes = await fetch(item.dataUrl).then((response) => response.arrayBuffer());
        const embeddedImage = item.dataUrl.includes('image/png')
          ? await pdfDoc.embedPng(imageBytes)
          : await pdfDoc.embedJpg(imageBytes);

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
      const pdfBytes = Uint8Array.from(bytes);
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `a4-composition-${Date.now()}.pdf`;
      link.click();
      URL.revokeObjectURL(link.href);
    } finally {
      setIsExporting(false);
    }
  };

  bindTransformer();

  return (
    <div className="app-shell">
      <div className="toolbar">
        <label className="button primary">
          Add image
          <input type="file" accept="image/*" multiple onChange={onFilesAdded} />
        </label>
        <button type="button" className="danger" onClick={deleteSelected} disabled={!selectedId}>Delete selected</button>
        <button type="button" className="success" onClick={exportPdf} disabled={isExporting || !items.length}>
          {isExporting ? 'Exporting…' : 'Export A4 PDF'}
        </button>
      </div>

      <div className="mode-row">
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
        <button
          type="button"
          className="undo-button"
          onClick={resetSelectedAdjustments}
          disabled={!selectedItem}
          title="Reset selected image (scale 100%, rotation 0, undo stretch)"
          aria-label="Reset selected image"
        >
          ↺
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
          <span>{Math.round(normalizeRotation(selectedItem.rotation))}°</span>
        </div>
      ) : null}

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
          <Stage
            width={stageWidth}
            height={stageHeight}
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
              <Rect width={stageWidth} height={stageHeight} fill="#fff" stroke="#ccc" strokeWidth={2} cornerRadius={8} />
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
                  draggable={interactionMode === 'move' && selectedId === item.id}
                  dragBoundFunc={(position) => {
                    return constrainPositionByCenter(
                      position.x,
                      position.y,
                      item.width,
                      item.height,
                      item.rotation
                    );
                  }}
                  onTap={() => setSelectedId(item.id)}
                  onClick={() => setSelectedId(item.id)}
                  onDragMove={(event) => {
                    if (interactionMode !== 'move' || selectedId !== item.id) {
                      return;
                    }
                    updateItem(item.id, { x: event.target.x(), y: event.target.y() });
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
              <Transformer
                ref={transformerRef}
                listening={interactionMode === 'transform'}
                rotateEnabled={false}
                anchorSize={14}
                rotateAnchorOffset={rotateAnchorOffset}
                borderStroke={interactionMode === 'move' ? '#16a34a' : '#2563eb'}
                borderStrokeWidth={2}
                borderDash={interactionMode === 'move' ? [6, 4] : []}
                keepRatio={false}
                enabledAnchors={
                  interactionMode === 'transform'
                    ? ['middle-left', 'middle-right', 'top-center', 'bottom-center']
                    : []
                }
              />
            </Layer>
          </Stage>
        </div>

      </div>
    </div>
  );
};

export default App;
