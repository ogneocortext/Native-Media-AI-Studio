/**
 * AudioReactiveVisualizer — Real-time audio visualization using Remotion's APIs.
 * Uses useAudioData and visualizeAudio from @remotion/media-utils.
 */

import { useCurrentFrame, useVideoConfig, Audio, AbsoluteFill } from "remotion";
import {
  useAudioData,
  visualizeAudio,
  visualizeAudioWaveform,
} from "@remotion/media-utils";

interface AudioReactiveVisualizerProps {
  audioSrc: string;
  style?: "bars" | "waveform" | "circular" | "particles";
  colorScheme?: "neon" | "fire" | "ocean" | "monochrome";
  sensitivity?: number;
  smoothing?: boolean;
  className?: string;
}

const COLOR_SCHEMES = {
  neon: ["#00ffff", "#ff00ff", "#ffff00", "#00ff00"],
  fire: ["#ff4500", "#ff6600", "#ffcc00", "#ff0000"],
  ocean: ["#0066ff", "#00ccff", "#00ffcc", "#0033ff"],
  monochrome: ["#ffffff", "#cccccc", "#999999", "#666666"],
};

export function AudioReactiveVisualizer({
  audioSrc,
  style = "bars",
  colorScheme = "neon",
  sensitivity = 1,
  smoothing = true,
  className = "",
}: AudioReactiveVisualizerProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const audioData = useAudioData(audioSrc);

  if (!audioData) {
    return (
      <AbsoluteFill className={className} style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #0a0a0f 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" }}>
          <div style={{ textAlign: "center", color: "#6b7280" }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🔊</div>
            <div style={{ fontSize: 14 }}>Loading audio...</div>
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  const visualization = visualizeAudio({
    fps,
    frame,
    audioData,
    numberOfSamples: style === "waveform" ? 128 : 32,
    smoothing,
  });

  const waveform = visualizeAudioWaveform({
    fps,
    frame,
    audioData,
    numberOfSamples: 64,
    windowInSeconds: 0.1,
  });

  const colors = COLOR_SCHEMES[colorScheme];

  return (
    <AbsoluteFill className={className}>
      <Audio src={audioSrc} />
      {renderVisualization(
        style,
        visualization,
        waveform,
        colors,
        width,
        height,
        sensitivity,
        frame,
        fps
      )}
    </AbsoluteFill>
  );
}

function renderVisualization(
  style: string,
  visualization: number[],
  waveform: number[],
  colors: string[],
  width: number,
  height: number,
  sensitivity: number,
  frame: number,
  fps: number
) {
  switch (style) {
    case "bars":
      return (
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            height: "100%",
            gap: 2,
            padding: "10%",
          }}
        >
          {visualization.map((value, i) => {
            const barHeight = Math.max(0, value * height * 0.4 * sensitivity);
            const colorIndex = Math.floor(
              (i / visualization.length) * colors.length
            );
            return (
              <div
                key={i}
                style={{
                  width: `${100 / visualization.length}%`,
                  maxWidth: 20,
                  height: barHeight,
                  backgroundColor: colors[colorIndex],
                  borderRadius: "2px 2px 0 0",
                  transition: "height 0.05s ease",
                  boxShadow: `0 0 ${10 * value}px ${colors[colorIndex]}`,
                }}
              />
            );
          })}
        </div>
      );

    case "waveform":
      return (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          <path
            d={generateWaveformPath(waveform, width, height, sensitivity)}
            fill="none"
            stroke={colors[0]}
            strokeWidth={3}
            style={{
              filter: `drop-shadow(0 0 8px ${colors[0]})`,
            }}
          />
        </svg>
      );

    case "circular":
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
          }}
        >
          <div
            style={{
              width: Math.min(width, height) * 0.6,
              height: Math.min(width, height) * 0.6,
              position: "relative",
              borderRadius: "50%",
            }}
          >
            {visualization.map((value, i) => {
              const angle = (i / visualization.length) * Math.PI * 2;
              const radius = Math.min(width, height) * 0.25;
              const barLength = value * radius * sensitivity;
              const colorIndex = Math.floor(
                (i / visualization.length) * colors.length
              );
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: 3,
                    height: barLength,
                    backgroundColor: colors[colorIndex],
                    transformOrigin: "top center",
                    transform: `rotate(${angle}rad)`,
                    borderRadius: 2,
                    boxShadow: `0 0 ${8 * value}px ${colors[colorIndex]}`,
                  }}
                />
              );
            })}
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: 40,
                height: 40,
                borderRadius: "50%",
                backgroundColor: colors[0],
                boxShadow: `0 0 20px ${colors[0]}`,
              }}
            />
          </div>
        </div>
      );

    case "particles":
      return (
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          {visualization.map((value, i) => {
            const x = (i / visualization.length) * width;
            const y = height / 2 + (value - 0.5) * height * 0.5 * sensitivity;
            const size = 5 + value * 20 * sensitivity;
            const colorIndex = Math.floor(
              (i / visualization.length) * colors.length
            );
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: x,
                  top: y,
                  width: size,
                  height: size,
                  borderRadius: "50%",
                  backgroundColor: colors[colorIndex],
                  opacity: 0.7,
                  boxShadow: `0 0 ${15 * value}px ${colors[colorIndex]}`,
                }}
              />
            );
          })}
        </div>
      );

    default:
      // Default to bars visualization for unknown styles
      return (
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          {visualization.map((value: number, i: number) => {
            const barWidth = (width / visualization.length) * 0.8;
            const barHeight = value * height * sensitivity * 0.8;
            const x = (i / visualization.length) * width;
            const y = height - barHeight;
            const color = colors[Math.floor((i / visualization.length) * colors.length)];
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: x,
                  top: y,
                  width: barWidth,
                  height: barHeight,
                  backgroundColor: color,
                  borderRadius: barWidth / 2,
                  boxShadow: `0 0 ${10 * value}px ${color}`,
                }}
              />
            );
          })}
        </div>
      );
  }
}

function generateWaveformPath(
  waveform: number[],
  width: number,
  height: number,
  sensitivity: number
): string {
  const centerY = height / 2;
  const points: string[] = [];

  for (let i = 0; i < waveform.length; i++) {
    const x = (i / (waveform.length - 1)) * width;
    const amplitude = waveform[i] * (height / 3) * sensitivity;
    points.push(`${x},${centerY - amplitude}`);
  }

  for (let i = waveform.length - 1; i >= 0; i--) {
    const x = (i / (waveform.length - 1)) * width;
    const amplitude = waveform[i] * (height / 3) * sensitivity;
    points.push(`${x},${centerY + amplitude}`);
  }

  return `M ${points.join(" L ")} Z`;
}

export default AudioReactiveVisualizer;
