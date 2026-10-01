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
}

interface FBO {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
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
  return { framebuffer, texture, width, height };
}

function deleteFBO(gl: WebGLRenderingContext, fbo: FBO | null) {
  if (!fbo) return;
  gl.deleteFramebuffer(fbo.framebuffer);
  gl.deleteTexture(fbo.texture);
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
}: ShaderCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const bufferRef = useRef<WebGLBuffer | null>(null);
  const vsRef = useRef<WebGLShader | null>(null);
  const fsRef = useRef<WebGLShader | null>(null);
  const uniformLocsRef = useRef<Record<string, WebGLUniformLocation | null>>({});
  const [contextRestored, setContextRestored] = useState(0);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef(Date.now());
  const debugRef = useRef(debug);
  const feedbackRef = useRef(feedback);
  const feedbackZoomRef = useRef(feedbackZoom);
  const feedbackRotationRef = useRef(feedbackRotation);
  const feedbackDecayRef = useRef(feedbackDecay);
  const fboRef = useRef<{ read: FBO | null; write: FBO | null }>({ read: null, write: null });
  const compositeProgramRef = useRef<WebGLProgram | null>(null);
  const compositeBufferRef = useRef<WebGLBuffer | null>(null);

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

    const gl = canvas.getContext("webgl", {
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      console.error("WebGL not supported");
      return;
    }
    glRef.current = gl;

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

    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    vsRef.current = vs;
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error("Vertex shader error:", gl.getShaderInfoLog(vs));
      return;
    }

    const fsSource = fragmentShader;
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
    fsRef.current = fs;
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error("Fragment shader error:", gl.getShaderInfoLog(fs));
      return;
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Program link error:", gl.getProgramInfoLog(program));
      return;
    }

    programRef.current = program;
    gl.useProgram(program);

    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buffer = gl.createBuffer();
    bufferRef.current = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

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
      // Key-derived palette (docs/architecture/chroma-hue-mapping.md, Q5).
      // Present for every shader; getUniformLocation returns null for any that
      // does not declare them, and uniform1f(null, x) is a no-op, so a shader
      // opts in by declaring the uniform and using it.
      "u_key_hue",
      "u_key_sat",
      "u_key_conf",
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

        centered /= u_feedback_zoom;
        uv = centered + 0.5;

        vec4 prev = texture2D(u_feedback_texture, uv) * u_feedback_decay;
        gl_FragColor = prev;
      }
    `;

    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error("Composite VS error:", gl.getShaderInfoLog(vs));
      return;
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error("Composite FS error:", gl.getShaderInfoLog(fs));
      return;
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Composite link error:", gl.getProgramInfoLog(program));
      return;
    }

    compositeProgramRef.current = program;
    gl.useProgram(program);

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

  const ensureFBOs = useCallback(
    (gl: WebGLRenderingContext, width: number, height: number) => {
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
    },
    [],
  );

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

    const handleContextRestored = () => {
      console.log("WebGL context restored, reinitializing...");
      initGL();
      setContextRestored((v) => v + 1);
    };

    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

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
      const time = ((Date.now() - startTimeRef.current) / 1000) * timeScale;
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
          gl.useProgram(program);

          gl.uniform1f(locs["u_time"], time);
          gl.uniform1f(locs["u_bass"], u.bass ?? 0);
          gl.uniform1f(locs["u_mid"], u.mid ?? 0);
          gl.uniform1f(locs["u_treble"], u.treble ?? 0);
          gl.uniform1f(locs["u_beat"], u.beat ?? 0);
          gl.uniform1f(locs["u_energy"], u.energy ?? 0);
          gl.uniform1f(locs["u_peak"], u.peak ?? 0);
          gl.uniform1f(locs["u_sub"], u.sub ?? 0);
          gl.uniform1f(locs["u_high"], u.high ?? 0);
          gl.uniform1f(locs["u_transient"], u.transient ?? 0);
          gl.uniform1f(locs["u_centroid"], u.centroid ?? 0);
          gl.uniform1f(locs["u_trail"], u.trail ?? 0);
          gl.uniform1f(locs["u_key_hue"], u.keyHue ?? 0);
          gl.uniform1f(locs["u_key_sat"], u.keySat ?? 0);
          gl.uniform1f(locs["u_key_conf"], u.keyConf ?? 0);
          gl.uniform2f(locs["u_resolution"], write.width, write.height);

          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, read.texture);
          const feedbackLoc = locs["u_feedback_texture"];
          if (feedbackLoc) gl.uniform1i(feedbackLoc, 0);

          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, canvas.width, canvas.height);
          const compProgram = compositeProgramRef.current;
          if (compProgram) {
            gl.useProgram(compProgram);
            const compLocs = {
              u_feedback_texture: gl.getUniformLocation(compProgram, "u_feedback_texture"),
              u_feedback_decay: gl.getUniformLocation(compProgram, "u_feedback_decay"),
              u_feedback_zoom: gl.getUniformLocation(compProgram, "u_feedback_zoom"),
              u_feedback_rotation: gl.getUniformLocation(compProgram, "u_feedback_rotation"),
              u_resolution: gl.getUniformLocation(compProgram, "u_resolution"),
            };
            gl.uniform1f(compLocs.u_feedback_decay, feedbackDecayRef.current);
            gl.uniform1f(compLocs.u_feedback_zoom, feedbackZoomRef.current);
            gl.uniform1f(compLocs.u_feedback_rotation, feedbackRotationRef.current);
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
          gl.useProgram(program);

          gl.uniform1f(locs["u_time"], time);
          gl.uniform1f(locs["u_bass"], u.bass ?? 0);
          gl.uniform1f(locs["u_mid"], u.mid ?? 0);
          gl.uniform1f(locs["u_treble"], u.treble ?? 0);
          gl.uniform1f(locs["u_beat"], u.beat ?? 0);
          gl.uniform1f(locs["u_energy"], u.energy ?? 0);
          gl.uniform1f(locs["u_peak"], u.peak ?? 0);
          gl.uniform1f(locs["u_sub"], u.sub ?? 0);
          gl.uniform1f(locs["u_high"], u.high ?? 0);
          gl.uniform1f(locs["u_transient"], u.transient ?? 0);
          gl.uniform1f(locs["u_centroid"], u.centroid ?? 0);
          gl.uniform1f(locs["u_trail"], u.trail ?? 0);
          gl.uniform1f(locs["u_key_hue"], u.keyHue ?? 0);
          gl.uniform1f(locs["u_key_sat"], u.keySat ?? 0);
          gl.uniform1f(locs["u_key_conf"], u.keyConf ?? 0);
          gl.uniform2f(locs["u_resolution"], canvas.width, canvas.height);

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
          let totalDiff = 0;
          for (let i = 0; i < sample.length; i++) {
            totalDiff += Math.abs(sample[i] - lastSample[i]);
          }
          const avgDiff = (totalDiff / (sample.length / 4)).toFixed(1);
          console.log(
            `[ShaderCanvas debug] frame=${frameCount} time=${time.toFixed(1)}s avgPixelDiff=${avgDiff}`,
          );
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
    };
  }, [uniformsRef, fragmentShader, initGL, contextRestored, ensureFBOs]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
