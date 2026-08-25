import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { Dashboard } from "./features/dashboard/Dashboard";
import { HealthPage } from "./features/health/HealthPage";
import { ImageGeneration } from "./features/image-generation/ImageGeneration";
import { MediaLibrary } from "./features/media-library/MediaLibrary";
import { MusicVideoWizard } from "./features/music-video/MusicVideoWizard";
import { Queue } from "./features/queue/Queue";
import { Settings } from "./features/settings/Settings";
import { ThreeJSStudio } from "./features/three-js-studio/ThreeJSStudio";
import { Visualizer } from "./features/visualizer/Visualizer";
import { LogViewer } from "./features/logs/LogViewer";
import { AudioAnalysisPage } from "./features/audio-analysis/AudioAnalysisPage";
import { AIToolsPage } from "./features/ai-tools/AIToolsPage";
import { VideoGenerationPage } from "./features/video-generation/VideoGenerationPage";
import { Generation3DPage } from "./features/generate3d/Generation3DPage";
import { DocsPage } from "./features/docs/DocsPage";
import { StoryboardPage } from "./features/storyboards/StoryboardPage";
import { Preview } from "./features/preview/Preview";
import { NotFound } from "./features/not-found/NotFound";

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/music-video-wizard" element={<MusicVideoWizard />} />
          <Route path="/three-js-studio" element={<ThreeJSStudio />} />
          <Route path="/audio-analysis" element={<AudioAnalysisPage />} />
          <Route path="/video-generation" element={<VideoGenerationPage />} />
          <Route path="/generate-3d" element={<Generation3DPage />} />
          <Route path="/ai-tools" element={<AIToolsPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/storyboards" element={<StoryboardPage />} />
          <Route path="/image-generation" element={<ImageGeneration />} />
          <Route path="/visualizer" element={<Visualizer />} />
          <Route path="/library" element={<MediaLibrary />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/logs" element={<LogViewer />} />
          <Route path="/health" element={<HealthPage />} />
          <Route path="/preview" element={<Preview />} />
          <Route path="/preview/:clipId" element={<Preview />} />
          {/* Redirects for removed/merged routes */}
          <Route path="/music-video" element={<Navigate to="/music-video-wizard" replace />} />
          <Route path="/studio-3d" element={<Navigate to="/generate-3d" replace />} />
          <Route path="/video-editor" element={<Navigate to="/video-generation" replace />} />
          <Route path="/diagnostics" element={<Navigate to="/health" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
