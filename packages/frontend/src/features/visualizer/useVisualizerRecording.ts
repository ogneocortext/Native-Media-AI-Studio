/**
 * Canvas capture for the visualizer stage.
 *
 * Prefers MP4 via WebCodecs when the H.264 profile is actually encodable,
 * and falls back to MediaRecorder/WebM otherwise. `canRecordMp4` probes the
 * config — WebCodecs merely existing does not mean the profile is available.
 *
 * Extracted from Visualizer.tsx — no logic changed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { canRecordMp4, createMp4Recorder } from "./mp4Recording";

export interface VisualizerRecording {
  isRecording: boolean;
  recordingTime: number;
  recordedBlob: Blob | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  downloadRecording: () => void;
  /** Teardown for an in-flight recorder — call on unmount / track change. */
  dispose: () => void;
}

export function useVisualizerRecording(
  canvasHostRef: React.RefObject<HTMLDivElement | null>,
  onError: (message: string) => void,
): VisualizerRecording {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mp4RecorderRef = useRef<ReturnType<typeof createMp4Recorder> | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingFormatRef = useRef<"webm" | "mp4">("webm");

  const clearTimer = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    recordingTimerRef.current = setInterval(() => setRecordingTime((p) => p + 1), 1000);
  }, []);

  const dispose = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (mp4RecorderRef.current) {
      // Flush + mux is async now; fire-and-forget on unmount (the buffer is
      // unusable once the page is going away anyway).
      void mp4RecorderRef.current.stop().catch(() => undefined);
    }
    clearTimer();
  }, [clearTimer]);

  const startRecording = useCallback(async () => {
    const canvas = canvasHostRef.current?.querySelector("canvas") ?? null;
    if (!canvas) {
      onError("Recording failed — no visualizer canvas found");
      return;
    }
    try {
      // Prefer MP4 via WebCodecs when available; fall back to MediaRecorder/WebM.
      // `canRecordMp4` actually probes the H.264 config — WebCodecs existing does
      // not mean this profile is encodable.
      const useMp4 = await canRecordMp4(canvas.width, canvas.height);
      recordingFormatRef.current = useMp4 ? "mp4" : "webm";

      if (useMp4) {
        const recorder = createMp4Recorder({ bitrate: 8_000_000, fps: 60 });
        recorder.start(canvas);
        mp4RecorderRef.current = recorder;
        setRecordedBlob(null);
        setIsRecording(true);
        startTimer();
        return;
      }

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const mediaRecorder = new MediaRecorder(canvas.captureStream(60), {
        mimeType,
        videoBitsPerSecond: 8000000,
      });
      recordedChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = () => {
        setRecordedBlob(new Blob(recordedChunksRef.current, { type: "video/webm" }));
      };
      mediaRecorder.start(100);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      startTimer();
    } catch (e) {
      onError(e instanceof Error ? `Recording failed — ${e.message}` : "Recording failed");
    }
  }, [canvasHostRef, onError, startTimer]);

  const stopRecording = useCallback(async () => {
    const fmt = recordingFormatRef.current;

    if (fmt === "mp4") {
      const recorder = mp4RecorderRef.current;
      mp4RecorderRef.current = null;
      setIsRecording(false);
      clearTimer();
      if (recorder) {
        // Await the encoder flush: the tail frames only reach the muxer after the
        // flush resolves (see mp4Recording.ts).
        try {
          const buffer = await recorder.stop();
          if (buffer) setRecordedBlob(new Blob([buffer], { type: "video/mp4" }));
          else onError("MP4 export produced no data — try WebM (see console)");
        } catch (e) {
          onError(e instanceof Error ? `MP4 export failed — ${e.message}` : "MP4 export failed");
        }
      }
      return;
    }

    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    clearTimer();
  }, [clearTimer, onError]);

  const downloadRecording = useCallback(() => {
    if (!recordedBlob) return;
    const ext = recordingFormatRef.current;
    const a = document.createElement("a");
    const url = URL.createObjectURL(recordedBlob);
    a.href = url;
    a.download = `visualizer_${Date.now()}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [recordedBlob]);

  // Never leave a recorder or timer running past unmount.
  useEffect(() => dispose, [dispose]);

  return {
    isRecording,
    recordingTime,
    recordedBlob,
    startRecording,
    stopRecording,
    downloadRecording,
    dispose,
  };
}
