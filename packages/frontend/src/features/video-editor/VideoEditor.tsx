/**
 * Video Editor Dashboard — interactive control center for Remotion compositions.
 * Shows studio status, available compositions, assets, and quick actions.
 */

import React, { useState, useEffect } from "react";
import {
  Film,
  Play,
  Square,
  ExternalLink,
  Music,
  Image,
  Plus,
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Download,
  Trash2,
  Eye,
} from "lucide-react";
import { Card, StatusBadge } from "../../components/common";
import { getVideoEditorUrl } from "../../services/portConfig";

interface Composition {
  id: string;
  name: string;
  file: string;
  duration: string;
  audioFile: string;
  hasPreview: boolean;
}

interface AudioAsset {
  name: string;
  size: string;
  type: string;
}

const COMPOSITIONS: Composition[] = [
  { id: "SignalBreakingThroughNoise", name: "Signal Breaking Through Noise", file: "Composition.tsx", duration: "2:22", audioFile: "signal.mp3", hasPreview: false },
  { id: "StillIRise", name: "Still I Rise", file: "StillIRise.tsx", duration: "3:54", audioFile: "still-i-rise.mp3", hasPreview: true },
  { id: "TakeTheCrown", name: "Take the Crown", file: "TakeTheCrown.tsx", duration: "~4:00", audioFile: "take-the-crown.mp3", hasPreview: true },
  { id: "SiliconDreamsPreview", name: "Silicon Dreams Preview", file: "SiliconDreamsPreview.tsx", duration: "~1:00", audioFile: "", hasPreview: false },
];

const AUDIO_ASSETS: AudioAsset[] = [
  { name: "still-i-rise.mp3", size: "5.4 MB", type: "Stereo" },
  { name: "take-the-crown.mp3", size: "4.2 MB", type: "Stereo" },
  { name: "take-the-crown-remastered.mp3", size: "4.7 MB", type: "Stereo" },
  { name: "signal.mp3", size: "6.3 MB", type: "Stereo" },
];

const IMAGE_ASSETS = [
  "blender-character.png",
  "blender-scenery.png",
  "blender-props.png",
  "crown-still-intro.png",
  "crown-still-verse.png",
  "crown-still-drop.png",
  "crown-still-final.png",
  "sd-floaters.png",
  "sd-planet.png",
  "sd-terrain.png",
];

export function VideoEditor() {
  const [studioStatus, setStudioStatus] = useState<"checking" | "online" | "offline">("checking");
  const [activeTab, setActiveTab] = useState<"compositions" | "assets" | "actions">("compositions");
  const [selectedComposition, setSelectedComposition] = useState<string | null>(null);

  useEffect(() => {
    checkStudioStatus();
  }, []);

  const checkStudioStatus = async () => {
    setStudioStatus("checking");
    try {
      const response = await fetch(getVideoEditorUrl(), { method: "HEAD", mode: "no-cors" });
      setStudioStatus("online");
    } catch {
      setStudioStatus("offline");
    }
  };

  const handleRender = (compositionId: string) => {
    const audioFile = COMPOSITIONS.find(c => c.id === compositionId)?.audioFile;
    const propsPart = audioFile ? ` --props='{"audioFile":"${audioFile}"}'` : "";
    const cmd = `npx remotion render src/index.tsx ${compositionId} ${compositionId.toLowerCase()}.mp4${propsPart}`;
    alert(`Run this command in packages/video-editor:\n\n${cmd}`);
  };

  const handleRenderStill = (compositionId: string) => {
    const cmd = `npx remotion still src/index.tsx ${compositionId} preview.png --frame=30`;
    alert(`Run this command in packages/video-editor:\n\n${cmd}`);
  };

  return (
    <div className="p-6 animate-fade-in">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Film className="text-accent" size={24} />
            Video Editor
          </h1>
          <p className="text-muted mt-1">Remotion-powered music video studio</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="btn btn-ghost btn-sm flex items-center gap-1"
            onClick={checkStudioStatus}
            title="Refresh status"
          >
            <RefreshCw size={14} />
          </button>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-border">
            {studioStatus === "checking" && <Loader2 size={14} className="animate-spin text-muted" />}
            {studioStatus === "online" && <CheckCircle size={14} className="text-success" />}
            {studioStatus === "offline" && <XCircle size={14} className="text-error" />}
            <span className="text-xs font-medium">
              Studio {studioStatus === "checking" ? "checking..." : studioStatus}
            </span>
          </div>
          <a
            href={getVideoEditorUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className={`btn btn-primary flex items-center gap-2 ${studioStatus === "offline" ? "opacity-50 pointer-events-none" : ""}`}
          >
            <ExternalLink size={16} />
            Open Studio
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(["compositions", "assets", "actions"] as const).map((tab) => (
          <button
            key={tab}
            className={`btn ${activeTab === tab ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Compositions Tab */}
      {activeTab === "compositions" && (
        <div className="grid grid-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {COMPOSITIONS.map((comp) => (
            <div
              key={comp.id}
              onClick={() => setSelectedComposition(selectedComposition === comp.id ? null : comp.id)}
            >
              <Card
                glow={selectedComposition === comp.id}
                className="cursor-pointer"
              >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                  <Film size={20} className="text-accent" />
                </div>
                <StatusBadge status={comp.hasPreview ? "completed" : "processing"} />
              </div>
              <h3 className="font-semibold text-sm mb-1">{comp.name}</h3>
              <p className="text-xs text-muted mb-3">{comp.file} • {comp.duration}</p>

              {selectedComposition === comp.id && (
                <div className="mt-4 pt-4 border-t border-border space-y-2 animate-scale-in">
                  {comp.audioFile && (
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <Music size={12} />
                      {comp.audioFile}
                    </div>
                  )}
                  <div className="flex gap-2 mt-3">
                    <button
                      className="btn btn-sm btn-secondary flex-1 flex items-center justify-center gap-1"
                      onClick={(e) => { e.stopPropagation(); handleRenderStill(comp.id); }}
                      title="Render a preview frame"
                    >
                      <Eye size={12} />
                      Preview
                    </button>
                    <button
                      className="btn btn-sm btn-primary flex-1 flex items-center justify-center gap-1"
                      onClick={(e) => { e.stopPropagation(); handleRender(comp.id); }}
                      title="Render full video"
                    >
                      <Download size={12} />
                      Render
                    </button>
                  </div>
                  <a
                    href={`${getVideoEditorUrl()}/${comp.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-sm btn-ghost w-full flex items-center justify-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink size={12} />
                    Open in Studio
                  </a>
                </div>
              )}
            </Card>
          </div>
        ))}

        {/* Add New Composition */}
          <Card className="border-dashed border-2 border-border/50 bg-transparent flex flex-col items-center justify-center min-h-[180px] cursor-pointer hover:border-accent/50 transition-colors">
            <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mb-3">
              <Plus size={24} className="text-accent" />
            </div>
            <span className="text-sm font-medium text-muted">New Composition</span>
            <span className="text-xs text-muted mt-1">Copy template & customize</span>
          </Card>
        </div>
      )}

      {/* Assets Tab */}
      {activeTab === "assets" && (
        <div className="space-y-6">
          <Card>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Music size={18} className="text-accent" />
              Audio Tracks
            </h3>
            <div className="space-y-2">
              {AUDIO_ASSETS.map((audio) => (
                <div key={audio.name} className="flex items-center justify-between p-3 bg-background rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center">
                      <Music size={14} className="text-primary" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">{audio.name}</div>
                      <div className="text-xs text-muted">{audio.size} • {audio.type}</div>
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm">
                    <Play size={14} />
                  </button>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Image size={18} className="text-secondary" />
              Image Assets
            </h3>
            <div className="grid grid-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {IMAGE_ASSETS.map((img) => (
                <div key={img} className="aspect-video bg-background rounded-lg border border-border overflow-hidden flex items-center justify-center group relative">
                  <img
                    src={`/video-editor-assets/${img}`}
                    alt={img}
                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-xs text-white truncate block">{img}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Actions Tab */}
      {activeTab === "actions" && (
        <div className="grid grid-1 md:grid-cols-2 gap-4">
          <Card>
            <h3 className="text-lg font-semibold mb-4">Studio Control</h3>
            <div className="space-y-3">
              <a
                href={getVideoEditorUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary w-full flex items-center justify-center gap-2"
              >
                <ExternalLink size={16} />
                Open Remotion Studio
              </a>
              <button
                className="btn btn-secondary w-full flex items-center justify-center gap-2"
                onClick={checkStudioStatus}
              >
                <RefreshCw size={16} />
                Check Status
              </button>
              <div className="p-3 bg-background rounded-lg text-xs font-mono text-muted">
                cd packages/video-editor{'\n'}npm run dev
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="text-lg font-semibold mb-4">Quick Render</h3>
            <div className="space-y-3">
              {COMPOSITIONS.filter(c => c.hasPreview).map((comp) => (
                <div key={comp.id} className="flex items-center justify-between p-3 bg-background rounded-lg">
                  <div className="text-sm">{comp.name}</div>
                  <div className="flex gap-2">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleRenderStill(comp.id)}
                      title="Render preview frame"
                    >
                      <Eye size={14} />
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleRender(comp.id)}
                      title="Render full video"
                    >
                      <Download size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="text-lg font-semibold mb-4">Create New</h3>
            <div className="space-y-3">
              <button className="btn btn-secondary w-full flex items-center justify-center gap-2">
                <Plus size={16} />
                New Composition
              </button>
              <button className="btn btn-ghost w-full flex items-center justify-center gap-2">
                <Music size={16} />
                Upload Audio
              </button>
              <div className="p-3 bg-background rounded-lg text-xs text-muted">
                Copy <code className="text-cyan">Template.tsx</code>, customize config & lyrics, register in <code className="text-cyan">Root.tsx</code>
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="text-lg font-semibold mb-4">Keyboard Shortcuts</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Play/Pause</span>
                <kbd className="px-2 py-0.5 bg-background rounded text-xs">Space</kbd>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Next frame</span>
                <kbd className="px-2 py-0.5 bg-background rounded text-xs">→</kbd>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Previous frame</span>
                <kbd className="px-2 py-0.5 bg-background rounded text-xs">←</kbd>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Go to start</span>
                <kbd className="px-2 py-0.5 bg-background rounded text-xs">Home</kbd>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Render</span>
                <kbd className="px-2 py-0.5 bg-background rounded text-xs">Ctrl+R</kbd>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
