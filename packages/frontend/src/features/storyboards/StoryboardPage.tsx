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
    const elements: React.ReactElement[] = [];
    let inTable = false;
    let tableRows: string[][] = [];
    let tableHeaders: string[] = [];

    const flushTable = () => {
      if (tableHeaders.length === 0) return;
      elements.push(
        <div key={`table-${elements.length}`} className="sb-table-wrapper">
          <table className="sb-table">
            <thead>
              <tr>
                {tableHeaders.map((h, i) => (
                  <th key={i} className="sb-th">{h.trim()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, ri) => (
                <tr key={ri} className="sb-tr">
                  {row.map((cell, ci) => (
                    <td key={ci} className="sb-td">{cell.trim()}</td>
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
        elements.push(<h1 key={i} className="sb-h1">{line.slice(2)}</h1>);
      } else if (line.startsWith("## ")) {
        elements.push(<h2 key={i} className="sb-h2">{line.slice(3)}</h2>);
      } else if (line.startsWith("### ")) {
        elements.push(<h3 key={i} className="sb-h3">{line.slice(4)}</h3>);
      } else if (line.startsWith("> ")) {
        elements.push(
          <blockquote key={i} className="sb-blockquote">
            {line.slice(2)}
          </blockquote>
        );
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        elements.push(
          <li key={i} className="sb-li">{line.slice(2)}</li>
        );
      } else if (line.trim() === "---") {
        elements.push(<hr key={i} className="sb-hr" />);
      } else if (line.trim() === "") {
        elements.push(<div key={i} className="sb-spacer" />);
      } else {
        elements.push(<p key={i} className="sb-p">{line}</p>);
      }
    }
    flushTable();
    return elements;
  };

  const filtered = STORYBOARDS.filter((s) =>
    s.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="sb-page">
      <div className="sb-header">
        <BookOpen size={24} className="sb-icon" />
        <h1 className="sb-title">Storyboards</h1>
      </div>

      {!selected ? (
        <div className="sb-content">
          <div className="sb-search">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search storyboards..."
              className="sb-search-input"
            />
            <Search size={20} className="sb-search-icon" />
          </div>

          <div className="sb-grid">
            {filtered.map((s) => (
              <button
                key={s.name}
                onClick={() => setSelected(s)}
                className="sb-card"
              >
                <div className="sb-card-inner">
                  <div className="sb-card-left">
                    <FileText size={18} className="sb-card-icon" />
                    <span className="sb-card-title">{s.title}</span>
                  </div>
                  <ChevronRight size={16} className="sb-card-arrow" />
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="sb-content">
          <button
            onClick={() => { setSelected(null); setContent(""); }}
            className="sb-back"
          >
            ← Back to storyboards
          </button>
          <div className="sb-markdown">
            {renderMarkdown(content)}
          </div>
        </div>
      )}
    </div>
  );
}
