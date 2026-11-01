import { Composition } from "remotion";
import { MusicVisualizer } from "./Composition";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="MusicVisualizer"
      component={MusicVisualizer}
      durationInFrames={270}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{}}
    />
  );
};