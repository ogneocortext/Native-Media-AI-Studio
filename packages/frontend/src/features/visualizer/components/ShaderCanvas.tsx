import { useRef, useEffect, useCallback } from "react";

interface ShaderCanvasProps {
  fragmentShader: string;
  uniformsRef: React.MutableRefObject<Record<string, number>>;
  width?: number;
  height?: number;
  className?: string;
  debug?: boolean;
}

/**
 * Generic WebGL shader canvas — compiles a fragment shader and renders it
 * with audio-reactive uniforms. Uses a fullscreen quad approach.
 *
 * Reads uniforms from a ref so the parent can update them every frame
 * without forcing React re-renders.
 */
export function ShaderCanvas({ fragmentShader, uniformsRef, className, debug = false }: ShaderCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const uniformLocsRef = useRef<Record<string, WebGLUniformLocation | null>>({});
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef(Date.now());
  const debugRef = useRef(debug);

  // Sync debug prop into ref so the render loop sees live toggles
  useEffect(() => { debugRef.current = debug; }, [debug]);

  // Toggle debug mode via URL hash (#shader-debug)
  useEffect(() => {
    const onHash = () => { debugRef.current = window.location.hash === '#shader-debug'; };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Compile shader and create program
  const initGL = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", { antialias: true, alpha: false });
    if (!gl) return;
    glRef.current = gl;

    const vsSource = `
      attribute vec2 a_position;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error("Vertex shader error:", gl.getShaderInfoLog(vs));
      return;
    }

    const fsSource = fragmentShader;
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
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
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uniformLocs: Record<string, WebGLUniformLocation | null> = {};
    const uniformNames = ["u_time", "u_bass", "u_mid", "u_treble", "u_beat", "u_energy", "u_peak", "u_resolution"];
    for (const name of uniformNames) {
      uniformLocs[name] = gl.getUniformLocation(program, name);
    }
    uniformLocsRef.current = uniformLocs;
  }, [fragmentShader]);

  // Initialize WebGL
  useEffect(() => {
    initGL();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [initGL]);

  // Resize + render loop
  useEffect(() => {
    const gl = glRef.current;
    const program = programRef.current;
    const canvas = canvasRef.current;
    if (!gl || !program || !canvas) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    let frameCount = 0;
    let lastSample = new Uint8Array(9 * 4);

    const render = () => {
      resize();
      const time = (Date.now() - startTimeRef.current) / 1000;
      const locs = uniformLocsRef.current;
      const u = uniformsRef.current;

      gl.uniform1f(locs["u_time"], time);
      gl.uniform1f(locs["u_bass"], u.bass ?? 0);
      gl.uniform1f(locs["u_mid"], u.mid ?? 0);
      gl.uniform1f(locs["u_treble"], u.treble ?? 0);
      gl.uniform1f(locs["u_beat"], u.beat ?? 0);
      gl.uniform1f(locs["u_energy"], u.energy ?? 0);
      gl.uniform1f(locs["u_peak"], u.peak ?? 0);
      gl.uniform2f(locs["u_resolution"], canvas.width, canvas.height);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

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
              const view = new Uint8Array(4);
              gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, view);
              sample.set(view, idx);
              idx += 4;
            }
          }
          let totalDiff = 0;
          for (let i = 0; i < sample.length; i++) {
            totalDiff += Math.abs(sample[i] - lastSample[i]);
          }
          const avgDiff = (totalDiff / (sample.length / 4)).toFixed(1);
          console.log(`[ShaderCanvas debug] frame=${frameCount} time=${time.toFixed(1)}s avgPixelDiff=${avgDiff}`);
          lastSample.set(sample);
        }
      }

      rafRef.current = requestAnimationFrame(render);
    };

    render();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // fragmentShader is an intentional dep: when the parent switches presets,
    // initGL recompiles (init effect above re-runs and cancels this loop), so
    // this effect MUST re-run to restart rendering on the new program.
    // Without it the canvas freezes on its last frame after any preset change.
  }, [uniformsRef, fragmentShader]);

  return <canvas ref={canvasRef} className={className} style={{ width: "100%", height: "100%", display: "block" }} />;
}
