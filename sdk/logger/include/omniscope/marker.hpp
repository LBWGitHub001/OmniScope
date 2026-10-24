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
};

}  // namespace omniscope

#endif  // OMNISCOPE_MARKER_HPP
