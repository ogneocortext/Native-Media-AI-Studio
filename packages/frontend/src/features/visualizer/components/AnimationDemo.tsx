/**
 * Anime.js + Theatre.js Integration Demo
 * Showcases kinetic typography effects for the visualizer lyric overlay.
 * 
 * Anime.js — Lightweight animation engine for CSS, SVG, DOM, and JS objects
 * Theatre.js — Motion design editor with visual timeline for high-fidelity animation
 */
import { useEffect, useRef, useState } from "react";

interface Libs {
  animate: (targets: any, params: any) => any;
  stagger: (val: number, opts?: any) => any;
  getProject: (name: string) => any;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function AnimationDemo({ visible, onClose }: Props) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const wordsRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [activeDemo, setActiveDemo] = useState<"anime" | "theatre" | null>(null);
  const [libs, setLibs] = useState<Libs | null>(null);
  const [loading, setLoading] = useState(false);
  const theatreProject = useRef<any>(null);
  const theatreSheet = useRef<any>(null);

  // Lazy-load heavy animation libs only when this demo is actually visible
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      import("animejs").then(m => ({ animate: m.animate, stagger: m.stagger })),
      import("@theatre/core").then(m => ({ getProject: m.getProject })),
    ]).then(([anime, theatre]) => {
      if (!cancelled) {
        setLibs({ animate: anime.animate, stagger: anime.stagger, getProject: theatre.getProject });
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [visible]);

  // Anime.js demo: Staggered word reveal
  const runAnimeDemo = () => {
    if (!libs) return;
    setActiveDemo("anime");
    if (!wordsRef.current) return;
    const words = wordsRef.current.querySelectorAll(".demo-word");
    words.forEach(w => {
      (w as HTMLElement).style.opacity = "0";
      (w as HTMLElement).style.transform = "translateY(20px)";
    });

    libs.animate(words, {
      opacity: [0, 1],
      translateY: [20, 0],
      duration: 600,
      delay: libs.stagger(80, { from: "first" }),
      ease: "outExpo",
    });
  };

  // Anime.js demo: SVG path drawing
  const runSvgDemo = () => {
    if (!libs) return;
    setActiveDemo("anime");
    if (!svgRef.current) return;
    const paths = svgRef.current.querySelectorAll("path");
    paths.forEach(path => {
      const length = (path as SVGPathElement).getTotalLength();
      path.style.strokeDasharray = `${length}`;
      path.style.strokeDashoffset = `${length}`;
    });
    libs.animate(paths, {
      strokeDashoffset: 0,
      duration: 1200,
      delay: libs.stagger(200),
      ease: "inOutQuad",
    });
  };

  // Theatre.js demo: Create a project with animated object
  const runTheatreDemo = () => {
    if (!libs) return;
    setActiveDemo("theatre");
    if (theatreProject.current) {
      theatreProject.current = null;
      theatreSheet.current = null;
    }
    const project = libs.getProject("Visualizer Demo");
    theatreProject.current = project;
    const sheet = project.sheet("Scene 1");
    theatreSheet.current = sheet;
    const obj = sheet.object("Title", { x: 0, opacity: 0, scale: 0.8 });

    // Animate using Theatre.js values
    const el = titleRef.current;
    if (!el) return;

    obj.onValuesChange((values: { x: number; opacity: number; scale: number }) => {
      el.style.transform = `translateX(${values.x}px) scale(${values.scale})`;
      el.style.opacity = `${values.opacity}`;
    });
    obj.value = { x: 0, opacity: 1, scale: 1 };
  };

  useEffect(() => {
    if (!visible) return;
    // Run entrance animation on mount
    if (titleRef.current && libs) {
      libs.animate(titleRef.current, {
        opacity: [0, 1],
        translateY: [-20, 0],
        duration: 800,
        ease: "outExpo",
      });
    }
  }, [visible, libs]);

  if (!visible) return null;

  return (
    <div className="anim-demo-overlay">
      <div className="anim-demo-panel">
        <div className="anim-demo-header">
          <h2 ref={titleRef}>Animation Libraries Demo</h2>
          <button onClick={onClose} className="anim-demo-close">✕</button>
        </div>

        <div className="anim-demo-buttons">
          <button onClick={runAnimeDemo} disabled={loading} className={`anim-demo-btn ${activeDemo === "anime" ? "active" : ""}`}>
            Anime.js — Stagger Words
          </button>
          <button onClick={runSvgDemo} disabled={loading} className={`anim-demo-btn ${activeDemo === "anime" ? "active" : ""}`}>
            Anime.js — SVG Draw
          </button>
          <button onClick={runTheatreDemo} disabled={loading} className={`anim-demo-btn ${activeDemo === "theatre" ? "active" : ""}`}>
            Theatre.js — Object Animate
          </button>
        </div>

        <div className="anim-demo-stage">
          <div ref={wordsRef} className="demo-words">
            {["Still", "I", "Rise", "Before", "The", "Fade"].map((w, i) => (
              <span key={i} className="demo-word" style={{ opacity: 0 }}>{w} </span>
            ))}
          </div>

          <svg ref={svgRef} className="demo-svg" viewBox="0 0 200 60">
            <path d="M10 50 Q50 10 100 50 T190 50" fill="none" stroke="#007AFF" strokeWidth="2" />
            <path d="M10 30 Q50 50 100 30 T190 30" fill="none" stroke="#c084fc" strokeWidth="2" />
            <path d="M10 40 Q50 20 100 40 T190 40" fill="none" stroke="#f59e0b" strokeWidth="2" />
          </svg>
        </div>

        <div className="anim-demo-info">
          <div className="anim-demo-lib">
            <h4>Anime.js 4.5.0</h4>
            <p>Lightweight JS animation engine. Stagger, timeline, SVG, text splitting.</p>
          </div>
          <div className="anim-demo-lib">
            <h4>Theatre.js 0.7.2</h4>
            <p>Motion design editor. Visual timeline, keyframing, 3D object animation.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
