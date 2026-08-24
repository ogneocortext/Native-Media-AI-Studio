import { useState, useEffect } from "react";
import { BookOpen, FileText, Search, ChevronRight } from "lucide-react";

interface StoryboardFile {
  name: string;
  path: string;
  title: string;
}

const STORYBOARDS: StoryboardFile[] = [
  { name: "take-the-crown", path: "/docs/STORYBOARD_TakeTheCrown.md", title: "Take the Crown" },
  { name: "still-i-rise", path: "/docs/STORYBOARD_StillIRise.md", title: "Still I Rise" },
  { name: "mindful-layering", path: "/docs/MINDFUL_LAYERING_2026.md", title: "Mindful Layering 2026" },
  { name: "visual-storytelling", path: "/docs/VISUAL_STORYTELLING_2026.md", title: "Visual Storytelling 2026" },
];

export function StoryboardPage() {
  const [selected, setSelected] = useState<StoryboardFile | null>(null);
  const [content, setContent] = useState<string>("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!selected) return;
    fetch(selected.path)
      .then((r) => r.text())
      .then(setContent)
      .catch(() => setContent("# Error\nFailed to load storyboard."));
  }, [selected]);

  const renderMarkdown = (md: string) => {
    const lines = md.split("\n");
    const elements: JSX.Element[] = [];
    let inTable = false;
    let tableRows: string[][] = [];
    let tableHeaders: string[] = [];

    const flushTable = () => {
      if (tableHeaders.length === 0) return;
      elements.push(
        <div key={`table-${elements.length}`} className="overflow-x-auto my-4">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-600">
                {tableHeaders.map((h, i) => (
                  <th key={i} className="text-left py-2 px-3 text-gray-300 font-medium">{h.trim()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, ri) => (
                <tr key={ri} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                  {row.map((cell, ci) => (
                    <td key={ci} className="py-2 px-3 text-gray-400">{cell.trim()}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
      tableHeaders = [];
      inTable = false;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith("|")) {
        const cells = line.split("|").filter((c) => c.trim() !== "");
        if (line.includes("---")) {
          inTable = true;
          tableHeaders = cells;
          continue;
        }
        if (inTable) {
          tableRows.push(cells);
          continue;
        }
      } else if (inTable) {
        flushTable();
      }

      if (line.startsWith("# ")) {
        elements.push(<h1 key={i} className="text-2xl font-bold text-white mt-6 mb-3">{line.slice(2)}</h1>);
      } else if (line.startsWith("## ")) {
        elements.push(<h2 key={i} className="text-xl font-semibold text-white mt-5 mb-2">{line.slice(3)}</h2>);
      } else if (line.startsWith("### ")) {
        elements.push(<h3 key={i} className="text-lg font-medium text-gray-200 mt-4 mb-2">{line.slice(4)}</h3>);
      } else if (line.startsWith("> ")) {
        elements.push(
          <blockquote key={i} className="border-l-4 border-purple-500 pl-4 my-3 text-gray-300 italic">
            {line.slice(2)}
          </blockquote>
        );
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        elements.push(
          <li key={i} className="text-gray-400 ml-4 list-disc">{line.slice(2)}</li>
        );
      } else if (line.trim() === "---") {
        elements.push(<hr key={i} className="border-gray-700 my-4" />);
      } else if (line.trim() === "") {
        elements.push(<div key={i} className="h-2" />);
      } else {
        elements.push(<p key={i} className="text-gray-400 leading-relaxed">{line}</p>);
      }
    }
    flushTable();
    return elements;
  };

  const filtered = STORYBOARDS.filter((s) =>
    s.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <BookOpen size={24} className="text-purple-400" />
        <h1 className="text-2xl font-bold text-white">Storyboards</h1>
      </div>

      {!selected ? (
        <div className="space-y-4">
          <div className="flex gap-2 mb-6">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search storyboards..."
              className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />
            <Search size={20} className="text-gray-500 mt-2" />
          </div>

          <div className="grid gap-3">
            {filtered.map((s) => (
              <button
                key={s.name}
                onClick={() => setSelected(s)}
                className="w-full text-left p-4 bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-purple-500/50 rounded-lg transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText size={18} className="text-purple-400" />
                    <span className="text-white font-medium">{s.title}</span>
                  </div>
                  <ChevronRight size={16} className="text-gray-500 group-hover:text-purple-400 transition-colors" />
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <button
            onClick={() => { setSelected(null); setContent(""); }}
            className="mb-4 text-purple-400 hover:text-purple-300 text-sm flex items-center gap-1"
          >
            ← Back to storyboards
          </button>
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            {renderMarkdown(content)}
          </div>
        </div>
      )}
    </div>
  );
}
