import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Marker, MarkerAction, MarkerType, MARKER_TYPE_NAMES } from "./markers";

export interface MarkerObjectMeta {
  key: string;       // `${ns}:${id}`
  ns: string;
  id: number;
  type: MarkerType;
  typeName: string;
  text?: string;
  colorHex: string;
}

export interface Scene3DStats {
  count: number;
  namespaces: Record<string, number>;
  types: Record<string, number>;
  objects: MarkerObjectMeta[];
}

interface Scene3DViewProps {
  markers: Marker[];
  onClear?: () => void;
  onActiveCountChange?: (count: number) => void;
  onStatsChange?: (stats: Scene3DStats) => void;
  className?: string;
  showGrid?: boolean;
  gridSize?: number;
  showAxes?: boolean;
  visibleNs?: Record<string, boolean>;
  visibleObjects?: Record<string, boolean>;
  cameraPreset?: { id: number; type: "reset" | "top" | "front" | "side" } | null;
}

interface MarkerRecord {
  marker: Marker;
  object: THREE.Object3D;
  expireTime: number;
  lastText?: string;
}

// ============================================================================
// Shared Unit Geometries (Drastically reduces WebGL memory & allocations)
// ============================================================================
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_SPHERE = new THREE.SphereGeometry(0.5, 16, 16);
const UNIT_CYLINDER = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
UNIT_CYLINDER.rotateX(Math.PI / 2); // Rotate to align with ROS Z-Up axis

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

// ============================================================================
// 3D Triad Coordinate Axes (Thicker, Shorter, Solid 3D Arrows)
// ============================================================================
function createAxesArrows(totalLength = 0.8, shaftR = 0.03, headR = 0.07, headL = 0.18): THREE.Group {
  const group = new THREE.Group();
  const shaftL = Math.max(0.1, totalLength - headL);

  // Origin anchor sphere
  const sphereGeom = new THREE.SphereGeometry(shaftR * 1.5, 16, 16);
  const sphereMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.25,
    metalness: 0.4,
  });
  group.add(new THREE.Mesh(sphereGeom, sphereMat));

  // Materials with slight emissive boost for crystal clarity from any angle
  const redMat = new THREE.MeshStandardMaterial({
    color: 0xf43f5e,
    roughness: 0.3,
    metalness: 0.2,
    emissive: 0xf43f5e,
    emissiveIntensity: 0.2,
  });
  const greenMat = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    roughness: 0.3,
    metalness: 0.2,
    emissive: 0x10b981,
    emissiveIntensity: 0.2,
  });
  const blueMat = new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    roughness: 0.3,
    metalness: 0.2,
    emissive: 0x00f0ff,
    emissiveIntensity: 0.2,
  });

  // X Axis (Red, Forward in ROS)
  {
    const shaftGeom = new THREE.CylinderGeometry(shaftR, shaftR, shaftL, 16);
    shaftGeom.rotateZ(-Math.PI / 2);
    shaftGeom.translate(shaftL / 2, 0, 0);
    const headGeom = new THREE.ConeGeometry(headR, headL, 16);
    headGeom.rotateZ(-Math.PI / 2);
    headGeom.translate(shaftL + headL / 2, 0, 0);

    const xGroup = new THREE.Group();
    xGroup.add(new THREE.Mesh(shaftGeom, redMat));
    xGroup.add(new THREE.Mesh(headGeom, redMat));
    group.add(xGroup);
  }

  // Y Axis (Green, Left in ROS)
  {
    const shaftGeom = new THREE.CylinderGeometry(shaftR, shaftR, shaftL, 16);
    shaftGeom.translate(0, shaftL / 2, 0);
    const headGeom = new THREE.ConeGeometry(headR, headL, 16);
    headGeom.translate(0, shaftL + headL / 2, 0);

    const yGroup = new THREE.Group();
    yGroup.add(new THREE.Mesh(shaftGeom, greenMat));
    yGroup.add(new THREE.Mesh(headGeom, greenMat));
    group.add(yGroup);
  }

  // Z Axis (Blue/Cyan, Up in ROS)
  {
    const shaftGeom = new THREE.CylinderGeometry(shaftR, shaftR, shaftL, 16);
    shaftGeom.rotateX(Math.PI / 2);
    shaftGeom.translate(0, 0, shaftL / 2);
    const headGeom = new THREE.ConeGeometry(headR, headL, 16);
    headGeom.rotateX(Math.PI / 2);
    headGeom.translate(0, 0, shaftL + headL / 2);

    const zGroup = new THREE.Group();
    zGroup.add(new THREE.Mesh(shaftGeom, blueMat));
    zGroup.add(new THREE.Mesh(headGeom, blueMat));
    group.add(zGroup);
  }

  return group;
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

// ============================================================================
// Object Creator (Initial construction using shared geometries)
// ============================================================================
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
      const mat = new THREE.MeshStandardMaterial({
        color,
        opacity,
        transparent,
        roughness: 0.35,
        metalness: 0.15,
      });
      const mesh = new THREE.Mesh(UNIT_BOX, mat);
      mesh.scale.set(sx, sy, sz);
      group.add(mesh);
      break;
    }

    case MarkerType.SPHERE: {
      const mat = new THREE.MeshStandardMaterial({
        color,
        opacity,
        transparent,
        roughness: 0.2,
        metalness: 0.1,
      });
      const mesh = new THREE.Mesh(UNIT_SPHERE, mat);
      mesh.scale.set(sx, sy, sz);
      group.add(mesh);
      break;
    }

    case MarkerType.CYLINDER: {
      const mat = new THREE.MeshStandardMaterial({
        color,
        opacity,
        transparent,
        roughness: 0.3,
        metalness: 0.1,
      });
      const mesh = new THREE.Mesh(UNIT_CYLINDER, mat);
      mesh.scale.set(sx, sy, sz);
      group.add(mesh);
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
      (m.points || []).forEach((p, idx) => {
        let mColor = color;
        let mOpacity = opacity;
        if (m.colors && m.colors[idx]) {
          const c = parseThreeColor(m.colors[idx]);
          mColor = c.color;
          mOpacity = c.opacity;
        }
        const mat = new THREE.MeshStandardMaterial({
          color: mColor,
          opacity: mOpacity,
          transparent: mOpacity < 1,
        });
        const mesh = new THREE.Mesh(UNIT_BOX, mat);
        mesh.scale.set(sx, sy, sz);
        mesh.position.set(p.x, p.y, p.z);
        group.add(mesh);
      });
      break;
    }

    case MarkerType.SPHERE_LIST: {
      (m.points || []).forEach((p, idx) => {
        let mColor = color;
        let mOpacity = opacity;
        if (m.colors && m.colors[idx]) {
          const c = parseThreeColor(m.colors[idx]);
          mColor = c.color;
          mOpacity = c.opacity;
        }
        const mat = new THREE.MeshStandardMaterial({
          color: mColor,
          opacity: mOpacity,
          transparent: mOpacity < 1,
        });
        const mesh = new THREE.Mesh(UNIT_SPHERE, mat);
        mesh.scale.set(sx, sy, sz);
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

// ============================================================================
// High-Performance In-Place Mutation Engine (Zero reallocation for 99% of frames)
// ============================================================================
function updateMarkerObject(rec: MarkerRecord, m: Marker): boolean {
  if (rec.marker.type !== m.type) return false;
  const { color, opacity } = parseThreeColor(m.color);
  const sx = Math.max(0.001, m.scale?.x ?? 1);
  const sy = Math.max(0.001, m.scale?.y ?? 1);
  const sz = Math.max(0.001, m.scale?.z ?? 1);
  const group = rec.object as THREE.Group;

  // 1. In-place Pose Update
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

  // 2. Type-Specific In-Place Update
  switch (m.type) {
    case MarkerType.CUBE:
    case MarkerType.SPHERE:
    case MarkerType.CYLINDER: {
      const mesh = group.children[0] as THREE.Mesh;
      if (mesh) {
        mesh.scale.set(sx, sy, sz);
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat) {
          mat.color.copy(color);
          mat.opacity = opacity;
          mat.transparent = opacity < 0.999;
        }
        return true;
      }
      return false;
    }

    case MarkerType.ARROW: {
      if (m.points && m.points.length >= 2) {
        const start = new THREE.Vector3(m.points[0].x, m.points[0].y, m.points[0].z);
        const end = new THREE.Vector3(m.points[1].x, m.points[1].y, m.points[1].z);
        const dir = new THREE.Vector3().subVectors(end, start);
        const len = dir.length();
        if (len > 0.0001) {
          dir.normalize();
          const arrowGroup = group.children[0] as THREE.Group;
          if (arrowGroup) {
            arrowGroup.position.copy(start);
            arrowGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
            arrowGroup.scale.set(1, 1, len);
            const shaft = arrowGroup.children[0] as THREE.Mesh;
            const head = arrowGroup.children[1] as THREE.Mesh;
            if (shaft?.material) (shaft.material as THREE.MeshStandardMaterial).color.copy(color);
            if (head?.material) (head.material as THREE.MeshStandardMaterial).color.copy(color);
            return true;
          }
        }
      } else {
        const arrowGroup = group.children[0] as THREE.Group;
        if (arrowGroup) {
          arrowGroup.scale.set(sx, sy, sz);
          const shaft = arrowGroup.children[0] as THREE.Mesh;
          const head = arrowGroup.children[1] as THREE.Mesh;
          if (shaft?.material) (shaft.material as THREE.MeshStandardMaterial).color.copy(color);
          if (head?.material) (head.material as THREE.MeshStandardMaterial).color.copy(color);
          return true;
        }
      }
      return false;
    }

    case MarkerType.LINE_STRIP:
    case MarkerType.LINE_LIST: {
      const line = group.children[0] as THREE.Line;
      const pts = m.points || [];
      if (line && line.geometry && pts.length >= 2) {
        const vecArr = pts.map((p) => new THREE.Vector3(p.x, p.y, p.z));
        line.geometry.setFromPoints(vecArr);
        if (line.material) (line.material as THREE.LineBasicMaterial).color.copy(color);
        return true;
      }
      return false;
    }

    case MarkerType.POINTS: {
      const points = group.children[0] as THREE.Points;
      const pts = m.points || [];
      if (points && points.geometry && pts.length > 0) {
        const vecArr = pts.map((p) => new THREE.Vector3(p.x, p.y, p.z));
        points.geometry.setFromPoints(vecArr);
        if (points.material) (points.material as THREE.PointsMaterial).color.copy(color);
        return true;
      }
      return false;
    }

    case MarkerType.TEXT_VIEW_FACING: {
      const sprite = group.children[0] as THREE.Sprite;
      if (sprite) {
        if (rec.lastText === m.text) {
          sprite.scale.set(sz * 4, sz, 1);
          return true;
        }
        return false; // Recreate canvas texture if string changed
      }
      return false;
    }

    default:
      return false;
  }
}

function disposeHierarchy(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh || (child as THREE.Line).isLine || (child as THREE.Points).isPoints) {
      const m = child as THREE.Mesh;
      // Do NOT dispose shared unit geometries!
      if (
        m.geometry &&
        m.geometry !== UNIT_BOX &&
        m.geometry !== UNIT_SPHERE &&
        m.geometry !== UNIT_CYLINDER
      ) {
        m.geometry.dispose();
      }
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

// ============================================================================
// Main Scene3DView Component
// ============================================================================
export function Scene3DView({
  markers,
  onClear,
  onActiveCountChange,
  onStatsChange,
  className = "",
  showGrid = true,
  gridSize = 20,
  showAxes = true,
  visibleNs = {},
  visibleObjects = {},
  cameraPreset = null,
}: Scene3DViewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const axesGroupRef = useRef<THREE.Group | null>(null);
  const markerMapRef = useRef<Map<string, MarkerRecord>>(new Map());

  // Cached refs to decouple high-frequency updates from closures
  const visibleNsRef = useRef<Record<string, boolean>>(visibleNs);
  const visibleObjectsRef = useRef<Record<string, boolean>>(visibleObjects);
  const statsDirtyRef = useRef<boolean>(true);
  const lastStatsReportRef = useRef<number>(0);

  const [activeCount, setActiveCount] = useState(0);

  // Throttled stats report (max 5Hz, eliminates React re-render lagging)
  const reportStats = useCallback(
    (force = false) => {
      const now = performance.now();
      if (!force && now - lastStatsReportRef.current < 200) {
        statsDirtyRef.current = true;
        return;
      }
      lastStatsReportRef.current = now;
      statsDirtyRef.current = false;

      const namespaces: Record<string, number> = {};
      const types: Record<string, number> = {};
      const objects: MarkerObjectMeta[] = [];

      markerMapRef.current.forEach((rec, key) => {
        const m = rec.marker;
        const ns = m.ns || "default";
        const id = m.id ?? 0;
        namespaces[ns] = (namespaces[ns] || 0) + 1;
        const typeName = MARKER_TYPE_NAMES[m.type] || `Type_${m.type}`;
        types[typeName] = (types[typeName] || 0) + 1;
        const { color } = parseThreeColor(m.color);

        objects.push({
          key,
          ns,
          id,
          type: m.type,
          typeName,
          text: m.text,
          colorHex: `#${color.getHexString()}`,
        });
      });

      // Sort objects by ns then id
      objects.sort((a, b) => (a.ns === b.ns ? a.id - b.id : a.ns.localeCompare(b.ns)));

      const count = markerMapRef.current.size;
      setActiveCount(count);
      if (onActiveCountChange) onActiveCountChange(count);
      if (onStatsChange) onStatsChange({ count, namespaces, types, objects });
    },
    [onActiveCountChange, onStatsChange]
  );

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

    // Renderer with optimized settings
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
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
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x00f0ff, 1.2);
    dirLight1.position.set(5, 5, 10);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x8b5cf6, 0.8);
    dirLight2.position.set(-5, -5, -2);
    scene.add(dirLight2);

    // Ground Grid (Flat on XY plane, Z=0)
    const grid = new THREE.GridHelper(gridSize, gridSize, 0x00f0ff, 0x1e2433);
    grid.rotation.x = Math.PI / 2;
    grid.visible = showGrid !== false;
    scene.add(grid);
    gridRef.current = grid;

    // 3D Triad Solid Arrows Coordinate Helper
    const axes = createAxesArrows(0.8, 0.03, 0.07, 0.18);
    axes.visible = showAxes !== false;
    scene.add(axes);
    axesGroupRef.current = axes;

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

    // High-performance RAF Render Loop
    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();

      // Prune expired markers
      const nowMs = Date.now();
      let changed = false;
      markerMapRef.current.forEach((rec, key) => {
        if (rec.expireTime > 0 && nowMs > rec.expireTime) {
          scene.remove(rec.object);
          disposeHierarchy(rec.object);
          markerMapRef.current.delete(key);
          changed = true;
        }
      });
      if (changed) {
        statsDirtyRef.current = true;
      }

      // Check throttled stats update
      const perfNow = performance.now();
      if (statsDirtyRef.current && perfNow - lastStatsReportRef.current >= 200) {
        reportStats(true);
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

  // Update Ground Grid
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

  // Update 3D Axes Visibility
  useEffect(() => {
    if (axesGroupRef.current) {
      axesGroupRef.current.visible = showAxes !== false;
    }
  }, [showAxes]);

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

  // Sync refs when visibility maps change
  useEffect(() => {
    visibleNsRef.current = visibleNs;
    visibleObjectsRef.current = visibleObjects;
    markerMapRef.current.forEach((rec, key) => {
      const ns = rec.marker.ns || "default";
      const isNsVis = visibleNs ? visibleNs[ns] !== false : true;
      const isObjVis = visibleObjects ? visibleObjects[key] !== false : true;
      rec.object.visible = isNsVis && isObjVis;
    });
  }, [visibleNs, visibleObjects]);

  // Process Incoming Markers & Actions with In-Place Mutation
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
        statsDirtyRef.current = true;
        return;
      }

      if (action === MarkerAction.DELETE) {
        const existing = markerMapRef.current.get(key);
        if (existing) {
          scene.remove(existing.object);
          disposeHierarchy(existing.object);
          markerMapRef.current.delete(key);
          statsDirtyRef.current = true;
        }
        return;
      }

      // Check if existing object can be mutated in-place
      const existing = markerMapRef.current.get(key);
      if (existing && updateMarkerObject(existing, m)) {
        const isNsVis = visibleNsRef.current ? visibleNsRef.current[ns] !== false : true;
        const isObjVis = visibleObjectsRef.current ? visibleObjectsRef.current[key] !== false : true;
        existing.object.visible = isNsVis && isObjVis;
        const lifetimeMs = (m.lifetime || 0) * 1000;
        existing.expireTime = lifetimeMs > 0 ? Date.now() + lifetimeMs : 0;
        existing.marker = m;
        statsDirtyRef.current = true;
        return;
      }

      // If cannot update in-place, recreate
      if (existing) {
        scene.remove(existing.object);
        disposeHierarchy(existing.object);
      }

      const obj = createMarkerObject(m);
      const isNsVis = visibleNsRef.current ? visibleNsRef.current[ns] !== false : true;
      const isObjVis = visibleObjectsRef.current ? visibleObjectsRef.current[key] !== false : true;
      obj.visible = isNsVis && isObjVis;
      scene.add(obj);

      const lifetimeMs = (m.lifetime || 0) * 1000;
      const expireTime = lifetimeMs > 0 ? Date.now() + lifetimeMs : 0;

      markerMapRef.current.set(key, {
        marker: m,
        object: obj,
        expireTime,
        lastText: m.text,
      });

      statsDirtyRef.current = true;
    },
    []
  );

  // Sync incoming markers prop in batch
  useEffect(() => {
    if (markers && markers.length > 0) {
      markers.forEach(processMarker);
      reportStats(false);
    }
  }, [markers, processMarker, reportStats]);

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
      reportStats(true);
    }
  }, [markers, reportStats]);

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
