import { useRef, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";

export interface TasteTag { id: string; category: string; label: string; }
interface Props { tags: TasteTag[]; onRemove: (id: string) => void; }

const CATEGORY_META: Record<string, { label: string; hex: string; tailwind: string }> = {
  genre:    { label: "Genres",     hex: "#8b5cf6", tailwind: "bg-violet-500/20 text-violet-200 border-violet-500/50" },
  vibe:     { label: "Vibes",      hex: "#3b82f6", tailwind: "bg-blue-500/20 text-blue-200 border-blue-500/50" },
  value:    { label: "Values",     hex: "#10b981", tailwind: "bg-emerald-500/20 text-emerald-200 border-emerald-500/50" },
  artist:   { label: "Artists",    hex: "#f97316", tailwind: "bg-orange-500/20 text-orange-200 border-orange-500/50" },
  art_form: { label: "Art forms",  hex: "#ec4899", tailwind: "bg-pink-500/20 text-pink-200 border-pink-500/50" },
  crowd:    { label: "Crowd",      hex: "#eab308", tailwind: "bg-yellow-500/20 text-yellow-200 border-yellow-500/50" },
  venue:    { label: "Venue",      hex: "#06b6d4", tailwind: "bg-cyan-500/20 text-cyan-200 border-cyan-500/50" },
  exclude:  { label: "Exclude",    hex: "#ef4444", tailwind: "bg-red-500/20 text-red-200 border-red-500/50" },
};
const CATEGORY_ORDER = ["genre", "vibe", "value", "artist", "art_form", "crowd", "venue", "exclude"];

const CAT_RADIUS = 115;
const TAG_RADIUS = 78;
const TAG_SPREAD = 0.55;
const FOV       = 700;
const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 4;
const LERP_K    = 0.09;   // used for focus travel (slower = more journey-like)
const LERP_FAST = 0.14;   // used for zoom reset (clearPivot)

// ── 3-D helpers ──────────────────────────────────────────────────────────────
type Vec3 = [number, number, number];
const norm   = (v: Vec3): Vec3 => { const l = Math.hypot(...v); return l < 1e-9 ? [1,0,0] : [v[0]/l,v[1]/l,v[2]/l]; };
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const add3   = (a: Vec3, b: Vec3): Vec3 => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const scl3   = (v: Vec3, s: number): Vec3 => [v[0]*s,v[1]*s,v[2]*s];
const lerp   = (a: number, b: number, t: number) => a + (b - a) * t;

function rotXY(v: Vec3, rx: number, ry: number): Vec3 {
  const [x,y,z] = v;
  const y1 = y*Math.cos(rx) - z*Math.sin(rx), z1 = y*Math.sin(rx) + z*Math.cos(rx);
  const x2 = x*Math.cos(ry) + z1*Math.sin(ry), z2 = -x*Math.sin(ry) + z1*Math.cos(ry);
  return [x2,y1,z2];
}
function project(v: Vec3) {
  const d = v[2] + FOV;
  return { px: v[0]*FOV/d, py: v[1]*FOV/d, pz: v[2] };
}
function fibSphere(n: number, r: number): Vec3[] {
  if (n === 0) return [];
  if (n === 1) return [[r,0,0]];
  const φ = (1+Math.sqrt(5))/2;
  return Array.from({length:n},(_,i)=>{
    const θ = Math.acos(1-(2*i+1)/n), λ = 2*Math.PI*i/φ;
    return [r*Math.sin(θ)*Math.cos(λ), r*Math.cos(θ), r*Math.sin(θ)*Math.sin(λ)] as Vec3;
  });
}
const shortPath = (target: number, current: number) => {
  let t = target;
  while (t-current >  Math.PI) t -= 2*Math.PI;
  while (current-t >  Math.PI) t += 2*Math.PI;
  return t;
};

// ── Node definitions ─────────────────────────────────────────────────────────
interface NodeData { id: string; pos3d: Vec3; label: string; category: string; type: "center"|"category"|"tag"; }

function buildNodes(tags: TasteTag[]): NodeData[] {
  const cats = CATEGORY_ORDER.filter(c => tags.some(t => t.category === c));
  const catPos = fibSphere(cats.length, CAT_RADIUS);
  const nodes: NodeData[] = [{ id:"__center__", pos3d:[0,0,0], label:"you", category:"", type:"center" }];
  cats.forEach((cat,i) => {
    nodes.push({ id:`cat:${cat}`, pos3d:catPos[i], label:cat, category:cat, type:"category" });
    const ct = tags.filter(t => t.category===cat);
    const out = norm(catPos[i]);
    const trial = cross3(out,[0,1,0]);
    const perp = norm(Math.hypot(...trial)<0.01 ? cross3(out,[1,0,0]) : trial);
    ct.forEach((tag,ti) => {
      const a = (ti-(ct.length-1)/2)*TAG_SPREAD;
      const dir = norm(add3(scl3(out,Math.cos(a)),scl3(perp,Math.sin(a))));
      nodes.push({ id:tag.id, pos3d:add3(catPos[i],scl3(dir,TAG_RADIUS)), label:tag.label, category:cat, type:"tag" });
    });
  });
  return nodes;
}

// ── Focus target ─────────────────────────────────────────────────────────────
interface FocusTarget {
  rx: number; ry: number; zoom: number;
  panTarget: { x: number; y: number };
  k: number; // lerp constant
}

// ── Component ────────────────────────────────────────────────────────────────
const TasteConstellation = ({ tags, onRemove }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [selectedId, setSelectedId] = useState<string|null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [, triggerRender] = useState(0);
  const flush = () => triggerRender(n => n+1);

  // ── All mutable view state in refs ──
  const rotRef  = useRef({ x: 0.35, y: 0.5 });
  const zoomRef = useRef(1);
  const panRef  = useRef({ x: 0, y: 0 });
  /** 3-D position of the currently selected node. Pan re-derives from this after rotation. */
  const pivotRef = useRef<Vec3 | null>(null);

  // ── Interaction refs ──
  const dragging       = useRef(false);
  const pinching       = useRef(false);
  const hasMoved       = useRef(false);
  const lastPtr        = useRef({ x: 0, y: 0 });
  const velocity       = useRef({ x: 0, y: 0 });
  const activePointers = useRef(new Map<number, { x:number; y:number }>());
  const lastPinchDist  = useRef<number|null>(null);
  const momentumRaf    = useRef<number|undefined>(undefined);
  const focusRaf       = useRef<number|undefined>(undefined);
  const focusTarget    = useRef<FocusTarget|null>(null);

  // ── Resize ──
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // ── RAF cleanup ──
  useEffect(() => () => {
    if (momentumRaf.current) cancelAnimationFrame(momentumRaf.current);
    if (focusRaf.current)    cancelAnimationFrame(focusRaf.current);
  }, []);

  // ── Keep pan centred on pivot after every rotation change ──
  const syncPanToPivot = () => {
    if (!pivotRef.current) return;
    const { px, py } = project(rotXY(pivotRef.current, rotRef.current.x, rotRef.current.y));
    panRef.current = { x: px, y: py };
  };

  // ── Non-passive wheel zoom ──
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = 1 - e.deltaY * 0.001;
      const newZ = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomRef.current * factor));
      if (pivotRef.current) {
        // Pivot selected → just scale; pivot stays at screen centre because pan doesn't change
        zoomRef.current = newZ;
      } else {
        // No pivot → zoom toward cursor
        const rect = el.getBoundingClientRect();
        const cx = el.clientWidth/2, cy = el.clientHeight/2;
        const sx = e.clientX-rect.left-cx, sy = e.clientY-rect.top-cy;
        const wx = sx/zoomRef.current + panRef.current.x;
        const wy = sy/zoomRef.current + panRef.current.y;
        zoomRef.current = newZ;
        panRef.current  = { x: wx - sx/newZ, y: wy - sy/newZ };
      }
      flush();
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // ── Focus animation ──
  const stopFocus = () => {
    focusTarget.current = null;
    if (focusRaf.current) { cancelAnimationFrame(focusRaf.current); focusRaf.current = undefined; }
  };
  const startFocus = (t: FocusTarget) => {
    focusTarget.current = t;
    if (focusRaf.current) cancelAnimationFrame(focusRaf.current);
    let frames = 0;
    const step = () => {
      const ft = focusTarget.current;
      if (!ft || frames++ > 80) { stopFocus(); return; }
      rotRef.current  = { x: lerp(rotRef.current.x, ft.rx, ft.k), y: lerp(rotRef.current.y, ft.ry, ft.k) };
      zoomRef.current = lerp(zoomRef.current, ft.zoom, ft.k);
      panRef.current  = { x: lerp(panRef.current.x, ft.panTarget.x, ft.k), y: lerp(panRef.current.y, ft.panTarget.y, ft.k) };
      flush();
      focusRaf.current = requestAnimationFrame(step);
    };
    focusRaf.current = requestAnimationFrame(step);
  };

  /**
   * Focus on a node: smoothly rotate so it faces the camera AND pan toward
   * screen centre simultaneously — no pan snap.
   *
   * At the target rotation, the node projects to (0,0), so panTarget={0,0}
   * is exactly right. Both pan and rotation lerp together for a smooth journey.
   *
   * Correct formula for rotXY (X-first, Y-second):
   *   rx = atan2(-b, -c)          → zeroes y after X rotation
   *   ry = atan2(a, hypot(b,c))   → zeroes x after Y rotation
   */
  const focusOnNode = (node: NodeData) => {
    pivotRef.current = node.pos3d;
    const [a,b,c] = node.pos3d;
    const rxT = shortPath(Math.atan2(-b, -c),            rotRef.current.x);
    const ryT = shortPath(Math.atan2(a, Math.hypot(b,c)), rotRef.current.y);
    startFocus({ rx: rxT, ry: ryT, zoom: 2.2, panTarget: { x:0, y:0 }, k: LERP_K });
  };

  const clearPivot = () => {
    pivotRef.current = null;
    setSelectedId(null);
    startFocus({ rx: rotRef.current.x, ry: rotRef.current.y, zoom: 1, panTarget: { x:0, y:0 }, k: LERP_FAST });
  };

  // ── Pinch midpoint helper ──
  const getPinchInfo = () => {
    const pts = [...activePointers.current.values()];
    if (pts.length < 2) return null;
    return { dist: Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y), midX: (pts[0].x+pts[1].x)/2, midY: (pts[0].y+pts[1].y)/2 };
  };

  // ── Pointer handlers ──
  const onPointerDown = (e: React.PointerEvent) => {
    activePointers.current.set(e.pointerId, { x:e.clientX, y:e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    stopFocus();
    if (momentumRaf.current) cancelAnimationFrame(momentumRaf.current);
    if (activePointers.current.size >= 2) {
      pinching.current = true; dragging.current = false; setIsDragging(false);
      lastPinchDist.current = getPinchInfo()?.dist ?? null;
    } else {
      pinching.current = false; dragging.current = true; hasMoved.current = false;
      setIsDragging(true);
      lastPtr.current = { x:e.clientX, y:e.clientY }; velocity.current = { x:0, y:0 };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!activePointers.current.has(e.pointerId)) return;
    activePointers.current.set(e.pointerId, { x:e.clientX, y:e.clientY });

    if (pinching.current && activePointers.current.size >= 2) {
      const info = getPinchInfo();
      if (info && lastPinchDist.current && lastPinchDist.current > 0) {
        const ratio = info.dist / lastPinchDist.current;
        const newZ = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomRef.current * ratio));
        if (pivotRef.current) {
          zoomRef.current = newZ; // pivot stays centred — just scale
        } else {
          const rect = containerRef.current!.getBoundingClientRect();
          const cx = containerRef.current!.clientWidth/2, cy = containerRef.current!.clientHeight/2;
          const sx = info.midX-rect.left-cx, sy = info.midY-rect.top-cy;
          const wx = sx/zoomRef.current + panRef.current.x;
          const wy = sy/zoomRef.current + panRef.current.y;
          zoomRef.current = newZ;
          panRef.current  = { x: wx - sx/newZ, y: wy - sy/newZ };
        }
        flush();
      }
      lastPinchDist.current = info?.dist ?? null;
      return;
    }

    if (!dragging.current) return;
    const dx = e.clientX-lastPtr.current.x, dy = e.clientY-lastPtr.current.y;
    if (!hasMoved.current && Math.abs(dx)<3 && Math.abs(dy)<3) return;
    hasMoved.current = true;
    velocity.current = { x:dx, y:dy };
    lastPtr.current = { x:e.clientX, y:e.clientY };
    rotRef.current = { x: rotRef.current.x + dy*0.006, y: rotRef.current.y + dx*0.006 };
    // Re-derive pan so the pivot stays fixed on screen during rotation
    syncPanToPivot();
    flush();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const wasDragging = dragging.current && hasMoved.current;
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size === 0) {
      pinching.current = false; lastPinchDist.current = null; dragging.current = false; setIsDragging(false);
      if (wasDragging) {
        const spin = () => {
          const v = velocity.current;
          if (Math.abs(v.x)<0.25 && Math.abs(v.y)<0.25) { velocity.current={x:0,y:0}; return; }
          velocity.current = { x:v.x*0.91, y:v.y*0.91 };
          rotRef.current = { x: rotRef.current.x + v.y*0.003, y: rotRef.current.y + v.x*0.003 };
          syncPanToPivot();
          flush();
          momentumRaf.current = requestAnimationFrame(spin);
        };
        momentumRaf.current = requestAnimationFrame(spin);
      }
    } else if (activePointers.current.size === 1) {
      pinching.current = false; lastPinchDist.current = null; dragging.current = true;
      const [ptr] = [...activePointers.current.values()];
      lastPtr.current = ptr; velocity.current = { x:0, y:0 };
    }
  };

  // ── Render ──
  const height = Math.max(Math.round(width*0.88), 340);
  const cx = width/2, cy = height/2;
  const rot = rotRef.current, zoom = zoomRef.current, pan = panRef.current;
  const nodes = buildNodes(tags);

  const projected = nodes.map(n => {
    const rotated = rotXY(n.pos3d, rot.x, rot.y);
    const { px, py, pz } = project(rotated);
    return { ...n, sx:(px-pan.x)*zoom+cx, sy:(py-pan.y)*zoom+cy, pz, depthScale: FOV/(pz+FOV) };
  });
  const nodeMap = new Map(projected.map(n=>[n.id,n]));

  type Edge = { x1:number;y1:number;x2:number;y2:number;color:string;opacity:number;dash?:string };
  const edges: Edge[] = [];
  const centre = nodeMap.get("__center__");
  const presentCats = CATEGORY_ORDER.filter(c => tags.some(t=>t.category===c));
  if (centre) {
    presentCats.forEach(cat => {
      const cn = nodeMap.get(`cat:${cat}`); if (!cn) return;
      edges.push({x1:centre.sx,y1:centre.sy,x2:cn.sx,y2:cn.sy,color:"white",opacity:0.18});
      tags.filter(t=>t.category===cat).forEach(tag => {
        const tn = nodeMap.get(tag.id); if (!tn) return;
        edges.push({x1:cn.sx,y1:cn.sy,x2:tn.sx,y2:tn.sy,color:CATEGORY_META[cat]?.hex??"white",opacity:0.4});
      });
    });
  }
  const gTags = tags.filter(t=>t.category==="genre");
  gTags.forEach((tag,i) => {
    if (!i) return;
    const a=nodeMap.get(gTags[i-1].id), b=nodeMap.get(tag.id);
    if (a&&b) edges.push({x1:a.sx,y1:a.sy,x2:b.sx,y2:b.sy,color:"#8b5cf6",opacity:0.45,dash:"3 5"});
  });
  if (gTags.length>=3) {
    const f=nodeMap.get(gTags[0].id), l=nodeMap.get(gTags[gTags.length-1].id);
    if (f&&l) edges.push({x1:l.sx,y1:l.sy,x2:f.sx,y2:f.sy,color:"#8b5cf6",opacity:0.45,dash:"3 5"});
  }

  const sorted = [...projected].sort((a,b)=>b.pz-a.pz);

  return (
    <div
      ref={containerRef}
      className={`relative w-full select-none overflow-hidden ${isDragging?"cursor-grabbing":"cursor-grab"}`}
      style={{
        height,
        WebkitMaskImage: "radial-gradient(ellipse at 50% 50%, black 50%, transparent 82%)",
        maskImage: "radial-gradient(ellipse at 50% 50%, black 50%, transparent 82%)",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={() => { if (!hasMoved.current) clearPivot(); }}
    >
      <p className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[10px] text-white/20">
        drag · pinch or scroll to zoom · tap to focus
      </p>

      <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
        {edges.map((e,i) => (
          <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
            stroke={e.color} strokeWidth={1} strokeOpacity={e.opacity} strokeDasharray={e.dash}/>
        ))}
      </svg>

{sorted.map(node => {
        const opacity = Math.max(0.35, Math.min(1, 0.45+node.depthScale*0.45));
        const zIndex  = Math.round(node.depthScale*50);

        if (node.type==="center") return (
          <div key="__center__" className="pointer-events-none absolute"
            style={{left:node.sx,top:node.sy,transform:"translate(-50%,-50%)",zIndex:50}}>
            <motion.div className="absolute rounded-full border border-white/20"
              style={{width:44,height:44,left:-4,top:-4}}
              animate={{scale:[1,1.25,1],opacity:[0.4,0.12,0.4]}}
              transition={{duration:2.8,repeat:Infinity,ease:"easeInOut"}}/>
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-[10px] font-semibold uppercase tracking-widest text-white/70">
              you
            </div>
          </div>
        );

        if (node.type==="category") {
          const meta = CATEGORY_META[node.category];
          return (
            <div key={node.id} className="pointer-events-none absolute flex flex-col items-center gap-1"
              style={{left:node.sx,top:node.sy,transform:"translate(-50%,-50%)",opacity,zIndex}}>
              <div className="rounded-full border"
                style={{width:16,height:16,backgroundColor:meta.hex+"33",borderColor:meta.hex+"99"}}/>
              <span className="whitespace-nowrap text-[9px] font-medium uppercase tracking-wider text-white/50">
                {meta.label}
              </span>
            </div>
          );
        }

        const meta = CATEGORY_META[node.category] ?? {tailwind:"bg-secondary text-foreground border-border",hex:"#888"};
        const isSelected = selectedId===node.id;
        return (
          <div key={node.id}
            className={`group absolute flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${meta.tailwind}`}
            style={{
              left:node.sx, top:node.sy, transform:"translate(-50%,-50%)", opacity, zIndex,
              ...(isSelected ? {
                backgroundColor: meta.hex+"d0", borderColor: meta.hex,
                boxShadow:`0 0 0 2px ${meta.hex}88, 0 0 16px ${meta.hex}66`,
                color: "white",
              } : {}),
            }}
            onClick={e => {
              e.stopPropagation();
              if (hasMoved.current) return;
              if (isSelected) {
                clearPivot();
              } else {
                setSelectedId(node.id);
                focusOnNode(node);
              }
            }}
          >
            <span>{node.label}</span>
            <button
              onClick={e => { e.stopPropagation(); onRemove(node.id); }}
              className={`rounded-full transition-opacity opacity-0 group-hover:opacity-80 hover:!opacity-100 ${isSelected?"!opacity-80":""}`}
              aria-label={`Remove ${node.label}`}
            >
              <X className="h-3 w-3"/>
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default TasteConstellation;
