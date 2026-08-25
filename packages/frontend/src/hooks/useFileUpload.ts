/**
 * Shared file upload hook with drag-drop support.
 * Used across all pages that accept file uploads.
 */

import { useState, useCallback, useRef } from "react";

interface UseFileUploadOptions {
  accept?: string;
  multiple?: boolean;
  maxSizeMB?: number;
  onFileSelected?: (file: File) => void;
  onError?: (error: string) => void;
}

interface UseFileUploadReturn {
  file: File | null;
  files: File[];
  isDragging: boolean;
  error: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  openFileDialog: () => void;
  clearFiles: () => void;
  setFiles: (files: File[]) => void;
}

export function useFileUpload(options: UseFileUploadOptions = {}): UseFileUploadReturn {
  const {
    multiple = false,
    maxSizeMB = 100,
    onFileSelected,
    onError,
  } = options;

  const [file, setFile] = useState<File | null>(null);
  const [files, setFilesState] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const validateFile = useCallback(
    (f: File): string | null => {
      if (maxSizeMB && f.size > maxSizeMB * 1024 * 1024) {
        return `File "${f.name}" exceeds ${maxSizeMB}MB limit (${(f.size / 1024 / 1024).toFixed(1)}MB)`;
      }
      return null;
    },
    [maxSizeMB]
  );

  const processFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;

      const newFiles: File[] = [];
      let firstError: string | null = null;

      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        const validationError = validateFile(f);
        if (validationError) {
          if (!firstError) firstError = validationError;
        } else {
          newFiles.push(f);
        }
      }

      if (firstError) {
        setError(firstError);
        onError?.(firstError);
      } else {
        setError(null);
      }

      if (newFiles.length > 0) {
        if (multiple) {
          setFilesState(newFiles);
        } else {
          setFile(newFiles[0]);
          onFileSelected?.(newFiles[0]);
        }
      }
    },
    [multiple, validateFile, onFileSelected, onError]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
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

  const openFileDialog = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const clearFiles = useCallback(() => {
    setFile(null);
    setFilesState([]);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const setFiles = useCallback((newFiles: File[]) => {
    setFilesState(newFiles);
    if (newFiles.length === 1) setFile(newFiles[0]);
  }, []);

  return {
    file,
    files,
    isDragging,
    error,
    inputRef,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileChange,
    openFileDialog,
    clearFiles,
    setFiles,
  };
}
