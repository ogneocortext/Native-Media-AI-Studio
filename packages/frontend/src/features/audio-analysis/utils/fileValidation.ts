/**
 * fileValidation — validation helpers for audio files
 */
import { isAudioFile } from "../../../utils/audioProbe";

export function validateAudioFile(file: File): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: "No file selected" };
  }

  if (!isAudioFile(file)) {
    return { valid: false, error: "Please select an audio file (MP3, WAV, FLAC, etc.)" };
  }

  // Check file size (max 500MB)
  const MAX_SIZE = 500 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    return { valid: false, error: "File too large (max 500MB)" };
  }

  return { valid: true };
}
