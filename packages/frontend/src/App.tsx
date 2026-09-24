import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { Layout } from "./components/layout/Layout";
import { Dashboard } from "./features/dashboard/Dashboard";
import { Queue } from "./features/queue/Queue";
import { Settings } from "./features/settings/Settings";
import { NotFound } from "./features/not-found/NotFound";
import { ErrorBoundary, PageLoader } from "./components/common";
import { DebugPanel } from "./components/debug/DebugPanel";

// Helper for lazy loading modules with named exports.
// Retries once on transient network/HMR failures. A rejected import promise is
// permanently rejected, so retries must call the dynamic-import factory again.
const loadNamedModule = async (
  loadModule: () => Promise<Record<string, unknown>>,
  name: string,
  retries = 1,
): Promise<{ default: unknown }> => {
  try {
    const module = await loadModule();
    return { default: module[name] as unknown };
  } catch (error) {
    if (retries <= 0) throw error;
    await new Promise(resolve => setTimeout(resolve, 150));
    return loadNamedModule(loadModule, name, retries - 1);
  }
};

const lazyNamed = (
  loadModule: () => Promise<Record<string, unknown>>,
  name: string,
) =>
  lazy(() =>
    loadNamedModule(loadModule, name).then(module => ({
      default: module.default as React.LazyExoticComponent<React.ComponentType<unknown>>,
    }))
  );

// Heavy pages loaded on-demand
const HealthPage = lazyNamed(() => import("./features/health/HealthPage"), "HealthPage");
const ImageGeneration = lazyNamed(() => import("./features/image-generation/ImageGeneration"), "ImageGeneration");
const MediaLibrary = lazyNamed(() => import("./features/media-library/MediaLibrary"), "MediaLibrary");
const MusicVideoWizard = lazyNamed(() => import("./features/music-video/MusicVideoWizard"), "MusicVideoWizard");
const ThreeJSStudio = lazyNamed(() => import("./features/three-js-studio/ThreeJSStudio"), "ThreeJSStudio");
const Visualizer = lazyNamed(() => import("./features/visualizer/Visualizer"), "Visualizer");
const AudioAnalysisPage = lazyNamed(() => import("./features/audio-analysis/AudioAnalysisPage"), "AudioAnalysisPage");
const AIToolsPage = lazyNamed(() => import("./features/ai-tools/AIToolsPage"), "AIToolsPage");
const VideoGenerationPage = lazyNamed(() => import("./features/video-generation/VideoGenerationPage"), "VideoGenerationPage");
const Generation3DPage = lazyNamed(() => import("./features/generate3d/Generation3DPage"), "Generation3DPage");
const DocsPage = lazyNamed(() => import("./features/docs/DocsPage"), "DocsPage");
const StoryboardPage = lazyNamed(() => import("./features/storyboards/StoryboardPage"), "StoryboardPage");
const KineticTypographyPage = lazyNamed(() => import("./features/kinetic-typography/KineticTypographyPage"), "KineticTypographyPage");
const Preview = lazyNamed(() => import("./features/preview/Preview"), "Preview");
const GpuMonitorPage = lazyNamed(() => import("./features/gpu/GpuMonitorPage"), "GpuMonitorPage");
const LogAnalyticsPage = lazyNamed(() => import("./features/log-analytics/LogAnalytics"), "LogAnalytics");
const HyperFramesPage = lazyNamed(() => import("./features/hyperframes/HyperFramesPage"), "HyperFramesPage");
const MusicPromptGenerator = lazyNamed(() => import("./features/music-prompts/MusicPromptGenerator"), "MusicPromptGenerator");
const UnityControlPage = lazyNamed(() => import("./features/unity-control/UnityControlPage"), "UnityControlPage");

const withErrorBoundary = (element: React.ReactNode) => <ErrorBoundary>{element}</ErrorBoundary>;

const ROUTE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/queue": "Queue",
  "/music-video-wizard": "Music Video Wizard",
  "/three-js-studio": "Three.js Studio",
  "/audio-analysis": "Audio Analysis",
  "/video-generation": "Video Generation",
  "/generate-3d": "3D Generation",
  "/ai-tools": "AI Tools",
  "/docs": "Documentation",
  "/storyboards": "Storyboards",
  "/image-generation": "Image Generation",
  "/visualizer": "Visualizer",
  "/hyperframes": "HyperFrames",
  "/music-prompts": "Music Prompts",
  "/library": "Media Library",
  "/settings": "Settings",
  "/log-analytics": "Log Analytics",
  "/health": "Health",
  "/kinetic-typography": "Kinetic Typography",
  "/gpu": "GPU Monitor",
  "/unity": "Unity Control",
  "/preview": "Preview",
};

function RouteTitle() {
  const { pathname } = useLocation();
  const pageTitle = ROUTE_TITLES[pathname] ?? (pathname.startsWith("/preview/") ? "Preview" : "Not Found");
  useEffect(() => {
    document.title = `${pageTitle} — Native Media AI Studio`;
  }, [pageTitle]);
  return null;
}

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
    <>
      <BrowserRouter>
        <RouteTitle />
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <Routes>
            <Route path="/" element={withErrorBoundary(<Dashboard />)} />
            <Route path="/queue" element={withErrorBoundary(<Queue />)} />
            <Route path="/music-video-wizard" element={withErrorBoundary(<MusicVideoWizard />)} />
            <Route path="/three-js-studio" element={withErrorBoundary(<ThreeJSStudio />)} />
            <Route path="/audio-analysis" element={withErrorBoundary(<AudioAnalysisPage />)} />
            <Route path="/video-generation" element={withErrorBoundary(<VideoGenerationPage />)} />
            <Route path="/generate-3d" element={withErrorBoundary(<Generation3DPage />)} />
            <Route path="/ai-tools" element={withErrorBoundary(<AIToolsPage />)} />
            <Route path="/docs" element={withErrorBoundary(<DocsPage />)} />
            <Route path="/storyboards" element={withErrorBoundary(<StoryboardPage />)} />
            <Route path="/image-generation" element={withErrorBoundary(<ImageGeneration />)} />
            <Route path="/visualizer" element={withErrorBoundary(<Visualizer />)} />
            <Route path="/hyperframes" element={withErrorBoundary(<HyperFramesPage />)} />
            <Route path="/music-prompts" element={withErrorBoundary(<MusicPromptGenerator />)} />
            <Route path="/library" element={withErrorBoundary(<MediaLibrary />)} />
            <Route path="/media-library" element={<Navigate to="/library" replace />} />
            <Route path="/settings" element={withErrorBoundary(<Settings />)} />
            <Route path="/logs" element={<Navigate to="/log-analytics" replace />} />
            <Route path="/log-analytics" element={withErrorBoundary(<LogAnalyticsPage />)} />
            <Route path="/health" element={withErrorBoundary(<HealthPage />)} />
            <Route path="/kinetic-typography" element={withErrorBoundary(<KineticTypographyPage />)} />
            <Route path="/gpu" element={withErrorBoundary(<GpuMonitorPage />)} />
            <Route path="/unity" element={withErrorBoundary(<UnityControlPage />)} />
            <Route path="/preview" element={withErrorBoundary(<Preview />)} />
            <Route path="/preview/:clipId" element={withErrorBoundary(<Preview />)} />
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
    </>
  );
}

export default App;
