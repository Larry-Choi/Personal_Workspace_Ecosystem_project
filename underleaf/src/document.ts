import type { TextualBlock, UnderleafBlock, UnderleafDocument } from "./types";

export const createId = (prefix = "block") =>
  `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

export const initialDocument = (): UnderleafDocument => {
  const now = new Date().toISOString();

  return {
    id: createId("doc"),
    title: "Untitled Underleaf Document",
    version: 1,
    createdAt: now,
    updatedAt: now,
    blocks: [
      {
        id: createId(),
        type: "heading",
        level: 1,
        text: "Underleaf 개요"
      },
      {
        id: createId(),
        type: "sentence",
        text: "Underleaf는 문장을 블록처럼 다루는 양방향 문서 편집기다."
      },
      {
        id: createId(),
        type: "sentence",
        text: "사용자는 복잡한 문법 대신 문장과 구조 블록을 배치한다."
      },
      {
        id: createId(),
        type: "paragraph_break"
      },
      {
        id: createId(),
        type: "sentence",
        text: "오른쪽 패널은 완성된 문서 형태를 실시간으로 보여준다."
      },
      {
        id: createId(),
        type: "bullet",
        text: "문장 블록 드래그 정렬"
      },
      {
        id: createId(),
        type: "bullet",
        text: "단락, 제목, 목록, 인용 블록 삽입"
      },
      {
        id: createId(),
        type: "quote",
        text: "글은 문법이 아니라 구조에서 시작된다."
      }
    ]
  };
};

export const isTextualBlock = (block: UnderleafBlock): block is TextualBlock =>
  "text" in block;

export const blockLabel = (block: UnderleafBlock) => {
  switch (block.type) {
    case "sentence":
      return "Sentence";
    case "paragraph_break":
      return "Paragraph";
    case "heading":
      return `H${block.level}`;
    case "bullet":
      return "Bullet";
    case "numbered":
      return "Numbered";
    case "quote":
      return "Quote";
    case "divider":
      return "Divider";
    case "image":
      return "Image";
    case "equation":
      return "Equation";
    case "citation":
      return "Citation";
  }
};

export const makeBlock = (
  type: "sentence" | "paragraph_break" | "heading" | "bullet" | "quote"
): UnderleafBlock => {
  switch (type) {
    case "sentence":
      return { id: createId(), type, text: "" };
    case "paragraph_break":
      return { id: createId(), type };
    case "heading":
      return { id: createId(), type, level: 1, text: "새 제목" };
    case "bullet":
      return { id: createId(), type, text: "새 목록 항목" };
    case "quote":
      return { id: createId(), type, text: "새 인용문" };
  }
};

export const normalizeSpacing = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .trim();
