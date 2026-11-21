import type { Quaternion, TransformStamped, Vector3 } from "./markers";

export interface RigidTransform {
  translation: Vector3;
  rotation: Quaternion;
}

const IDENTITY: RigidTransform = {
  translation: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
};

function quatMul(a: Quaternion, b: Quaternion): Quaternion {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function quatConj(q: Quaternion): Quaternion {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

function rotate(q: Quaternion, v: Vector3): Vector3 {
  const p: Quaternion = { x: v.x, y: v.y, z: v.z, w: 0 };
  const r = quatMul(quatMul(q, p), quatConj(q));
  return { x: r.x, y: r.y, z: r.z };
}

function invert(t: RigidTransform): RigidTransform {
  const qinv = quatConj(t.rotation);
  const p = rotate(qinv, t.translation);
  return {
    translation: { x: -p.x, y: -p.y, z: -p.z },
    rotation: qinv,
  };
}

function compose(a: RigidTransform, b: RigidTransform): RigidTransform {
  // a * b : apply b first (child), then a
  const r = rotate(a.rotation, b.translation);
  return {
    translation: {
      x: a.translation.x + r.x,
      y: a.translation.y + r.y,
      z: a.translation.z + r.z,
    },
    rotation: quatMul(a.rotation, b.rotation),
  };
}

function asRigid(tf: TransformStamped): RigidTransform {
  return {
    translation: tf.translation || { x: 0, y: 0, z: 0 },
    rotation: tf.rotation || { x: 0, y: 0, z: 0, w: 1 },
  };
}

export function transformPoint(t: RigidTransform, p: Vector3): Vector3 {
  const r = rotate(t.rotation, p);
  return {
    x: t.translation.x + r.x,
    y: t.translation.y + r.y,
    z: t.translation.z + r.z,
  };
}

export function knownFrames(tfByChild: Record<string, TransformStamped>, extra: string[] = []): string[] {
  const set = new Set<string>(extra.filter(Boolean));
  for (const tf of Object.values(tfByChild)) {
    if (tf.parent) set.add(tf.parent);
    if (tf.child) set.add(tf.child);
  }
  return [...set].sort();
}

export function tfTreeRows(tfByChild: Record<string, TransformStamped>): { parent: string; child: string }[] {
  return Object.values(tfByChild)
    .filter((tf) => tf.child)
    .map((tf) => ({ parent: tf.parent, child: tf.child }))
    .filter((row) => row.parent && row.child)
    .sort((a, b) => a.parent.localeCompare(b.parent) || a.child.localeCompare(b.child));
}

function pathToRoot(
  frame: string,
  tfByChild: Record<string, TransformStamped>,
): { frame: string; toParent?: RigidTransform }[] {
  const path: { frame: string; toParent?: RigidTransform }[] = [];
  const seen = new Set<string>();
  let cur = frame;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const edge = tfByChild[cur];
    if (!edge || !edge.parent) {
      path.push({ frame: cur });
      break;
    }
    path.push({ frame: cur, toParent: asRigid(edge) });
    cur = edge.parent;
  }
  return path;
}

/** Transform a point from `source` into `target`. Identity if equal. */
export function lookupTransform(
  tfByChild: Record<string, TransformStamped>,
  target: string,
  source: string,
): RigidTransform | null {
  if (!target || !source || target === source) return IDENTITY;
  const srcPath = pathToRoot(source, tfByChild);
  const dstPath = pathToRoot(target, tfByChild);
  const srcSet = new Set(srcPath.map((n) => n.frame));
  const lca = dstPath.find((n) => srcSet.has(n.frame));
  if (!lca) return null;

  let t = IDENTITY;
  for (const node of srcPath) {
    if (node.frame === lca.frame) break;
    if (!node.toParent) return null;
    t = compose(node.toParent, t);
  }
  let fromLca = IDENTITY;
  for (const node of dstPath) {
    if (node.frame === lca.frame) break;
    if (!node.toParent) return null;
    fromLca = compose(node.toParent, fromLca);
  }
  return compose(invert(fromLca), t);
}

export function defaultFixedFrame(tfByChild: Record<string, TransformStamped>): string {
  const children = Object.keys(tfByChild);
  if (children.length) {
    const parents = new Set(Object.values(tfByChild).map((tf) => tf.parent || ""));
    const roots = [...parents].filter((p) => p && !tfByChild[p]);
    if (roots[0]) return roots[0];
    return children[0];
  }
  return "";
}
