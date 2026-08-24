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

const styles = {
  page: {
    maxWidth: "72rem",
    margin: "0 auto",
    padding: "1.5rem",
    background: "#0a0a0f",
    minHeight: "100%",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    marginBottom: "1.5rem",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: "bold",
    color: "#f1f5f9",
  },
  searchContainer: {
    display: "flex",
    gap: "0.5rem",
    marginBottom: "1.5rem",
  },
  searchInput: {
    flex: 1,
    padding: "0.5rem 0.75rem",
    background: "#1f2937",
    border: "1px solid #374151",
    borderRadius: "0.5rem",
    color: "#f1f5f9",
    outline: "none",
  },
  card: {
    width: "100%",
    textAlign: "left",
    padding: "1rem",
    background: "#1f2937",
    border: "1px solid #374151",
    borderRadius: "0.5rem",
    marginBottom: "0.75rem",
    cursor: "pointer",
    transition: "border-color 0.2s",
  },
  cardContent: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardLeft: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  cardTitle: {
    color: "#f1f5f9",
    fontWeight: "500",
  },
  contentCard: {
    background: "#1f2937",
    borderRadius: "0.5rem",
    padding: "1.5rem",
    border: "1px solid #374151",
  },
  backButton: {
    marginBottom: "1rem",
    color: "#a78bfa",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: "0.875rem",
    display: "flex",
    alignItems: "center",
    gap: "0.25rem",
  },
  heading1: {
    fontSize: "1.5rem",
    fontWeight: "bold",
    color: "#f1f5f9",
    marginTop: "1.5rem",
    marginBottom: "0.75rem",
  },
  heading2: {
    fontSize: "1.25rem",
    fontWeight: "600",
    color: "#f1f5f9",
    marginTop: "1.25rem",
    marginBottom: "0.5rem",
  },
  heading3: {
    fontSize: "1.125rem",
    fontWeight: "500",
    color: "#e2e8f0",
    marginTop: "1rem",
    marginBottom: "0.5rem",
  },
  paragraph: {
    color: "#94a3b8",
    lineHeight: "1.6",
  },
  blockquote: {
    borderLeft: "4px solid #a855f7",
    paddingLeft: "1rem",
    margin: "0.75rem 0",
    color: "#cbd5e1",
    fontStyle: "italic",
  },
  listItem: {
    color: "#94a3b8",
    marginLeft: "1rem",
    listStyleType: "disc",
  },
  hr: {
    border: "none",
    borderTop: "1px solid #374151",
    margin: "1rem 0",
  },
  table: {
    width: "100%",
    fontSize: "0.875rem",
    borderCollapse: "collapse",
    margin: "1rem 0",
    overflowX: "auto",
    display: "block",
  },
  th: {
    textAlign: "left",
    padding: "0.5rem 0.75rem",
    color: "#cbd5e1",
    fontWeight: "500",
    borderBottom: "1px solid #4b5563",
  },
  td: {
    padding: "0.5rem 0.75rem",
    color: "#94a3b8",
    borderBottom: "1px solid rgba(55, 65, 81, 0.5)",
  },
};

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
        <div key={`table-${elements.length}`} style={{ overflowX: "auto", margin: "1rem 0" }}>
          <table style={styles.table}>
            <thead>
              <tr>
                {tableHeaders.map((h, i) => (
                  <th key={i} style={styles.th}>{h.trim()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={styles.td}>{cell.trim()}</td>
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
        elements.push(<h1 key={i} style={styles.heading1}>{line.slice(2)}</h1>);
      } else if (line.startsWith("## ")) {
        elements.push(<h2 key={i} style={styles.heading2}>{line.slice(3)}</h2>);
      } else if (line.startsWith("### ")) {
        elements.push(<h3 key={i} style={styles.heading3}>{line.slice(4)}</h3>);
      } else if (line.startsWith("> ")) {
        elements.push(
          <blockquote key={i} style={styles.blockquote}>
            {line.slice(2)}
          </blockquote>
        );
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        elements.push(
          <li key={i} style={styles.listItem}>{line.slice(2)}</li>
        );
      } else if (line.trim() === "---") {
        elements.push(<hr key={i} style={styles.hr} />);
      } else if (line.trim() === "") {
        elements.push(<div key={i} style={{ height: "0.5rem" }} />);
      } else {
        elements.push(<p key={i} style={styles.paragraph}>{line}</p>);
      }
    }
    flushTable();
    return elements;
  };

  const filtered = STORYBOARDS.filter((s) =>
    s.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <BookOpen size={24} color="#a78bfa" />
        <h1 style={styles.title}>Storyboards</h1>
      </div>

      {!selected ? (
        <div>
          <div style={styles.searchContainer}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search storyboards..."
              style={styles.searchInput}
            />
            <Search size={20} color="#6b7280" style={{ marginTop: "0.5rem" }} />
          </div>

          <div>
            {filtered.map((s) => (
              <button
                key={s.name}
                onClick={() => setSelected(s)}
                style={styles.card}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(168, 85, 247, 0.5)")}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#374151")}
              >
                <div style={styles.cardContent}>
                  <div style={styles.cardLeft}>
                    <FileText size={18} color="#a78bfa" />
                    <span style={styles.cardTitle}>{s.title}</span>
                  </div>
                  <ChevronRight size={16} color="#6b7280" />
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <button
            onClick={() => { setSelected(null); setContent(""); }}
            style={styles.backButton}
          >
            ← Back to storyboards
          </button>
          <div style={styles.contentCard}>
            {renderMarkdown(content)}
          </div>
        </div>
      )}
    </div>
  );
}
