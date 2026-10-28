import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ErrorBoundary, PageLoader } from "./components/common";
import { DebugPanel } from "./components/debug/DebugPanel";
import { Layout } from "./components/layout/Layout";
import { Dashboard } from "./features/dashboard/Dashboard";
import { FirstRunGate } from "./features/onboarding/OnboardingPage";
import { NotFound } from "./features/not-found/NotFound";
import { Queue } from "./features/queue/Queue";
import { Settings } from "./features/settings/Settings";

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
    await new Promise((resolve) => setTimeout(resolve, 150));
    return loadNamedModule(loadModule, name, retries - 1);
  }
};

const lazyNamed = (loadModule: () => Promise<Record<string, unknown>>, name: string) =>
  lazy(() =>
    loadNamedModule(loadModule, name).then((module) => ({
      default: module.default as React.LazyExoticComponent<React.ComponentType<unknown>>,
    })),
  );

// Heavy pages loaded on-demand
const MasteringPage = lazyNamed(() => import("./features/mastering/MasteringPage"), "MasteringPage");
const HealthPage = lazyNamed(() => import("./features/health/HealthPage"), "HealthPage");
const DataManagementPage = lazyNamed(
  () => import("./features/data-management/DataManagementPage"),
  "DataManagementPage",
);
const DatabasePage = lazyNamed(
  () => import("./features/database/DatabasePage"),
  "DatabasePage",
);
const ImageGeneration = lazyNamed(
  () => import("./features/image-generation/ImageGeneration"),
  "ImageGeneration",
);
const ImageProcessingPage = lazyNamed(
  () => import("./features/image-processing/ImageProcessingPage"),
  "ImageProcessingPage",
);
const MediaLibrary = lazyNamed(
  () => import("./features/media-library/MediaLibrary"),
  "MediaLibrary",
);
const MusicVideoWizard = lazyNamed(
  () => import("./features/music-video/MusicVideoWizard"),
  "MusicVideoWizard",
);
const ThreeJSStudio = lazyNamed(
  () => import("./features/three-js-studio/ThreeJSStudio"),
  "ThreeJSStudio",
);
const Visualizer = lazyNamed(() => import("./features/visualizer/Visualizer"), "Visualizer");
const AudioAnalysisPage = lazyNamed(
  () => import("./features/audio-analysis/AudioAnalysisPage"),
  "AudioAnalysisPage",
);
const AIToolsPage = lazyNamed(() => import("./features/ai-tools/AIToolsPage"), "AIToolsPage");
const OllamaChat = lazyNamed(() => import("./features/ollama-chat/OllamaChat"), "OllamaChat");
const SubAgentChat = lazyNamed(() => import("./features/sub-agent/SubAgentChat"), "SubAgentChat");
const VideoGenerationPage = lazyNamed(
  () => import("./features/video-generation/VideoGenerationPage"),
  "VideoGenerationPage",
);
const DocsPage = lazyNamed(() => import("./features/docs/DocsPage"), "DocsPage");
const StoryboardPage = lazyNamed(
  () => import("./features/storyboards/StoryboardPage"),
  "StoryboardPage",
);
const KineticTypographyPage = lazyNamed(
  () => import("./features/kinetic-typography/KineticTypographyPage"),
  "KineticTypographyPage",
);
const Preview = lazyNamed(() => import("./features/preview/Preview"), "Preview");
const GpuMonitorPage = lazyNamed(() => import("./features/gpu/GpuMonitorPage"), "GpuMonitorPage");
const LogAnalyticsPage = lazyNamed(
  () => import("./features/log-analytics/LogAnalytics"),
  "LogAnalytics",
);
const HyperFramesPage = lazyNamed(
  () => import("./features/hyperframes/HyperFramesPage"),
  "HyperFramesPage",
);
const MusicPromptsWorkbench = lazyNamed(
  () => import("./features/music-prompts/MusicPromptsWorkbench"),
  "MusicPromptsWorkbench",
);
const MusicGenPage = lazyNamed(
  () => import("./features/music-gen/MusicGenPage"),
  "MusicGenPage",
);
const RemixPage = lazyNamed(() => import("./features/remix/RemixPage"), "RemixPage");
const UnityControlPage = lazyNamed(
  () => import("./features/unity-control/UnityControlPage"),
  "UnityControlPage",
);
const NotificationsPage = lazyNamed(
  () => import("./features/notifications/NotificationsPage"),
  "NotificationsPage",
);
const AnimationStudio = lazyNamed(
  () => import("./features/animation-studio/AnimationStudio"), "AnimationStudio",
);
const OnboardingPage = lazyNamed(
  () => import("./features/onboarding/OnboardingPage"), "OnboardingPage",
);

const withErrorBoundary = (element: React.ReactNode) => <ErrorBoundary>{element}</ErrorBoundary>;

const ROUTE_TITLES: Record<string, string> = {
  "/system": "Dashboard",
  "/system/onboarding": "Quick Start",
  "/system/queue": "Queue",
  "/system/settings": "Settings",
  "/system/health": "Health",
  "/system/data-management": "Data Management",
  "/system/database": "Database",
  "/system/log-analytics": "Log Analytics",
  "/system/gpu": "GPU Monitor",
  "/system/notifications": "Notifications",
  "/system/docs": "Documentation",
  "/create/music-video": "Music Video Wizard",
  "/create/3d": "Three.js Studio",
  "/create/video": "Video Generation",
  "/create/image": "Image Generation",
  "/create/image-processing": "Image Processing",
  "/create/typography": "Kinetic Typography",
  "/create/music": "Music Gen",
  "/create/remix": "Remix / Mashup",
  "/create/animation": "Animation Studio",
  "/create/unity": "Unity Control",
  "/create/hyperframes": "HyperFrames",
  "/library": "Media Library",
  "/library/storyboards": "Storyboards",
  "/analyze/audio": "Audio Analysis",
  "/analyze/ai": "AI Tools",
  "/analyze/chat": "Ollama Chat",
  "/analyze/agent": "Local Sub-Agent",
  "/mastering": "Mastering",
  "/render/visualizer": "Visualizer",
  "/render/preview": "Preview",
  "/render/prompts": "Music Prompts",
};

function RouteTitle() {
  const { pathname } = useLocation();
  const pageTitle =
    ROUTE_TITLES[pathname] ?? (pathname.startsWith("/preview/") ? "Preview" : "Not Found");
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
              {/* System — dashboard root */}
              <Route
                path="/system"
                element={withErrorBoundary(
                  <FirstRunGate>
                    <Dashboard />
                  </FirstRunGate>,
                )}
              />
              <Route
                path="/system/onboarding"
                element={withErrorBoundary(<OnboardingPage />)}
              />
              <Route path="/system/queue" element={withErrorBoundary(<Queue />)} />
              <Route
                path="/system/settings"
                element={withErrorBoundary(<Settings />)}
              />
              <Route
                path="/system/health"
                element={withErrorBoundary(<HealthPage />)}
              />
              <Route
                path="/system/data-management"
                element={withErrorBoundary(<DataManagementPage />)}
              />
              <Route
                path="/system/database"
                element={withErrorBoundary(<DatabasePage />)}
              />
              <Route
                path="/system/log-analytics"
                element={withErrorBoundary(<LogAnalyticsPage />)}
              />
              <Route path="/system/gpu" element={withErrorBoundary(<GpuMonitorPage />)} />
              <Route
                path="/system/notifications"
                element={withErrorBoundary(<NotificationsPage />)}
              />
              <Route
                path="/system/docs"
                element={withErrorBoundary(<DocsPage />)}
              />

              {/* Create */}
              <Route
                path="/create/music-video"
                element={withErrorBoundary(<MusicVideoWizard />)}
              />
              <Route
                path="/create/3d"
                element={withErrorBoundary(<ThreeJSStudio />)}
              />
              <Route
                path="/create/video"
                element={withErrorBoundary(<VideoGenerationPage />)}
              />
              <Route
                path="/create/image"
                element={withErrorBoundary(<ImageGeneration />)}
              />
              <Route
                path="/create/image-processing"
                element={withErrorBoundary(<ImageProcessingPage />)}
              />
              <Route
                path="/create/typography"
                element={withErrorBoundary(<KineticTypographyPage />)}
              />
  <Route
    path="/create/music"
    element={withErrorBoundary(<MusicGenPage />)}
  />
  <Route
    path="/create/remix"
    element={withErrorBoundary(<RemixPage />)}
  />
              <Route
                path="/create/animation"
                element={withErrorBoundary(<AnimationStudio />)}
              />
              <Route
                path="/create/unity"
                element={withErrorBoundary(<UnityControlPage />)}
              />
              <Route
                path="/create/hyperframes"
                element={withErrorBoundary(<HyperFramesPage />)}
              />

              {/* Library */}
              <Route
                path="/library"
                element={withErrorBoundary(<MediaLibrary />)}
              />
              <Route
                path="/library/storyboards"
                element={withErrorBoundary(<StoryboardPage />)}
              />

              {/* Analyze */}
              <Route
                path="/mastering"
                element={withErrorBoundary(<MasteringPage />)}
              />
              <Route
                path="/analyze/audio"
                element={withErrorBoundary(<AudioAnalysisPage />)}
              />
              <Route
                path="/analyze/ai"
                element={withErrorBoundary(<AIToolsPage />)}
              />
              <Route
                path="/analyze/chat"
                element={withErrorBoundary(<OllamaChat />)}
              />
              <Route
                path="/analyze/agent"
                element={withErrorBoundary(<SubAgentChat />)}
              />

              {/* Render */}
              <Route
                path="/render/visualizer"
                element={withErrorBoundary(<Visualizer />)}
              />
              <Route path="/render/preview" element={withErrorBoundary(<Preview />)} />
              <Route path="/render/preview/:clipId" element={withErrorBoundary(<Preview />)} />
              <Route
                path="/render/prompts"
                element={withErrorBoundary(<MusicPromptsWorkbench />)}
              />

              {/* Root redirect */}
              <Route path="/" element={<Navigate to="/system" replace />} />

              {/* Backward-compatible redirects (old → new) */}
              <Route path="/onboarding" element={<Navigate to="/system/onboarding" replace />} />
              <Route path="/queue" element={<Navigate to="/system/queue" replace />} />
              <Route path="/music-video-wizard" element={<Navigate to="/create/music-video" replace />} />
              <Route path="/three-js-studio" element={<Navigate to="/create/3d" replace />} />
              <Route path="/audio-analysis" element={<Navigate to="/analyze/audio" replace />} />
              <Route path="/video-generation" element={<Navigate to="/create/video" replace />} />
              <Route path="/generate-3d" element={<Navigate to="/create/3d" replace />} />
              <Route path="/ai-tools" element={<Navigate to="/analyze/ai" replace />} />
              <Route path="/ollama-chat" element={<Navigate to="/analyze/chat" replace />} />
              <Route path="/docs" element={<Navigate to="/system/docs" replace />} />
              <Route path="/storyboards" element={<Navigate to="/library/storyboards" replace />} />
              <Route path="/image-generation" element={<Navigate to="/create/image" replace />} />
              <Route path="/visualizer" element={<Navigate to="/render/visualizer" replace />} />
              <Route path="/hyperframes" element={<Navigate to="/create/hyperframes" replace />} />
              <Route path="/music-prompts" element={<Navigate to="/render/prompts" replace />} />
              <Route path="/music-gen" element={<Navigate to="/create/music" replace />} />
              <Route path="/settings" element={<Navigate to="/system/settings" replace />} />
              <Route path="/logs" element={<Navigate to="/system/log-analytics" replace />} />
              <Route path="/log-analytics" element={<Navigate to="/system/log-analytics" replace />} />
              <Route path="/health" element={<Navigate to="/system/health" replace />} />
              <Route path="/data-management" element={<Navigate to="/system/data-management" replace />} />
              <Route path="/database" element={<Navigate to="/system/database" replace />} />
              <Route path="/kinetic-typography" element={<Navigate to="/create/typography" replace />} />
              <Route path="/gpu" element={<Navigate to="/system/gpu" replace />} />
              <Route path="/unity" element={<Navigate to="/create/unity" replace />} />
              <Route path="/preview" element={<Navigate to="/render/preview" replace />} />
              <Route path="/notifications" element={<Navigate to="/system/notifications" replace />} />
              <Route path="/animation-studio" element={<Navigate to="/create/animation" replace />} />

              {/* Redirects for removed/merged routes */}
              <Route path="/music-video" element={<Navigate to="/create/music-video" replace />} />
              <Route path="/studio-3d" element={<Navigate to="/create/3d" replace />} />
              <Route path="/video-editor" element={<Navigate to="/create/video" replace />} />
              <Route path="/diagnostics" element={<Navigate to="/system/health" replace />} />
              <Route path="/media-library" element={<Navigate to="/library" replace />} />
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
