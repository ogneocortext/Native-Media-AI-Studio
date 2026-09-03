import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { Layout } from "./components/layout/Layout";
import { Dashboard } from "./features/dashboard/Dashboard";
import { Queue } from "./features/queue/Queue";
import { Settings } from "./features/settings/Settings";
import { LogViewer } from "./features/logs/LogViewer";
import { NotFound } from "./features/not-found/NotFound";
import { ErrorBoundary } from "./components/common";
import { ToastProvider } from "./components/common/Toast";
import { DebugPanel } from "./components/debug/DebugPanel";

// Helper for lazy loading modules with named exports
const lazyNamed = (modulePromise: Promise<{ [key: string]: any }>, name: string) =>
  lazy(() => modulePromise.then(m => ({ default: m[name] as any })));

// Heavy pages loaded on-demand
const HealthPage = lazyNamed(import("./features/health/HealthPage"), "HealthPage");
const ImageGeneration = lazyNamed(import("./features/image-generation/ImageGeneration"), "ImageGeneration");
const MediaLibrary = lazyNamed(import("./features/media-library/MediaLibrary"), "MediaLibrary");
const MusicVideoWizard = lazyNamed(import("./features/music-video/MusicVideoWizard"), "MusicVideoWizard");
const ThreeJSStudio = lazyNamed(import("./features/three-js-studio/ThreeJSStudio"), "ThreeJSStudio");
const Visualizer = lazyNamed(import("./features/visualizer/Visualizer"), "Visualizer");
const AudioAnalysisPage = lazyNamed(import("./features/audio-analysis/AudioAnalysisPage"), "AudioAnalysisPage");
const AIToolsPage = lazyNamed(import("./features/ai-tools/AIToolsPage"), "AIToolsPage");
const VideoGenerationPage = lazyNamed(import("./features/video-generation/VideoGenerationPage"), "VideoGenerationPage");
const Generation3DPage = lazyNamed(import("./features/generate3d/Generation3DPage"), "Generation3DPage");
const DocsPage = lazyNamed(import("./features/docs/DocsPage"), "DocsPage");
const StoryboardPage = lazyNamed(import("./features/storyboards/StoryboardPage"), "StoryboardPage");
const KineticTypographyPage = lazyNamed(import("./features/kinetic-typography/KineticTypographyPage"), "KineticTypographyPage");
const Preview = lazyNamed(import("./features/preview/Preview"), "Preview");

function App() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "D") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("debug-panel-toggle"));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <ToastProvider>
      <BrowserRouter>
        <Layout>
          <Suspense fallback={null}>
            <Routes>
            <Route path="/" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
            <Route path="/queue" element={<ErrorBoundary><Queue /></ErrorBoundary>} />
            <Route path="/music-video-wizard" element={<ErrorBoundary><MusicVideoWizard /></ErrorBoundary>} />
            <Route path="/three-js-studio" element={<ErrorBoundary><ThreeJSStudio /></ErrorBoundary>} />
            <Route path="/audio-analysis" element={<ErrorBoundary><AudioAnalysisPage /></ErrorBoundary>} />
            <Route path="/video-generation" element={<ErrorBoundary><VideoGenerationPage /></ErrorBoundary>} />
            <Route path="/generate-3d" element={<ErrorBoundary><Generation3DPage /></ErrorBoundary>} />
            <Route path="/ai-tools" element={<ErrorBoundary><AIToolsPage /></ErrorBoundary>} />
            <Route path="/docs" element={<ErrorBoundary><DocsPage /></ErrorBoundary>} />
            <Route path="/storyboards" element={<ErrorBoundary><StoryboardPage /></ErrorBoundary>} />
            <Route path="/image-generation" element={<ErrorBoundary><ImageGeneration /></ErrorBoundary>} />
            <Route path="/visualizer" element={<ErrorBoundary><Visualizer /></ErrorBoundary>} />
            <Route path="/library" element={<ErrorBoundary><MediaLibrary /></ErrorBoundary>} />
            <Route path="/settings" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
            <Route path="/logs" element={<ErrorBoundary><LogViewer /></ErrorBoundary>} />
            <Route path="/health" element={<ErrorBoundary><HealthPage /></ErrorBoundary>} />
            <Route path="/kinetic-typography" element={<ErrorBoundary><KineticTypographyPage /></ErrorBoundary>} />
            <Route path="/preview" element={<ErrorBoundary><Preview /></ErrorBoundary>} />
            <Route path="/preview/:clipId" element={<ErrorBoundary><Preview /></ErrorBoundary>} />
            {/* Redirects for removed/merged routes */}
            <Route path="/music-video" element={<Navigate to="/music-video-wizard" replace />} />
            <Route path="/studio-3d" element={<Navigate to="/generate-3d" replace />} />
            <Route path="/video-editor" element={<Navigate to="/video-generation" replace />} />
            <Route path="/diagnostics" element={<Navigate to="/health" replace />} />
            <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </Layout>
      </BrowserRouter>
      <DebugPanel />
    </ToastProvider>
  );
}

export default App;
