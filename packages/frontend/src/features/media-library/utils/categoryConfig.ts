import type { MediaFile } from "../hooks/useMediaFiles";

export interface CategoryConfig {
  key: string;
  label: string;
  icon: string;
  color: string;
  fileTypes: string[];
}

export const CATEGORY_CONFIG: CategoryConfig[] = [
  {
    key: "audio",
    label: "Audio",
    icon: "🎵",
    color: "text-green-500",
    fileTypes: ["mp3", "wav", "flac", "ogg", "m4a", "aac", "wma", "aif", "opus"],
  },
  {
    key: "video",
    label: "Video",
    icon: "🎬",
    color: "text-blue-500",
    fileTypes: [
      "mp4",
      "webm",
      "avi",
      "mkv",
      "mov",
      "wmv",
      "flv",
      "ts",
      "m4v",
      "mp2",
      "mpe",
      "mpeg",
      "mpg",
      "m2v",
    ],
  },
  {
    key: "image",
    label: "Image",
    icon: "🖼️",
    color: "text-yellow-500",
    fileTypes: [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "bmp",
      "svg",
      "webp",
      "ico",
      "tiff",
      "tif",
    ],
  },
  {
    key: "model",
    label: "3D Model",
    icon: "🤖",
    color: "text-purple-500",
    fileTypes: ["3ds", "fbx", "obj", "glb", "blend", "dae", "stl", "max", "skp"],
  },
  {
    key: "document",
    label: "Document",
    icon: "📄",
    color: "text-red-500",
    fileTypes: [
      "txt",
      "pdf",
      "doc",
      "docx",
      "xls",
      "xlsx",
      "ppt",
      "pptx",
      "csv",
      "json",
      "xml",
      "md",
      "log",
    ],
  },
];

export function getCategoryForFile(file: MediaFile): string {
  const extension = file.file_type.split(".").pop()?.toLowerCase() || "";
  const categoryMap: Record<string, string> = {
    mp3: "audio",
    wav: "audio",
    flac: "audio",
    ogg: "audio",
    m4a: "audio",
    aac: "audio",
    wma: "audio",
    aif: "audio",
    opus: "audio",
    mp4: "video",
    webm: "video",
    avi: "video",
    mkv: "video",
    mov: "video",
    wmv: "video",
    flv: "video",
    ts: "video",
    m4v: "video",
    img: "image",
    jpg: "image",
    jpeg: "image",
    png: "image",
    gif: "image",
    bmp: "image",
    svg: "image",
    webp: "image",
    ico: "image",
    "3ds": "model",
    fbx: "model",
    obj: "model",
    glb: "model",
    blend: "model",
    dae: "model",
    stl: "model",
    max: "model",
    skp: "model",
    aab: "model",
    xxx: "document",
    pdf: "document",
    doc: "document",
    docx: "document",
    xls: "document",
    xlsx: "document",
    ppt: "document",
    pptx: "document",
    txt: "document",
    csv: "document",
    json: "document",
    xml: "document",
    rtf: "document",
    md: "document",
    log: "document",
  };

  const cat = categoryMap[extension] || "other";
  return cat;
}
