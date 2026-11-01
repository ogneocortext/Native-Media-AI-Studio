import {
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  staticFile,
} from "remotion";
import { Audio } from "@remotion/media";
import { Interactive } from "remotion";

const music = staticFile("remotion/music/music.mp3");

export const MusicVisualizer: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Simple beat-synced animation without heavy audio analysis
  // Uses sine wave for visual pacing that matches music rhythm
  const beatPhase = (frame / fps) * 2; // 2 Hz beat cycle
  const pulse = Math.abs(Math.sin(beatPhase * Math.PI));
  const scale = interpolate(frame, [0, fps * 9], [0.5, 1.5], {
    easing: Easing.linear,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(frame, [0, fps], [0.2, 1], {
    easing: Easing.linear,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const captionData: { text: string; start: number; end: number }[] = [
    { text: "Native Media AI Studio", start: 0, end: 3 },
    { text: "Audio-reactive visualization powered by Remotion", start: 3, end: 6 },
    { text: "Remotion + React = Music Video Creation", start: 6, end: 9 },
  ];

  const currentCaption = captionData.find(
    (c) => frame / fps >= c.start && frame / fps < c.end
  );

  return (
    <div style={{ width: 1920, height: 1080, backgroundColor: "#0a0a0f" }}>
      <Audio src={music} />

      {/* Background spectrum simulation - pulse bars synced to beat */}
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
          gap: 8,
          padding: 40,
        }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => {
          const barHeight = 100 + pulse * 200 + Math.sin((i + beatPhase) * 1.5) * 100;
          return (
            <Interactive.Div
              key={i}
              name={`bar-${i}`}
              style={{
                flex: 1,
                height: `${Math.max(30, barHeight)}px`,
                backgroundColor: `hsl(${i * 30}, 70%, 60%)`,
          opacity: opacity,
          transform: `scaleY(${1 + pulse})`,
                borderRadius: "4px 4px 0 0",
                transition: "all 0.1s ease-out",
              }}
            />
          );
        })}
      </div>

      {/* Center title */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: `translate(-50%, -50%) scale(${scale}) rotate(${Math.sin(frame / fps) * 5}deg)`,
          fontSize: 72,
          color: "#ffffff",
          fontFamily: "Arial, sans-serif",
          fontWeight: "bold",
          opacity: opacity,
          textAlign: "center",
        }}
      >
        MUSIC VISUALIZER
      </div>

      {/* Captions */}
      {currentCaption && (
        <div
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
            textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
          }}
        >
          {currentCaption.text}
        </div>
      )}
    </div>
  );
};