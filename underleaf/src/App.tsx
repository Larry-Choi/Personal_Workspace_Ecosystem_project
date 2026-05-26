import {
  AlignLeft,
  Download,
  FileText,
  GripVertical,
  Heading1,
  Highlighter,
  List,
  Pilcrow,
  Plus,
  Printer,
  Quote,
  Redo2,
  Save,
  SplitSquareVertical,
  Undo2,
  Upload
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  blockLabel,
  createId,
  initialDocument,
  isTextualBlock,
  makeBlock,
  normalizeSpacing
} from "./document";
import {
  blocksToDocxBlob,
  blocksToHtml,
  blocksToMarkdown,
  blocksToPlainText
} from "./exporters";
import {
  downloadText,
  pickUnderleafDocument,
  saveWithPicker,
  underleafFileType,
  validateUnderleafDocument
} from "./fileAccess";
import type { PreviewMode, TextualBlock, UnderleafBlock, UnderleafDocument } from "./types";

type InsertableType = "sentence" | "paragraph_break" | "heading" | "bullet" | "quote";

type TextSelection = {
  sourceBlockId: string;
  selectedText: string;
  rangeStart: number;
  rangeEnd: number;
};

type Token = {
  text: string;
  start: number;
  end: number;
};

type PointerTextDrag = TextSelection & {
  x: number;
  y: number;
};

const toolbarBlocks: Array<{
  type: InsertableType;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}> = [
  { type: "sentence", label: "Sentence", icon: AlignLeft },
  { type: "paragraph_break", label: "Paragraph", icon: Pilcrow },
  { type: "heading", label: "Heading", icon: Heading1 },
  { type: "bullet", label: "Bullet", icon: List },
  { type: "quote", label: "Quote", icon: Quote }
];

const cloneDocument = (document: UnderleafDocument, blocks: UnderleafBlock[]) => ({
  ...document,
  updatedAt: new Date().toISOString(),
  blocks
});

const hasText = (block: UnderleafBlock): block is TextualBlock => isTextualBlock(block);

const tokenize = (text: string): Token[] => {
  const matches = [...text.matchAll(/\S+/g)];
  return matches.map((match) => ({
    text: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length
  }));
};

export function App() {
  const [document, setDocument] = useState(initialDocument);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(
    document.blocks[0]?.id ?? null
  );
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [dragOverBlockId, setDragOverBlockId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("page");
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [draggingSelection, setDraggingSelection] = useState<TextSelection | null>(null);
  const [pointerTextDrag, setPointerTextDrag] = useState<PointerTextDrag | null>(null);
  const [tokenizedTargetId, setTokenizedTargetId] = useState<string | null>(null);
  const [history, setHistory] = useState<UnderleafDocument[]>([]);
  const [future, setFuture] = useState<UnderleafDocument[]>([]);
  const [fileStatus, setFileStatus] = useState("Unsaved");
  const textRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const activeIndex = document.blocks.findIndex((block) => block.id === activeBlockId);
  const markdown = useMemo(() => blocksToMarkdown(document.blocks), [document.blocks]);
  const html = useMemo(() => blocksToHtml(document.blocks), [document.blocks]);

  const commit = (nextBlocks: UnderleafBlock[]) => {
    setHistory((items) => [...items, document]);
    setFuture([]);
    setDocument((current) => cloneDocument(current, nextBlocks));
    setFileStatus("Unsaved changes");
  };

  const undo = () => {
    setHistory((items) => {
      const previous = items[items.length - 1];
      if (!previous) return items;
      setFuture((redoItems) => [document, ...redoItems]);
      setDocument(previous);
      return items.slice(0, -1);
    });
  };

  const redo = () => {
    setFuture((items) => {
      const next = items[0];
      if (!next) return items;
      setHistory((undoItems) => [...undoItems, document]);
      setDocument(next);
      return items.slice(1);
    });
  };

  const insertBlock = (type: InsertableType, index = activeIndex + 1) => {
    const next = [...document.blocks];
    const safeIndex = Math.max(0, Math.min(index < 0 ? next.length : index, next.length));
    const block = makeBlock(type);
    next.splice(safeIndex, 0, block);
    commit(next);
    setActiveBlockId(block.id);
    requestAnimationFrame(() => textRefs.current[block.id]?.focus());
  };

  const updateText = (blockId: string, text: string) => {
    setDocument((current) =>
      cloneDocument(
        current,
        current.blocks.map((block) =>
          block.id === blockId && hasText(block) ? { ...block, text } : block
        )
      )
    );
    setFileStatus("Unsaved changes");
  };

  const commitTextSnapshot = () => {
    setHistory((items) => [...items, document]);
    setFuture([]);
  };

  const moveBlock = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const from = document.blocks.findIndex((block) => block.id === fromId);
    const to = document.blocks.findIndex((block) => block.id === toId);
    if (from < 0 || to < 0) return;

    const next = [...document.blocks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
  };

  const moveActiveBy = (delta: number) => {
    if (activeIndex < 0) return;
    const to = activeIndex + delta;
    if (to < 0 || to >= document.blocks.length) return;
    const next = [...document.blocks];
    const [moved] = next.splice(activeIndex, 1);
    next.splice(to, 0, moved);
    commit(next);
  };

  const splitAfter = (blockId: string, value: string, cursor: number) => {
    const block = document.blocks.find((item) => item.id === blockId);
    if (!block || !hasText(block)) return;
    const before = value.slice(0, cursor).trimEnd();
    const after = value.slice(cursor).trimStart();
    const nextBlock: UnderleafBlock =
      block.type === "heading"
        ? { id: createId(), type: "sentence", text: after }
        : { ...block, id: createId(), text: after };
    const next = document.blocks.flatMap((item) =>
      item.id === blockId ? [{ ...block, text: before }, nextBlock] : [item]
    );
    commit(next);
    setActiveBlockId(nextBlock.id);
    requestAnimationFrame(() => textRefs.current[nextBlock.id]?.focus());
  };

  const mergeWithPrevious = (blockId: string) => {
    const index = document.blocks.findIndex((block) => block.id === blockId);
    if (index <= 0) return;
    const previous = document.blocks[index - 1];
    const current = document.blocks[index];
    if (!hasText(previous) || !hasText(current)) return;
    const merged = normalizeSpacing(`${previous.text} ${current.text}`);
    const next = [...document.blocks];
    next.splice(index - 1, 2, { ...previous, text: merged });
    commit(next);
    setActiveBlockId(previous.id);
  };

  const captureSelection = (block: TextualBlock) => {
    const input = textRefs.current[block.id];
    if (!input) return;
    const { selectionStart, selectionEnd } = input;
    if (selectionEnd <= selectionStart) return;
    setSelection({
      sourceBlockId: block.id,
      selectedText: input.value.slice(selectionStart, selectionEnd),
      rangeStart: selectionStart,
      rangeEnd: selectionEnd
    });
  };

  const clearTextDrag = () => {
    setDraggingSelection(null);
    setPointerTextDrag(null);
    setTokenizedTargetId(null);
  };

  const applySelectionAsNewBlock = (indexOffset = 1) => {
    const textDrag = draggingSelection ?? selection;
    if (!textDrag) return;
    const sourceIndex = document.blocks.findIndex((block) => block.id === textDrag.sourceBlockId);
    const source = document.blocks[sourceIndex];
    if (!source || !hasText(source)) return;

    const sourceText = normalizeSpacing(
      source.text.slice(0, textDrag.rangeStart) + source.text.slice(textDrag.rangeEnd)
    );
    const extracted: UnderleafBlock = {
      id: createId(),
      type: "sentence",
      text: normalizeSpacing(textDrag.selectedText)
    };
    const next = [...document.blocks];
    next.splice(sourceIndex, 1, { ...source, text: sourceText });
    const insertIndex = Math.max(0, Math.min(sourceIndex + indexOffset, next.length));
    next.splice(insertIndex, 0, extracted);
    commit(next.filter((block) => !hasText(block) || block.text.length > 0));
    setSelection(null);
    clearTextDrag();
    setActiveBlockId(extracted.id);
  };

  const applySelectionIntoText = (targetBlockId: string, insertionPoint: number) => {
    const textDrag = draggingSelection ?? selection;
    if (!textDrag) return;

    const source = document.blocks.find((block) => block.id === textDrag.sourceBlockId);
    const target = document.blocks.find((block) => block.id === targetBlockId);
    if (!source || !target || !hasText(source) || !hasText(target)) return;

    if (
      targetBlockId === textDrag.sourceBlockId &&
      insertionPoint >= textDrag.rangeStart &&
      insertionPoint <= textDrag.rangeEnd
    ) {
      clearTextDrag();
      return;
    }

    const next = document.blocks
      .map((block) => {
        if (!hasText(block)) return block;

        if (block.id === textDrag.sourceBlockId && block.id === targetBlockId) {
          const removed = normalizeSpacing(
            block.text.slice(0, textDrag.rangeStart) + block.text.slice(textDrag.rangeEnd)
          );
          const adjustedPoint =
            insertionPoint > textDrag.rangeEnd
              ? Math.max(0, insertionPoint - (textDrag.rangeEnd - textDrag.rangeStart))
              : insertionPoint;
          return {
            ...block,
            text: normalizeSpacing(
              `${removed.slice(0, adjustedPoint)} ${textDrag.selectedText} ${removed.slice(
                adjustedPoint
              )}`
            )
          };
        }

        if (block.id === textDrag.sourceBlockId) {
          return {
            ...block,
            text: normalizeSpacing(
              block.text.slice(0, textDrag.rangeStart) + block.text.slice(textDrag.rangeEnd)
            )
          };
        }

        if (block.id === targetBlockId) {
          return {
            ...block,
            text: normalizeSpacing(
              `${block.text.slice(0, insertionPoint)} ${textDrag.selectedText} ${block.text.slice(
                insertionPoint
              )}`
            )
          };
        }

        return block;
      })
      .filter((block) => !hasText(block) || block.text.length > 0);

    commit(next);
    setSelection(null);
    clearTextDrag();
    setActiveBlockId(targetBlockId);
  };

  const openDocument = async () => {
    try {
      const loaded = await pickUnderleafDocument();
      if (!validateUnderleafDocument(loaded)) {
        setFileStatus("Invalid Underleaf file");
        return;
      }
      setDocument({
        ...loaded,
        updatedAt: loaded.updatedAt ?? new Date().toISOString()
      });
      setActiveBlockId(loaded.blocks[0]?.id ?? null);
      setHistory([]);
      setFuture([]);
      setSelection(null);
      clearTextDrag();
      setFileStatus("Opened");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFileStatus("Open failed");
    }
  };

  const saveUnderleaf = async () => {
    const payload = JSON.stringify(document, null, 2);
    try {
      await saveWithPicker(
        new Blob([payload], { type: "application/json" }),
        `${document.title || "document"}.underleaf.json`,
        [underleafFileType]
      );
      setFileStatus("Saved");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFileStatus("Save failed");
    }
  };

  const exportHtml = () => {
    downloadText(html, "document.html", "text/html");
    setFileStatus("HTML exported");
  };

  const exportMarkdown = () => {
    downloadText(markdown, "document.md", "text/markdown");
    setFileStatus("Markdown exported");
  };

  const exportPlainText = () => {
    downloadText(blocksToPlainText(document.blocks), "document.txt", "text/plain");
    setFileStatus("Text exported");
  };

  const exportDocx = async () => {
    try {
      const blob = await blocksToDocxBlob(document.blocks);
      await saveWithPicker(blob, "document.docx", [
        {
          description: "Word Document",
          accept: {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"]
          }
        }
      ]);
      setFileStatus("DOCX exported");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFileStatus("DOCX export failed");
    }
  };

  const printPdf = () => {
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) {
      setFileStatus("Popup blocked");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => {
      printWindow.print();
      setFileStatus("PDF print opened");
    }, 250);
  };

  const handleEditorKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
    block: TextualBlock
  ) => {
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      splitAfter(block.id, event.currentTarget.value, event.currentTarget.selectionStart);
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      insertBlock("paragraph_break", activeIndex + 1);
      return;
    }
    if (event.key === "Backspace" && event.currentTarget.selectionStart === 0) {
      mergeWithPrevious(block.id);
      return;
    }
    if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveBy(-1);
      return;
    }
    if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      moveActiveBy(1);
    }
  };

  useEffect(() => {
    if (!pointerTextDrag) return;

    const handlePointerMove = (event: PointerEvent) => {
      setPointerTextDrag((current) =>
        current ? { ...current, x: event.clientX, y: event.clientY } : current
      );

      const element = window.document.elementFromPoint(event.clientX, event.clientY);
      const textBlock = element?.closest<HTMLElement>("[data-text-block-id]");
      setTokenizedTargetId(textBlock?.dataset.textBlockId ?? null);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const element = window.document.elementFromPoint(event.clientX, event.clientY);
      const textDrop = element?.closest<HTMLElement>("[data-text-drop]");
      const newBlockDrop = element?.closest<HTMLElement>("[data-new-block-drop]");

      if (textDrop?.dataset.targetBlockId && textDrop.dataset.insertionPoint) {
        applySelectionIntoText(
          textDrop.dataset.targetBlockId,
          Number(textDrop.dataset.insertionPoint)
        );
        return;
      }

      if (newBlockDrop) {
        applySelectionAsNewBlock();
        return;
      }

      clearTextDrag();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [pointerTextDrag, document, draggingSelection]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <FileText size={20} />
          <strong>Underleaf</strong>
        </div>
        <nav className="toolbar" aria-label="Insert blocks">
          {toolbarBlocks.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.type}
                className="tool-button"
                draggable
                onClick={() => insertBlock(item.type)}
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/underleaf-block", item.type);
                }}
                title={`${item.label} block`}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="topbar-actions">
          <button className="text-button" onClick={openDocument}>
            <Upload size={16} />
            Open
          </button>
          <button className="text-button" onClick={saveUnderleaf}>
            <Save size={16} />
            Save
          </button>
          <button className="icon-button" onClick={undo} disabled={!history.length} title="Undo">
            <Undo2 size={17} />
          </button>
          <button className="icon-button" onClick={redo} disabled={!future.length} title="Redo">
            <Redo2 size={17} />
          </button>
          <button
            className="text-button"
            onClick={() => setPreviewMode(previewMode === "page" ? "continuous" : "page")}
          >
            {previewMode === "page" ? "Page" : "Continuous"}
          </button>
          <button
            className="icon-button"
            onClick={saveUnderleaf}
            title="Export Underleaf JSON"
          >
            <Download size={17} />
          </button>
          <span className="file-status">{fileStatus}</span>
        </div>
      </header>

      <section className="workspace">
        <section className="editor-pane" aria-label="Block editor">
          <div className="pane-header">
            <h2>Block Editor</h2>
            <div className="selection-tools">
              <button
                className="text-button"
                onClick={() => applySelectionAsNewBlock()}
                disabled={!selection}
                title="선택한 문장 내부 텍스트를 새 블록으로 분리"
              >
                <SplitSquareVertical size={15} />
                Extract
              </button>
              <button
                className="icon-button"
                onClick={() => insertBlock("sentence", document.blocks.length)}
                title="Add sentence"
              >
                <Plus size={17} />
              </button>
            </div>
          </div>

          <div className="block-list">
            {draggingSelection && (
              <div
                className="new-line-drop-zone"
                data-new-block-drop="true"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  applySelectionAsNewBlock();
                }}
              >
                선택 텍스트를 여기에 놓으면 새 Sentence 블록이 됩니다.
              </div>
            )}

            {document.blocks.map((block) => {
              const active = activeBlockId === block.id;
              const over = dragOverBlockId === block.id;

              if (block.type === "paragraph_break") {
                return (
                  <div
                    key={block.id}
                    className={`block-row break-row ${active ? "active" : ""} ${
                      over ? "drop-over" : ""
                    }`}
                    onClick={() => setActiveBlockId(block.id)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOverBlockId(block.id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const newType = event.dataTransfer.getData(
                        "application/underleaf-block"
                      ) as InsertableType;
                      if (newType) {
                        insertBlock(
                          newType,
                          document.blocks.findIndex((item) => item.id === block.id)
                        );
                      } else if (draggedBlockId) {
                        moveBlock(draggedBlockId, block.id);
                      }
                      setDraggedBlockId(null);
                      setDragOverBlockId(null);
                    }}
                  >
                    <span
                      className="drag-handle"
                      draggable
                      onDragStart={(event) => {
                        event.stopPropagation();
                        setDraggedBlockId(block.id);
                      }}
                    >
                      <GripVertical size={18} />
                    </span>
                    <span className="block-badge">Paragraph</span>
                    <div className="paragraph-rule">
                      <span>Paragraph Break</span>
                    </div>
                  </div>
                );
              }

              return (
                <TextBlockRow
                  key={block.id}
                  block={block}
                  active={active}
                  over={over}
                  selection={selection}
                  draggingSelection={draggingSelection}
                  tokenizedTargetId={tokenizedTargetId}
                  textRef={(node) => {
                    textRefs.current[block.id] = node;
                  }}
                  onCaptureSelection={captureSelection}
                  onSetActive={setActiveBlockId}
                  onTextChange={updateText}
                  onTextBlur={commitTextSnapshot}
                  onKeyDown={handleEditorKeyDown}
                  onSelectionDragStart={(event) => {
                    if (!selection) return;
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("application/underleaf-selection", "true");
                    setDraggingSelection(selection);
                  }}
                  onSelectionDragEnd={clearTextDrag}
                  onSelectionPointerStart={(event) => {
                    if (!selection) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setDraggingSelection(selection);
                    setPointerTextDrag({
                      ...selection,
                      x: event.clientX,
                      y: event.clientY
                    });
                  }}
                  onTokenTargetEnter={(blockId) => setTokenizedTargetId(blockId)}
                  onTokenDrop={applySelectionIntoText}
                  onBlockDragStart={() => setDraggedBlockId(block.id)}
                  onBlockDragOver={(event) => {
                    if (draggingSelection && hasText(block)) {
                      setTokenizedTargetId(block.id);
                    }
                    event.preventDefault();
                    setDragOverBlockId(block.id);
                  }}
                  onBlockDrop={(event) => {
                    event.preventDefault();
                    if (draggingSelection) {
                      setTokenizedTargetId(block.id);
                      return;
                    }
                    const newType = event.dataTransfer.getData(
                      "application/underleaf-block"
                    ) as InsertableType;
                    if (newType) {
                      insertBlock(
                        newType,
                        document.blocks.findIndex((item) => item.id === block.id)
                      );
                    } else if (draggedBlockId) {
                      moveBlock(draggedBlockId, block.id);
                    }
                    setDraggedBlockId(null);
                    setDragOverBlockId(null);
                  }}
                  onBlockDragEnd={() => {
                    setDraggedBlockId(null);
                    setDragOverBlockId(null);
                  }}
                />
              );
            })}
          </div>

          {pointerTextDrag && (
            <div
              className="floating-selection-chip"
              style={{
                left: pointerTextDrag.x + 12,
                top: pointerTextDrag.y + 12
              }}
            >
              <Highlighter size={14} />
              <span>{pointerTextDrag.selectedText}</span>
            </div>
          )}
        </section>

        <section className="preview-pane" aria-label="Document preview">
          <div className="pane-header">
            <h2>Preview</h2>
            <div className="export-group">
              <button
                className="text-button"
                onClick={exportMarkdown}
              >
                Markdown
              </button>
              <button className="text-button" onClick={exportHtml}>
                HTML
              </button>
              <button className="text-button" onClick={exportDocx}>
                DOCX
              </button>
              <button
                className="text-button"
                onClick={exportPlainText}
              >
                Text
              </button>
              <button className="text-button" onClick={printPdf}>
                <Printer size={15} />
                PDF
              </button>
            </div>
          </div>
          <DocumentPreview blocks={document.blocks} mode={previewMode} />
        </section>
      </section>
    </main>
  );
}

function TextBlockRow({
  block,
  active,
  over,
  selection,
  draggingSelection,
  tokenizedTargetId,
  textRef,
  onCaptureSelection,
  onSetActive,
  onTextChange,
  onTextBlur,
  onKeyDown,
  onSelectionDragStart,
  onSelectionDragEnd,
  onSelectionPointerStart,
  onTokenTargetEnter,
  onTokenDrop,
  onBlockDragStart,
  onBlockDragOver,
  onBlockDrop,
  onBlockDragEnd
}: {
  block: Exclude<UnderleafBlock, { type: "paragraph_break" }>;
  active: boolean;
  over: boolean;
  selection: TextSelection | null;
  draggingSelection: TextSelection | null;
  tokenizedTargetId: string | null;
  textRef: (node: HTMLTextAreaElement | null) => void;
  onCaptureSelection: (block: TextualBlock) => void;
  onSetActive: (blockId: string) => void;
  onTextChange: (blockId: string, text: string) => void;
  onTextBlur: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>, block: TextualBlock) => void;
  onSelectionDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onSelectionDragEnd: () => void;
  onSelectionPointerStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onTokenTargetEnter: (blockId: string) => void;
  onTokenDrop: (targetBlockId: string, insertionPoint: number) => void;
  onBlockDragStart: () => void;
  onBlockDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onBlockDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onBlockDragEnd: () => void;
}) {
  const showTokenDrop =
    draggingSelection && hasText(block) && tokenizedTargetId === block.id;
  const tokens = hasText(block) ? tokenize(block.text) : [];

  return (
    <div
      className={`block-row text-row ${active ? "active" : ""} ${over ? "drop-over" : ""} ${
        showTokenDrop ? "tokenized" : ""
      }`}
      onClick={() => onSetActive(block.id)}
      onDragOver={onBlockDragOver}
      onDragEnter={() => {
        if (draggingSelection && hasText(block)) onTokenTargetEnter(block.id);
      }}
      onDrop={onBlockDrop}
      onDragEnd={onBlockDragEnd}
      data-text-block-id={hasText(block) ? block.id : undefined}
    >
      <span
        className="drag-handle"
        draggable
        onDragStart={(event) => {
          event.stopPropagation();
          onBlockDragStart();
        }}
      >
        <GripVertical size={18} />
      </span>
      <span className={`block-badge ${block.type}`}>{blockLabel(block)}</span>
      {hasText(block) && (
        <div className="text-cell">
          <textarea
            ref={textRef}
            className={`block-input ${block.type}`}
            value={block.text}
            rows={block.type === "quote" ? 2 : 1}
            onFocus={() => onSetActive(block.id)}
            onMouseUp={() => onCaptureSelection(block)}
            onKeyUp={() => onCaptureSelection(block)}
            onBlur={onTextBlur}
            onChange={(event) => onTextChange(block.id, event.target.value)}
            onKeyDown={(event) => onKeyDown(event, block)}
            placeholder="문장을 입력하세요"
          />

          {selection?.sourceBlockId === block.id && (
            <div
              className="selection-chip"
              draggable
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={onSelectionPointerStart}
              onDragStart={onSelectionDragStart}
              onDragEnd={onSelectionDragEnd}
              title="선택 텍스트를 드래그해 새 줄이나 다른 문장 사이에 놓기"
              role="button"
              tabIndex={0}
            >
              <Highlighter size={14} />
              <span>{selection.selectedText}</span>
            </div>
          )}

          {showTokenDrop && (
            <div className="token-drop-row">
              <button
                className="token-slot"
                data-text-drop="true"
                data-target-block-id={block.id}
                data-insertion-point={0}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  onTokenDrop(block.id, 0);
                }}
                title="문장 앞에 삽입"
              />
              {tokens.map((token) => (
                <div className="token-pair" key={`${token.start}-${token.text}`}>
                  <span className="word-token">{token.text}</span>
                  <button
                    className="token-slot"
                    data-text-drop="true"
                    data-target-block-id={block.id}
                    data-insertion-point={token.end}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      onTokenDrop(block.id, token.end);
                    }}
                    title={`${token.text} 뒤에 삽입`}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DocumentPreview({
  blocks,
  mode
}: {
  blocks: UnderleafBlock[];
  mode: PreviewMode;
}) {
  const content: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let bulletItems: string[] = [];
  let numberedItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      content.push(<p key={`p-${content.length}`}>{paragraph.join(" ")}</p>);
      paragraph = [];
    }
  };

  const flushLists = () => {
    if (bulletItems.length) {
      content.push(
        <ul key={`ul-${content.length}`}>
          {bulletItems.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      );
      bulletItems = [];
    }
    if (numberedItems.length) {
      content.push(
        <ol key={`ol-${content.length}`}>
          {numberedItems.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ol>
      );
      numberedItems = [];
    }
  };

  for (const block of blocks) {
    switch (block.type) {
      case "sentence":
        flushLists();
        if (block.text.trim()) paragraph.push(block.text.trim());
        break;
      case "paragraph_break":
        flushParagraph();
        flushLists();
        break;
      case "heading":
        flushParagraph();
        flushLists();
        content.push(
          block.level === 1 ? (
            <h1 key={block.id}>{block.text}</h1>
          ) : block.level === 2 ? (
            <h2 key={block.id}>{block.text}</h2>
          ) : (
            <h3 key={block.id}>{block.text}</h3>
          )
        );
        break;
      case "bullet":
        flushParagraph();
        if (block.text.trim()) bulletItems.push(block.text.trim());
        break;
      case "numbered":
        flushParagraph();
        if (block.text.trim()) numberedItems.push(block.text.trim());
        break;
      case "quote":
        flushParagraph();
        flushLists();
        content.push(<blockquote key={block.id}>{block.text}</blockquote>);
        break;
      case "divider":
        flushParagraph();
        flushLists();
        content.push(<hr key={block.id} />);
        break;
      case "image":
        flushParagraph();
        flushLists();
        content.push(
          <figure key={block.id}>
            <img src={block.src} alt={block.caption ?? ""} />
            {block.caption && <figcaption>{block.caption}</figcaption>}
          </figure>
        );
        break;
      case "equation":
        flushParagraph();
        flushLists();
        content.push(<pre key={block.id}>{block.latex}</pre>);
        break;
      case "citation":
        flushLists();
        paragraph.push(`[${block.label}]`);
        break;
    }
  }

  flushParagraph();
  flushLists();

  return (
    <article className={`document-preview ${mode}`}>
      {content.length ? content : <p className="empty-preview">문장을 입력하면 여기에 표시됩니다.</p>}
    </article>
  );
}
