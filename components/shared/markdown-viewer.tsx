"use client";

import React, { useMemo } from "react";
import { cx } from "@/utils/cx";

export interface MarkdownViewerProps {
  content: string;
  className?: string;
}

type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "hr" }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "ordered-list"; items: string[] }
  | { type: "unordered-list"; items: string[] }
  | { type: "paragraph"; text: string };

function parseInlineFormatting(text: string): React.ReactNode[] {
  // Regex matches:
  // 1. Links: [label](url)
  // 2. Bold: **text**
  // 3. Italic: *text* or _text_
  // 4. Code: `code`
  const regex = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
  const parts = text.split(regex);

  return parts.map((part, idx) => {
    if (!part) return null;

    // Link: [label](url)
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={idx}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-600 underline hover:text-accent-500 font-medium transition-colors"
        >
          {linkMatch[1]}
        </a>
      );
    }

    // Bold: **text**
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong key={idx} className="font-semibold text-text-primary">
          {part.slice(2, -2)}
        </strong>
      );
    }

    // Italic: *text* or _text_
    if (
      ((part.startsWith("*") && part.endsWith("*")) ||
        (part.startsWith("_") && part.endsWith("_"))) &&
      part.length >= 2
    ) {
      return (
        <em key={idx} className="italic text-text-secondary">
          {part.slice(1, -1)}
        </em>
      );
    }

    // Code: `code`
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded-md bg-background-tertiary-default text-text-primary font-mono text-caption-2-medium"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function parseMarkdown(mdText: string): MarkdownBlock[] {
  if (!mdText) return [];

  const rawLines = mdText.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      i++;
      continue;
    }

    // Horizontal Rule: --- or *** or ___
    if (/^(---|[*]{3}|___)$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // Headings: #, ##, ###, ####, #####, ######
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    // Tables: must start and end with pipe "|"
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableLines: string[] = [];
      while (
        i < rawLines.length &&
        rawLines[i].trim().startsWith("|") &&
        rawLines[i].trim().endsWith("|")
      ) {
        tableLines.push(rawLines[i].trim());
        i++;
      }

      if (tableLines.length >= 2) {
        const headers = tableLines[0]
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());

        // Skip separator row (tableLines[1], e.g. |---|---|)
        const rows = tableLines.slice(2).map((r) =>
          r
            .split("|")
            .slice(1, -1)
            .map((c) => c.trim())
        );

        blocks.push({ type: "table", headers, rows });
        continue;
      }
    }

    // Ordered List: e.g. 1. Item
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < rawLines.length && /^\d+\.\s+/.test(rawLines[i].trim())) {
        items.push(rawLines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ordered-list", items });
      continue;
    }

    // Unordered List: e.g. - Item or * Item
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < rawLines.length && /^[-*]\s+/.test(rawLines[i].trim())) {
        items.push(rawLines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "unordered-list", items });
      continue;
    }

    // Paragraph: collect consecutive lines until an empty line or special token
    const paraLines: string[] = [];
    while (
      i < rawLines.length &&
      rawLines[i].trim() &&
      !rawLines[i].trim().startsWith("#") &&
      !/^(---|[*]{3}|___)$/.test(rawLines[i].trim()) &&
      !(rawLines[i].trim().startsWith("|") && rawLines[i].trim().endsWith("|")) &&
      !/^\d+\.\s+/.test(rawLines[i].trim()) &&
      !/^[-*]\s+/.test(rawLines[i].trim())
    ) {
      paraLines.push(rawLines[i].trim());
      i++;
    }

    if (paraLines.length > 0) {
      blocks.push({
        type: "paragraph",
        text: paraLines.join(" "),
      });
    }
  }

  return blocks;
}

export function MarkdownViewer({ content, className }: MarkdownViewerProps) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);

  if (!content || blocks.length === 0) {
    return (
      <div className={cx("text-body-2-regular text-text-tertiary italic", className)}>
        No preparation material provided.
      </div>
    );
  }

  return (
    <div className={cx("flex flex-col gap-3 font-sans text-text-primary", className)}>
      {blocks.map((block, idx) => {
        switch (block.type) {
          case "heading": {
            if (block.level === 1) {
              return (
                <h1
                  key={idx}
                  className="text-title-1-medium text-text-primary mt-6 mb-2 first:mt-0 font-bold tracking-tight"
                >
                  {parseInlineFormatting(block.text)}
                </h1>
              );
            }
            if (block.level === 2) {
              return (
                <h2
                  key={idx}
                  className="text-title-2-medium text-text-primary mt-5 mb-2 font-semibold border-b border-separator-border pb-1.5"
                >
                  {parseInlineFormatting(block.text)}
                </h2>
              );
            }
            if (block.level === 3) {
              return (
                <h3
                  key={idx}
                  className="text-title-3-semibold text-text-primary mt-4 mb-1.5 font-semibold"
                >
                  {parseInlineFormatting(block.text)}
                </h3>
              );
            }
            return (
              <h4
                key={idx}
                className="text-body-medium text-text-primary mt-3 mb-1 font-semibold"
              >
                {parseInlineFormatting(block.text)}
              </h4>
            );
          }

          case "hr":
            return <hr key={idx} className="my-5 border-separator-border" />;

          case "table":
            return (
              <div
                key={idx}
                className="my-3 overflow-x-auto rounded-xl border border-border-table bg-background-primary-default shadow-2xs"
              >
                <table className="w-full text-start text-body-2-regular border-collapse">
                  <thead className="bg-background-secondary-default/90 text-text-primary border-b border-border-table">
                    <tr>
                      {block.headers.map((h, hIdx) => (
                        <th
                          key={hIdx}
                          className="px-3.5 py-2.5 text-start font-semibold text-caption-1-semibold text-text-primary whitespace-nowrap"
                        >
                          {parseInlineFormatting(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-table">
                    {block.rows.map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        className="hover:bg-background-secondary-default/40 transition-colors"
                      >
                        {row.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            className="px-3.5 py-2 text-text-secondary align-top"
                          >
                            {parseInlineFormatting(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case "ordered-list":
            return (
              <ol
                key={idx}
                className="list-decimal list-outside ms-5 my-1.5 space-y-1 text-body-2-regular text-text-secondary"
              >
                {block.items.map((item, itemIdx) => (
                  <li key={itemIdx} className="leading-relaxed">
                    {parseInlineFormatting(item)}
                  </li>
                ))}
              </ol>
            );

          case "unordered-list":
            return (
              <ul
                key={idx}
                className="list-disc list-outside ms-5 my-1.5 space-y-1 text-body-2-regular text-text-secondary"
              >
                {block.items.map((item, itemIdx) => (
                  <li key={itemIdx} className="leading-relaxed">
                    {parseInlineFormatting(item)}
                  </li>
                ))}
              </ul>
            );

          case "paragraph":
            return (
              <p
                key={idx}
                className="text-body-2-regular text-text-secondary leading-relaxed my-1.5"
              >
                {parseInlineFormatting(block.text)}
              </p>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}
