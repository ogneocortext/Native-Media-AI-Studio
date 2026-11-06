/**
 * DocViews - document renderers extracted from DocsPage: JsonView
 * (canvas/node JSON pretty view), MarkdownView (hand-rolled markdown
 * parser/renderer) and its inlineFmt helper.
 */
import type { ReactNode } from "react";

function JsonView({ text, filePath }: { text: string; filePath?: string }) {
  let pretty = text;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
    pretty = JSON.stringify(parsed, null, 2);
  } catch {
    // not JSON
  }
  // Canvas preview (Obsidian .canvas)
  if (
    filePath?.endsWith(".canvas") &&
    parsed &&
    typeof parsed === "object" &&
    parsed !== null &&
    "nodes" in (parsed as Record<string, unknown>)
  ) {
    const canvas = parsed as {
      nodes?: { id: string; type?: string; text?: string }[];
      edges?: unknown[];
    };
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="px-2 py-1 bg-purple-900/30 rounded border border-purple-700/30 text-purple-300">
            Canvas
          </span>
          <span>{canvas.nodes?.length ?? 0} nodes</span>
          <span>·</span>
          <span>{canvas.edges?.length ?? 0} edges</span>
        </div>
        {canvas.nodes && canvas.nodes.length > 0 && (
          <div className="grid grid-cols-1 gap-2 max-h-[320px] overflow-y-auto">
            {canvas.nodes.slice(0, 20).map((n) => (
              <div
                key={n.id}
                className="p-2 bg-gray-900/50 rounded border border-gray-700/30 text-xs"
              >
                <span className="text-gray-500 font-mono">{n.id.slice(0, 8)}</span>
                <span className="ml-2 text-gray-400">{n.type ?? "text"}</span>
                {n.text && (
                  <p className="text-gray-300 mt-1 line-clamp-2">{n.text.slice(0, 120)}</p>
                )}
              </div>
            ))}
            {canvas.nodes.length > 20 && (
              <p className="text-xs text-gray-500">+{canvas.nodes.length - 20} more nodes</p>
            )}
          </div>
        )}
        <details className="text-xs">
          <summary className="cursor-pointer text-purple-400 hover:text-purple-300">
            Raw JSON
          </summary>
          <pre className="mt-2 bg-gray-900 border border-gray-700 rounded-lg p-3 overflow-x-auto text-xs text-gray-200 whitespace-pre-wrap break-words">
            <code>{pretty}</code>
          </pre>
        </details>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {filePath ? filePath.split("/").pop() : "JSON"} · {(pretty.length / 1024).toFixed(1)} KB
        </span>
        <span className="text-xs text-gray-600">pretty-printed</span>
      </div>
      <pre className="bg-gray-900 border border-gray-700 rounded-lg p-3 overflow-x-auto text-xs text-gray-200 whitespace-pre-wrap break-words">
        <code>{pretty}</code>
      </pre>
    </div>
  );
}

export function MarkdownView({ text, filePath }: { text: string; filePath?: string }) {
  // JSON / canvas files → pretty print directly
  if (filePath?.endsWith(".json") || filePath?.endsWith(".canvas")) {
    return <JsonView text={text} filePath={filePath} />;
  }

  // Quick JSON heuristic (agent.manifest etc may be served as .md but content is JSON)
  const trimmed = text.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed);
      return <JsonView text={trimmed} />;
    } catch {
      // not JSON, fall through
    }
  }

  // Strip frontmatter
  let md = text;
  if (md.startsWith("---")) {
    const end = md.indexOf("\n---", 3);
    if (end !== -1) md = md.slice(end + 4).trimStart();
  }

  const lines = md.split("\n");
  const elements: ReactNode[] = [];
  let inCodeBlock = false;
  let codeLang = "";
  let codeBuffer: string[] = [];
  let listBuffer: { type: "ul" | "ol"; items: string[] } | null = null;
  let tableBuffer: string[] | null = null;

  const flushList = () => {
    if (!listBuffer) return;
    elements.push(
      listBuffer.type === "ul" ? (
        <ul
          key={`ul-${elements.length}`}
          className="list-disc ml-6 my-2 space-y-1 text-gray-300 text-sm"
        >
          {listBuffer.items.map((it, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: inlineFmt(it) }} />
          ))}
        </ul>
      ) : (
        <ol
          key={`ol-${elements.length}`}
          className="list-decimal ml-6 my-2 space-y-1 text-gray-300 text-sm"
        >
          {listBuffer.items.map((it, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: inlineFmt(it) }} />
          ))}
        </ol>
      ),
    );
    listBuffer = null;
  };

  const flushCode = () => {
    if (codeBuffer.length === 0) return;
    elements.push(
      <div
        key={`code-${elements.length}`}
        className="my-3 rounded-lg border border-gray-700 overflow-hidden"
      >
        {codeLang && (
          <div className="px-3 py-1 bg-gray-800 border-b border-gray-700 text-xs text-gray-400 font-mono flex items-center justify-between">
            <span>{codeLang}</span>
            <span className="text-gray-600">{codeBuffer.length} lines</span>
          </div>
        )}
        <pre className="bg-gray-900 p-3 overflow-x-auto text-xs text-gray-200">
          <code className={codeLang ? `language-${codeLang}` : ""}>{codeBuffer.join("\n")}</code>
        </pre>
      </div>,
    );
    codeBuffer = [];
    codeLang = "";
  };

  const flushTable = () => {
    if (!tableBuffer || tableBuffer.length === 0) return;
    const rows = tableBuffer.map((r) =>
      r
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean),
    );
    // Detect separator row (|---|---|)
    const isSeparator = (row: string[]) => row.every((c) => /^[-:]+$/.test(c));
    const hasHeaderSep = rows.length >= 2 && isSeparator(rows[1]);
    const header = hasHeaderSep ? rows[0] : null;
    const body = hasHeaderSep ? rows.slice(2) : rows;
    elements.push(
      <div
        key={`tbl-${elements.length}`}
        className="overflow-x-auto my-3 rounded-lg border border-gray-700"
      >
        <table className="w-full text-xs">
          {header && (
            <thead className="bg-gray-800">
              <tr>
                {header.map((c, i) => (
                  <th
                    key={i}
                    className="text-left px-3 py-2 text-gray-200 font-semibold border-b border-gray-700"
                    dangerouslySetInnerHTML={{ __html: inlineFmt(c) }}
                  />
                ))}
              </tr>
            </thead>
          )}
          <tbody className="divide-y divide-gray-700/50">
            {body.map((row, ri) => (
              <tr key={ri} className="hover:bg-gray-800/40">
                {row.map((c, ci) => (
                  <td
                    key={ci}
                    className="px-3 py-2 text-gray-300 border-b border-gray-700/30"
                    dangerouslySetInnerHTML={{ __html: inlineFmt(c) }}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    tableBuffer = null;
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const line = raw.trimEnd();

    // Code fence
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        flushCode();
        inCodeBlock = false;
      } else {
        flushList();
        flushTable();
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCodeBlock) {
      codeBuffer.push(raw);
      continue;
    }

    // Table detection — collect consecutive | lines
    if (line.trim().startsWith("|") && line.includes("|")) {
      flushList();
      tableBuffer ??= [];
      tableBuffer.push(line.trim());
      continue;
    } else if (tableBuffer) {
      flushTable();
    }

    // Empty line
    if (!line.trim()) {
      flushList();
      continue;
    }

    // Heading
    const h = /^(#{1,6})\s+(.*)/.exec(line);
    if (h) {
      flushList();
      const level = h[1].length;
      const content = inlineFmt(h[2]);
      const cls =
        level === 1
          ? "text-xl font-bold text-white mt-6 mb-3"
          : level === 2
            ? "text-lg font-semibold text-white mt-5 mb-2"
            : level === 3
              ? "text-base font-semibold text-purple-300 mt-4 mb-2"
              : "text-sm font-semibold text-gray-200 mt-3 mb-1";
      const TagName = `h${Math.min(level, 4)}` as "h1" | "h2" | "h3" | "h4";
      elements.push(
        <TagName
          key={`h-${elements.length}`}
          className={cls}
          dangerouslySetInnerHTML={{ __html: content }}
        />,
      );
      continue;
    }

    // Blockquote/callout [!info] etc
    if (line.startsWith(">")) {
      flushList();
      const content = line.replace(/^>\s?/, "").replace(/^\[!.*?\]\s*/, "");
      elements.push(
        <div
          key={`bq-${elements.length}`}
          className="border-l-2 border-purple-500 bg-purple-500/10 pl-3 py-2 my-2 text-sm text-gray-300 rounded-r"
          dangerouslySetInnerHTML={{ __html: inlineFmt(content) }}
        />,
      );
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      flushList();
      elements.push(<hr key={`hr-${elements.length}`} className="border-gray-700 my-4" />);
      continue;
    }

    // Unordered list
    const ul = /^\s*[-*]\s+(.*)/.exec(line);
    if (ul) {
      if (listBuffer?.type !== "ul") {
        flushList();
        listBuffer = { type: "ul", items: [] };
      }
      listBuffer.items.push(ul[1]);
      continue;
    }
    // Ordered list
    const ol = /^\s*\d+\.\s+(.*)/.exec(line);
    if (ol) {
      if (listBuffer?.type !== "ol") {
        flushList();
        listBuffer = { type: "ol", items: [] };
      }
      listBuffer.items.push(ol[1]);
      continue;
    }

    // Paragraph
    flushList();
    elements.push(
      <p
        key={`p-${elements.length}`}
        className="text-sm text-gray-300 leading-relaxed my-2"
        dangerouslySetInnerHTML={{ __html: inlineFmt(line) }}
      />,
    );
  }
  flushList();
  flushTable();
  flushCode();
  return <div className="space-y-1">{elements}</div>;
}

function inlineFmt(s: string): string {
  let out = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Inline code first (protect)
  out = out.replace(
    /`([^`]+)`/g,
    '<code class="bg-gray-800 px-1 py-0.5 rounded text-purple-300 text-xs">$1</code>',
  );
  // Bold
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong class='text-white'>$1</strong>");
  // Italic
  out = out.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "<em>$1</em>");
  // Links with href preserved
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer" class="text-purple-400 hover:underline hover:text-purple-300">$1</a>',
  );
  // Wiki links
  out = out.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '<span class="text-blue-400">$1</span>');
  return out;
}

// ---------------------------------------------------------------------------
// Component
