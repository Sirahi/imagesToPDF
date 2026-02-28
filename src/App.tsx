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
const MIN_IMAGE_SIZE = 24;
const createId = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

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
  const [isExporting, setIsExporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [maxStageHeight, setMaxStageHeight] = useState(0);
  const { debugEnabled, showDebug, setShowDebug, debugEntries, appendDebug, clearDebug } = useDebugLogger();

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
  const constrainToStage = (x: number, y: number, width: number, height: number) => {
    const nextWidth = clamp(width, MIN_IMAGE_SIZE, stageWidth);
    const nextHeight = clamp(height, MIN_IMAGE_SIZE, stageHeight);
    return {
      x: clamp(x, 0, stageWidth - nextWidth),
      y: clamp(y, 0, stageHeight - nextHeight),
      width: nextWidth,
      height: nextHeight
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
        const placement = constrainToStage(
          stageWidth / 2 - baseWidth / 2,
          stageHeight / 2 - baseHeight / 2,
          baseWidth,
          baseHeight
        );
        incoming.push({
          id: createId(),
          dataUrl,
          htmlImage,
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: placement.height,
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
      <header>
        <h1>A4 Cake Decoration Composer</h1>
        <p>Create an A4 PDF, then print at <strong>Actual size / 100%</strong>.</p>
      </header>

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
                  draggable
                  dragBoundFunc={(position) => {
                    const constrained = constrainToStage(position.x, position.y, item.width, item.height);
                    return { x: constrained.x, y: constrained.y };
                  }}
                  onTap={() => setSelectedId(item.id)}
                  onClick={() => setSelectedId(item.id)}
                  onDragEnd={(event) => {
                    const constrained = constrainToStage(event.target.x(), event.target.y(), item.width, item.height);
                    updateItem(item.id, { x: constrained.x, y: constrained.y });
                  }}
                  onTransformEnd={(event) => {
                    const node = event.target;
                    const scaleX = node.scaleX();
                    const scaleY = node.scaleY();
                    node.scaleX(1);
                    node.scaleY(1);
                    const constrained = constrainToStage(
                      node.x(),
                      node.y(),
                      node.width() * scaleX,
                      node.height() * scaleY
                    );
                    updateItem(item.id, {
                      x: constrained.x,
                      y: constrained.y,
                      width: constrained.width,
                      height: constrained.height,
                      rotation: node.rotation()
                    });
                  }}
                />
              ))}

              <Transformer
                ref={transformerRef}
                rotateEnabled
                keepRatio={false}
                enabledAnchors={[
                  'top-left',
                  'top-right',
                  'bottom-left',
                  'bottom-right',
                  'middle-left',
                  'middle-right',
                  'top-center',
                  'bottom-center'
                ]}
                boundBoxFunc={(oldBox, newBox) => {
                  const constrained = constrainToStage(newBox.x, newBox.y, newBox.width, newBox.height);
                  return {
                    ...newBox,
                    x: constrained.x,
                    y: constrained.y,
                    width: constrained.width,
                    height: constrained.height
                  };
                }}
              />
            </Layer>
          </Stage>
        </div>

      </div>
    </div>
  );
};

export default App;
