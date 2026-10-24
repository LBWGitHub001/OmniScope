/**
 * ROS 2 Visualization Markers Specification (3D Only)
 * Matches visualization_msgs/msg/Marker standards.
 */

export enum MarkerType {
  ARROW = 0,             // 3D 箭头
  CUBE = 1,              // 3D 长方体 / 立方体
  SPHERE = 2,            // 3D 球体
  CYLINDER = 3,          // 3D 圆柱体
  LINE_STRIP = 4,        // 连续折线
  LINE_LIST = 5,         // 离散线段对
  CUBE_LIST = 6,         // 批量立方体集合
  SPHERE_LIST = 7,       // 批量球体集合
  POINTS = 8,            // 3D 点云集合
  TEXT_VIEW_FACING = 9,  // 始终面向相机的 3D 文本标签
  TRIANGLE_LIST = 11,    // 三角面网格
}

export enum MarkerAction {
  ADD = 0,               // 新增或修改标记
  MODIFY = 0,            // ADD 的别名
  DELETE = 2,            // 删除指定 ns:id 标记
  DELETEALL = 3,         // 删除全部标记
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface ColorRGBA {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface Pose {
  position: Vector3;
  orientation?: Quaternion;
}

export interface Marker {
  header?: { frame_id?: string; stamp?: number };
  frame_id?: string;
  ns?: string;
  id?: number;
  type: MarkerType;
  action?: MarkerAction;
  pose?: Pose;
  scale?: Vector3;
  color?: ColorRGBA;
  lifetime?: number;       // seconds; 0 = infinite
  frame_locked?: boolean;
  points?: Vector3[];
  colors?: ColorRGBA[];
  text?: string;
  receivedAt?: number;     // local timestamp ms for lifetime evaluation
}

export const MARKER_TYPE_NAMES: Record<number, string> = {
  [MarkerType.ARROW]: "Arrow",
  [MarkerType.CUBE]: "Cube",
  [MarkerType.SPHERE]: "Sphere",
  [MarkerType.CYLINDER]: "Cylinder",
  [MarkerType.LINE_STRIP]: "Line Strip",
  [MarkerType.LINE_LIST]: "Line List",
  [MarkerType.CUBE_LIST]: "Cube List",
  [MarkerType.SPHERE_LIST]: "Sphere List",
  [MarkerType.POINTS]: "Points",
  [MarkerType.TEXT_VIEW_FACING]: "Text",
  [MarkerType.TRIANGLE_LIST]: "Triangle List",
};
