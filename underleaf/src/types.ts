export type UnderleafBlock =
  | SentenceBlock
  | ParagraphBreakBlock
  | HeadingBlock
  | BulletBlock
  | NumberedBlock
  | QuoteBlock
  | DividerBlock
  | ImageBlock
  | EquationBlock
  | CitationBlock;

export type TextualBlock = Extract<
  UnderleafBlock,
  { text: string }
>;

export type SentenceBlock = {
  id: string;
  type: "sentence";
  text: string;
  metadata?: Record<string, unknown>;
};

export type ParagraphBreakBlock = {
  id: string;
  type: "paragraph_break";
};

export type HeadingBlock = {
  id: string;
  type: "heading";
  level: 1 | 2 | 3;
  text: string;
};

export type BulletBlock = {
  id: string;
  type: "bullet";
  text: string;
};

export type NumberedBlock = {
  id: string;
  type: "numbered";
  text: string;
};

export type QuoteBlock = {
  id: string;
  type: "quote";
  text: string;
};

export type DividerBlock = {
  id: string;
  type: "divider";
};

export type ImageBlock = {
  id: string;
  type: "image";
  src: string;
  caption?: string;
};

export type EquationBlock = {
  id: string;
  type: "equation";
  latex: string;
};

export type CitationBlock = {
  id: string;
  type: "citation";
  key: string;
  label: string;
};

export type UnderleafDocument = {
  id: string;
  title: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  blocks: UnderleafBlock[];
};

export type PreviewMode = "page" | "continuous";
