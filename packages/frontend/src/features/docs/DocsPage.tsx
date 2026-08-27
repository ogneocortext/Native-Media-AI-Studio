import { useState, useEffect, useCallback } from "react";
import {
  Search,
  FileText,
  Folder,
  FolderOpen,
  Code,
  BookOpen,
  Loader2,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import {
  searchDocs,
  getDocsBootstrap,
  getProjectStructure,
} from "../../services/api";

interface DocResult {
  path: string;
  title: string;
  score: number;
  snippet: string | null;
}

interface TreeNode {
  name: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

export function DocsPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DocResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [bootstrap, setBootstrap] = useState<Record<string, unknown>>({});
  const [structure, setStructure] = useState<TreeNode | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadBootstrap();
    loadStructure();
  }, []);

  const loadBootstrap = async () => {
    try {
      const data = await getDocsBootstrap();
      setBootstrap(data);
    } catch {
      // Backend may not be running
    }
  };

  const loadStructure = async () => {
    try {
      const data = await getProjectStructure(3);
      setStructure(parseStructure(data.structure));
    } catch {
      // Backend may not be running
    }
  };

  const parseStructure = (obj: unknown, name: string = "project"): TreeNode => {
    if (typeof obj === "object" && obj !== null) {
      const children: TreeNode[] = [];
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof value === "object" && value !== null) {
          children.push(parseStructure(value, key));
        } else {
          children.push({ name: key, type: "file" });
        }
      }
      return { name, type: "directory", children };
    }
    return { name, type: "file" };
  };

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const data = await searchDocs(query, 20);
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderTree = (node: TreeNode, path: string = "", depth: number = 0) => {
    const currentPath = path ? `${path}/${node.name}` : node.name;
    const isExpanded = expandedDirs.has(currentPath);

    return (
      <div key={currentPath}>
        <button
          onClick={() => node.type === "directory" && toggleDir(currentPath)}
          className={`w-full flex items-center gap-2 px-2 py-1 hover:bg-gray-700/50 rounded text-sm ${
            node.type === "directory" ? "text-blue-400" : "text-gray-400"
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {node.type === "directory" ? (
            <>
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
            </>
          ) : (
            <>
              <span className="w-3" />
              <FileText size={14} />
            </>
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {node.type === "directory" && isExpanded && node.children?.map((child) => renderTree(child, currentPath, depth + 1))}
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <BookOpen size={24} className="text-purple-400" />
          Documentation
        </h1>
        <p className="text-gray-400 mt-1">
          Search project docs and explore the codebase structure.
        </p>
      </div>

      {/* Search */}
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:border-purple-500 focus:outline-none"
            placeholder="Search documentation..."
          />
          <button
            onClick={handleSearch}
            disabled={searching || !query.trim()}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-lg flex items-center gap-2"
          >
            {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            Search
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Search Results */}
        <div className="lg:col-span-2 space-y-4">
          {results.length > 0 && (
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-white font-medium mb-3">Search Results ({results.length})</h3>
              <div className="space-y-2">
                {results.map((r, i) => (
                  <div key={i} className="p-3 bg-gray-700/30 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-purple-400 text-sm font-medium">{r.title}</span>
                      <span className="text-xs text-gray-500">Score: {r.score.toFixed(2)}</span>
                    </div>
                    <p className="text-gray-500 text-xs mt-1">{r.path}</p>
                    {r.snippet && <p className="text-gray-400 text-sm mt-2">{r.snippet}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bootstrap Info */}
          {Object.keys(bootstrap).length > 0 && (
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-white font-medium mb-3">System Info</h3>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(bootstrap).slice(0, 8).map(([key, value]) => (
                  <div key={key} className="p-2 bg-gray-700/30 rounded">
                    <span className="text-gray-500 text-xs block">{key}</span>
                    <span className="text-white text-sm">{String(value).slice(0, 50)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Project Structure */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-3 flex items-center gap-2">
            <Code size={16} />
            Project Structure
          </h3>
          {structure ? (
            <div className="max-h-96 overflow-y-auto">
              {renderTree(structure)}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Loading structure...</p>
          )}
        </div>
      </div>
    </div>
  );
}
