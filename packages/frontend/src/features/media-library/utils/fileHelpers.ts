export function getFileTypeCategory(fileType: string): string {
  const ext = fileType.split(".").pop()?.toLowerCase() || "";
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
    mp2: "video",
    mpe: "video",
    mpeg: "video",
    mpg: "video",
    m2v: "video",
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

  const extension = fileType.split(".").pop()?.toLowerCase() || "";
  if (extension in categoryMap) {
    return categoryMap[extension as keyof typeof categoryMap];
  }

  if (fileType.includes("audio")) return "audio";
  if (fileType.includes("video")) return "video";
  if (fileType.includes("image") || ["img", "jpg", "jpeg", "png", "gif"].includes(ext))
    return "image";
  if (fileType.includes("model") || ["3ds", "fbx", "obj", "glb", "blend", "stl"].includes(ext))
    return "model";
  if (["txt", "pdf", "doc", "docx", "xls", "xlsx"].includes(ext))
    return "document";
  if (["json", "csv", "xml", "md", "log"].includes(ext)) return "document";

  return "other";
}

export function getFileIcon(fileType: string): string {
  const ext = fileType.split(".").pop()?.toLowerCase() || "";
  const iconMap: Record<string, string> = {
    mp3: "🎵",
    wav: "🎵",
    flac: "🎵",
    ogg: "🎵",
    m4a: "🎵",
    aac: "🎵",
    svg: "🎵",
    mp4: "🎬",
    webm: "🎬",
    avi: "🎬",
    mkv: "🎬",
    mov: "🎬",
    wmv: "🎬",
    flv: "🎬",
    ts: "🎬",
    m4v: "🎬",
    jpg: "🖼️",
    jpeg: "🖼️",
    png: "🖼️",
    gif: "🖼️",
    bmp: "🖼️",
    webp: "🖼️",
    ico: "🖼️",
    fbx: "🤖",
    obj: "🤖",
    glb: "🤖",
    blend: "🤖",
    stl: "🤖",
    "3ds": "🤖",
    pdf: "📄",
    doc: "📄",
    docx: "📄",
    xls: "📄",
    xlsx: "📄",
    ppt: "📄",
    pptx: "📄",
    txt: "📝",
    csv: "📝",
    json: "📋",
    xml: "📋",
    md: "📝",
    log: "📝",
  };

  if (ext in iconMap) {
    return iconMap[ext as keyof typeof iconMap];
  }

  if (fileType.includes("audio")) return "🎵";
  if (fileType.includes("video")) return "🎬";
  if (fileType.includes("image")) return "🖼️";
  if (fileType.includes("model")) return "🤖";
  if (fileType.includes("txt")) return "📝";

  return "📁";
}
