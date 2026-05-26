import type { UnderleafBlock } from "./types";

export const blocksToMarkdown = (blocks: UnderleafBlock[]) => {
  const lines: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      lines.push(paragraph.join(" "));
      lines.push("");
      paragraph = [];
    }
  };

  for (const block of blocks) {
    switch (block.type) {
      case "sentence":
        paragraph.push(block.text);
        break;
      case "paragraph_break":
        flushParagraph();
        break;
      case "heading":
        flushParagraph();
        lines.push(`${"#".repeat(block.level)} ${block.text}`);
        lines.push("");
        break;
      case "bullet":
        flushParagraph();
        lines.push(`- ${block.text}`);
        break;
      case "numbered":
        flushParagraph();
        lines.push(`1. ${block.text}`);
        break;
      case "quote":
        flushParagraph();
        lines.push(`> ${block.text}`);
        lines.push("");
        break;
      case "divider":
        flushParagraph();
        lines.push("---");
        lines.push("");
        break;
      case "image":
        flushParagraph();
        lines.push(`![${block.caption ?? ""}](${block.src})`);
        lines.push("");
        break;
      case "equation":
        flushParagraph();
        lines.push(`$$${block.latex}$$`);
        lines.push("");
        break;
      case "citation":
        paragraph.push(`[${block.label}]`);
        break;
    }
  }

  flushParagraph();
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

export const blocksToPlainText = (blocks: UnderleafBlock[]) =>
  blocksToMarkdown(blocks)
    .replace(/^#{1,6}\s/gm, "")
    .replace(/^[-*]\s/gm, "")
    .replace(/^>\s/gm, "")
    .replace(/^---$/gm, "")
    .trim();

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const blocksToHtml = (blocks: UnderleafBlock[]) => {
  const html: string[] = [];
  let paragraph: string[] = [];
  let bulletItems: string[] = [];
  let numberedItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${paragraph.map(escapeHtml).join(" ")}</p>`);
      paragraph = [];
    }
  };

  const flushLists = () => {
    if (bulletItems.length) {
      html.push(`<ul>${bulletItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
      bulletItems = [];
    }
    if (numberedItems.length) {
      html.push(`<ol>${numberedItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`);
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
        html.push(`<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`);
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
        html.push(`<blockquote>${escapeHtml(block.text)}</blockquote>`);
        break;
      case "divider":
        flushParagraph();
        flushLists();
        html.push("<hr />");
        break;
      case "image":
        flushParagraph();
        flushLists();
        html.push(
          `<figure><img src="${escapeHtml(block.src)}" alt="${escapeHtml(
            block.caption ?? ""
          )}" />${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ""}</figure>`
        );
        break;
      case "equation":
        flushParagraph();
        flushLists();
        html.push(`<pre>${escapeHtml(block.latex)}</pre>`);
        break;
      case "citation":
        flushLists();
        paragraph.push(`[${block.label}]`);
        break;
    }
  }

  flushParagraph();
  flushLists();

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>Underleaf Export</title>
    <style>
      body { max-width: 760px; margin: 48px auto; padding: 0 24px; color: #202124; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.65; }
      h1, h2, h3 { line-height: 1.18; }
      blockquote { margin: 24px 0; padding: 12px 18px; border-left: 4px solid #8c6d4f; background: #f7f1e8; }
      img { max-width: 100%; display: block; }
      figcaption { margin-top: 8px; color: #777; text-align: center; }
    </style>
  </head>
  <body>
    ${html.join("\n    ")}
  </body>
</html>`;
};

export const blocksToDocxBlob = async (blocks: UnderleafBlock[]) => {
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import("docx");
  const children: InstanceType<typeof Paragraph>[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      children.push(
        new Paragraph({
          children: [new TextRun(paragraph.join(" "))]
        })
      );
      paragraph = [];
    }
  };

  for (const block of blocks) {
    switch (block.type) {
      case "sentence":
        if (block.text.trim()) paragraph.push(block.text.trim());
        break;
      case "paragraph_break":
        flushParagraph();
        break;
      case "heading":
        flushParagraph();
        children.push(
          new Paragraph({
            text: block.text,
            heading:
              block.level === 1
                ? HeadingLevel.HEADING_1
                : block.level === 2
                  ? HeadingLevel.HEADING_2
                  : HeadingLevel.HEADING_3
          })
        );
        break;
      case "bullet":
        flushParagraph();
        children.push(
          new Paragraph({
            children: [new TextRun(`• ${block.text}`)]
          })
        );
        break;
      case "numbered":
        flushParagraph();
        children.push(
          new Paragraph({
            children: [new TextRun(block.text)]
          })
        );
        break;
      case "quote":
        flushParagraph();
        children.push(
          new Paragraph({
            children: [new TextRun({ text: block.text, italics: true })]
          })
        );
        break;
      case "divider":
        flushParagraph();
        children.push(new Paragraph({ text: "----------" }));
        break;
      case "image":
        flushParagraph();
        children.push(new Paragraph({ text: `[Image] ${block.caption ?? block.src}` }));
        break;
      case "equation":
        flushParagraph();
        children.push(new Paragraph({ text: block.latex }));
        break;
      case "citation":
        paragraph.push(`[${block.label}]`);
        break;
    }
  }

  flushParagraph();

  const doc = new Document({
    sections: [
      {
        properties: {},
        children
      }
    ]
  });

  return Packer.toBlob(doc);
};
