import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Marker, MarkerAction, MarkerType, MARKER_TYPE_NAMES } from "./markers";

interface Scene3DViewProps {
  markers: Marker[];
  onClear?: () => void;
  onActiveCountChange?: (count: number) => void;
  onStatsChange?: (stats: {
    count: number;
    namespaces: Record<string, number>;
    types: Record<string, number>;
  }) => void;
  className?: string;
  showGrid?: boolean;
  gridSize?: number;
  visibleNs?: Record<string, boolean>;
  cameraPreset?: { id: number; type: "reset" | "top" | "front" | "side" } | null;
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

export function Scene3DView({
  markers,
  onClear,
  onActiveCountChange,
  onStatsChange,
  className = "",
  showGrid = true,
  gridSize = 20,
  visibleNs = {},
  cameraPreset = null,
}: Scene3DViewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const markerMapRef = useRef<Map<string, MarkerRecord>>(new Map());

  const [activeCount, setActiveCount] = useState(0);

  const reportStats = useCallback(() => {
    const namespaces: Record<string, number> = {};
    const types: Record<string, number> = {};
    markerMapRef.current.forEach((rec) => {
      const ns = rec.marker.ns || "default";
      namespaces[ns] = (namespaces[ns] || 0) + 1;
      const typeName = MARKER_TYPE_NAMES[rec.marker.type] || `Type_${rec.marker.type}`;
      types[typeName] = (types[typeName] || 0) + 1;
    });
    const count = markerMapRef.current.size;
    setActiveCount(count);
    if (onActiveCountChange) onActiveCountChange(count);
    if (onStatsChange) onStatsChange({ count, namespaces, types });
  }, [onActiveCountChange, onStatsChange]);

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
    const grid = new THREE.GridHelper(gridSize, gridSize, 0x00f0ff, 0x1e2433);
    grid.rotation.x = Math.PI / 2; // Lie flat on XY plane
    grid.visible = showGrid !== false;
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
        reportStats();
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

  // Update Ground Grid when gridSize or showGrid changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (gridRef.current) {
      scene.remove(gridRef.current);
      disposeHierarchy(gridRef.current);
    }
    const grid = new THREE.GridHelper(gridSize, gridSize, 0x00f0ff, 0x1e2433);
    grid.rotation.x = Math.PI / 2;
    grid.visible = showGrid !== false;
    scene.add(grid);
    gridRef.current = grid;
  }, [gridSize, showGrid]);

  // React to Camera Presets
  const lastPresetIdRef = useRef<number>(0);
  useEffect(() => {
    if (!cameraPreset || cameraPreset.id === lastPresetIdRef.current) return;
    lastPresetIdRef.current = cameraPreset.id;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    if (cameraPreset.type === "reset") {
      camera.position.set(-6, -6, 4.5);
      camera.up.set(0, 0, 1);
      controls.target.set(0, 0, 0);
    } else if (cameraPreset.type === "top") {
      camera.position.set(0, 0, 14);
      camera.up.set(1, 0, 0);
      controls.target.set(0, 0, 0);
    } else if (cameraPreset.type === "front") {
      camera.position.set(8, 0, 1.5);
      camera.up.set(0, 0, 1);
      controls.target.set(0, 0, 1.5);
    } else if (cameraPreset.type === "side") {
      camera.position.set(0, 8, 1.5);
      camera.up.set(0, 0, 1);
      controls.target.set(0, 0, 1.5);
    }
    controls.update();
  }, [cameraPreset]);

  // Process Incoming Markers & Actions
  const processMarker = useCallback(
    (m: Marker) => {
      const scene = sceneRef.current;
      if (!scene) return;

      const ns = m.ns || "default";
      const id = m.id ?? 0;
      const key = `${ns}:${id}`;
      const action = m.action ?? MarkerAction.ADD;

      if (action === MarkerAction.DELETEALL) {
        markerMapRef.current.forEach((rec, k) => {
          if (!m.ns || rec.marker.ns === m.ns) {
            scene.remove(rec.object);
            disposeHierarchy(rec.object);
            markerMapRef.current.delete(k);
          }
        });
        reportStats();
        return;
      }

      if (action === MarkerAction.DELETE) {
        const existing = markerMapRef.current.get(key);
        if (existing) {
          scene.remove(existing.object);
          disposeHierarchy(existing.object);
          markerMapRef.current.delete(key);
          reportStats();
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

      reportStats();
    },
    [visibleNs, reportStats]
  );

  // Sync incoming markers prop
  useEffect(() => {
    if (markers && markers.length > 0) {
      markers.forEach(processMarker);
    }
  }, [markers, processMarker]);

  // Clean clearing if markers array is empty
  useEffect(() => {
    if (!markers || markers.length === 0) {
      const scene = sceneRef.current;
      if (scene) {
        markerMapRef.current.forEach((rec) => {
          scene.remove(rec.object);
          disposeHierarchy(rec.object);
        });
      }
      markerMapRef.current.clear();
      reportStats();
    }
  }, [markers, reportStats]);

  // Update visibility when namespace filters change
  useEffect(() => {
    markerMapRef.current.forEach((rec) => {
      const ns = rec.marker.ns || "default";
      rec.object.visible = visibleNs ? visibleNs[ns] !== false : true;
    });
  }, [visibleNs]);

  return (
    <div className={`scene3d-container ${className}`} style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* 3D WebGL Canvas */}
      <div ref={mountRef} style={{ width: "100%", height: "100%", overflow: "hidden" }} />

      {/* Top Left: Active Markers Badge */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          display: "flex",
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
          pointerEvents: "none",
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: activeCount > 0 ? "var(--cyan)" : "#666" }} />
        {activeCount} 标记 (base_link)
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
