/**
 * Shared file upload zone component with drag-drop support.
 * Reusable across all pages that accept file uploads.
 */

import React from "react";
import { Upload, FileAudio, FileImage, FileVideo, X, AlertCircle } from "lucide-react";

interface FileUploadZoneProps {
  accept?: string;
  multiple?: boolean;
  maxSizeMB?: number;
  file: File | null;
  files: File[];
  isDragging: boolean;
  error: string | null;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenDialog: () => void;
  onClear: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  variant?: "audio" | "image" | "video" | "default";
  title?: string;
  subtitle?: string;
  compact?: boolean;
}

const variantConfig = {
  audio: {
    icon: FileAudio,
    color: "violet",
    defaultTitle: "Drop audio file here",
    defaultSubtitle: "or click to browse • WAV, MP3, FLAC, OGG",
  },
  image: {
    icon: FileImage,
    color: "blue",
    defaultTitle: "Drop image here",
    defaultSubtitle: "or click to browse • PNG, JPG, WebP",
  },
  video: {
    icon: FileVideo,
    color: "amber",
    defaultTitle: "Drop video file here",
    defaultSubtitle: "or click to browse • MP4, WebM, MOV",
  },
  default: {
    icon: Upload,
    color: "primary",
    defaultTitle: "Drop file here",
    defaultSubtitle: "or click to browse",
  },
};

export function FileUploadZone({
  accept,
  multiple,
  file,
  files,
  isDragging,
  error,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileChange,
  onOpenDialog,
  onClear,
  inputRef,
  variant = "default",
  title,
  subtitle,
  compact = false,
}: FileUploadZoneProps) {
  const config = variantConfig[variant];
  const Icon = config.icon;
  const displayFile = file;

  return (
    <div className="file-upload-zone-wrapper">
      <div
        className={`file-upload-zone ${isDragging ? "dragging" : ""} ${compact ? "compact" : ""}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onOpenDialog}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOpenDialog(); }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={onFileChange}
          className="file-upload-input"
          hidden
        />

        {compact ? (
          <div className="file-upload-compact-inner">
            <Icon size={16} className="file-upload-icon" />
            <span className="file-upload-compact-text">
              {displayFile ? displayFile.name : title || config.defaultTitle}
            </span>
          </div>
        ) : (
          <>
            <div className={`file-upload-icon-wrapper ${isDragging ? "dragging" : ""}`}>
              <Icon size={32} className="file-upload-icon" />
            </div>
            <p className="file-upload-title">
              {isDragging ? "Drop to upload" : title || config.defaultTitle}
            </p>
            <p className="file-upload-subtitle">{subtitle || config.defaultSubtitle}</p>
          </>
        )}

        {displayFile && !compact && (
          <div className="file-upload-preview">
            <span className="file-upload-name">{displayFile.name}</span>
            <span className="file-upload-size">
              {(displayFile.size / 1024 / 1024).toFixed(2)} MB
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="file-upload-clear"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {multiple && files.length > 0 && !compact && (
          <div className="file-upload-count">{files.length} file{files.length > 1 ? "s" : ""} selected</div>
        )}
      </div>

      {error && (
        <div className="file-upload-error">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
