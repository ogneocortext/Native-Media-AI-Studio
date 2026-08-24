import "./index.css";
import { MyComposition } from "./Composition";
import { StillIRiseComposition, StillIRiseDuration, StillIRiseFps } from "./StillIRise";
import { SiliconDreamsPreview, SiliconDreamsDuration, SiliconDreamsFps } from "./SiliconDreamsPreview";
import { TakeTheCrownComposition, TakeTheCrownDuration, TakeTheCrownFps } from "./TakeTheCrown";
import { Composition } from "remotion";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MyComposition />
      <Composition
        id="StillIRise"
        component={StillIRiseComposition}
        durationInFrames={StillIRiseDuration}
        fps={StillIRiseFps}
        width={1920}
        height={1080}
      />
      <Composition
        id="SiliconDreamsPreview"
        component={SiliconDreamsPreview}
        durationInFrames={SiliconDreamsDuration}
        fps={SiliconDreamsFps}
        width={1920}
        height={1080}
      />
      <Composition
        id="TakeTheCrown"
        component={TakeTheCrownComposition}
        durationInFrames={TakeTheCrownDuration}
        fps={TakeTheCrownFps}
        width={1920}
        height={1080}
      />
    </>
  );
};
