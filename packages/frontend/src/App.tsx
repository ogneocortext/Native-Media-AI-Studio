import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { Dashboard } from "./features/dashboard/Dashboard";
import { Documentation } from "./features/docs/Documentation";
import { HealthPage } from "./features/health/HealthPage";
import { ImageGeneration } from "./features/image-generation/ImageGeneration";
import { MediaLibrary } from "./features/media-library/MediaLibrary";
import { MusicVideo } from "./features/music-video/MusicVideo";
import { MusicVideoWizard } from "./features/music-video/MusicVideoWizard";
import { Queue } from "./features/queue/Queue";
import { Settings } from "./features/settings/Settings";
import { Studio3D } from "./features/studio3d/Studio3D";
import { ThreeJSStudio } from "./features/three-js-studio/ThreeJSStudio";
import { Visualizer } from "./features/visualizer/Visualizer";
import { ArtDirection } from "./features/art-direction/ArtDirection";
import { VideoEditor } from "./features/video-editor/VideoEditor";
import { LogViewer } from "./features/logs/LogViewer";
import { SystemDiagnosticsPage } from "./features/diagnostics/SystemDiagnosticsPage";
import { AudioAnalysisPage } from "./features/audio-analysis/AudioAnalysisPage";
import { AIToolsPage } from "./features/ai-tools/AIToolsPage";
import { VideoGenerationPage } from "./features/video-generation/VideoGenerationPage";
import { Generation3DPage } from "./features/generate3d/Generation3DPage";
import { DocsPage } from "./features/docs/DocsPage";
import { StoryboardPage } from "./features/storyboards/StoryboardPage";
import { Preview } from "./features/preview/Preview";

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/music-video" element={<MusicVideo />} />
          <Route path="/music-video-wizard" element={<MusicVideoWizard />} />
          <Route path="/studio-3d" element={<Studio3D />} />
          <Route path="/three-js-studio" element={<ThreeJSStudio />} />
          <Route path="/audio-analysis" element={<AudioAnalysisPage />} />
          <Route path="/video-generation" element={<VideoGenerationPage />} />
          <Route path="/generate-3d" element={<Generation3DPage />} />
          <Route path="/ai-tools" element={<AIToolsPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/storyboards" element={<StoryboardPage />} />
          <Route path="/diagnostics" element={<SystemDiagnosticsPage />} />
          <Route path="/image-generation" element={<ImageGeneration />} />
          <Route path="/visualizer" element={<Visualizer />} />
          <Route path="/library" element={<MediaLibrary />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/art-direction" element={<ArtDirection />} />
          <Route path="/video-editor" element={<VideoEditor />} />
          <Route path="/logs" element={<LogViewer />} />
          <Route path="/health" element={<HealthPage />} />
          <Route path="/preview" element={<Preview />} />
          <Route path="/preview/:clipId" element={<Preview />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
