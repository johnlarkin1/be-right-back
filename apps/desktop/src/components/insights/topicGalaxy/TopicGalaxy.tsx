/**
 * TopicGalaxy - WebGL 3D topic map (react-three-fiber).
 *
 * All points draw in one call: a THREE.Points cloud with a custom shader
 * for soft sprites, depth fog and topic focus. Bloom runs as a post pass.
 * Hover picking runs on the CPU against the packed positions, at most
 * once per frame and only after the pointer moves.
 *
 * Labels and the hover card are plain DOM over the canvas. The frame
 * loop moves them through refs, so React does not re-render per frame.
 */
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  Bloom,
  EffectComposer,
  Scanline,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { EmbeddingPoint } from "@/types";
import {
  clusterAnchors,
  packPoints,
  pickPoint,
  placeLabels,
  type LabelBox,
  type PackedPoints,
  type TopicStyle,
} from "./scene";

export interface GalaxyTopic extends TopicStyle {
  name: string;
  count: number;
}

export interface TopicGalaxyProps {
  points: readonly EmbeddingPoint[];
  /** Topics to draw, biggest first. Points of other clusters are hidden. */
  topics: readonly GalaxyTopic[];
  selectedCluster: number | null;
  onSelectCluster: (id: number | null) => void;
  autoRotate: boolean;
  /** Bump to put the camera back at the start. */
  resetToken: number;
  isRetro: boolean;
  /** Scene background, read from --color-surface. */
  background: string;
  /** Floating labels shown when no topic is selected. */
  labelCount?: number;
  /**
   * 0 = crisp, separate dots with no bloom. 1 = soft dots with full bloom.
   * Defaults to 0.5.
   */
  glow?: number;
  /** Called about once per second with the frame rate (bench only). */
  onFps?: (fps: number) => void;
}

const START_POSITION = new THREE.Vector3(1.55, 0.75, 1.55);
const FOV = 45;
/** Glow values below this draw solid dots with normal blending. */
const CRISP_BELOW = 0.2;
/** Hover hit radius in CSS px. */
const PICK_RADIUS_PX = 7;

const vertexShader = /* glsl */ `
  attribute vec3 color;
  attribute float cluster;
  attribute float seed;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uSelected;
  uniform float uFocus;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uAlpha;
  uniform float uTime;
  uniform float uGlow;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float depth = -mv.z;
    float inTopic = 1.0 - step(0.5, abs(cluster - uSelected));
    // uFocus eases 0 -> 1 when a topic is picked.
    float focus = mix(1.0, mix(0.04, 1.4, inTopic), uFocus);
    float fog = smoothstep(uFogNear, uFogFar, depth);
    float twinkle = 0.85 + 0.15 * sin(uTime * 1.3 + seed * 40.0);
    vAlpha = uAlpha * focus * (1.0 - 0.9 * fog) * twinkle;
    vColor = color;
    float size = uSize * mix(0.55, 1.0, uGlow) * (0.6 + 0.8 * seed) * mix(1.0, 1.0 + 0.4 * inTopic, uFocus);
    gl_PointSize = max(size * uPixelRatio / depth, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uGlow;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    // Low glow: a crisp disc. High glow: a bright core with a soft halo,
    // which bloom widens further.
    float disc = 1.0 - smoothstep(0.55, 0.8, d);
    float soft = exp(-d * d * 6.0) + (1.0 - d) * 0.25;
    float a = mix(disc, soft, uGlow);
    gl_FragColor = vec4(vColor * a, a * vAlpha);
  }
`;

const ringVertex = /* glsl */ `
  uniform float uPixelRatio;
  void main() {
    gl_PointSize = 26.0 * uPixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ringFragment = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float ring = smoothstep(0.62, 0.72, d) * (1.0 - smoothstep(0.86, 0.96, d));
    if (ring < 0.01) discard;
    gl_FragColor = vec4(uColor, ring);
  }
`;

/** DOM nodes the frame loop moves. */
interface Overlay {
  labels: Map<number, HTMLElement>;
  tooltip: HTMLElement | null;
}

export const TopicGalaxy = memo(function TopicGalaxy(props: TopicGalaxyProps) {
  const {
    points,
    topics,
    selectedCluster,
    onSelectCluster,
    isRetro,
    background,
    autoRotate,
    labelCount = 10,
    glow = 0.5,
  } = props;
  const overlay = useRef<Overlay>({ labels: new Map(), tooltip: null });
  const [hovered, setHovered] = useState<EmbeddingPoint | null>(null);

  const packed = useMemo(() => packPoints(points, topics), [points, topics]);

  const labelled = useMemo(
    () =>
      selectedCluster !== null
        ? topics.filter((t) => t.id === selectedCluster)
        : topics.filter((t) => t.id >= 0).slice(0, labelCount),
    [topics, selectedCluster, labelCount],
  );

  const hoverTopic = hovered
    ? topics.find((t) => t.id === hovered.cluster)
    : undefined;

  return (
    <div className="absolute inset-0">
      <Canvas
        dpr={[1, 2]}
        camera={{
          position: START_POSITION.toArray(),
          fov: FOV,
          near: 0.01,
          far: 50,
        }}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        frameloop={autoRotate ? "always" : "demand"}
      >
        <color attach="background" args={[background]} />
        <Galaxy
          {...props}
          packed={packed}
          labelled={labelled}
          overlay={overlay}
          onHover={setHovered}
        />
        <EffectComposer multisampling={0}>
          <Bloom
            mipmapBlur
            intensity={glow * 2 * (isRetro ? 1.4 : 1.0)}
            luminanceThreshold={0.1}
            luminanceSmoothing={0.35}
            radius={0.72}
          />
          <Vignette eskil={false} offset={0.25} darkness={0.55} />
          {isRetro ? (
            <Scanline
              blendFunction={BlendFunction.OVERLAY}
              density={1.4}
              opacity={0.12}
            />
          ) : (
            <></>
          )}
        </EffectComposer>
      </Canvas>

      <div className="topic-galaxy-overlay" aria-hidden={false}>
        {labelled.map((t) => (
          <button
            key={t.id}
            type="button"
            ref={(el) => {
              if (el) overlay.current.labels.set(t.id, el);
              else overlay.current.labels.delete(t.id);
            }}
            className="topic-galaxy-label"
            style={{ "--topic-color": t.color, opacity: 0 } as CSSProperties}
            onClick={() =>
              onSelectCluster(selectedCluster === t.id ? null : t.id)
            }
          >
            <span className="topic-galaxy-label-dot" aria-hidden="true" />
            {isRetro ? `[${t.name.toLowerCase()}]` : t.name}
          </button>
        ))}
        <div
          ref={(el) => {
            overlay.current.tooltip = el;
          }}
          className="topic-galaxy-tooltip"
          style={{ visibility: hovered ? "visible" : "hidden" }}
          role="tooltip"
        >
          {hovered && (
            <>
              <div className="topic-galaxy-tooltip-quote">
                “{hovered.message_preview}”
              </div>
              <div className="topic-galaxy-tooltip-meta">
                {hovered.contact_name} · {hovered.date}
              </div>
              {hoverTopic && (
                <div
                  className="topic-galaxy-tooltip-topic"
                  style={{ "--topic-color": hoverTopic.color } as CSSProperties}
                >
                  <span className="topic-galaxy-label-dot" aria-hidden="true" />
                  {hoverTopic.name}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

interface GalaxyProps extends TopicGalaxyProps {
  packed: PackedPoints;
  labelled: readonly GalaxyTopic[];
  overlay: MutableRefObject<Overlay>;
  onHover: (point: EmbeddingPoint | null) => void;
}

function Galaxy({
  points,
  topics,
  selectedCluster,
  onSelectCluster,
  autoRotate,
  resetToken,
  isRetro,
  onFps,
  glow = 0.5,
  packed,
  labelled,
  overlay,
  onHover,
}: GalaxyProps) {
  const { camera, gl, size, invalidate } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const ring = useRef<THREE.ShaderMaterial>(null);
  const [hovered, setHovered] = useState(-1);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(packed.positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(packed.colors, 3));
    g.setAttribute("cluster", new THREE.BufferAttribute(packed.clusters, 1));
    g.setAttribute("seed", new THREE.BufferAttribute(packed.seeds, 1));
    return g;
  }, [packed]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const anchors = useMemo(
    () => clusterAnchors(packed.positions, packed.clusters),
    [packed],
  );

  // Additive sprites saturate to white in dense areas. Thin them out as
  // the count grows, so 250k reads as the same shape, only finer.
  const n = packed.clusters.length;
  const density = Math.sqrt(Math.max(n, 2000) / 8000);
  const uniforms = useMemo(
    () => ({
      uSize: { value: 1 },
      uPixelRatio: { value: 1 },
      uSelected: { value: -999 },
      uFocus: { value: 0 },
      uFogNear: { value: 1.5 },
      uFogFar: { value: 4.5 },
      uAlpha: { value: 1 },
      uTime: { value: 0 },
      uGlow: { value: 0.5 },
    }),
    [],
  );
  uniforms.uSize.value = 20 / Math.cbrt(density);
  // Low glow draws opaque dots that cover each other, so dense areas
  // don't add up to white. Higher glow adds light, thinned by density.
  const crisp = glow < CRISP_BELOW;
  uniforms.uAlpha.value = crisp
    ? 0.95
    : Math.min(1, ((isRetro ? 0.95 : 0.85) * (1.6 - 0.6 * glow)) / density);
  uniforms.uGlow.value = glow;
  uniforms.uPixelRatio.value = gl.getPixelRatio();

  const ringUniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color("#ffffff") },
      uPixelRatio: { value: 1 },
    }),
    [],
  );
  ringUniforms.uPixelRatio.value = gl.getPixelRatio();

  // Keep the last real selection so focus can fade out on deselect.
  const lastSelected = useRef<number | null>(null);
  if (selectedCluster !== null) lastSelected.current = selectedCluster;

  useEffect(() => {
    camera.position.copy(START_POSITION);
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
    invalidate();
  }, [resetToken, camera, invalidate]);

  // Clicking a dot (not dragging) focuses its topic.
  const hoveredRef = useRef(-1);
  hoveredRef.current = hovered;
  const clickPoint = useCallback(() => {
    const i = hoveredRef.current;
    if (i < 0) return;
    const id = packed.clusters[i];
    if (id < 0) return;
    onSelectCluster(selectedCluster === id ? null : id);
  }, [packed, selectedCluster, onSelectCluster]);
  const clickRef = useRef(clickPoint);
  clickRef.current = clickPoint;

  // Pointer state for picking, in NDC.
  const pointer = useRef({
    x: 0,
    y: 0,
    inside: false,
    dirty: false,
    down: false,
  });
  useEffect(() => {
    const el = gl.domElement;
    let pressAt: { x: number; y: number } | null = null;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.current.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.current.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      pointer.current.inside = true;
      pointer.current.dirty = true;
      invalidate();
    };
    const leave = () => {
      pointer.current.inside = false;
      pointer.current.dirty = true;
      invalidate();
    };
    const down = (e: PointerEvent) => {
      pointer.current.down = true;
      pressAt = { x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      pointer.current.down = false;
      pointer.current.dirty = true;
      if (
        pressAt &&
        Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) < 4
      ) {
        clickRef.current();
      }
      pressAt = null;
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
    };
  }, [gl, invalidate]);

  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const goal = useMemo(() => new THREE.Vector3(), []);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  const fps = useRef({ frames: 0, since: 0 });

  /** Scene point -> CSS px in the canvas, or null when behind the camera. */
  const project = (x: number, y: number, z: number) => {
    scratch.set(x, y, z).project(camera);
    if (scratch.z > 1) return null;
    return {
      x: (scratch.x * 0.5 + 0.5) * size.width,
      y: (-scratch.y * 0.5 + 0.5) * size.height,
      depth: camera.position.distanceTo(scratch.set(x, y, z)),
    };
  };

  useFrame((state, delta) => {
    // r3f copies the uniforms prop, so write to the material's own copy.
    const u = (material.current?.uniforms ?? uniforms) as typeof uniforms;
    u.uSize.value = uniforms.uSize.value;
    u.uAlpha.value = uniforms.uAlpha.value;
    u.uGlow.value = uniforms.uGlow.value;
    u.uPixelRatio.value = uniforms.uPixelRatio.value;
    u.uTime.value = state.clock.elapsedTime;

    // Ease topic focus in or out.
    const want = selectedCluster === null ? 0 : 1;
    u.uSelected.value = lastSelected.current ?? -999;
    u.uFocus.value += (want - u.uFocus.value) * Math.min(1, delta * 6);
    let animating = Math.abs(want - u.uFocus.value) > 0.002;

    // Glide the orbit target to the picked topic.
    const ctl = controls.current;
    let dist = camera.position.length();
    if (ctl) {
      const anchor =
        selectedCluster !== null ? anchors.get(selectedCluster) : undefined;
      if (anchor) goal.set(anchor[0], anchor[1], anchor[2]);
      else goal.set(0, 0, 0);
      if (ctl.target.distanceToSquared(goal) > 1e-6) {
        ctl.target.lerp(goal, Math.min(1, delta * 3));
        ctl.update();
        animating = true;
      }
      dist = camera.position.distanceTo(ctl.target);
    }
    // The fog band follows the orbit distance, so zoom stays legible.
    u.uFogNear.value = dist - 0.3;
    u.uFogFar.value = dist + 1.5;

    // Pick at most once per frame, never mid-drag.
    const p = pointer.current;
    if (p.dirty && !p.down) {
      p.dirty = false;
      let hit = -1;
      if (p.inside) {
        ndc.set(p.x, p.y);
        raycaster.setFromCamera(ndc, camera);
        const tanAngle =
          (Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * 2 * PICK_RADIUS_PX) /
          size.height;
        const { origin, direction } = raycaster.ray;
        hit = pickPoint(
          packed.positions,
          packed.clusters,
          {
            origin: [origin.x, origin.y, origin.z],
            dir: [direction.x, direction.y, direction.z],
          },
          tanAngle,
          selectedCluster,
        );
      }
      if (hit !== hoveredRef.current) {
        hoveredRef.current = hit;
        setHovered(hit);
        onHover(hit >= 0 ? points[packed.sourceIndex[hit]] : null);
      }
    }

    // Move labels; hide ones that collide with a bigger topic's label.
    const boxes: (LabelBox | null)[] = labelled.map((t) => {
      const a = anchors.get(t.id);
      const el = overlay.current.labels.get(t.id);
      if (!a || !el) return null;
      const s = project(a[0], a[1], a[2]);
      if (!s) return null;
      return { x: s.x, y: s.y, w: el.offsetWidth, h: el.offsetHeight };
    });
    const visible = placeLabels(boxes);
    labelled.forEach((t, i) => {
      const el = overlay.current.labels.get(t.id);
      const b = boxes[i];
      if (!el) return;
      if (b) {
        el.style.transform = `translate(${b.x - b.w / 2}px, ${b.y - b.h / 2}px)`;
      }
      el.style.opacity = visible[i] ? "1" : "0";
      el.style.pointerEvents = visible[i] ? "auto" : "none";
    });

    // Pin the hover card next to its dot.
    const tip = overlay.current.tooltip;
    if (tip && hoveredRef.current >= 0) {
      const i = hoveredRef.current;
      const s = project(
        packed.positions[i * 3],
        packed.positions[i * 3 + 1],
        packed.positions[i * 3 + 2],
      );
      if (s) {
        // Flip to the left near the right edge.
        const flip = s.x + tip.offsetWidth + 24 > size.width;
        const x = flip ? s.x - tip.offsetWidth - 14 : s.x + 14;
        const y = Math.min(s.y + 14, size.height - tip.offsetHeight - 8);
        tip.style.transform = `translate(${x}px, ${y}px)`;
      }
    }

    if (animating) invalidate();

    if (onFps) {
      const now = performance.now();
      if (fps.current.since === 0) fps.current.since = now;
      fps.current.frames++;
      if (now - fps.current.since >= 1000) {
        onFps((fps.current.frames * 1000) / (now - fps.current.since));
        fps.current = { frames: 0, since: now };
      }
    }
  });

  const hoverPos: [number, number, number] | null =
    hovered >= 0
      ? [
          packed.positions[hovered * 3],
          packed.positions[hovered * 3 + 1],
          packed.positions[hovered * 3 + 2],
        ]
      : null;
  if (hovered >= 0) {
    const topic = topics.find((t) => t.id === packed.clusters[hovered]);
    if (topic) ringUniforms.uColor.value.set(topic.color);
  }
  useEffect(() => {
    const u = ring.current?.uniforms;
    if (!u) return;
    u.uColor.value.copy(ringUniforms.uColor.value);
    u.uPixelRatio.value = ringUniforms.uPixelRatio.value;
    invalidate();
  });
  const ringGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(3), 3),
    );
    return g;
  }, []);

  return (
    <>
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.6}
        zoomSpeed={0.8}
        minDistance={0.25}
        maxDistance={8}
        autoRotate={autoRotate}
        autoRotateSpeed={0.55}
      />
      <points geometry={geometry} frustumCulled={false} raycast={() => null}>
        <shaderMaterial
          ref={material}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          key={crisp ? "crisp" : "glow"}
          transparent
          depthWrite={crisp}
          blending={crisp ? THREE.NormalBlending : THREE.AdditiveBlending}
        />
      </points>
      {hoverPos && (
        <points
          geometry={ringGeometry}
          position={hoverPos}
          frustumCulled={false}
          raycast={() => null}
        >
          <shaderMaterial
            ref={ring}
            vertexShader={ringVertex}
            fragmentShader={ringFragment}
            uniforms={ringUniforms}
            transparent
            depthTest={false}
          />
        </points>
      )}
    </>
  );
}

export default TopicGalaxy;
