import { useMemo, useRef, useState } from 'react';
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
const createId = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

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
  const { debugEnabled, showDebug, setShowDebug, debugEntries, appendDebug, clearDebug } = useDebugLogger();

  const stageWidth = useMemo(() => {
    const viewportWidth = stageContainerRef.current?.clientWidth ?? 360;
    return Math.min(viewportWidth, 640);
  }, [stageContainerRef.current?.clientWidth]);

  const stageHeight = stageWidth / A4_RATIO;

  const selectedItem = items.find((item) => item.id === selectedId) ?? null;

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
    const incoming: PlacedImage[] = [];
    const failedNames: string[] = [];
    for (const file of Array.from(fileList)) {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const htmlImage = await loadImage(dataUrl);
        const baseWidth = Math.min(stageWidth * 0.35, htmlImage.width);
        const baseHeight = (baseWidth / htmlImage.width) * htmlImage.height;
        incoming.push({
          id: createId(),
          dataUrl,
          htmlImage,
          x: stageWidth / 2 - baseWidth / 2,
          y: stageHeight / 2 - baseHeight / 2,
          width: baseWidth,
          height: baseHeight,
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
        <button type="button" onClick={deleteSelected} disabled={!selectedId}>Delete selected</button>
        <button type="button" onClick={exportPdf} disabled={isExporting || !items.length}>
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
                  onTap={() => setSelectedId(item.id)}
                  onClick={() => setSelectedId(item.id)}
                  onDragEnd={(event) => {
                    updateItem(item.id, { x: event.target.x(), y: event.target.y() });
                  }}
                  onTransformEnd={(event) => {
                    const node = event.target;
                    const scaleX = node.scaleX();
                    const scaleY = node.scaleY();
                    node.scaleX(1);
                    node.scaleY(1);
                    updateItem(item.id, {
                      x: node.x(),
                      y: node.y(),
                      width: Math.max(24, node.width() * scaleX),
                      height: Math.max(24, node.height() * scaleY),
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
              />
            </Layer>
          </Stage>
        </div>

        <aside className="side-panel">
          <h2>Selected image</h2>
          {selectedItem ? (
            <>
              <p>Use handles to resize and rotate. Fine tune rotation below:</p>
              <div className="rotation-controls">
                <button type="button" onClick={() => updateItem(selectedItem.id, { rotation: selectedItem.rotation - 1 })}>-1°</button>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  value={Math.round(selectedItem.rotation)}
                  onChange={(event) => updateItem(selectedItem.id, { rotation: Number(event.target.value) })}
                />
                <button type="button" onClick={() => updateItem(selectedItem.id, { rotation: selectedItem.rotation + 1 })}>+1°</button>
              </div>
            </>
          ) : (
            <p>Tap an image to select it.</p>
          )}
        </aside>
      </div>
    </div>
  );
};

export default App;
