/**
 * SimpleMarkdown — lightweight markdown → React (no extra dependency)
 *
 * Extracted from AIToolsPage.tsx so the parser can be reasoned about,
 * tested, and reused independently of the chat page.
 */

import type { ReactNode } from "react";

type MDNode =
  | { type: "text"; content: string }
  | { type: "bold"; children: MDNode[] }
  | { type: "italic"; children: MDNode[] }
  | { type: "code"; content: string }
  | { type: "link"; href: string; children: MDNode[] }
  | { type: "br" };

function parseInline(md: string): MDNode[] {
  const nodes: MDNode[] = [];
  let i = 0;
  const len = md.length;
  while (i < len) {
    const ch = md[i];
    if (ch === "`") {
      const end = md.indexOf("`", i + 1);
      if (end !== -1) {
        nodes.push({ type: "code", content: md.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
      nodes.push({ type: "text", content: ch });
      i += 1;
      continue;
    }
    if (md.startsWith("**", i)) {
      const end = md.indexOf("**", i + 2);
      if (end !== -1) {
        nodes.push({ type: "bold", children: parseInline(md.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
      nodes.push({ type: "text", content: "**" });
      i += 2;
      continue;
    }
    if (ch === "*") {
      const end = md.indexOf("*", i + 1);
      if (end !== -1 && end > i + 1) {
        nodes.push({ type: "italic", children: parseInline(md.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
      nodes.push({ type: "text", content: ch });
      i += 1;
      continue;
    }
    if (ch === "[") {
      const close = md.indexOf("]", i + 1);
      if (close !== -1 && md[close + 1] === "(") {
        const parenClose = md.indexOf(")", close + 2);
        if (parenClose !== -1) {
          nodes.push({
            type: "link",
            href: md.slice(close + 2, parenClose),
            children: parseInline(md.slice(i + 1, close)),
          });
          i = parenClose + 1;
          continue;
        }
      }
      nodes.push({ type: "text", content: ch });
      i += 1;
      continue;
    }
    if (ch === "\n") {
      nodes.push({ type: "br" });
      i += 1;
      continue;
    }
    nodes.push({ type: "text", content: ch });
    i += 1;
  }
  return nodes;
}

function renderInline(nodes: MDNode[]): ReactNode {
  return nodes.map((node, idx) => {
    switch (node.type) {
      case "text":
        return node.content;
      case "bold":
        return <strong key={idx}>{renderInline(node.children)}</strong>;
      case "italic":
        return <em key={idx}>{renderInline(node.children)}</em>;
      case "code":
        return (
          <code
            key={idx}
            className="text-xs bg-white/10 px-1.5 py-0.5 rounded border border-white/5 text-cyan-300 font-mono"
          >
            {node.content}
          </code>
        );
      case "link":
        return (
          <a
            key={idx}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-400 underline underline-offset-4 hover:text-emerald-300"
          >
            {renderInline(node.children)}
          </a>
        );
      case "br":
        return <br key={idx} />;
      default:
        return null;
    }
  });
}

export function SimpleMarkdown({ content }: { content: string }): ReactNode {
  if (!content) return null;
  const blocks = content.split("\n\n");
  return blocks.map((block, bi) => {
    const trimmed = block.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("```")) {
      const fenceEnd = trimmed.indexOf("```", 3);
      const langLine = trimmed.slice(3, fenceEnd !== -1 ? fenceEnd : trimmed.length).trim();
      const codeBody = fenceEnd !== -1 ? trimmed.slice(fenceEnd + 3).trim() : "";
      return (
        <div
          key={bi}
          className="my-2 rounded-lg border border-white/10 bg-black/30 p-3 overflow-x-auto"
        >
          <div className="flex items-center gap-2 mb-1 text-[10px] text-muted font-mono">
            <span>{langLine || "text"}</span>
          </div>
          <pre className="text-sm text-gray-200 font-mono leading-relaxed whitespace-pre break-all">
            {codeBody}
          </pre>
        </div>
      );
    }
    const headingMatch = /^(#{1,3})\s(.+)/s.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      return (
        <Tag key={bi} className="mt-3 mb-1 text-white font-semibold">
          {renderInline(parseInline(text))}
        </Tag>
      );
    }
    if (trimmed.startsWith(">")) {
      const text = trimmed.slice(1).trim();
      return (
        <div key={bi} className="my-2 border-l-2 border-emerald-500 pl-3 italic text-gray-300">
          {renderInline(parseInline(text))}
        </div>
      );
    }
    if (/^[-*]\s/m.test(trimmed)) {
      const items = trimmed.split(/\n(?=[-*]\s)/);
      return (
        <ul key={bi} className="my-2 list-disc pl-5 space-y-1 text-gray-200">
          {items.map((item, ii) => (
            <li key={ii} className="whitespace-pre-wrap">
              {renderInline(parseInline(item.replace(/^[-*]\s/, "")))}
            </li>
          ))}
        </ul>
      );
    }
    return (
      <p key={bi} className="my-2 text-gray-200 whitespace-pre-wrap break-words">
        {renderInline(parseInline(trimmed))}
      </p>
    );
  });
}
