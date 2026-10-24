import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Marker, MarkerAction, MarkerType, MARKER_TYPE_NAMES } from "./markers";

interface Scene3DViewProps {
  markers: Marker[];
  onClear?: () => void;
  onLoadDemo?: (markers: Marker[]) => void;
  className?: string;
}

interface MarkerRecord {
  marker: Marker;
  object: THREE.Object3D;
  expireTime: number;
}

function parseThreeColor(c?: { r: number; g: number; b: number; a?: number }): {
  color: THREE.Color;
  opacity: number;
} {
  if (!c) {
    return { color: new THREE.Color(0x00f0ff), opacity: 1.0 };
  }
  return {
    color: new THREE.Color(c.r, c.g, c.b),
    opacity: c.a !== undefined ? Math.max(0, Math.min(1, c.a)) : 1.0,
  };
}

function createTextSprite(text: string, color: THREE.Color, scaleZ: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Draw rounded background badge
    ctx.fillStyle = "rgba(10, 14, 24, 0.82)";
    ctx.strokeStyle = `#${color.getHexString()}`;
    ctx.lineWidth = 4;
    const r = 16;
    ctx.beginPath();
    ctx.roundRect(8, 8, canvas.width - 16, canvas.height - 16, r);
    ctx.fill();
    ctx.stroke();

    // Draw text
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 44px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text || "", canvas.width / 2, canvas.height / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  const h = Math.max(0.2, scaleZ || 0.6);
  sprite.scale.set(h * 4, h, 1);
  return sprite;
}

function createMarkerObject(m: Marker): THREE.Object3D {
  const group = new THREE.Group();
  const { color, opacity } = parseThreeColor(m.color);
  const sx = Math.max(0.001, m.scale?.x ?? 1);
  const sy = Math.max(0.001, m.scale?.y ?? 1);
  const sz = Math.max(0.001, m.scale?.z ?? 1);
  const transparent = opacity < 0.999;

  switch (m.type) {
    case MarkerType.ARROW: {
      const arrowGroup = new THREE.Group();
      if (m.points && m.points.length >= 2) {
        const start = new THREE.Vector3(m.points[0].x, m.points[0].y, m.points[0].z);
        const end = new THREE.Vector3(m.points[1].x, m.points[1].y, m.points[1].z);
        const dir = new THREE.Vector3().subVectors(end, start);
        const len = dir.length();
        if (len > 0.0001) {
          dir.normalize();
          const shaftLen = len * 0.75;
          const headLen = len * 0.25;
          const shaftR = Math.max(0.01, sx * 0.1);
          const headR = Math.max(0.03, sx * 0.25);

          const shaftGeom = new THREE.CylinderGeometry(shaftR, shaftR, shaftLen, 16);
          shaftGeom.rotateX(Math.PI / 2);
          shaftGeom.translate(0, 0, shaftLen / 2);
          const shaftMat = new THREE.MeshStandardMaterial({ color, opacity, transparent, roughness: 0.3 });
          const shaftMesh = new THREE.Mesh(shaftGeom, shaftMat);

          const headGeom = new THREE.ConeGeometry(headR, headLen, 16);
          headGeom.rotateX(Math.PI / 2);
          headGeom.translate(0, 0, shaftLen + headLen / 2);
          const headMat = new THREE.MeshStandardMaterial({ color, opacity, transparent, roughness: 0.2 });
          const headMesh = new THREE.Mesh(headGeom, headMat);

          arrowGroup.add(shaftMesh);
          arrowGroup.add(headMesh);
          arrowGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
          arrowGroup.position.copy(start);
        }
      } else {
        const len = sx;
        const shaftLen = len * 0.75;
        const headLen = len * 0.25;
        const shaftR = Math.max(0.01, sy * 0.5);
        const headR = Math.max(0.03, sz * 0.5);

        const shaftGeom = new THREE.CylinderGeometry(shaftR, shaftR, shaftLen, 16);
        shaftGeom.rotateZ(-Math.PI / 2);
        shaftGeom.translate(shaftLen / 2, 0, 0);
        const shaftMat = new THREE.MeshStandardMaterial({ color, opacity, transparent, roughness: 0.3 });
        const shaftMesh = new THREE.Mesh(shaftGeom, shaftMat);

        const headGeom = new THREE.ConeGeometry(headR, headLen, 16);
        headGeom.rotateZ(-Math.PI / 2);
        headGeom.translate(shaftLen + headLen / 2, 0, 0);
        const headMat = new THREE.MeshStandardMaterial({ color, opacity, transparent, roughness: 0.2 });
        const headMesh = new THREE.Mesh(headGeom, headMat);

        arrowGroup.add(shaftMesh);
        arrowGroup.add(headMesh);
      }
      group.add(arrowGroup);
      break;
    }

    case MarkerType.CUBE: {
      const geom = new THREE.BoxGeometry(sx, sy, sz);
      const mat = new THREE.MeshStandardMaterial({
        color,
        opacity,
        transparent,
        roughness: 0.35,
        metalness: 0.15,
      });
      const mesh = new THREE.Mesh(geom, mat);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geom),
        new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.3, transparent: true })
      );
      mesh.add(edges);
      group.add(mesh);
      break;
    }

    case MarkerType.SPHERE: {
      const geom = new THREE.SphereGeometry(0.5, 24, 24);
      geom.scale(sx, sy, sz);
      const mat = new THREE.MeshStandardMaterial({
        color,
        opacity,
        transparent,
        roughness: 0.2,
        metalness: 0.1,
      });
      group.add(new THREE.Mesh(geom, mat));
      break;
    }

    case MarkerType.CYLINDER: {
      // In ROS, cylinder axis is Z. Three.js cylinder axis is Y.
      const geom = new THREE.CylinderGeometry(sx / 2, sy / 2, sz, 24);
      geom.rotateX(Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color,
        opacity,
        transparent,
        roughness: 0.3,
        metalness: 0.1,
      });
      group.add(new THREE.Mesh(geom, mat));
      break;
    }

    case MarkerType.LINE_STRIP: {
      const pts = (m.points || []).map((p) => new THREE.Vector3(p.x, p.y, p.z));
      if (pts.length >= 2) {
        const geom = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color, linewidth: Math.max(1, sx) });
        group.add(new THREE.Line(geom, mat));
      }
      break;
    }

    case MarkerType.LINE_LIST: {
      const pts = (m.points || []).map((p) => new THREE.Vector3(p.x, p.y, p.z));
      if (pts.length >= 2) {
        const geom = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color, linewidth: Math.max(1, sx) });
        group.add(new THREE.LineSegments(geom, mat));
      }
      break;
    }

    case MarkerType.CUBE_LIST: {
      const geom = new THREE.BoxGeometry(sx, sy, sz);
      const mat = new THREE.MeshStandardMaterial({ color, opacity, transparent });
      (m.points || []).forEach((p, idx) => {
        let mMat = mat;
        if (m.colors && m.colors[idx]) {
          const c = parseThreeColor(m.colors[idx]);
          mMat = new THREE.MeshStandardMaterial({ color: c.color, opacity: c.opacity, transparent: c.opacity < 1 });
        }
        const mesh = new THREE.Mesh(geom, mMat);
        mesh.position.set(p.x, p.y, p.z);
        group.add(mesh);
      });
      break;
    }

    case MarkerType.SPHERE_LIST: {
      const geom = new THREE.SphereGeometry(sx / 2, 16, 16);
      const mat = new THREE.MeshStandardMaterial({ color, opacity, transparent });
      (m.points || []).forEach((p, idx) => {
        let mMat = mat;
        if (m.colors && m.colors[idx]) {
          const c = parseThreeColor(m.colors[idx]);
          mMat = new THREE.MeshStandardMaterial({ color: c.color, opacity: c.opacity, transparent: c.opacity < 1 });
        }
        const mesh = new THREE.Mesh(geom, mMat);
        mesh.position.set(p.x, p.y, p.z);
        group.add(mesh);
      });
      break;
    }

    case MarkerType.POINTS: {
      const pts = (m.points || []).map((p) => new THREE.Vector3(p.x, p.y, p.z));
      if (pts.length > 0) {
        const geom = new THREE.BufferGeometry().setFromPoints(pts);
        if (m.colors && m.colors.length === pts.length) {
          const rgbArr: number[] = [];
          m.colors.forEach((c) => {
            rgbArr.push(c.r, c.g, c.b);
          });
          geom.setAttribute("color", new THREE.Float32BufferAttribute(rgbArr, 3));
          const mat = new THREE.PointsMaterial({
            size: Math.max(0.02, sx * 0.1),
            vertexColors: true,
          });
          group.add(new THREE.Points(geom, mat));
        } else {
          const mat = new THREE.PointsMaterial({
            color,
            size: Math.max(0.02, sx * 0.1),
          });
          group.add(new THREE.Points(geom, mat));
        }
      }
      break;
    }

    case MarkerType.TEXT_VIEW_FACING: {
      const sprite = createTextSprite(m.text || "", color, sz);
      group.add(sprite);
      break;
    }

    case MarkerType.TRIANGLE_LIST: {
      const pts = (m.points || []).map((p) => new THREE.Vector3(p.x, p.y, p.z));
      if (pts.length >= 3) {
        // truncate to multiple of 3
        const count = pts.length - (pts.length % 3);
        const subPts = pts.slice(0, count);
        const geom = new THREE.BufferGeometry().setFromPoints(subPts);
        geom.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({
          color,
          opacity,
          transparent,
          side: THREE.DoubleSide,
          roughness: 0.4,
        });
        group.add(new THREE.Mesh(geom, mat));
      }
      break;
    }

    default:
      break;
  }

  // Apply Pose translation and rotation
  if (m.pose) {
    if (m.pose.position) {
      group.position.set(m.pose.position.x || 0, m.pose.position.y || 0, m.pose.position.z || 0);
    }
    if (m.pose.orientation) {
      const q = m.pose.orientation;
      if (Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w)) {
        group.quaternion.set(q.x, q.y, q.z, q.w);
      }
    }
  }

  return group;
}

function disposeHierarchy(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh || (child as THREE.Line).isLine || (child as THREE.Points).isPoints) {
      const m = child as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (Array.isArray(m.material)) {
          m.material.forEach((mat) => mat.dispose());
        } else {
          m.material.dispose();
        }
      }
    }
  });
}

export function Scene3DView({ markers, onClear, onLoadDemo, className = "" }: Scene3DViewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const markerMapRef = useRef<Map<string, MarkerRecord>>(new Map());

  const [activeCount, setActiveCount] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [visibleNs, setVisibleNs] = useState<Record<string, boolean>>({});

  // Initialize Three.js Scene
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 400;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090a0f);
    sceneRef.current = scene;

    // Camera (Z-Up ROS coordinate convention)
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.up.set(0, 0, 1);
    camera.position.set(-6, -6, 4.5);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // Ambient & Directional Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x00f0ff, 1.2);
    dirLight1.position.set(5, 5, 10);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x8b5cf6, 0.8);
    dirLight2.position.set(-5, -5, -2);
    scene.add(dirLight2);

    // Grid (Flat on XY plane, Z=0)
    const grid = new THREE.GridHelper(20, 20, 0x00f0ff, 0x1e2433);
    grid.rotation.x = Math.PI / 2; // Lie flat on XY plane
    scene.add(grid);
    gridRef.current = grid;

    // Axes Helper (X=Red, Y=Green, Z=Blue)
    const axes = new THREE.AxesHelper(1.8);
    scene.add(axes);

    // Resize Observer
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
      }
    });
    resizeObserver.observe(container);

    // Animation Loop with Lifetime Pruning
    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();

      // Prune expired markers
      const now = Date.now();
      let changed = false;
      markerMapRef.current.forEach((rec, key) => {
        if (rec.expireTime > 0 && now > rec.expireTime) {
          scene.remove(rec.object);
          disposeHierarchy(rec.object);
          markerMapRef.current.delete(key);
          changed = true;
        }
      });
      if (changed) {
        setActiveCount(markerMapRef.current.size);
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
      markerMapRef.current.forEach((rec) => {
        disposeHierarchy(rec.object);
      });
      markerMapRef.current.clear();
    };
  }, []);

  // Process Incoming Markers & Actions
  const processMarker = useCallback((m: Marker) => {
    const scene = sceneRef.current;
    if (!scene) return;

    const ns = m.ns || "default";
    const id = m.id ?? 0;
    const key = `${ns}:${id}`;
    const action = m.action ?? MarkerAction.ADD;

    if (action === MarkerAction.DELETEALL) {
      // Clear all markers or specific namespace
      markerMapRef.current.forEach((rec, k) => {
        if (!m.ns || rec.marker.ns === m.ns) {
          scene.remove(rec.object);
          disposeHierarchy(rec.object);
          markerMapRef.current.delete(k);
        }
      });
      setActiveCount(markerMapRef.current.size);
      return;
    }

    if (action === MarkerAction.DELETE) {
      const existing = markerMapRef.current.get(key);
      if (existing) {
        scene.remove(existing.object);
        disposeHierarchy(existing.object);
        markerMapRef.current.delete(key);
        setActiveCount(markerMapRef.current.size);
      }
      return;
    }

    // ADD / MODIFY action
    const existing = markerMapRef.current.get(key);
    if (existing) {
      scene.remove(existing.object);
      disposeHierarchy(existing.object);
    }

    const obj = createMarkerObject(m);
    obj.visible = visibleNs[ns] !== false;
    scene.add(obj);

    const lifetimeMs = (m.lifetime || 0) * 1000;
    const expireTime = lifetimeMs > 0 ? Date.now() + lifetimeMs : 0;

    markerMapRef.current.set(key, {
      marker: m,
      object: obj,
      expireTime,
    });

    setActiveCount(markerMapRef.current.size);

    // Track unique namespaces
    setNamespaces((prev) => (prev.includes(ns) ? prev : [...prev, ns]));
  }, [visibleNs]);

  // Sync incoming markers prop
  useEffect(() => {
    if (markers && markers.length > 0) {
      markers.forEach(processMarker);
    }
  }, [markers, processMarker]);

  // Update visibility when namespace filters change
  useEffect(() => {
    markerMapRef.current.forEach((rec) => {
      const ns = rec.marker.ns || "default";
      rec.object.visible = visibleNs[ns] !== false;
    });
  }, [visibleNs]);

  // Toolbar Actions
  const handleResetCamera = () => {
    if (!cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.set(-6, -6, 4.5);
    cameraRef.current.up.set(0, 0, 1);
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  };

  const handleTopDownCamera = () => {
    if (!cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.set(0, 0, 12);
    cameraRef.current.up.set(1, 0, 0); // Point forward
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  };

  const handleToggleGrid = () => {
    setShowGrid((prev) => {
      const next = !prev;
      if (gridRef.current) gridRef.current.visible = next;
      return next;
    });
  };

  const handleClearAll = () => {
    const scene = sceneRef.current;
    if (scene) {
      markerMapRef.current.forEach((rec) => {
        scene.remove(rec.object);
        disposeHierarchy(rec.object);
      });
    }
    markerMapRef.current.clear();
    setActiveCount(0);
    if (onClear) onClear();
  };

  const toggleNs = (ns: string) => {
    setVisibleNs((prev) => ({
      ...prev,
      [ns]: prev[ns] === false,
    }));
  };

  const handleLoadDemo = useCallback(() => {
    const now = Date.now() / 1000;
    const demo: Marker[] = [
      // 1. Robot Chassis Base (CUBE)
      {
        header: { frame_id: "base_link", stamp: { sec: Math.floor(now), nanosec: 0 } },
        ns: "robot",
        id: 1,
        type: MarkerType.CUBE,
        action: MarkerAction.ADD,
        pose: {
          position: { x: 0, y: 0, z: 0.2 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
        scale: { x: 0.65, y: 0.5, z: 0.28 },
        color: { r: 0.06, g: 0.73, b: 0.51, a: 0.75 },
      },
      // 2. Turret Gimbal Heading (ARROW)
      {
        header: { frame_id: "base_link", stamp: { sec: Math.floor(now), nanosec: 0 } },
        ns: "gimbal",
        id: 2,
        type: MarkerType.ARROW,
        action: MarkerAction.ADD,
        points: [
          { x: 0, y: 0, z: 0.35 },
          { x: 1.8, y: 0.9, z: 0.55 },
        ],
        scale: { x: 0.08, y: 0.16, z: 0.2 },
        color: { r: 0.0, g: 0.94, b: 1.0, a: 1.0 },
      },
      // 3. Enemy Target Robot (CYLINDER)
      {
        header: { frame_id: "base_link", stamp: { sec: Math.floor(now), nanosec: 0 } },
        ns: "target",
        id: 3,
        type: MarkerType.CYLINDER,
        action: MarkerAction.ADD,
        pose: {
          position: { x: 2.4, y: 1.2, z: 0.35 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
        scale: { x: 0.5, y: 0.5, z: 0.7 },
        color: { r: 0.96, g: 0.62, b: 0.04, a: 0.8 },
      },
      // 4. Target Label Tag (TEXT_VIEW_FACING)
      {
        header: { frame_id: "base_link", stamp: { sec: Math.floor(now), nanosec: 0 } },
        ns: "target",
        id: 4,
        type: MarkerType.TEXT_VIEW_FACING,
        action: MarkerAction.ADD,
        pose: {
          position: { x: 2.4, y: 1.2, z: 0.95 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
        scale: { x: 0.35, y: 0.35, z: 0.35 },
        color: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
        text: "Enemy Sentry #1 [2.68m]",
      },
      // 5. Ballistic trajectory curve (LINE_STRIP)
      {
        header: { frame_id: "base_link", stamp: { sec: Math.floor(now), nanosec: 0 } },
        ns: "trajectory",
        id: 5,
        type: MarkerType.LINE_STRIP,
        action: MarkerAction.ADD,
        points: Array.from({ length: 25 }, (_, idx) => {
          const s = idx / 24;
          return {
            x: s * 2.4,
            y: s * 1.2,
            z: 0.35 + 0.9 * Math.sin(s * Math.PI) - 0.2 * s,
          };
        }),
        scale: { x: 0.04, y: 0.04, z: 0.04 },
        color: { r: 0.55, g: 0.36, b: 0.96, a: 0.9 },
      },
      // 6. Impact Prediction Sphere (SPHERE)
      {
        header: { frame_id: "base_link", stamp: { sec: Math.floor(now), nanosec: 0 } },
        ns: "trajectory",
        id: 6,
        type: MarkerType.SPHERE,
        action: MarkerAction.ADD,
        pose: {
          position: { x: 2.4, y: 1.2, z: 0.35 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
        scale: { x: 0.16, y: 0.16, z: 0.16 },
        color: { r: 0.93, g: 0.28, b: 0.6, a: 1.0 },
      },
    ];
    if (onLoadDemo) {
      onLoadDemo(demo);
    } else {
      demo.forEach(processMarker);
    }
  }, [onLoadDemo, processMarker]);

  return (
    <div className={`scene3d-container ${className}`} style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* 3D WebGL Canvas */}
      <div ref={mountRef} style={{ width: "100%", height: "100%", overflow: "hidden" }} />

      {/* Empty State Prompt when no markers */}
      {activeCount === 0 && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            textAlign: "center",
            background: "rgba(10, 14, 24, 0.92)",
            padding: "20px 28px",
            borderRadius: 8,
            border: "1px solid rgba(0, 240, 255, 0.3)",
            pointerEvents: "auto",
            backdropFilter: "blur(8px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            zIndex: 10,
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          }}
        >
          <div style={{ fontSize: 32 }}>🧊</div>
          <div style={{ color: "#fff", fontWeight: 600, fontSize: 14 }}>
            ROS 2 3D 空间可视化环境就绪
          </div>
          <div style={{ color: "var(--muted)", fontSize: 12, maxWidth: 320, lineHeight: 1.5 }}>
            右手 Z-Up 空间坐标系已启动。支持实时接收并渲染 10 种 ROS 2 3D 标记。
          </div>
          <button
            type="button"
            onClick={handleLoadDemo}
            style={{
              marginTop: 4,
              padding: "7px 18px",
              fontSize: 12,
              background: "rgba(0, 240, 255, 0.18)",
              border: "1px solid var(--cyan)",
              color: "var(--cyan)",
              borderRadius: 4,
              cursor: "pointer",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            🎯 一键加载 3D 演示标记 (Demo)
          </button>
        </div>
      )}

      {/* Floating HUD Toolbar */}
      <div
        className="scene3d-toolbar"
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          right: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pointerEvents: "none",
          gap: 8,
        }}
      >
        {/* Left: Active Markers Badge & Namespaces */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, pointerEvents: "auto", flexWrap: "wrap" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 10px",
              background: "rgba(10, 14, 24, 0.85)",
              border: "1px solid rgba(0, 240, 255, 0.35)",
              borderRadius: 6,
              fontSize: 12,
              fontFamily: "var(--mono)",
              color: "var(--cyan)",
              backdropFilter: "blur(8px)",
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: activeCount > 0 ? "var(--cyan)" : "#666" }} />
            {activeCount} 3D Markers
          </span>

          {namespaces.map((ns) => {
            const on = visibleNs[ns] !== false;
            return (
              <button
                key={ns}
                onClick={() => toggleNs(ns)}
                className={`ghost ${on ? "" : "disabled"}`}
                style={{
                  height: 24,
                  padding: "0 8px",
                  fontSize: 11,
                  fontFamily: "var(--mono)",
                  background: on ? "rgba(0, 240, 255, 0.15)" : "rgba(255,255,255,0.05)",
                  borderColor: on ? "var(--cyan)" : "transparent",
                  color: on ? "#fff" : "var(--muted)",
                  borderRadius: 4,
                }}
                title={`点击切换命名空间 ${ns} 的可见性`}
              >
                {ns}
              </button>
            );
          })}
        </div>

        {/* Right: Camera & Grid Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, pointerEvents: "auto" }}>
          <button
            onClick={handleLoadDemo}
            className="ghost"
            style={{
              height: 26,
              fontSize: 11,
              padding: "0 8px",
              background: "rgba(0, 240, 255, 0.15)",
              borderColor: "var(--cyan)",
              color: "var(--cyan)",
            }}
            title="加载 3D 演示标记"
          >
            🎯 Demo
          </button>
          <button
            onClick={handleResetCamera}
            className="ghost"
            style={{ height: 26, fontSize: 11, padding: "0 8px", background: "rgba(10,14,24,0.85)" }}
            title="重置为透视观察视角"
          >
            视角重置
          </button>
          <button
            onClick={handleTopDownCamera}
            className="ghost"
            style={{ height: 26, fontSize: 11, padding: "0 8px", background: "rgba(10,14,24,0.85)" }}
            title="切换为顶视俯视图"
          >
            俯视
          </button>
          <button
            onClick={handleToggleGrid}
            className="ghost"
            style={{
              height: 26,
              fontSize: 11,
              padding: "0 8px",
              background: showGrid ? "rgba(0, 240, 255, 0.15)" : "rgba(10,14,24,0.85)",
              color: showGrid ? "var(--cyan)" : "var(--muted)",
            }}
            title="显示/隐藏基准地面网格"
          >
            网格
          </button>
          <button
            onClick={handleClearAll}
            className="ghost"
            style={{ height: 26, fontSize: 11, padding: "0 8px", background: "rgba(10,14,24,0.85)", color: "var(--err)" }}
            title="清空所有 3D 标记"
          >
            清空
          </button>
        </div>
      </div>

      {/* Coordinate Axes Legend at Bottom Right */}
      <div
        style={{
          position: "absolute",
          bottom: 10,
          right: 12,
          padding: "3px 8px",
          background: "rgba(10, 14, 24, 0.75)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 4,
          fontSize: 11,
          fontFamily: "var(--mono)",
          color: "var(--muted)",
          pointerEvents: "none",
          display: "flex",
          gap: 8,
        }}
      >
        <span><b style={{ color: "#f43f5e" }}>X</b> 前</span>
        <span><b style={{ color: "#10b981" }}>Y</b> 左</span>
        <span><b style={{ color: "#00f0ff" }}>Z</b> 上</span>
      </div>
    </div>
  );
}
