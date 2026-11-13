#ifndef OMNISCOPE_MARKER_HPP
#define OMNISCOPE_MARKER_HPP

#include <cstdint>
#include <string>
#include <vector>
#include <nlohmann/json.hpp>

namespace omniscope
{

/// ROS 2 对齐的 3D 标记类型定义 (visualization_msgs/msg/Marker)
enum class MarkerType : int32_t
{
  ARROW = 0,             // 3D 箭头
  CUBE = 1,              // 3D 立方体 / 障碍物包围盒
  SPHERE = 2,            // 3D 球体 / 航向路标
  CYLINDER = 3,          // 3D 圆柱体 / 立柱
  LINE_STRIP = 4,        // 连续折线 / 运动轨迹
  LINE_LIST = 5,         // 离散线段对 / 测距射线
  CUBE_LIST = 6,         // 批量立方体 / 栅格点阵
  SPHERE_LIST = 7,       // 批量球体 / 路标群
  POINTS = 8,            // 3D 点云集合
  TEXT_VIEW_FACING = 9,  // 始终面向相机的 3D 文本标签
  TRIANGLE_LIST = 11     // 三角网格片 / 自定义多边形
};

/// 标记动作 (Marker Actions)
enum class MarkerAction : int32_t
{
  ADD = 0,               // 新增或更新指定 ns:id 的标记
  MODIFY = 0,            // ADD 的别名
  DELETE = 2,            // 删除指定 ns:id 的标记
  DELETEALL = 3          // 清空所有活动标记
};

struct Vector3
{
  float x = 0.0f;
  float y = 0.0f;
  float z = 0.0f;

  NLOHMANN_DEFINE_TYPE_INTRUSIVE(Vector3, x, y, z)
};

struct Quaternion
{
  float x = 0.0f;
  float y = 0.0f;
  float z = 0.0f;
  float w = 1.0f;

  NLOHMANN_DEFINE_TYPE_INTRUSIVE(Quaternion, x, y, z, w)
};

struct Pose
{
  Vector3 position;
  Quaternion orientation;

  NLOHMANN_DEFINE_TYPE_INTRUSIVE(Pose, position, orientation)
};

struct ColorRGBA
{
  float r = 1.0f;
  float g = 1.0f;
  float b = 1.0f;
  float a = 1.0f;

  NLOHMANN_DEFINE_TYPE_INTRUSIVE(ColorRGBA, r, g, b, a)
};

struct Marker
{
  std::string frame_id = "base_link";
  std::string ns = "default";
  int32_t id = 0;
  MarkerType type = MarkerType::CUBE;
  MarkerAction action = MarkerAction::ADD;
  Pose pose;
  Vector3 scale = {1.0f, 1.0f, 1.0f};
  ColorRGBA color = {0.0f, 0.94f, 1.0f, 1.0f}; // 默认赛博青色
  float lifetime = 0.0f;                         // 持续秒数，0 为永不过期
  bool frame_locked = false;
  std::vector<Vector3> points;
  std::vector<ColorRGBA> colors;
  std::string text;

  nlohmann::json to_json() const
  {
    nlohmann::json j;
    j["frame_id"] = frame_id;
    j["ns"] = ns;
    j["id"] = id;
    j["type"] = static_cast<int32_t>(type);
    j["action"] = static_cast<int32_t>(action);
    j["pose"] = pose;
    j["scale"] = scale;
    j["color"] = color;
    j["lifetime"] = lifetime;
    j["frame_locked"] = frame_locked;
    if (!points.empty()) {
      j["points"] = points;
    }
    if (!colors.empty()) {
      j["colors"] = colors;
    }
    if (!text.empty()) {
      j["text"] = text;
    }
    return j;
  }

  static Marker from_json(const nlohmann::json & j)
  {
    Marker m;
    if (j.contains("frame_id") && j["frame_id"].is_string()) m.frame_id = j["frame_id"];
    if (j.contains("ns") && j["ns"].is_string()) m.ns = j["ns"];
    if (j.contains("id") && j["id"].is_number_integer()) m.id = j["id"];
    if (j.contains("type") && j["type"].is_number_integer()) m.type = static_cast<MarkerType>(j["type"].get<int32_t>());
    if (j.contains("action") && j["action"].is_number_integer()) m.action = static_cast<MarkerAction>(j["action"].get<int32_t>());
    if (j.contains("pose")) j["pose"].get_to(m.pose);
    if (j.contains("scale")) j["scale"].get_to(m.scale);
    if (j.contains("color")) j["color"].get_to(m.color);
    if (j.contains("lifetime") && j["lifetime"].is_number()) m.lifetime = j["lifetime"];
    if (j.contains("frame_locked") && j["frame_locked"].is_boolean()) m.frame_locked = j["frame_locked"];
    if (j.contains("points") && j["points"].is_array()) j["points"].get_to(m.points);
    if (j.contains("colors") && j["colors"].is_array()) j["colors"].get_to(m.colors);
    if (j.contains("text") && j["text"].is_string()) m.text = j["text"];
    return m;
  }

  // Chaining helpers for ergonomic configuration
  Marker & set_ns(std::string new_ns) { ns = std::move(new_ns); return *this; }
  Marker & set_id(int32_t new_id) { id = new_id; return *this; }
  Marker & set_frame(std::string frame) { frame_id = std::move(frame); return *this; }
  Marker & set_lifetime(float sec) { lifetime = sec; return *this; }

  // Fluent Static Builders for Modern C++ Usage
  static Marker make_arrow(
    const Vector3 & start, const Vector3 & end,
    const ColorRGBA & col = {0.0f, 0.94f, 1.0f, 1.0f},
    float shaft_dia = 0.05f, float head_dia = 0.1f)
  {
    Marker m;
    m.type = MarkerType::ARROW;
    m.color = col;
    m.scale = {shaft_dia, head_dia, 0.0f};
    m.points = {start, end};
    return m;
  }

  static Marker make_cube(
    const Vector3 & center, const Vector3 & size = {0.2f, 0.2f, 0.2f},
    const ColorRGBA & col = {0.0f, 0.94f, 1.0f, 1.0f})
  {
    Marker m;
    m.type = MarkerType::CUBE;
    m.pose.position = center;
    m.scale = size;
    m.color = col;
    return m;
  }

  static Marker make_sphere(
    const Vector3 & center, float radius = 0.1f,
    const ColorRGBA & col = {0.0f, 0.94f, 1.0f, 1.0f})
  {
    Marker m;
    m.type = MarkerType::SPHERE;
    m.pose.position = center;
    m.scale = {radius * 2.0f, radius * 2.0f, radius * 2.0f};
    m.color = col;
    return m;
  }

  static Marker make_cylinder(
    const Vector3 & center, float radius = 0.1f, float height = 0.4f,
    const ColorRGBA & col = {0.0f, 0.94f, 1.0f, 1.0f})
  {
    Marker m;
    m.type = MarkerType::CYLINDER;
    m.pose.position = center;
    m.scale = {radius * 2.0f, radius * 2.0f, height};
    m.color = col;
    return m;
  }

  static Marker make_line_strip(
    const std::vector<Vector3> & pts,
    const ColorRGBA & col = {0.0f, 0.94f, 1.0f, 1.0f},
    float width = 0.03f)
  {
    Marker m;
    m.type = MarkerType::LINE_STRIP;
    m.scale = {width, 0.0f, 0.0f};
    m.color = col;
    m.points = pts;
    return m;
  }

  static Marker make_line_list(
    const std::vector<Vector3> & pairs,
    const ColorRGBA & col = {0.0f, 0.94f, 1.0f, 1.0f},
    float width = 0.03f)
  {
    Marker m;
    m.type = MarkerType::LINE_LIST;
    m.scale = {width, 0.0f, 0.0f};
    m.color = col;
    m.points = pairs;
    return m;
  }

  static Marker make_points(
    const std::vector<Vector3> & pts,
    const ColorRGBA & col = {0.0f, 0.94f, 1.0f, 1.0f},
    float size = 0.05f)
  {
    Marker m;
    m.type = MarkerType::POINTS;
    m.scale = {size, size, size};
    m.color = col;
    m.points = pts;
    return m;
  }

  static Marker make_text(
    const Vector3 & pos, const std::string & str,
    const ColorRGBA & col = {1.0f, 1.0f, 1.0f, 1.0f},
    float size = 0.2f)
  {
    Marker m;
    m.type = MarkerType::TEXT_VIEW_FACING;
    m.pose.position = pos;
    m.scale = {size, size, size};
    m.color = col;
    m.text = str;
    return m;
  }

  static Marker make_triangle_list(
    const std::vector<Vector3> & vertices,
    const ColorRGBA & col = {0.0f, 0.94f, 1.0f, 1.0f})
  {
    Marker m;
    m.type = MarkerType::TRIANGLE_LIST;
    m.scale = {1.0f, 1.0f, 1.0f};
    m.color = col;
    m.points = vertices;
    return m;
  }

  static Marker make_delete(const std::string & del_ns, int32_t del_id)
  {
    Marker m;
    m.ns = del_ns;
    m.id = del_id;
    m.action = MarkerAction::DELETE;
    return m;
  }

  static Marker make_delete_all()
  {
    Marker m;
    m.action = MarkerAction::DELETEALL;
    return m;
  }
};

}  // namespace omniscope

#endif  // OMNISCOPE_MARKER_HPP
