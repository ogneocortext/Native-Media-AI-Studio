/**
 * Shared file upload hook with drag-drop support.
 * Used across all pages that accept file uploads.
 *
 * Additions: MIME/extension validation, optional audio probing
 * (duration via decodeAudioData), and XHR upload with progress + cancel
 * (fetch has no upload-progress events).
 */

import type React from "react";
import { useState, useCallback, useRef } from "react";
import { isAudioFile, probeAudioFile, type AudioProbeResult } from "../utils/audioProbe";

interface UseFileUploadOptions {
  accept?: string;
  multiple?: boolean;
  maxSizeMB?: number;
  /** When true, decode audio headers to surface duration/corruption early. */
  probeAudio?: boolean;
  kind?: "audio" | "image" | "video" | "any";
  onFileSelected?: (file: File) => void;
  onError?: (error: string) => void;
}

interface UseFileUploadReturn {
  file: File | null;
  files: File[];
  isDragging: boolean;
  error: string | null;
  probing: boolean;
  audioMeta: AudioProbeResult | null;
  uploadProgress: number | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handlePaste: (e: React.ClipboardEvent) => void;
  openFileDialog: () => void;
  clearFiles: () => void;
  setFiles: (files: File[]) => void;
  uploadWithProgress: (url: string, fileToUpload: File, fieldName?: string, extraFields?: Record<string, string>) => Promise<Response>;
  cancelUpload: () => void;
}

export function useFileUpload(options: UseFileUploadOptions = {}): UseFileUploadReturn {
  const {
    accept,
    multiple = false,
    maxSizeMB = 100,
    probeAudio = false,
    kind = "any",
    onFileSelected,
    onError,
  } = options;

  const [file, setFile] = useState<File | null>(null);
  const [files, setFilesState] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [audioMeta, setAudioMeta] = useState<AudioProbeResult | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragCounter = useRef(0);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const fail = useCallback((msg: string) => {
    setError(msg);
    onError?.(msg);
  }, [onError]);

  const validateFile = useCallback(
    (f: File): string | null => {
      if (maxSizeMB && f.size > maxSizeMB * 1024 * 1024) {
        return `File "${f.name}" exceeds ${maxSizeMB}MB limit (${(f.size / 1024 / 1024).toFixed(1)}MB)`;
      }
      if (f.size === 0) return `File "${f.name}" is empty`;
      if (kind === "audio" && !isAudioFile(f, accept)) {
        return `"${f.name}" is not an audio file (MP3, WAV, FLAC, OGG, M4A)`;
      }
      return null;
    },
    [maxSizeMB, kind, accept]
  );

  const runProbe = useCallback(async (f: File) => {
    if (!probeAudio || kind !== "audio") {
      setAudioMeta(null);
      return;
    }
    setProbing(true);
    try {
      const meta = await probeAudioFile(f);
      setAudioMeta(meta);
      if (meta.durationSeconds !== null && meta.durationSeconds < 1) {
        fail(`"${f.name}" decoded to ${meta.durationSeconds.toFixed(2)}s — file looks corrupt`);
      }
    } finally {
      setProbing(false);
    }
  }, [probeAudio, kind, fail]);

  const commitFiles = useCallback((valid: File[]) => {
    if (valid.length === 0) return;
    if (multiple) {
      setFilesState(valid);
      if (valid.length === 1) {
        setFile(valid[0]);
        onFileSelected?.(valid[0]);
        void runProbe(valid[0]);
      } else {
        setAudioMeta(null);
      }
    } else {
      setFile(valid[0]);
      onFileSelected?.(valid[0]);
      void runProbe(valid[0]);
    }
  }, [multiple, onFileSelected, runProbe]);

  const processFiles = useCallback(
    (fileList: FileList | File[] | null) => {
      if (!fileList || fileList.length === 0) return;

      const valid: File[] = [];
      let firstError: string | null = null;

      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        const validationError = validateFile(f);
        if (validationError) {
          if (!firstError) firstError = validationError;
        } else {
          valid.push(f);
        }
        if (!multiple && valid.length >= 1) break;
      }

      if (firstError) {
        fail(firstError);
      } else {
        setError(null);
      }

      commitFiles(valid);
    },
    [multiple, validateFile, commitFiles, fail]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragEnter = useCallback((_e: React.DragEvent) => {
    dragCounter.current += 1;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragging(false);
      processFiles(e.dataTransfer.files);
    },
    [processFiles]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      processFiles(e.target.files);
    },
    [processFiles]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (pasted.length > 0) {
        e.preventDefault();
        processFiles(pasted);
      }
    },
    [processFiles]
  );

  const openFileDialog = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const clearFiles = useCallback(() => {
    cancelUploadSafe();
    setFile(null);
    setFilesState([]);
    setError(null);
    setAudioMeta(null);
    setUploadProgress(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const setFiles = useCallback((newFiles: File[]) => {
    setFilesState(newFiles);
    if (newFiles.length === 1) setFile(newFiles[0]);
  }, []);

  const cancelUploadSafe = () => {
    xhrRef.current?.abort();
    xhrRef.current = null;
    setUploadProgress(null);
  };

  const cancelUpload = useCallback(() => {
    cancelUploadSafe();
  }, []);

  /** POST multipart with progress (0-100). Rejects on abort or HTTP error. */
  const uploadWithProgress = useCallback(
    (url: string, fileToUpload: File, fieldName = "file", extraFields?: Record<string, string>) => {
      cancelUploadSafe();
      setUploadProgress(0);
      return new Promise<Response>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open("POST", url);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () => {
          xhrRef.current = null;
          setUploadProgress(100);
          resolve(new Response(xhr.responseText, { status: xhr.status, statusText: xhr.statusText }));
        };
        xhr.onerror = () => {
          xhrRef.current = null;
          setUploadProgress(null);
          reject(new Error("Upload failed (network error)"));
        };
        xhr.onabort = () => {
          xhrRef.current = null;
          setUploadProgress(null);
          reject(new DOMException("Upload cancelled", "AbortError"));
        };
        const form = new FormData();
        form.append(fieldName, fileToUpload, fileToUpload.name);
        if (extraFields) {
          for (const [k, v] of Object.entries(extraFields)) form.append(k, v);
        }
        xhr.send(form);
      });
    },
    []
  );

  return {
    file,
    files,
    isDragging,
    error,
    probing,
    audioMeta,
    uploadProgress,
    inputRef,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handleFileChange,
    handlePaste,
    openFileDialog,
    clearFiles,
    setFiles,
    uploadWithProgress,
    cancelUpload,
  };
}

// Attach drag-enter tracking: consumers spread handleDragOver/Leave/Drop;
// enter events bubble through handleDragOver — export helper for completeness.
export type { UseFileUploadOptions };
