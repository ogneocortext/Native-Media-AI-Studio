import { useRef, useEffect, useCallback } from "react";

interface ShaderCanvasProps {
  fragmentShader: string;
  uniforms: Record<string, number>;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Generic WebGL shader canvas — compiles a fragment shader and renders it
 * with audio-reactive uniforms. Uses a fullscreen quad approach.
 */
export function ShaderCanvas({ fragmentShader, uniforms, className }: ShaderCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const uniformLocsRef = useRef<Record<string, WebGLUniformLocation | null>>({});
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef(Date.now());

  // Compile shader and create program
  const initGL = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", { antialias: true, alpha: false });
    if (!gl) return;
    glRef.current = gl;

    // Vertex shader — fullscreen quad
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

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fragmentShader);
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

    // Fullscreen quad vertices
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Cache uniform locations
    const uniformLocs: Record<string, WebGLUniformLocation | null> = {};
    const uniformNames = ["u_time", "u_bass", "u_mid", "u_treble", "u_beat", "u_energy", "u_peak", "u_resolution"];
    for (const name of uniformNames) {
      uniformLocs[name] = gl.getUniformLocation(program, name);
    }
    uniformLocsRef.current = uniformLocs;
  }, [fragmentShader]);

  // Resize handler
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      if (glRef.current) {
        glRef.current.viewport(0, 0, canvas.width, canvas.height);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Initialize WebGL
  useEffect(() => {
    initGL();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [initGL]);

  // Render loop
  useEffect(() => {
    const gl = glRef.current;
    const program = programRef.current;
    const canvas = canvasRef.current;
    if (!gl || !program || !canvas) return;

    const render = () => {
      const time = (Date.now() - startTimeRef.current) / 1000;
      const locs = uniformLocsRef.current;

      gl.uniform1f(locs["u_time"], time);
      gl.uniform1f(locs["u_bass"], uniforms.bass ?? 0);
      gl.uniform1f(locs["u_mid"], uniforms.mid ?? 0);
      gl.uniform1f(locs["u_treble"], uniforms.treble ?? 0);
      gl.uniform1f(locs["u_beat"], uniforms.beat ?? 0);
      gl.uniform1f(locs["u_energy"], uniforms.energy ?? 0);
      gl.uniform1f(locs["u_peak"], uniforms.peak ?? 0);
      gl.uniform2f(locs["u_resolution"], canvas.width, canvas.height);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      rafRef.current = requestAnimationFrame(render);
    };

    render();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [uniforms]);

  return <canvas ref={canvasRef} className={className} style={{ width: "100%", height: "100%", display: "block" }} />;
}
