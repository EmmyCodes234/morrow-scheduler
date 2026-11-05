import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownViewer } from "@/components/shared/markdown-viewer";

describe("MarkdownViewer Component", () => {
  it("renders empty fallback when content is empty", () => {
    const html = renderToStaticMarkup(React.createElement(MarkdownViewer, { content: "" }));
    expect(html).toContain("No preparation material provided.");
  });

  it("renders headings at correct levels with BoardUI classes", () => {
    const md = "# Heading 1\n## Heading 2\n### Heading 3\n#### Heading 4";
    const html = renderToStaticMarkup(React.createElement(MarkdownViewer, { content: md }));

    expect(html).toContain("<h1");
    expect(html).toContain("Heading 1");
    expect(html).toContain("<h2");
    expect(html).toContain("Heading 2");
    expect(html).toContain("<h3");
    expect(html).toContain("Heading 3");
    expect(html).toContain("<h4");
    expect(html).toContain("Heading 4");
  });

  it("renders bold, italic, code, and links", () => {
    const md = "This is **bold** text and *italic* text with `code` and [Morrow](https://usemorrow.xyz).";
    const html = renderToStaticMarkup(React.createElement(MarkdownViewer, { content: md }));

    expect(html).toContain("<strong");
    expect(html).toContain("bold</strong>");
    expect(html).toContain("<em");
    expect(html).toContain("italic</em>");
    expect(html).toContain("<code");
    expect(html).toContain("code</code>");
    expect(html).toContain("<a href=\"https://usemorrow.xyz\"");
    expect(html).toContain("Morrow</a>");
  });

  it("renders ordered and unordered lists properly", () => {
    const md = `
1. First numbered item
2. Second numbered item

- First bullet item
- Second bullet item
`;
    const html = renderToStaticMarkup(React.createElement(MarkdownViewer, { content: md }));

    expect(html).toContain("<ol");
    expect(html).toContain("First numbered item");
    expect(html).toContain("Second numbered item");
    expect(html).toContain("<ul");
    expect(html).toContain("First bullet item");
    expect(html).toContain("Second bullet item");
  });

  it("renders markdown tables properly with headers and rows", () => {
    const md = `
| Action | Owner | Status |
|---|---|---|
| Entertainment plan | Catherine | Done |
| Media plan | Crew | Pending |
`;
    const html = renderToStaticMarkup(React.createElement(MarkdownViewer, { content: md }));

    expect(html).toContain("<table");
    expect(html).toContain("<thead");
    expect(html).toContain("Action");
    expect(html).toContain("Owner");
    expect(html).toContain("Status");
    expect(html).toContain("<tbody");
    expect(html).toContain("Entertainment plan");
    expect(html).toContain("Catherine");
    expect(html).toContain("Done");
  });

  it("renders horizontal rules", () => {
    const md = "Before\n\n---\n\nAfter";
    const html = renderToStaticMarkup(React.createElement(MarkdownViewer, { content: md }));
    expect(html).toContain("<hr");
  });
});
