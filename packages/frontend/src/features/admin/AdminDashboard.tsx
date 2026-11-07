import { useState, useMemo, useEffect } from "react";
import {
  TestTube,
  Server,
  Mic2,
  Music,
  Settings,
  Database,
  BarChart3,
  Zap,
  Cpu,
  Network,
  AlertTriangle,
  Filter,
  FileText,
  Monitor,
  Home,
  Activity,
  ListOrdered,
  ChevronRight,
  ChevronLeft,
  Rocket,
} from "lucide-react";
import { Card } from "../../components/common";
import { NavLink, useLocation, useSearchParams } from "react-router-dom";

interface DashboardTab {
  id: string;
  label: string;
  icon: React.ReactNode;
  keywords: string;
}

const TABS: DashboardTab[] = [
  { id: "overview", label: "Overview", icon: <BarChart3 size={18} />, keywords: "overview summary stats" },
  { id: "tests", label: "Test Results", icon: <TestTube size={18} />, keywords: "tests playwright pytest results" },
  { id: "backend", label: "Backend Tests", icon: <Server size={18} />, keywords: "backend pytest python coverage" },
  { id: "services", label: "Services", icon: <Mic2 size={18} />, keywords: "services ports architecture mcp" },
  { id: "audio", label: "Audio Pipeline", icon: <Music size={18} />, keywords: "audio stems remix enhance visualize" },
  { id: "config", label: "Config & Ports", icon: <Settings size={18} />, keywords: "config ports models environments" },
];

// Admin navigation items for the hub
interface AdminNavItem {
  id: string;
  label: string;
  description: string;
  path: string;
  icon: React.ReactNode;
  category: "core" | "monitoring" | "data" | "docs";
  badge?: string;
  external?: boolean;
}

const ADMIN_NAV: AdminNavItem[] = [
  // Core admin pages
  { id: "dashboard", label: "Dashboard", description: "System overview, active jobs, quick actions", path: "/system", icon: <Home size={20} />, category: "core", badge: "Hub" },
  { id: "admin-dashboard", label: "Admin Dashboard", description: "Deep-dive: tests, services, audio, config", path: "/system/admin", icon: <Monitor size={20} />, category: "core", badge: "Deep" },
  { id: "settings", label: "Settings", description: "App configuration, preferences, integrations", path: "/system/settings", icon: <Settings size={20} />, category: "core" },
  
  // Monitoring
  { id: "health", label: "Health", description: "System health, adapters, resource cards, diagnostics", path: "/system/health", icon: <Activity size={20} />, category: "monitoring" },
  { id: "queue", label: "Queue", description: "Job queue, stats, SSE live indicator, job cards", path: "/system/queue", icon: <ListOrdered size={20} />, category: "monitoring" },
  { id: "gpu", label: "GPU Monitor", description: "VRAM, temperature, CUDA processes, telemetry", path: "/system/gpu", icon: <Cpu size={20} />, category: "monitoring" },
  { id: "log-analytics", label: "Log Analytics", description: "Log counts, analytics summary, search", path: "/system/log-analytics", icon: <BarChart3 size={20} />, category: "monitoring" },
  { id: "notifications", label: "Notifications", description: "System alerts, notification history", path: "/system/notifications", icon: <Zap size={20} />, category: "monitoring" },
  
  // Data
  { id: "data-management", label: "Data Management", description: "Saved prompts, visuals, history, exports", path: "/system/data-management", icon: <FileText size={20} />, category: "data" },
  { id: "database", label: "Database", description: "SQLite schema, tables, vacuum, integrity", path: "/system/database", icon: <Database size={20} />, category: "data" },
  
  // Docs & Help
  { id: "docs", label: "Documentation", description: "API docs, guides, architecture decisions", path: "/system/docs", icon: <FileText size={20} />, category: "docs" },
  { id: "onboarding", label: "Quick Start", description: "5-minute guided path to first video", path: "/system/onboarding", icon: <Rocket size={20} />, category: "docs" },
];

const STATUS_COLORS = {
  pass: "text-green-500",
  fail: "text-red-500",
  warn: "text-amber-500",
  skip: "text-amber-500",
  running: "text-green-500",
  stopped: "text-red-500",
  optional: "text-amber-500",
  active: "text-green-500",
  experimental: "text-amber-500",
  stable: "text-green-500",
  deprecated: "text-red-500",
  config: "text-blue-500",
};

const BADGE_VARIANTS: Record<string, string> = {
  core: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  db: "bg-green-500/10 text-green-500 border-green-500/20",
  audio: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  queue: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  ml: "bg-pink-500/10 text-pink-500 border-pink-500/20",
  infra: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  service: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  api: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  worker: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  ui: "bg-pink-500/10 text-pink-500 border-pink-500/20",
  ai: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  ext: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  port: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  model: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  embed: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  rerank: "bg-pink-500/10 text-pink-500 border-pink-500/20",
  chat: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  analysis: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  stems: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  remix: "bg-pink-500/10 text-pink-500 border-pink-500/20",
  enhance: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  visual: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  output: "bg-green-500/10 text-green-500 border-green-500/20",
  monitoring: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  docs: "bg-purple-500/10 text-purple-500 border-purple-500/20",
};

function StatusDot({ status }: { status: string }) {
  const colorClass = STATUS_COLORS[status as keyof typeof STATUS_COLORS] || "text-slate-500";
  return <span className={`flex items-center gap-1.5 ${colorClass}`}><span className="w-2 h-2 rounded-full bg-current" />{status}</span>;
}

function Badge({ variant, children }: { variant: string; children: React.ReactNode }) {
  const className = BADGE_VARIANTS[variant] || "bg-slate-500/10 text-slate-500 border-slate-500/20";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>{children}</span>;
}

function OverviewTab() {
  const stats = [
    { label: "Playwright Tests", value: "112", status: "pass", detail: "98 passing · 14 failing" },
    { label: "Backend Tests", value: "220", status: "pass", detail: "218 passing · 2 failing" },
    { label: "Core Services", value: "8", status: "running", detail: "3 Go sidecars + 3 optional" },
    { label: "API Operations", value: "286", status: "active", detail: "9 routers registered" },
    { label: "Pipeline Stages", value: "6", status: "stable", detail: "Analysis → Stems → Remix → Enhance → Visualize → Output" },
    { label: "Ollama Models", value: "5", status: "active", detail: "2 embed · 1 rerank · 2 chat" },
    { label: "Python Envs", value: "4", status: "config", detail: "nma-studio-cuda default" },
    { label: "Config Files", value: "3", status: "config", detail: "ports.json · settings.json · tracks.json" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="text-center p-6">
            <div className="text-4xl font-bold mb-2" style={{ color: `var(--${s.status === "pass" || s.status === "running" || s.status === "active" ? "success" : s.status === "fail" || s.status === "stopped" ? "destructive" : s.status === "warn" || s.status === "optional" ? "warning" : "primary"})` }}>
              {s.value}
            </div>
            <div className="text-sm font-medium text-muted-foreground mb-1">{s.label}</div>
            <div className="flex items-center justify-center gap-1.5">
              <StatusDot status={s.status} />
              <span className="text-xs text-muted-foreground">{s.detail}</span>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="font-semibold mb-4 flex items-center gap-2"><TestTube size={20} /> Recently Verified Passing Suites</h3>
          <div className="space-y-2">
            {[
              { suite: "Dashboard", tests: 8, status: "pass" },
              { suite: "Canvas2D Visualizer", tests: 3, status: "pass" },
              { suite: "LRC Visualizer", tests: 1, status: "skip", detail: "expected" },
              { suite: "Onboarding Flow", tests: 6, status: "pass" },
              { suite: "Pipeline Smoke", tests: 7, status: "pass" },
              { suite: "Queue", tests: 6, status: "pass" },
              { suite: "Go Services", tests: 4, status: "pass" },
              { suite: "Health", tests: 4, status: "pass" },
              { suite: "Media Library", tests: 4, status: "pass" },
              { suite: "GPU", tests: 2, status: "pass" },
              { suite: "Logs", tests: 2, status: "pass" },
              { suite: "App Shell", tests: 4, status: "pass" },
              { suite: "File Upload", tests: 4, status: "pass" },
              { suite: "diag2 / diag3", tests: 2, status: "pass" },
            ].map((s) => (
              <div key={s.suite} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <span className="font-medium">{s.suite}</span>
                <div className="flex items-center gap-2">
                  <StatusDot status={s.status} />
                  <span className="text-sm text-muted-foreground">{s.tests} tests{s.detail ? ` · ${s.detail}` : ""}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold mb-4 flex items-center gap-2"><AlertTriangle size={20} /> Known Remaining Issues</h3>
          <div className="space-y-3">
            {[
              { area: "AI Tools Templates", failing: "2/7 templates", cause: "Backend 502 under load (infrastructure)" },
              { area: "Remix Panel", failing: "4 tests", cause: "Component not mounting in test env" },
              { area: "Backend DB Pool", failing: "1 test", cause: "Flaky — isolation issue (passes solo)" },
              { area: "Ollama Live", failing: "1 test", cause: "Requires local Ollama server" },
            ].map((i) => (
              <div key={i.area} className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="text-destructive mt-0.5" size={16} />
                  <div>
                    <div className="font-medium">{i.area}</div>
                    <div className="text-sm text-muted-foreground">{i.failing} failing</div>
                    <div className="text-xs text-muted-foreground/80 mt-0.5">{i.cause}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Zap size={20} /> Key Fix: Health/Go Services/Queue Cascade</h3>
        <div className="p-4 bg-primary/10 border border-primary/20 rounded-lg">
          <p className="text-sm">A single missing optional chaining in <code className="bg-muted px-1.5 py-0.5 rounded">ComfyUICard.tsx:50</code> (<code>status.version.version</code> → <code>status.version?.version</code>) caused an ErrorBoundary catch that prevented HealthPage from rendering its children — which included the resource cards, ServiceChecksCard, and GoServicesCard. This one-line fix unblocked 3 entire test suites simultaneously.</p>
        </div>
      </Card>
    </div>
  );
}

function TestsTab() {
  return (
    <div className="space-y-6">
      <Card>
        <h3 className="font-semibold mb-4 flex items-center gap-2"><TestTube size={20} /> Playwright E2E — 112 Tests</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Suite</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Tests</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Notes</th>
              </tr>
            </thead>
            <tbody>
              {[
                { suite: "Dashboard", tests: 8, status: "pass", notes: "Hero text, drop zone, jobs card" },
                { suite: "Canvas2D Visualizer", tests: 3, status: "pass", notes: "2D modes, cycles, no console errors" },
                { suite: "LRC Visualizer", tests: 1, status: "skip", notes: "Expected (no LRC fixture)" },
                { suite: "Onboarding Flow", tests: 6, status: "pass", notes: "Redirect fixed to /system" },
                { suite: "Pipeline Smoke", tests: 7, status: "pass", notes: "Label fixed: Three.js Studio" },
                { suite: "Queue", tests: 6, status: "pass", notes: "Health mock + metrics endpoint" },
                { suite: "Go Services", tests: 4, status: "pass", notes: "Fixed by ComfyUICard fix" },
                { suite: "Health", tests: 4, status: "pass", notes: "Resource cards render" },
                { suite: "Media Library", tests: 4, status: "pass", notes: "Tab names: Image/Video (singular)" },
                { suite: "GPU", tests: 2, status: "pass", notes: "Telemetry, header" },
                { suite: "Logs", tests: 2, status: "pass", notes: "Header, analytics" },
                { suite: "App Shell", tests: 4, status: "pass", notes: "Redirects, sidebar CTA" },
                { suite: "File Upload", tests: 4, status: "pass", notes: "Drop zone, keyboard" },
                { suite: "diag2 / diag3", tests: 2, status: "pass", notes: "Probes, timing" },
                { suite: "AI Tools Templates", tests: 7, status: "warn", notes: "2/7 fail — 502 under load" },
                { suite: "Remix Panel", tests: 4, status: "fail", notes: "Component not mounting" },
              ].map((r) => (
                <tr key={r.suite} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-2 px-3 font-medium">{r.suite}</td>
                  <td className="py-2 px-3 text-muted-foreground">{r.tests}</td>
                  <td className="py-2 px-3"><StatusDot status={r.status} /></td>
                  <td className="py-2 px-3 text-sm text-muted-foreground">{r.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Server size={20} /> Issues Fixed This Session</h3>
        <div className="space-y-2">
          {[
            { num: 1, issue: "Dashboard test text mismatch", fix: 'Updated expected strings to match "Drop your song" + "Get your video"', file: "dashboard.spec.ts" },
            { num: 2, issue: "Backend schema version", fix: "Updated test expectation 21 → 22", file: "test_media_library.py" },
            { num: 3, issue: "Ollama chat 422 errors", fix: "Fixed @router.post decorator placement on ollama_chat function", file: "integrations_generation.py" },
            { num: 4, issue: "Media Library tabs", fix: "Updated test to match singular UI labels (Image/Video)", file: "media-library.spec.ts" },
            { num: 5, issue: "Health page ErrorBoundary crash", fix: "Added optional chaining status.version?.version", file: "ComfyUICard.tsx" },
            { num: 6, issue: "Onboarding redirect URL", fix: "Changed expectation from / to /system", file: "onboarding-flow.spec.ts" },
            { num: 7, issue: "Pipeline smoke label", fix: '"3D Model Generation" → "Three.js Studio"', file: "pipeline-smoke.spec.ts" },
            { num: 8, issue: "Queue tests", fix: "Added mockApiHealth + /api/jobs/metrics mock with full QueueStats/QueueMetrics", file: "queue.spec.ts, helpers.ts" },
            { num: 9, issue: "AI Tools timeout", fix: "Extended to 20 minutes for 7 templates", file: "ai-tools-templates.spec.ts" },
          ].map((f) => (
            <div key={f.num} className="p-3 bg-muted/30 border border-border/50 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="text-2xl font-bold text-primary/30">{f.num}.</span>
                <div className="flex-1">
                  <div className="font-medium">{f.issue}</div>
                  <div className="text-sm text-muted-foreground mt-0.5">{f.fix}</div>
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded mt-1 inline-block">{f.file}</code>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function BackendTab() {
  const categories = [
    { name: "Core Infrastructure", badge: "core", tests: 52, passRate: 100, items: ["Database Admin (12)", "Database Connections (7)", "Doc Search Index (11)", "Error Classification (28)", "Health Endpoints (5)", "CORS Origin (8)", "Lyric Safety (14)", "Hardware Benchmark (6)", "GPU Telemetry (7)", "Resources Async (8)"] },
    { name: "DB Pool & Connections", badge: "db", tests: 19, passRate: 94.7, items: ["Connection Pool (6/7)", "Database Admin (12)", "Database Connections (7)", "Safe Vacuum", "WAL Checkpoint", "Integrity Check"] },
    { name: "Audio Processing", badge: "audio", tests: 57, passRate: 100, items: ["Essentia Bridge (17)", "Essentia Tempo Store (14)", "Mastering (15)", "Finishing Chain (10)", "Reference Match (8)", "Remix Jobs (12)", "Remix Prompt (48)", "Remix Routes (6)"] },
    { name: "Queue & Job System", badge: "queue", tests: 53, passRate: 100, items: ["Core Queue (6)", "Event-Driven (4)", "Lease System (12)", "Lifecycle Events (7)", "Stale Recovery (16)", "Queue Lease (12)", "Pipeline Integration (8)"] },
    { name: "ML & Ollama", badge: "ml", tests: 36, passRate: 97.2, items: ["Ollama Capabilities (13)", "Ollama Live (8/10)", "Music Prompts (3)", "LipSync (14)", "Generation Estimator (4)"] },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {categories.map((c) => (
          <Card key={c.name} className="col-span-1">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2"><Badge variant={c.badge}>{c.name}</Badge></h3>
              <StatusDot status={c.passRate === 100 ? "pass" : "warn"} />
            </div>
            <div className="text-3xl font-bold mb-1">{c.tests} tests</div>
            <div className="text-sm text-muted-foreground mb-4">{c.passRate}% pass rate</div>
            <div className="space-y-1 text-xs text-muted-foreground">
              {c.items.map((i) => <div key={i} className="py-0.5 border-b border-border/30 last:border-0">{i}</div>)}
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <h3 className="font-semibold mb-4 flex items-center gap-2"><AlertTriangle size={20} /> Known Failures</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Test</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Category</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Issue</th>
              </tr>
            </thead>
            <tbody>
              {[
                { test: "test_close_pooled_connections_empties_the_pool", category: "DB Pool", issue: "Flaky — passes in isolation, fails in full suite (test isolation)" },
                { test: "test_ollama_live.py::test_health_check_true_against_live_server", category: "ML Live", issue: "Requires Ollama server running (environment dependency)" },
              ].map((f) => (
                <tr key={f.test} className="border-b border-border/50">
                  <td className="py-2 px-3 font-mono text-sm"><code>{f.test}</code></td>
                  <td className="py-2 px-3"><Badge variant={f.category.toLowerCase().includes("db") ? "db" : "ml"}>{f.category}</Badge></td>
                  <td className="py-2 px-3 text-sm text-muted-foreground">{f.issue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ServicesTab() {
  const coreServices = [
    { name: "FastAPI Backend", port: 8000, type: "REST + SSE", status: "running", health: "GET /api/health", badge: "service" },
    { name: "Vite + React Frontend", port: 5173, type: "SPA + HMR", status: "running", health: "GET /", badge: "ui" },
    { name: "Queue Worker", port: "—", type: "Background", status: "running", health: "Internal", badge: "worker" },
    { name: "Ollama LLM Server", port: 11434, type: "Local Inference", status: "running", health: "GET /api/tags", badge: "ai" },
    { name: "Atomic Chat (Qwen GGUF)", port: 1337, type: "Chat Fallback", status: "running", health: "GET /health", badge: "ai" },
    { name: "ComfyUI", port: 8188, type: "Optional", status: "optional", health: "GET /system_stats", badge: "ext" },
    { name: "Blender", port: "—", type: "MCP Bridge", status: "optional", health: "MCP stdio", badge: "ext" },
    { name: "Unity Visualizer", port: "—", type: "MCP Bridge", status: "optional", health: "MCP stdio", badge: "ext" },
  ];

  const goSidecars = [
    { name: "Go Dashboard", port: 9000, purpose: "Metrics UI", endpoints: ["/metrics", "/health"] },
    { name: "Go Media", port: 9001, purpose: "Media processing", endpoints: ["/api/media/*", "/health"] },
    { name: "Go Worker", port: 9002, purpose: "Job execution", endpoints: ["/api/worker/*", "/health"] },
  ];

  const apiRouters = [
    { name: "Audio", prefix: "/api/audio", ops: "~40", endpoints: "upload, list, stems, enhance, remix, files", badge: "api" },
    { name: "Queue", prefix: "/api/jobs", ops: "~25", endpoints: "create, list, stats, cancel, retry, SSE", badge: "api" },
    { name: "Health", prefix: "/api/health", ops: "~15", endpoints: "system, GPU, services, diagnostics", badge: "api" },
    { name: "Remix", prefix: "/api/audio/remix", ops: "~12", endpoints: "sources, probe, preview, build, enhance", badge: "api" },
    { name: "Integrations", prefix: "/api/integrations", ops: "~30", endpoints: "ollama, atomic-chat, ComfyUI, VRAM", badge: "api" },
    { name: "Retrieval", prefix: "/api/retrieval", ops: "3", endpoints: "index, search, status", badge: "api" },
    { name: "Media Library", prefix: "/api/library", ops: "~10", endpoints: "files, collections, tags, favorites", badge: "api" },
    { name: "3D Generation", prefix: "/api/generate-3d", ops: "~8", endpoints: "models, scenes, assets", badge: "api" },
    { name: "Video", prefix: "/api/video", ops: "~12", endpoints: "generation, lipsync, status", badge: "api" },
  ];

  const mcpBridges = [
    { name: "ComfyUI", type: "Port 8188 (REST)", detail: "Workflows: txt2img, wan2.1, LTX, AnimateDiff", badge: "ext" },
    { name: "Blender", type: "MCP stdio bridge", detail: "bpy scripts: mesh, material, rig, scene", badge: "ext" },
    { name: "Unity", type: "MCP stdio bridge", detail: "Scene creation, GameObject, animation", badge: "ext" },
    { name: "Remotion", type: "MCP stdio bridge", detail: "Composition, render, preview", badge: "ext" },
    { name: "Context Store", type: "Library (not server)", detail: "4 functions: get/set/del/list", badge: "ext" },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Server size={20} /> Core Services (Managed by manage-servers.ps1)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Service</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Port</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Type</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Health Endpoint</th>
              </tr>
            </thead>
            <tbody>
              {coreServices.map((s) => (
                <tr key={s.name} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-2 px-3"><Badge variant={s.badge}>{s.name}</Badge></td>
                  <td className="py-2 px-3 font-mono text-sm">{s.port}</td>
                  <td className="py-2 px-3 text-muted-foreground">{s.type}</td>
                  <td className="py-2 px-3"><StatusDot status={s.status} /></td>
                  <td className="py-2 px-3 font-mono text-xs text-muted-foreground">{s.health}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Cpu size={20} /> Go Sidecars (Port 9000-9002)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Service</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Port</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Purpose</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Endpoints</th>
              </tr>
            </thead>
            <tbody>
              {goSidecars.map((s) => (
                <tr key={s.name} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-2 px-3"><Badge variant="worker">{s.name}</Badge></td>
                  <td className="py-2 px-3 font-mono text-sm">{s.port}</td>
                  <td className="py-2 px-3 text-muted-foreground">{s.purpose}</td>
                  <td className="py-2 px-3 font-mono text-xs text-muted-foreground">{s.endpoints.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Network size={20} /> API Surface — 286 Operations</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Router</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Prefix</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Ops</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Key Endpoints</th>
              </tr>
            </thead>
            <tbody>
              {apiRouters.map((r) => (
                <tr key={r.name} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-2 px-3"><Badge variant={r.badge}>{r.name}</Badge></td>
                  <td className="py-2 px-3 font-mono text-sm">{r.prefix}</td>
                  <td className="py-2 px-3 text-muted-foreground">{r.ops}</td>
                  <td className="py-2 px-3 text-sm text-muted-foreground">{r.endpoints}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Zap size={20} /> MCP Bridges (stdio/REST)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {mcpBridges.map((m) => (
            <Card key={m.name} className="p-4">
              <div className="flex items-center gap-2 mb-2"><Badge variant={m.badge}>{m.name}</Badge></div>
              <div className="text-sm text-muted-foreground mb-1">{m.type}</div>
              <div className="text-xs text-muted-foreground/80">{m.detail}</div>
            </Card>
          ))}
        </div>
      </Card>
    </div>
  );
}

function AudioTab() {
  const stages = [
    { num: 1, badge: "analysis", title: "Analysis", detail: "Essentia (WSL) extracts BPM, beats, sections, loudness. Results cached in SQLite (output/audio/{id}/analysis.json). Tempo probed from drums stem when available." },
    { num: 2, badge: "stems", title: "Stems (Demucs)", detail: "4 stems: vocals, drums, bass, other. HTDemucs 6s model. Output: output/audio/{id}/stems/{stem}.wav. Partial stem sets supported." },
    { num: 3, badge: "remix", title: "Remix / Mashup", detail: "Layer stems from DIFFERENT tracks with per-layer: gain (dB), key shift (semitones), source start bar, lowpass, brightness. Time-stretches to target BPM (drums-probed). Output: output/remixes/{name}/" },
    { num: 4, badge: "enhance", title: "Enhance (Suno Chain)", detail: "Highpass → EQ → Vocal balance → Limiter. POST /api/audio/remix/{name}/enhance (NOT /api/audio/enhance-stems). Target peak -1 dBFS, ceiling -1 dBFS." },
    { num: 5, badge: "visual", title: "Visualize", detail: "Unity MCP / Three.js Studio / LRC Visualizer. Section-aware storyboard from beats. AutoCapture: 360 frames @ 24fps = 15s." },
    { num: 6, badge: "output", title: "Output (Remotion)", detail: "Frame sequence + mastered audio → MP4. output/videos/{id}.mp4. GPU encoding optional (NVENC)." },
  ];

  const modules = [
    { name: "audio.py (Core)", badge: "analysis", endpoints: ["POST /api/audio/upload", "GET /api/audio/library", "GET /api/audio/files", "GET /api/audio/analyze/{id}", "GET /api/audio/file/{path}", "GET /api/audio/analysis/{id}"], detail: "Upload, listing, file serving, analysis cache, JSON index" },
    { name: "audio_stems.py (Separation)", badge: "stems", endpoints: ["POST /api/audio/stems/separate", "GET /api/audio/stems/status/{job_id}", "GET /api/audio/stems/download/{job_id}/{stem}"], detail: "Demucs separation job management" },
    { name: "audio_edit.py (Edit/Serve)", badge: "stems", endpoints: ["POST /api/audio/extract", "POST /api/audio/rename", "POST /api/audio/trim", "GET /api/audio/stem-file/{id}/{stem}"], detail: "Extract/rename/trim, stem file serving" },
    { name: "audio_remix.py (Remix)", badge: "remix", endpoints: ["GET /api/audio/remix/sources", "GET /api/audio/remix/probe/{track}", "POST /api/audio/remix/preview", "POST /api/audio/remix/build", "POST /api/audio/remix/{name}/enhance", "GET /api/audio/remix/{name}/file/{which}", "GET /api/audio/remix/list"], detail: "Sources, probe, preview, build, enhance, file serving, listing" },
    { name: "audio_analysis.py (No Routes)", badge: "analysis", endpoints: ["build_analysis_result()", "suggest_remix_layers()", "label_sections()"], detail: "Result builder, suggestions, section labeling — used by other modules" },
  ];

  const behaviors = [
    { behavior: "Tempo detection", detail: "Probed from drums stem when present (not vocals)", implementation: "_pick_analysis_stem() in remix_prompt.py" },
    { behavior: "Key detection", detail: "Chroma flatness 0.978-0.998 → unreliable, must use explicit key_shift_semitones", implementation: "Advisory only in /api/audio/remix/probe" },
    { behavior: "Silent intro handling", detail: "Ad-Nauseam vocals silent 7.06s → preview_recipe warns < −50 dBFS", implementation: "Layer source_start_bar hint in warnings" },
    { behavior: "Remix enhance", detail: "Use POST /api/audio/remix/{name}/enhance — /api/audio/enhance-stems 404s on remixes", implementation: "Different path resolution" },
    { behavior: "Probe caching", detail: "Tempo probes cached in output/remixes/.probes/ (not beside stems)", implementation: "Survives stem regeneration" },
    { behavior: "Stem serving", detail: "GET /api/audio/remix/{name}/file/{which} where which = vocals|drums|bass|other|master", implementation: "Only route serving output/remixes/" },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {stages.map((s) => (
          <Card key={s.num} className="p-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-lg flex-shrink-0">{s.num}</div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1"><Badge variant={s.badge}>{s.title}</Badge></div>
                <p className="text-sm text-muted-foreground">{s.detail}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Settings size={20} /> Audio API Endpoints (4 Modules)</h3>
        <div className="space-y-4">
          {modules.map((m) => (
            <div key={m.name} className="p-4 bg-muted/30 border border-border/50 rounded-lg">
              <div className="flex items-center gap-2 mb-2"><Badge variant={m.badge}>{m.name}</Badge></div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {m.endpoints.map((e) => <code key={e} className="px-2 py-0.5 bg-muted border border-border rounded text-xs font-mono">{e}</code>)}
              </div>
              <p className="text-xs text-muted-foreground">{m.detail}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Zap size={20} /> Critical Pipeline Behaviors</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Behavior</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Detail</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Implementation</th>
              </tr>
            </thead>
            <tbody>
              {behaviors.map((b) => (
                <tr key={b.behavior} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-2 px-3 font-medium">{b.behavior}</td>
                  <td className="py-2 px-3 text-sm text-muted-foreground">{b.detail}</td>
                  <td className="py-2 px-3 font-mono text-xs text-muted-foreground">{b.implementation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ConfigTab() {
  const ports = [
    { service: "FastAPI Backend", port: 8000, key: "backend_port", protocol: "HTTP + SSE", notes: "Primary API, dynamic via manage-servers.ps1", badge: "port" },
    { service: "Vite Frontend", port: 5173, key: "frontend_port", protocol: "HTTP + HMR", notes: "Dev server, proxies /api → 8000", badge: "port" },
    { service: "WebSocket Events", port: 8000, key: "ws_port", protocol: "WS", notes: "Same as backend (SSE fallback)", badge: "port" },
    { service: "Dashboard Events", port: 3847, key: "dashboard_port", protocol: "HTTP + SSE", notes: "events_url, sse_url", badge: "port" },
    { service: "Atomic Chat", port: 1337, key: "atomic_chat_port", protocol: "HTTP", notes: "atomic_chat_url, GGUF fallback", badge: "port" },
    { service: "Ollama", port: 11434, key: "ollama_port", protocol: "HTTP", notes: "Local inference, embeddings", badge: "port" },
    { service: "ComfyUI", port: 8188, key: "comfyui_port", protocol: "HTTP", notes: "Optional, workflow execution", badge: "port" },
    { service: "Go Dashboard", port: 9000, key: "go_dashboard_port", protocol: "HTTP", notes: "Metrics UI", badge: "port" },
    { service: "Go Media", port: 9001, key: "go_media_port", protocol: "HTTP", notes: "Media processing", badge: "port" },
    { service: "Go Worker", port: 9002, key: "go_worker_port", protocol: "HTTP", notes: "Job execution", badge: "port" },
    { service: "Go Gateway", port: 9003, key: "go_gateway_port", protocol: "HTTP", notes: "API gateway", badge: "port" },
    { service: "Go Ports", port: 9004, key: "go_ports_port", protocol: "HTTP", notes: "Port management", badge: "port" },
  ];

  const models = [
    { model: "nomic-embed-text:v1.5", role: "Primary Embedding", size: "~270 MB", dim: 768, status: "active", useCase: "Retrieval indexing, vector search (always resident)", badge: "embed" },
    { model: "embeddinggemma-2:270m", role: "Fallback Embedding", size: "~290 MB", dim: "768 (MRL)", status: "active", useCase: "Auto-fallback if nomic fails, truncatable", badge: "embed" },
    { model: "BAAI/bge-reranker-v2-m3", role: "Cross-Encoder Rerank", size: "568 MB", dim: "—", status: "lazy", useCase: "HF Transformers, cached at huggingface_cache/", badge: "rerank" },
    { model: "gemma4:e2b-it-qat", role: "Vision + Chat", size: "~4 GB", dim: "—", status: "active", useCase: "Vision analysis, tool calling, chat fallback", badge: "chat" },
    { model: "qwen3.5:4b", role: "Atomic Chat (Qwen)", size: "~2.5 GB", dim: "—", status: "active", useCase: "Atomic Chat on port 1337, GGUF Q4_K_M", badge: "chat" },
  ];

  const pythonEnvs = [
    { env: "nma-studio-cuda", path: "D:\\conda-envs\\nma-studio-cuda\\", python: "3.11.9", useCase: "Backend, audio, ML, CUDA (DEFAULT)", status: "active" },
    { env: "comfyui-cuda", path: "D:\\conda-envs\\comfyui-cuda\\", python: "3.11.9", useCase: "ComfyUI service ONLY", status: "optional" },
    { env: "repo venv", path: "venv\\", python: "3.11.x", useCase: "Fallback / CPU-only", status: "optional" },
    { env: "music-gen", path: "tools/music-gen/.venv\\", python: "3.11.x", useCase: "Music generation (preferred)", status: "optional" },
  ];

  const configFiles = [
    { file: "config/ports.json", purpose: "Dynamic port assignments", loadedBy: "portConfig.ts, manage-servers.ps1" },
    { file: "config/settings.json", purpose: "Service URLs, model IDs, paths", loadedBy: "Backend config.py, Frontend portConfig.ts" },
    { file: "config/tracks.json", purpose: "Track metadata registry", loadedBy: "Audio library, remix sources" },
    { file: ".kilo/kilo.jsonc", purpose: "Kilo agent config (gitignored)", loadedBy: "Kilo Desktop" },
    { file: "opencode.json", purpose: "OpenCode MCP servers", loadedBy: "OpenCode" },
    { file: "~/.cline/mcp.json", purpose: "Cline MCP servers", loadedBy: "Cline (outside repo)" },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Settings size={20} /> Port Configuration (config/ports.json)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Service</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Port</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Key</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Protocol</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Notes</th>
              </tr>
            </thead>
            <tbody>
              {ports.map((p) => (
                <tr key={p.service} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-2 px-3"><Badge variant={p.badge}>{p.service}</Badge></td>
                  <td className="py-2 px-3 font-mono text-sm">{p.port}</td>
                  <td className="py-2 px-3 font-mono text-xs text-muted-foreground">{p.key}</td>
                  <td className="py-2 px-3 text-muted-foreground">{p.protocol}</td>
                  <td className="py-2 px-3 text-sm text-muted-foreground">{p.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-3">Ports assigned dynamically by <code className="bg-muted px-1.5 py-0.5 rounded">scripts/start-services.ps1</code> → written to <code className="bg-muted px-1.5 py-0.5 rounded">config/ports.json</code>. Frontend reads via <code className="bg-muted px-1.5 py-0.5 rounded">portConfig.ts</code>.</p>
      </Card>

      <Card>
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Mic2 size={20} /> Ollama Model Registry</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Model</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Role</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Size</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Dim</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Use Case</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.model} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-2 px-3 font-mono text-sm">{m.model}</td>
                  <td className="py-2 px-3"><Badge variant={m.badge}>{m.role}</Badge></td>
                  <td className="py-2 px-3 text-muted-foreground">{m.size}</td>
                  <td className="py-2 px-3 text-muted-foreground">{m.dim}</td>
                  <td className="py-2 px-3"><StatusDot status={m.status} /></td>
                  <td className="py-2 px-3 text-sm text-muted-foreground">{m.useCase}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Database size={20} /> Retrieval / Embedding Subsystem</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: "Endpoints", value: "GET /api/retrieval/status, POST /api/retrieval/index, POST /api/retrieval/search" },
              { label: "Index", value: "SQLite + in-memory — chunks, docs, embeddings (768-dim)" },
              { label: "Search", value: "Hybrid BM25 + vector → RRF → cross-encoder rerank → top-k" },
              { label: "Python API", value: "embed_text(), embed_text_batch_concurrent() (concurrency=4)" },
              { label: "Model Resolution", value: "Explicit arg → config.embedding_model → fallback tuple" },
              { label: "Warm-up", value: "Dummy call on first use to load weights into GPU VRAM" },
              { label: "Failure Mode", value: "Returns None on total failure; search falls back to BM25-only with warning" },
              { label: "Status Check", value: "GET /api/retrieval/status → embedding_model_available flag" },
            ].map((i) => (
              <div key={i.label} className="p-3 bg-muted/30 border border-border/50 rounded-lg">
                <div className="font-medium text-sm">{i.label}</div>
                <div className="text-xs text-muted-foreground font-mono">{i.value}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Cpu size={20} /> Python Environments</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Environment</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Path</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Python</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Use Case</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {pythonEnvs.map((e) => (
                <tr key={e.env} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-2 px-3 font-medium">{e.env}</td>
                  <td className="py-2 px-3 font-mono text-xs">{e.path}</td>
                  <td className="py-2 px-3 text-muted-foreground">{e.python}</td>
                  <td className="py-2 px-3 text-sm text-muted-foreground">{e.useCase}</td>
                  <td className="py-2 px-3"><StatusDot status={e.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-3">Selection verified by <code className="bg-muted px-1.5 py-0.5 rounded">tools/run-gates.py</code> probing with real <code className="bg-muted px-1.5 py-0.5 rounded">ruff</code> + <code className="bg-muted px-1.5 py-0.5 rounded">pytest tmp_path</code> runs. Cached in <code className="bg-muted px-1.5 py-0.5 rounded">%TEMP%\\nma-studio-python-choice.json</code> (TTL 15min).</p>
      </Card>

      <Card>
        <h3 className="font-semibold mb-4 flex items-center gap-2"><FileText size={20} /> Key Config Files</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">File</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Purpose</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Loaded By</th>
              </tr>
            </thead>
            <tbody>
              {configFiles.map((c) => (
                <tr key={c.file} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-2 px-3 font-mono text-sm">{c.file}</td>
                  <td className="py-2 px-3 text-muted-foreground">{c.purpose}</td>
                  <td className="py-2 px-3 text-sm text-muted-foreground">{c.loadedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function AdminNavCard({ item, isActive }: { item: AdminNavItem; isActive?: boolean }) {
  const categoryColors: Record<string, string> = {
    core: "border-blue-500/30 bg-blue-500/5",
    monitoring: "border-amber-500/30 bg-amber-500/5",
    data: "border-green-500/30 bg-green-500/5",
    docs: "border-purple-500/30 bg-purple-500/5",
  };
  
  const borderColor = categoryColors[item.category] || "border-border";
  
  return (
    <NavLink
      to={item.path}
      className={`flex items-start gap-4 p-4 rounded-xl border transition-all hover:shadow-lg ${
        isActive 
          ? "border-primary/50 bg-primary/5 ring-2 ring-primary/20" 
          : `border-border/50 ${borderColor}`
      }`}
      aria-current={isActive ? "page" : undefined}
    >
      <div className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${isActive ? "bg-primary/20 text-primary" : "bg-muted/50 text-muted-foreground"}`}>
        {item.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-base">{item.label}</span>
          {item.badge && (
            <Badge variant={item.category}>{item.badge}</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground line-clamp-2">{item.description}</p>
        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground/70">
          <span className="font-mono bg-muted px-1.5 py-0.5 rounded">{item.path}</span>
          <ChevronRight size={12} className="text-muted-foreground/50" />
        </div>
      </div>
      <ChevronRight size={20} className="text-muted-foreground/50 flex-shrink-0" />
    </NavLink>
  );
}

function AdminHub() {
  const location = useLocation();
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground text-sm">Central hub for system administration, monitoring, data, and documentation</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="core">12 Pages</Badge>
          <Badge variant="monitoring">5 Monitoring</Badge>
          <Badge variant="data">2 Data</Badge>
          <Badge variant="docs">2 Docs</Badge>
        </div>
      </div>

      {/* Admin Navigation Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {ADMIN_NAV.map((item) => (
          <AdminNavCard key={item.id} item={item} isActive={location.pathname === item.path || (item.path !== "/system" && location.pathname.startsWith(item.path))} />
        ))}
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 border-blue-500/30 bg-blue-500/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-500"><Monitor size={20} /></div>
            <div>
              <div className="text-2xl font-bold text-blue-500">12</div>
              <div className="text-xs text-muted-foreground">Admin Pages</div>
            </div>
          </div>
        </Card>
        <Card className="p-4 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center text-amber-500"><Activity size={20} /></div>
            <div>
              <div className="text-2xl font-bold text-amber-500">5</div>
              <div className="text-xs text-muted-foreground">Monitoring</div>
            </div>
          </div>
        </Card>
        <Card className="p-4 border-green-500/30 bg-green-500/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center text-green-500"><Database size={20} /></div>
            <div>
              <div className="text-2xl font-bold text-green-500">2</div>
              <div className="text-xs text-muted-foreground">Data Pages</div>
            </div>
          </div>
        </Card>
        <Card className="p-4 border-purple-500/30 bg-purple-500/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-500"><FileText size={20} /></div>
            <div>
              <div className="text-2xl font-bold text-purple-500">2</div>
              <div className="text-xs text-muted-foreground">Docs & Help</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Category Legend */}
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20">
          <span className="w-2 h-2 rounded-full bg-blue-500"></span> Core
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
          <span className="w-2 h-2 rounded-full bg-amber-500"></span> Monitoring
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-green-500/10 text-green-500 border border-green-500/20">
          <span className="w-2 h-2 rounded-full bg-green-500"></span> Data
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-purple-500/10 text-purple-500 border border-purple-500/20">
          <span className="w-2 h-2 rounded-full bg-purple-500"></span> Docs
        </span>
      </div>
    </div>
  );
}

export function AdminDashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [filter, setFilter] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();

  // Sync activeTab with query param
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab && TABS.some(t => t.id === tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    setSearchParams({ tab: tabId });
  };

  const filteredTabs = useMemo(() => {
    if (!filter) return TABS;
    const terms = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return TABS.filter((t) => terms.every((term) => t.label.toLowerCase().includes(term) || t.keywords.toLowerCase().includes(term)));
  }, [filter]);

  const isHubView = !searchParams.has("tab");

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground text-sm">System health, test results, service architecture, audio pipeline, and configuration</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter tabs…"
              className="pl-10 pr-4 py-2 bg-muted border border-border rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
      </div>

      {/* Hub View - Show when no tab selected */}
      {isHubView && <AdminHub />}

      {/* Tab Navigation - Show when tab selected */}
      {!isHubView && (
        <div className="flex items-center justify-between mb-6 pb-1 border-b border-border">
          <NavLink to="/system/admin" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
            <ChevronLeft size={16} />
            Back to Hub
          </NavLink>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter tabs…"
                className="pl-10 pr-4 py-2 bg-muted border border-border rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      {!isHubView && (
        <div className="flex gap-1 mb-6 border-b border-border pb-1 overflow-x-auto">
          {filteredTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground border-b-2 border-primary -mb-px"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {isHubView ? null : (
          <>
            {activeTab === "overview" && <OverviewTab />}
            {activeTab === "tests" && <TestsTab />}
            {activeTab === "backend" && <BackendTab />}
            {activeTab === "services" && <ServicesTab />}
            {activeTab === "audio" && <AudioTab />}
            {activeTab === "config" && <ConfigTab />}
          </>
        )}
      </div>
    </div>
  );
}