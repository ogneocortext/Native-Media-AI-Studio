/**
 * DuplicatesPanel — shows exact-duplicate groups and offers "Keep oldest,
 * delete the rest" via bulk delete.
 */
import { useCallback, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { fetchWithTimeout } from "../../../services/fetchWithTimeout";

interface DuplicateGroup {
  hash: string;
  files: string[]; // relative paths
  wasted_bytes: number;
}

interface DuplicatesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onRefetch: () => void;
}

export function DuplicatesPanel({
  isOpen,
  onClose,
  onRefetch,
}: DuplicatesPanelProps) {
  if (!isOpen) return null;

  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const findDuplicates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithTimeout("/api/outputs/duplicates/groups?quick=true", {
        timeout: 30000,
      });
      if (!res.ok) throw new Error(`duplicates ${res.status}`);
      const data: DuplicateGroup[] = await res.json();
      setGroups(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Duplicate scan failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const keepOldestDeleteRest = useCallback(
    (group: DuplicateGroup) => {
      // Keep oldest (index 0), delete the rest
      const toDelete = group.files.slice(1);
      setDeleting(true);
      void fetchWithTimeout("/api/outputs/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: toDelete }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`bulk-delete ${res.status}`);
          await onRefetch();
          await findDuplicates();
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : "Duplicate cleanup failed");
        })
        .finally(() => setDeleting(false));
    },
    [onRefetch, findDuplicates]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  const totalWasted = groups.reduce((sum, g) => sum + g.wasted_bytes, 0);

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Duplicate groups"
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-black/90 border border-white/10 rounded-xl max-w-lg w-full max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <AlertTriangle size={20} className="text-yellow-400" />
            Duplicate Groups
          </h3>
          <button
            onClick={onClose}
            className="text-muted hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {loading && (
          <div className="p-8 text-center text-muted">Scanning for duplicates…</div>
        )}

        {!loading && groups.length === 0 && (
          <div className="p-8 text-center text-muted">
            No exact duplicates found.
          </div>
        )}

        {!loading && groups.length > 0 && (
          <div className="p-4 space-y-3">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-semibold text-muted">
                {groups.length} group{groups.length !== 1 ? "s" : " found"}
              </span>
              <span className="text-xs text-yellow-400 font-mono">
                {totalWasted} bytes wasted
              </span>
            </div>

            {groups.map((group, gi) => (
              <div
                key={gi}
                className="border border-white/10 rounded-lg p-3 bg-black/40"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className="text-xs text-yellow-400 font-mono">
                      #{group.hash.slice(0, 12)}
                    </span>
                    <span className="ml-2 text-xs text-muted">
                      • {group.files.length} files
                    </span>
                  </div>
                  <button
                    onClick={() => keepOldestDeleteRest(group)}
                    disabled={deleting}
                    className="text-xs bg-violet-600/30 text-violet-300 hover:bg-violet-600 px-2 py-1 rounded border border-violet-500/40 disabled:opacity-50"
                  >
                    {deleting ? (
                      <span className="flex items-center gap-1">
                        <X size={10} className="animate-spin" />
                      </span>
                    ) : (
                      "Keep oldest, delete rest"
                    )}
                  </button>
                </div>
                <div className="text-xs text-gray-400 space-y-1 ml-4">
                  {group.files.map((fp, fi) => (
                    <div
                      key={fi}
                      className="flex items-center gap-2 truncate"
                      title={fp}
                    >
                      {fi === 0 ? (
                        <span className="text-green-400 text-[10px]">▸ keep</span>
                      ) : (
                        <span className="text-red-400 text-[10px]">✕ delete</span>
                      )}
                      <span className="truncate">{fp}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="mt-4 pt-4 border-t border-white/10">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-black/30 text-muted rounded hover:text-white"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-900/30 border border-red-700 rounded text-red-300 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
