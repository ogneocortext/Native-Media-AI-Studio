import React, { useCallback, useEffect, useRef, useState } from "react";

interface ShaderCanvasProps {
  fragmentShader: string;
  uniformsRef: React.MutableRefObject<Record<string, number>>;
  width?: number;
  height?: number;
  className?: string;
  debug?: boolean;
  /** Time multiplier for speed control (1 = normal, 0.5 = half, 2 = double) */
  timeScale?: number;
  /** Enable feedback frame buffer (ping-pong FBO for trails/tunnels) */
  feedback?: boolean;
  /** Feedback zoom factor per frame (1.0 = no zoom, 1.01 = slow zoom-in) */
  feedbackZoom?: number;
  /** Feedback rotation per frame in radians */
  feedbackRotation?: number;
  /** Feedback decay/fade factor (0.95 = slow fade, 0.99 = long trails) */
  feedbackDecay?: number;
  /** Feedback swirl intensity — vortex rotation scaled by distance from center (0 = off) */
  feedbackSwirl?: number;
  /** Feedback radial flow — push/pull from center (negative = inward, positive = outward) */
  feedbackRadial?: number;
  /**
   * Where the rendered canvas element is published. Frame-accurate export
   * captures the canvas the frames actually land on, and the visualizer page
   * mounts more than one canvas (three-js is always mounted), so the lane that
   * renders names its own rather than leaving the exporter to guess from the
   * DOM.
   */
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

interface FBO {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

/**
 * Check for WebGL errors and log them with context. Call after critical GL
 * operations during development/debug to catch silent failures.
 */
function glCheckError(gl: WebGLRenderingContext, where: string, debug = false): boolean {
  let err: GLenum;
  let hadError = false;
  while ((err = gl.getError()) !== gl.NO_ERROR) {
    hadError = true;
    if (debug) {
      console.error(`[WebGL2] GL error 0x${err.toString(16)} at ${where}`);
    }
  }
  return !hadError;
}

/**
 * Bind a WebGL program only if it differs from the currently bound one,
 * avoiding redundant gl.useProgram() calls.
 */
function glUseProgram(
  gl: WebGLRenderingContext,
  program: WebGLProgram | null,
  currentRef: React.MutableRefObject<WebGLProgram | null>,
): boolean {
  if (!program) return false;
  if (currentRef.current === program) return true;
  gl.useProgram(program);
  currentRef.current = program;
  return true;
}

function createFBO(gl: WebGLRenderingContext, width: number, height: number): FBO | null {
  const texture = gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  glCheckError(gl, "createFBO texImage2D");

  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) return null;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    return null;
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  glCheckError(gl, "createFBO");
  return { framebuffer, texture, width, height };
}

function deleteFBO(gl: WebGLRenderingContext, fbo: FBO | null) {
  if (!fbo) return;
  gl.deleteFramebuffer(fbo.framebuffer);
  gl.deleteTexture(fbo.texture);
}

/**
 * Load an image into a WebGL2 texture using the placeholder+async pattern:
 * upload a 1x1 opaque pixel immediately so the texture is usable right away,
 * then replace it with the image data when it loads.
 *
 * Based on MDN/WebGL2Fundamentals best practices:
 *   - Cross-origin images need img.crossOrigin = "anonymous"
 *   - generateMipmap() after upload enables trilinear filtering
 *   - CLAMP_TO_EDGE wrapping for feedback/non-tiling textures
 *
 * @param gl - WebGL2 rendering context
 * @param url - Image URL to load
 * @param generateMipmaps - Whether to generate mipmap chain (33% memory overhead)
 * @param wrapS - Texture wrap mode for S axis
 * @param wrapT - Texture wrap mode for T axis
 * @param minFilter - Minification filter
 * @param magFilter - Magnification filter
 * @returns Promise resolving to { texture, width, height } or null on failure
 */
export async function loadTextureFromImage(
  gl: WebGLRenderingContext,
  url: string,
  {
    generateMipmaps = false,
    wrapS = gl.CLAMP_TO_EDGE,
    wrapT = gl.CLAMP_TO_EDGE,
    minFilter = generateMipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
    magFilter = gl.LINEAR,
    anisotropic = false,
  }: {
    generateMipmaps?: boolean;
    wrapS?: GLenum;
    wrapT?: GLenum;
    minFilter?: GLenum;
    magFilter?: GLenum;
    anisotropic?: boolean;
  } = {},
): Promise<{ texture: WebGLTexture; width: number; height: number } | null> {
  const texture = gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);

  // Placeholder 1x1 opaque pixel — texture is immediately usable
  const pixel = new Uint8Array([0, 0, 255, 255]);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
  glCheckError(gl, "loadTexture placeholder");

  const img = new Image();
  img.crossOrigin = "anonymous";

  return new Promise((resolve) => {
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      if (generateMipmaps) {
        gl.generateMipmap(gl.TEXTURE_2D);
      }
      // Apply anisotropic filtering if requested and extension available
      if (anisotropic) {
        const ext = gl.getExtension(
          "EXT_texture_filter_anisotropic",
        ) as EXT_texture_filter_anisotropic | null;
        if (ext) {
          const maxAniso = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
          gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
        }
      }
      glCheckError(gl, "loadTexture image upload");

      resolve({ texture, width: img.width, height: img.height });
    };
    img.onerror = () => {
      console.error("[WebGL2] Failed to load texture:", url);
      gl.deleteTexture(texture);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Dispose of a WebGL texture and its associated resources.
 * Safe to call on null textures.
 */
export function disposeTexture(gl: WebGLRenderingContext, texture: WebGLTexture | null) {
  if (texture) {
    gl.deleteTexture(texture);
  }
}

/**
 * Optional anisotropic filtering extension for better texture quality at
 * oblique viewing angles. Falls back gracefully if unsupported.
 */
export function getAnisotropicExt(
  gl: WebGLRenderingContext,
): EXT_texture_filter_anisotropic | null {
  return gl.getExtension("EXT_texture_filter_anisotropic") as EXT_texture_filter_anisotropic | null;
}

/**
 * Apply anisotropic filtering to the currently bound texture.
 * Returns the anisotropy level applied (0 if unsupported or not applied).
 */
export function setAnisotropicFiltering(
  gl: WebGLRenderingContext,
  ext: EXT_texture_filter_anisotropic | null,
  maxAniso: number = 16,
): number {
  if (!ext) return 0;
  const supported = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
  const level = Math.min(maxAniso, supported);
  gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, level);
  glCheckError(gl, "setAnisotropicFiltering");
  return level;
}

/**
 * Texture unit tracker — records which texture is bound to which unit
 * to avoid redundant activeTexture/bindTexture calls during render.
 */
function createTextureUnitTracker(
  gl: WebGLRenderingContext,
  maxUnits: number,
): {
  bind: (unit: number, texture: WebGLTexture | null) => void;
  active: (unit: number) => void;
  getBound: (unit: number) => WebGLTexture | null;
} {
  const bindings: (WebGLTexture | null)[] = new Array(maxUnits).fill(null);
  let activeUnit = 0;

  const doActive = (unit: number) => {
    if (activeUnit === unit) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    activeUnit = unit;
  };

  return {
    bind: (unit: number, texture: WebGLTexture | null) => {
      if (bindings[unit] === texture) return;
      doActive(unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      bindings[unit] = texture;
    },
    active: doActive,
    getBound: (unit: number) => bindings[unit],
  };
}

/**
 * Generic WebGL shader canvas — compiles a fragment shader and renders it
 * with audio-reactive uniforms. Uses a fullscreen quad approach.
 *
 * Reads uniforms from a ref so the parent can update them every frame
 * without forcing React re-renders.
 *
 * Supports optional ping-pong feedback framebuffers for trail/tunnel effects.
 */
export function ShaderCanvas({
  fragmentShader,
  uniformsRef,
  className,
  debug = false,
  timeScale = 1,
  feedback = false,
  feedbackZoom = 1.0,
  feedbackRotation = 0.0,
  feedbackDecay = 0.97,
  canvasRef: externalCanvasRef,
}: ShaderCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const bufferRef = useRef<WebGLBuffer | null>(null);
  const vsRef = useRef<WebGLShader | null>(null);
  const fsRef = useRef<WebGLShader | null>(null);
  const uniformLocsRef = useRef<Record<string, WebGLUniformLocation | null>>({});
  const compositeUniformLocsRef = useRef<Record<string, WebGLUniformLocation | null>>({});
  const [contextRestored, setContextRestored] = useState(0);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef(performance.now());
  const debugRef = useRef(debug);
  const feedbackRef = useRef(feedback);
  const feedbackZoomRef = useRef(feedbackZoom);
  const feedbackRotationRef = useRef(feedbackRotation);
  const feedbackDecayRef = useRef(feedbackDecay);
  const fboRef = useRef<{ read: FBO | null; write: FBO | null }>({ read: null, write: null });
  const compositeProgramRef = useRef<WebGLProgram | null>(null);
  const compositeBufferRef = useRef<WebGLBuffer | null>(null);
  const currentProgramRef = useRef<WebGLProgram | null>(null);
  const textureUnitTrackerRef = useRef<ReturnType<typeof createTextureUnitTracker> | null>(null);
  const anisotropicExtRef = useRef<EXT_texture_filter_anisotropic | null>(null);

  useEffect(() => {
    debugRef.current = debug;
  }, [debug]);

  useEffect(() => {
    feedbackRef.current = feedback;
    feedbackZoomRef.current = feedbackZoom;
    feedbackRotationRef.current = feedbackRotation;
    feedbackDecayRef.current = feedbackDecay;
  }, [feedback, feedbackZoom, feedbackRotation, feedbackDecay]);

  useEffect(() => {
    const onHash = () => {
      debugRef.current = window.location.hash === "#shader-debug";
    };
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const initGL = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl =
      canvas.getContext("webgl2", {
        antialias: true,
        alpha: false,
        // Frame snapshots (More → Snapshot) read this canvas via
        // toDataURL(); without a preserved buffer the readback is blank.
        preserveDrawingBuffer: true,
      }) ??
      canvas.getContext("webgl", {
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      });
    if (!gl) {
      console.error("WebGL not supported");
      return;
    }
    // If we got a WebGL1 context, we can't use WebGL2-only features.
    // Cast to WebGL2RenderingContext — all the calls we make are WebGL1-compatible,
    // so this is safe at runtime. WebGL2-specific paths (e.g. drawBuffers) check
    // for the extension at runtime.
    glRef.current = gl as unknown as WebGL2RenderingContext;

    // Debug: report renderer info and capability limits
    if (debugRef.current) {
      const gl2 = gl as WebGL2RenderingContext;
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        console.log(
          "[WebGL2] Renderer:",
          gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
          "| Vendor:",
          gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
        );
      }
      console.log(
        "[WebGL2] Max texture image units:",
        gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
        "| Max vertex texture image units:",
        gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
        "| Max texture size:",
        gl.getParameter(gl.MAX_TEXTURE_SIZE),
        "| Max color attachments:",
        gl2.getParameter(gl2.MAX_COLOR_ATTACHMENTS),
      );
      // Verify shader precision formats
      for (const shaderType of [gl.FRAGMENT_SHADER, gl.VERTEX_SHADER]) {
        for (const precision of [gl.LOW_FLOAT, gl.MEDIUM_FLOAT, gl.HIGH_FLOAT]) {
          const fmt = gl.getShaderPrecisionFormat(shaderType, precision);
          if (fmt) {
            console.log(
              `[WebGL2] Shader precision ${shaderType === gl.FRAGMENT_SHADER ? "frag" : "vert"}/${precision}: rangeMin=${fmt.rangeMin} rangeMax=${fmt.rangeMax} precision=${fmt.precision}`,
            );
          }
        }
      }
    }
    glCheckError(gl, "initGL setup", debugRef.current);

    // Initialize texture unit tracker for efficient multi-texture binding
    const maxUnits = Math.min(
      gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
      32, // WebGL2 guarantees at least 16 fragment units; cap tracker at 32
    );
    textureUnitTrackerRef.current = createTextureUnitTracker(gl, maxUnits);

    // Pre-load anisotropic filtering extension if available
    anisotropicExtRef.current = getAnisotropicExt(gl);
    if (anisotropicExtRef.current && debugRef.current) {
      const maxAniso = gl.getParameter(anisotropicExtRef.current.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      console.log(`[WebGL2] Anisotropic filtering max: ${maxAniso}x`);
    }

    if (programRef.current) {
      if (vsRef.current) {
        gl.detachShader(programRef.current, vsRef.current);
        gl.deleteShader(vsRef.current);
        vsRef.current = null;
      }
      if (fsRef.current) {
        gl.detachShader(programRef.current, fsRef.current);
        gl.deleteShader(fsRef.current);
        fsRef.current = null;
      }
      gl.deleteProgram(programRef.current);
      programRef.current = null;
    }
    if (bufferRef.current) {
      gl.deleteBuffer(bufferRef.current);
      bufferRef.current = null;
    }

    const vsSource = `
      attribute vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    glCheckError(gl, "compile vertex shader", debugRef.current);
    vsRef.current = vs;
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error("Vertex shader error:", gl.getShaderInfoLog(vs));
      return;
    }

    const fsSource = fragmentShader;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
    glCheckError(gl, "compile fragment shader", debugRef.current);
    fsRef.current = fs;
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error("Fragment shader error:", gl.getShaderInfoLog(fs));
      return;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    glCheckError(gl, "link program", debugRef.current);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Program link error:", gl.getProgramInfoLog(program));
      return;
    }

    programRef.current = program;
    glUseProgram(gl, program, currentProgramRef);
    glCheckError(gl, "use program", debugRef.current);

    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buffer = gl.createBuffer();
    bufferRef.current = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    glCheckError(gl, "bufferData vertices", debugRef.current);

    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uniformLocs: Record<string, WebGLUniformLocation | null> = {};
    const uniformNames = [
      "u_time",
      "u_bass",
      "u_mid",
      "u_treble",
      "u_beat",
      "u_energy",
      "u_peak",
      "u_resolution",
      "u_sub",
      "u_high",
      "u_transient",
      "u_centroid",
      "u_trail",
      // Motion-vocabulary camera offset (plan 2.7): a vec2 UV
      // shift driven by the motion driver's camera-offset channel.
      // getUniformLocation returns null for shaders that don't
      // declare it, and uniform2f(null, x, y) is a no-op, so a
      // shader opts in by declaring the uniform.
      "u_camera_offset",
      // Key-derived palette (docs/architecture/chroma-hue-mapping.md, Q5).
      // Present for every shader; getUniformLocation returns null for any that
      // does not declare them, and uniform1f(null, x) is a no-op, so a shader
      // opts in by declaring the uniform and using it.
      "u_key_hue",
      "u_key_sat",
      "u_key_conf",
      // Tier 2 per-frame chroma hue (chroma-hue-mapping.md). -1 = inactive.
      "u_chroma_hue",
      "u_feedback_texture",
    ];
    for (const name of uniformNames) {
      uniformLocs[name] = gl.getUniformLocation(program, name);
    }
    uniformLocsRef.current = uniformLocs;

    if (feedbackRef.current) {
      initCompositeProgram(gl);
    }
  }, [fragmentShader]);

  const initCompositeProgram = useCallback((gl: WebGLRenderingContext) => {
    if (compositeProgramRef.current) {
      gl.deleteProgram(compositeProgramRef.current);
      compositeProgramRef.current = null;
    }
    if (compositeBufferRef.current) {
      gl.deleteBuffer(compositeBufferRef.current);
      compositeBufferRef.current = null;
    }

    const vsSource = `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() {
        v_uv = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;
    const fsSource = `
      precision mediump float;
      varying vec2 v_uv;
      uniform sampler2D u_feedback_texture;
      uniform float u_feedback_decay;
      uniform float u_feedback_zoom;
      uniform float u_feedback_rotation;
      uniform float u_feedback_swirl;
      uniform float u_feedback_radial;
      uniform vec2 u_resolution;

      void main() {
        vec2 uv = v_uv;
        vec2 centered = uv - 0.5;

        float cosR = cos(u_feedback_rotation);
        float sinR = sin(u_feedback_rotation);
        centered = vec2(
          centered.x * cosR - centered.y * sinR,
          centered.x * sinR + centered.y * cosR
        );

        // Swirl: extra rotation scaled by distance from center (vortex effect)
        float dist = length(centered);
        float swirlAngle = u_feedback_swirl * dist;
        float cosS = cos(swirlAngle);
        float sinS = sin(swirlAngle);
        centered = vec2(
          centered.x * cosS - centered.y * sinS,
          centered.x * sinS + centered.y * cosS
        );

        // Radial flow: push outward or pull inward from center
        centered *= (1.0 + u_feedback_radial * dist);

        centered /= u_feedback_zoom;
        uv = centered + 0.5;

        vec4 prev = texture2D(u_feedback_texture, uv) * u_feedback_decay;
        gl_FragColor = prev;
      }
    `;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    glCheckError(gl, "composite compile vertex shader", debugRef.current);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error("Composite VS error:", gl.getShaderInfoLog(vs));
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
    glCheckError(gl, "composite compile fragment shader", debugRef.current);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error("Composite FS error:", gl.getShaderInfoLog(fs));
      return;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    glCheckError(gl, "composite link program", debugRef.current);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Composite link error:", gl.getProgramInfoLog(program));
      return;
    }

    compositeProgramRef.current = program;
    glUseProgram(gl, program, currentProgramRef);
    glCheckError(gl, "composite use program", debugRef.current);

    // Cache composite shader uniform locations so the render loop
    // doesn't call gl.getUniformLocation every frame.
    const compUniformNames = [
      "u_feedback_texture",
      "u_feedback_decay",
      "u_feedback_zoom",
      "u_feedback_rotation",
      "u_feedback_swirl",
      "u_feedback_radial",
      "u_resolution",
    ];
    const compLocs: Record<string, WebGLUniformLocation | null> = {};
    for (const name of compUniformNames) {
      compLocs[name] = gl.getUniformLocation(program, name);
    }
    compositeUniformLocsRef.current = compLocs;

    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buffer = gl.createBuffer();
    compositeBufferRef.current = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.deleteShader(vs);
    gl.deleteShader(fs);
  }, []);

  const ensureFBOs = useCallback((gl: WebGLRenderingContext, width: number, height: number) => {
    const current = fboRef.current;
    if (
      current.read &&
      current.write &&
      current.read.width === width &&
      current.read.height === height
    ) {
      return;
    }
    deleteFBO(gl, current.read);
    deleteFBO(gl, current.write);
    const read = createFBO(gl, width, height);
    const write = createFBO(gl, width, height);
    fboRef.current = { read, write };
  }, []);

  useEffect(() => {
    initGL();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const gl = glRef.current;
      if (gl) {
        if (programRef.current) {
          if (vsRef.current) {
            gl.detachShader(programRef.current, vsRef.current);
            gl.deleteShader(vsRef.current);
            vsRef.current = null;
          }
          if (fsRef.current) {
            gl.detachShader(programRef.current, fsRef.current);
            gl.deleteShader(fsRef.current);
            fsRef.current = null;
          }
          gl.deleteProgram(programRef.current);
          programRef.current = null;
        }
        if (bufferRef.current) {
          gl.deleteBuffer(bufferRef.current);
          bufferRef.current = null;
        }
        deleteFBO(gl, fboRef.current.read);
        deleteFBO(gl, fboRef.current.write);
        fboRef.current = { read: null, write: null };
        if (compositeProgramRef.current) {
          gl.deleteProgram(compositeProgramRef.current);
          compositeProgramRef.current = null;
        }
        if (compositeBufferRef.current) {
          gl.deleteBuffer(compositeBufferRef.current);
          compositeBufferRef.current = null;
        }
      }
    };
  }, [initGL]);

  useEffect(() => {
    const gl = glRef.current;
    const program = programRef.current;
    const canvas = canvasRef.current;
    if (!gl || !program || !canvas) return;

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      console.warn("WebGL context lost, pausing render loop...");
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      glRef.current = null;
    };

    const handleContextCreationError = (e: Event) => {
      console.error("WebGL context creation failed:", e);
      if (debugRef.current) {
        console.error("Try enabling WebGL2 in browser flags or updating graphics drivers.");
      }
    };

    const handleContextRestored = () => {
      console.log("WebGL context restored, reinitializing...");
      initGL();
      setContextRestored((v) => v + 1);
    };

    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    canvas.addEventListener("webglcontextcreationerror", handleContextCreationError);

    let ro: ResizeObserver | null = null;
    const applySize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (feedbackRef.current) {
        ensureFBOs(gl, canvas.width, canvas.height);
      }
    };
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(applySize);
      ro.observe(canvas);
    }
    applySize();

    let frameCount = 0;
    const lastSample = new Uint8Array(9 * 4);
    const pixelView = new Uint8Array(4);

    const render = () => {
      const time = ((performance.now() - startTimeRef.current) / 1000) * timeScale;
      const visible =
        (typeof document === "undefined" || !document.hidden) &&
        canvas.clientWidth > 0 &&
        canvas.clientHeight > 0;
      if (visible) {
        const locs = uniformLocsRef.current;
        const u = uniformsRef.current;
        const useFeedback = feedbackRef.current && fboRef.current.read && fboRef.current.write;

        if (useFeedback) {
          const { read, write } = fboRef.current;
          if (!write || !read) {
            return;
          }

          gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
          gl.viewport(0, 0, write.width, write.height);
          glUseProgram(gl, program, currentProgramRef);

          gl.uniform1f(locs.u_time, time);
          gl.uniform1f(locs.u_bass, u.bass ?? 0);
          gl.uniform1f(locs.u_mid, u.mid ?? 0);
          gl.uniform1f(locs.u_treble, u.treble ?? 0);
          gl.uniform1f(locs.u_beat, u.beat ?? 0);
          gl.uniform1f(locs.u_energy, u.energy ?? 0);
          gl.uniform1f(locs.u_peak, u.peak ?? 0);
          gl.uniform1f(locs.u_sub, u.sub ?? 0);
          gl.uniform1f(locs.u_high, u.high ?? 0);
          gl.uniform1f(locs.u_transient, u.transient ?? 0);
          gl.uniform1f(locs.u_centroid, u.centroid ?? 0);
          gl.uniform1f(locs.u_trail, u.trail ?? 0);
          gl.uniform2f(locs.u_camera_offset, u.cameraOffsetX ?? 0, u.cameraOffsetY ?? 0);
          gl.uniform1f(locs.u_key_hue, u.keyHue ?? 0);
          gl.uniform1f(locs.u_key_sat, u.keySat ?? 0);
          gl.uniform1f(locs.u_key_conf, u.keyConf ?? 0);
          gl.uniform1f(locs.u_chroma_hue, u.chromaHue ?? -1);
          gl.uniform2f(locs.u_resolution, write.width, write.height);

          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, read.texture);
          const feedbackLoc = locs.u_feedback_texture;
          if (feedbackLoc) gl.uniform1i(feedbackLoc, 0);

          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, canvas.width, canvas.height);
          const compProgram = compositeProgramRef.current;
          const compLocs = compositeUniformLocsRef.current;
          if (compProgram && compLocs) {
            glUseProgram(gl, compProgram, currentProgramRef);
            gl.uniform1f(compLocs.u_feedback_decay, feedbackDecayRef.current);
            gl.uniform1f(compLocs.u_feedback_zoom, feedbackZoomRef.current);
            gl.uniform1f(compLocs.u_feedback_rotation, feedbackRotationRef.current);
            gl.uniform1f(compLocs.u_feedback_swirl, u.feedbackSwirl ?? 0);
            gl.uniform1f(compLocs.u_feedback_radial, u.feedbackRadial ?? 0);
            gl.uniform2f(compLocs.u_resolution, canvas.width, canvas.height);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, write.texture);
            if (compLocs.u_feedback_texture) gl.uniform1i(compLocs.u_feedback_texture, 0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          }

          fboRef.current = { read: write, write: read };
        } else {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, canvas.width, canvas.height);
          glUseProgram(gl, program, currentProgramRef);

          gl.uniform1f(locs.u_time, time);
          gl.uniform1f(locs.u_bass, u.bass ?? 0);
          gl.uniform1f(locs.u_mid, u.mid ?? 0);
          gl.uniform1f(locs.u_treble, u.treble ?? 0);
          gl.uniform1f(locs.u_beat, u.beat ?? 0);
          gl.uniform1f(locs.u_energy, u.energy ?? 0);
          gl.uniform1f(locs.u_peak, u.peak ?? 0);
          gl.uniform1f(locs.u_sub, u.sub ?? 0);
          gl.uniform1f(locs.u_high, u.high ?? 0);
          gl.uniform1f(locs.u_transient, u.transient ?? 0);
          gl.uniform1f(locs.u_centroid, u.centroid ?? 0);
          gl.uniform1f(locs.u_trail, u.trail ?? 0);
          gl.uniform2f(locs.u_camera_offset, u.cameraOffsetX ?? 0, u.cameraOffsetY ?? 0);
          gl.uniform1f(locs.u_key_hue, u.keyHue ?? 0);
          gl.uniform1f(locs.u_key_sat, u.keySat ?? 0);
          gl.uniform1f(locs.u_key_conf, u.keyConf ?? 0);
          gl.uniform1f(locs.u_chroma_hue, u.chromaHue ?? -1);
          gl.uniform2f(locs.u_resolution, canvas.width, canvas.height);

          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
      }

      if (debugRef.current) {
        frameCount++;
        if (frameCount % 60 === 0) {
          const w = canvas.width;
          const h = canvas.height;
          const stepX = Math.max(1, Math.floor(w / 3));
          const stepY = Math.max(1, Math.floor(h / 3));
          const sample = new Uint8Array(9 * 4);
          let idx = 0;
          for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
              const x = Math.min(col * stepX, w - 1);
              const y = Math.min(row * stepY, h - 1);
              gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelView);
              sample.set(pixelView, idx);
              idx += 4;
            }
          }
          lastSample.set(sample);
        }
      }

      rafRef.current = requestAnimationFrame(render);
    };

    render();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro?.disconnect();
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      canvas.removeEventListener("webglcontextcreationerror", handleContextCreationError);
    };
  }, [uniformsRef, fragmentShader, initGL, contextRestored, ensureFBOs]);

  // The lane that renders here publishes this canvas to the exporter, which
  // must capture *this* one: the visualizer page always mounts a second
  // (three-js) canvas, and querying the DOM for "a canvas" grabbed whichever
  // came first in document order.
  const attachCanvas = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      if (externalCanvasRef) externalCanvasRef.current = node;
    },
    [externalCanvasRef],
  );

  return (
    <canvas
      ref={attachCanvas}
      className={className}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
