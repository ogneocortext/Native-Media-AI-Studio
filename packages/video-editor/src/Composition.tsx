import {
  AbsoluteFill,
  Audio,
  Composition,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { AudioReactiveVisualizer } from "./components/AudioReactiveVisualizer";

type Props = {
  visualSrc?: string;
  visualStyle?: "bars" | "waveform" | "circular" | "particles";
  colorScheme?: "neon" | "fire" | "ocean" | "monochrome";
};

export const MyComposition = (props: Props) => {
  return (
    <Composition
      id="SignalBreakingThroughNoise"
      component={MyComponent}
      durationInFrames={7269}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{
        visualSrc: "",
        visualStyle: "bars" as const,
        colorScheme: "neon" as const,
      }}
    />
  );
};

export const MyComponent: React.FC<Props> = ({
  visualSrc,
  visualStyle = "bars",
  colorScheme = "neon",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const pulse = 1 + Math.max(0, Math.sin(t * 9.2)) * 0.035;

  const sections = [
    { start: 0, end: 63, name: "VERSE 01", lines: ["I used to stand at the edge of everything I knew", "Watching the old world fade into a different kind of blue", "I drew my maps in silence, traced the lines with borrowed light", "And somewhere in the static I found something worth the fight"] },
    { start: 63, end: 126, name: "VERSE 02", lines: ["The city changed around me and the code rewrote the sky", "But I was learning how to breathe inside the reason why", "Every door that closed behind me opened something new", "I built myself from frequencies I never thought I knew"] },
    { start: 126, end: 146, name: "PRE-CHORUS", lines: ["Now I feel it rising", "Like the current finding ground", "Every wall that held me", "Is the bridge I'm standing on now"] },
    { start: 146, end: 176, name: "CHORUS", lines: ["I am the signal breaking through the noise", "I am the light that finds the dark and makes a choice", "Static in my veins but I am not afraid", "I am the frequency", "I am the frequency"] },
    { start: 176, end: 191, name: "BREAKDOWN", lines: ["Still here", "Still moving", "Still drawing the map", "Still here", "Still moving", "Through the light and back"] },
    { start: 191, end: 211, name: "BUILD-UP", lines: ["Rising", "Rising", "Let it break through", "Rising", "Rising", "Let it take you"] },
    { start: 211, end: 231, name: "CHORUS", lines: ["I am the signal breaking through the noise", "I am the light that finds the dark and makes a choice", "Static in my veins but I am not afraid", "I am the frequency", "I am the frequency"] },
    { start: 231, end: 242.32, name: "FINAL TRANSMISSION", lines: ["The borrowed light became my own, the grief became a song", "And everything I thought I lost was where I still belong", "Not the version that was promised, not the life I thought I'd find", "But something real and present and entirely mine"] },
  ];

  const sec = sections.find((s) => t >= s.start && t < s.end) ?? sections[0];
  const p = (t - sec.start) / (sec.end - sec.start);
  const index = Math.min(sec.lines.length - 1, Math.floor(p * sec.lines.length));
  const lyric = sec.lines[index];
  const glow =
    sec.name.includes("CHORUS") || sec.name.includes("BUILD")
      ? "#ffcf70"
      : "#66e6ff";

  return (
    <AbsoluteFill className="frame" style={{ backgroundColor: "#050810" }}>
      <Audio src={staticFile("signal.mp3")} />

      {/* AI-Generated Visual Background */}
      {visualSrc && (
        <AbsoluteFill style={{ opacity: 0.6, zIndex: 0 }}>
          <Img
            src={visualSrc}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${pulse})`,
            }}
          />
        </AbsoluteFill>
      )}

      {/* Audio-Reactive Visualizer Overlay */}
      <AbsoluteFill style={{ zIndex: 1, mixBlendMode: "screen", opacity: 0.4 }}>
        <AudioReactiveVisualizer
          audioSrc={staticFile("signal.mp3")}
          style={visualStyle}
          colorScheme={colorScheme}
          sensitivity={1.2}
        />
      </AbsoluteFill>

      {/* Effects Layer */}
      <div className="grain" />
      <div
        className="grid"
        style={{ opacity: interpolate(Math.sin(t * 0.5), [-1, 1], [0.16, 0.32]) }}
      />
      <div
        className="aurora"
        style={{
          background: `radial-gradient(circle at ${35 + p * 30}% ${65 - p * 35}%, ${glow}55 0%, transparent 36%)`,
          scale: pulse,
        }}
      />
      <div className="map-lines">
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            className="route"
            style={{
              top: `${12 + i * 8}%`,
              rotate: `${Math.sin(t * 0.25 + i) * 3}deg`,
              translate: `${Math.sin(t * 0.4 + i) * 30}px 0`,
            }}
          />
        ))}
      </div>

      {/* UI Layer */}
      <div
        className="signal-orb"
        style={{
          borderColor: glow,
          boxShadow: `0 0 40px ${glow}88, inset 0 0 28px ${glow}33`,
          scale: pulse,
        }}
      >
        <span />
      </div>
      <div
        className="figure"
        style={{
          translate: `${Math.sin(t * 0.7) * 18}px ${Math.cos(t * 0.45) * 8}px`,
        }}
      >
        <div className="head" />
        <div className="body" />
      </div>
      <div className="hud top">
        <span>TRANSMISSION // 110294196698</span>
        <span>{sec.name}</span>
      </div>
      <div className="hud bottom">
        <span>THE SIGNAL BREAKING THROUGH THE NOISE</span>
        <span>
          CH. 01 / {String(Math.floor(t / 60)).padStart(2, "0")}:
          {String(Math.floor(t % 60)).padStart(2, "0")}
        </span>
      </div>
      <div className="lyrics">
        <div className="eyebrow">
          {sec.name} <i />
        </div>
        <div
          className="lyric"
          style={{ color: glow, textShadow: `0 0 28px ${glow}66` }}
        >
          {lyric}
        </div>
        <div className="progress">
          <div
            style={{
              width: `${((index + 1) / sec.lines.length) * 100}%`,
              backgroundColor: glow,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
