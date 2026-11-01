import {
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  staticFile,
} from "remotion";
import { Audio } from "@remotion/media";
import { useAudioData, visualizeAudio } from "@remotion/media-utils";
import { Interactive } from "remotion";
import { BasicCaptions } from "@remotion/captions";
import type { Caption } from "@remotion/captions";

const music = staticFile("remotion/music/music.mp3");

export const MusicVisualizer: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const audioData = useAudioData(music);

  if (!audioData || !audioData.channelData || audioData.channelData.length === 0) {
    return (
      <div style={{ width: 1920, height: 1080, backgroundColor: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 48, color: "#0b84ff", fontFamily: "Arial, sans-serif", fontWeight: "bold" }}>
          Loading audio...
        </div>
      </div>
    );
  }

  const frequencies = visualizeAudio({
    fps,
    frame,
    audioData,
    numberOfSamples: 24,
    optimizeFor: "speed",
  });

  const globalScale = interpolate(frame, [0, fps], [0.6, 1], {
    easing: Easing.linear,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const globalOpacity = interpolate(frame, [0, fps], [0.2, 1], {
    easing: Easing.linear,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const captionData: Caption[] = [
    { text: "Native Media AI Studio", startMs: 0, endMs: 3000, timestampMs: 0, confidence: 1 },
    { text: "Audio-reactive visualization powered by Remotion", startMs: 3000, endMs: 6000, timestampMs: 3000, confidence: 1 },
    { text: "Remotion + React = Music Video Creation", startMs: 6000, endMs: 9000, timestampMs: 6000, confidence: 1 },
  ];

  return (
    <div style={{ width: 1920, height: 1080, backgroundColor: "#0a0a0f" }}>
      <Audio src={music} />

      {/* Background spectrum bars */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 6,
          padding: 40,
        }}
      >
        {frequencies.map((v, i) => (
          <Interactive.Div
            key={i}
            name={`bar-${i}`}
            style={{
              flex: 1,
              height: `${Math.max(50, v * 600)}px`,
              backgroundColor: `hsl(${i * 12}, 70%, 60%)`,
              opacity: globalOpacity,
              transform: `scaleY(${globalScale})`,
              borderRadius: "4px 4px 0 0",
            }}
          />
        ))}
      </div>

      {/* Center title */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: `translate(-50%, -50%) scale(${globalScale}) rotate(${interpolate(frame, [0, fps], [0, 15], {
            easing: Easing.linear,
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}deg)`,
          fontSize: 72,
          color: "#ffffff",
          fontFamily: "Arial, sans-serif",
          fontWeight: "bold",
          opacity: globalOpacity,
          textAlign: "center",
        }}
      >
        MUSIC VISUALIZER
      </div>

      {/* Captions */}
      <BasicCaptions
        name="main-captions"
        captions={captionData}
        width={1200}
        style={{
          position: "absolute",
          bottom: 120,
          left: "50%",
          transform: "translateX(-50%)",
          color: "#ffffff",
          textAlign: "center",
          fontSize: 48,
          fontFamily: "Arial, sans-serif",
          fontWeight: "bold",
          WebkitTextStroke: "2px black",
          paintOrder: "stroke",
        }}
      />
    </div>
  );
};