/**
 * TrashPanel — soft-delete trash. Shows trashed media items with restore /
 * purge actions and an empty-trash option.
 */
import { useState } from "react";
import { RefreshCw, Clock, AlertTriangle } from "lucide-react";
import type { TrashItem } from "../../../services/api";

interface TrashPanelProps {
  isOpen: boolean;
  onClose: () => void;
  trash: TrashItem[];
  restoreTrashItem: (relativePath: string) => void;
  purgeTrashItem: (relativePath: string) => void;
  emptyTrash: () => void;
  refetchOrg: () => void;
}

export function TrashPanel({
  isOpen,
  onClose,
  trash,
  restoreTrashItem,
  purgeTrashItem,
  emptyTrash,
  refetchOrg,
}: TrashPanelProps) {
  if (!isOpen) return null;

  const [emptying, setEmptying] = useState(false);

  const handleEmpty = async () => {
    if (!window.confirm("Empty the trash? This cannot be undone.")) return;
    setEmptying(true);
    try {
      await emptyTrash();
      await refetchOrg();
    } finally {
      setEmptying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Trash"
    >
      <div
        className="bg-black/90 border border-white/10 rounded-xl max-w-lg w-full max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Trash2Icon size={20} className="text-red-400" />
            Trash
          </h3>
          <button
            onClick={onClose}
            className="text-muted hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-4 text-xs text-muted">
          Items here were soft-deleted and can be restored. Use Purge to
          permanently remove a trash record.
        </div>

        {trash.length === 0 ? (
          <div className="p-8 text-center text-muted">
            <Clock size={32} className="mx-auto mb-2 opacity-50" />
            <p>Trash is empty</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {trash.map((item) => (
              <div
                key={item.relative_path}
                className="p-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3 flex-1">
                  <div className="text-xs text-muted">{item.file_type}</div>
                  <div className="text-sm font-medium text-white truncate">
                    {item.relative_path}
                  </div>
                  <div className="text-xs text-gray-500 ml-auto">
                    <Clock size={12} className="mr-1" />
                    {new Date(item.deleted_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      restoreTrashItem(item.relative_path);
                      void refetchOrg();
                    }}
                    className="text-xs text-green-400 hover:text-green-300"
                  >
                    Restore
                  </button>
                  <button
                    onClick={() => {
                      purgeTrashItem(item.relative_path);
                      void refetchOrg();
                    }}
                    className="text-xs text-red-500 hover:text-red-300"
                  >
                    Purge
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {trash.length > 0 && (
          <div className="p-4 border-t border-white/10 flex justify-between items-center">
            <button
              onClick={handleEmpty}
              disabled={emptying}
              className="px-3 py-1 text-xs bg-red-900/30 border border-red-700 rounded text-red-300 hover:bg-red-800/50 disabled:opacity-50"
            >
              {emptying ? (
                <span className="flex items-center gap-1">
                  <RefreshCw size={12} className="animate-spin" />
                  Emptying…
                </span>
              ) : (
                <>
                  <AlertTriangle size={14} /> Empty Trash
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Trash2Icon({ size, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
