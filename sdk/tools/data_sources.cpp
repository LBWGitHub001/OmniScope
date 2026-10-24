#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include <nlohmann/json.hpp>
#include <opencv2/opencv.hpp>

#include "omniscope/core/exiter.hpp"
#include "omniscope/marker.hpp"
#include "omniscope/remote_logger.hpp"

using namespace std::chrono_literals;

namespace
{
// Helper to construct a 3D Vector
inline omniscope::Vector3 vec3(float x, float y, float z)
{
  omniscope::Vector3 v;
  v.x = x;
  v.y = y;
  v.z = z;
  return v;
}

// Helper to construct a ColorRGBA
inline omniscope::ColorRGBA rgba(float r, float g, float b, float a = 1.0f)
{
  omniscope::ColorRGBA c;
  c.r = r;
  c.g = g;
  c.b = b;
  c.a = a;
  return c;
}

// Draw Sentry HUD frame with targeting crosshair
cv::Mat make_sentry_hud(int w, int h, double t, float target_dist, bool locked)
{
  cv::Mat img(h, w, CV_8UC3, cv::Scalar(12, 16, 24));

  // Dynamic grid background
  for (int x = 0; x < w; x += 32) {
    cv::line(img, {x, 0}, {x, h}, cv::Scalar(24, 30, 42), 1);
  }
  for (int y = 0; y < h; y += 24) {
    cv::line(img, {0, y}, {w, y}, cv::Scalar(24, 30, 42), 1);
  }

  // Crosshair center
  int cx = w / 2;
  int cy = h / 2;
  cv::Scalar aim_col = locked ? cv::Scalar(0, 240, 255) : cv::Scalar(40, 160, 220);
  cv::circle(img, {cx, cy}, 28, aim_col, 1, cv::LINE_AA);
  cv::circle(img, {cx, cy}, 4, aim_col, -1, cv::LINE_AA);
  cv::line(img, {cx - 38, cy}, {cx - 10, cy}, aim_col, 1);
  cv::line(img, {cx + 10, cy}, {cx + 38, cy}, aim_col, 1);
  cv::line(img, {cx, cy - 38}, {cx, cy - 10}, aim_col, 1);
  cv::line(img, {cx, cy + 10}, {cx, cy + 38}, aim_col, 1);

  // Moving target simulated box
  int tx = cx + static_cast<int>(60.0 * std::cos(t * 1.5));
  int ty = cy + static_cast<int>(30.0 * std::sin(t * 1.2));
  cv::Scalar box_col = locked ? cv::Scalar(16, 220, 100) : cv::Scalar(0, 165, 255);
  cv::rectangle(img, cv::Rect(tx - 25, ty - 18, 50, 36), box_col, 2);
  cv::putText(img, locked ? "LOCK" : "TRACK", {tx - 24, ty - 22},
              cv::FONT_HERSHEY_SIMPLEX, 0.4, box_col, 1, cv::LINE_AA);

  // HUD telemetry overlay text
  char buf[128];
  std::snprintf(buf, sizeof(buf), "DIST: %.2fm  BULLET: 28.4m/s", target_dist);
  cv::putText(img, buf, {10, h - 12}, cv::FONT_HERSHEY_SIMPLEX, 0.42,
              cv::Scalar(200, 220, 240), 1, cv::LINE_AA);

  cv::putText(img, "OMNISCOPE AUTO-AIM HUD", {10, 20}, cv::FONT_HERSHEY_SIMPLEX, 0.45,
              cv::Scalar(0, 240, 255), 1, cv::LINE_AA);
  return img;
}

// Draw Navigation Bird's-Eye View (BEV) simulated costmap
cv::Mat make_nav_bev(int w, int h, double t, float rx, float ry)
{
  cv::Mat img(h, w, CV_8UC3, cv::Scalar(18, 20, 28));

  // Concentric range circles
  int cx = w / 2;
  int cy = h / 2;
  for (int r = 30; r < w / 2; r += 35) {
    cv::circle(img, {cx, cy}, r, cv::Scalar(32, 40, 54), 1, cv::LINE_AA);
  }
  cv::line(img, {0, cy}, {w, cy}, cv::Scalar(35, 45, 60), 1);
  cv::line(img, {cx, 0}, {cx, h}, cv::Scalar(35, 45, 60), 1);

  // Simulated static obstacle blocks
  cv::rectangle(img, {cx + 40, cy - 60, 30, 30}, cv::Scalar(60, 80, 180), -1);
  cv::rectangle(img, {cx - 70, cy + 30, 40, 25}, cv::Scalar(60, 80, 180), -1);

  // Robot center marker
  int px = cx + static_cast<int>(rx * 15.0f);
  int py = cy - static_cast<int>(ry * 15.0f);
  cv::circle(img, {px, py}, 8, cv::Scalar(0, 240, 255), -1, cv::LINE_AA);

  // Heading ray
  int hx = px + static_cast<int>(20.0 * std::cos(t));
  int hy = py - static_cast<int>(20.0 * std::sin(t));
  cv::line(img, {px, py}, {hx, hy}, cv::Scalar(0, 255, 120), 2, cv::LINE_AA);

  // Planned path line
  std::vector<cv::Point> pts;
  for (int i = 0; i < 20; i++) {
    float s = i / 19.0f;
    pts.push_back({
      px + static_cast<int>(s * 80.0f * std::cos(t * 0.3)),
      py - static_cast<int>(s * 70.0f * std::sin(t * 0.3))
    });
  }
  cv::polylines(img, pts, false, cv::Scalar(240, 100, 200), 2, cv::LINE_AA);

  cv::putText(img, "BEV OCCUPANCY MAP", {10, 20}, cv::FONT_HERSHEY_SIMPLEX, 0.45,
              cv::Scalar(0, 240, 255), 1, cv::LINE_AA);
  return img;
}
}  // namespace

// Scenario 1: Sentry Auto-Aim & Ballistics
void run_sentry_scenario(int rate_hz, bool local)
{
  std::cout << "[OmniScope DataSource] Starting scenario: 'sentry' (Auto-Aim & 3D Ballistics)" << std::endl;

  omniscope::RemoteLogger::Config cfg;
  cfg.sender_name = "sentry_auto_aim";
  cfg.control_port = 15000;
  cfg.enable_local = local;
  cfg.img_width = 320;
  cfg.img_quality = 45;
  omniscope::RemoteLogger::instance().init(cfg);

  tools::Exiter exiter;
  auto t0 = std::chrono::steady_clock::now();
  uint64_t iter = 0;
  const auto loop_gap = std::chrono::microseconds(1000000 / rate_hz);

  while (!exiter.exit()) {
    auto t1 = std::chrono::steady_clock::now();
    double t = std::chrono::duration<double>(t1 - t0).count();

    // 1. High-frequency waveforms
    double target_dist = 2.4 + 0.8 * std::sin(t * 0.4);
    double target_yaw = 35.0 * std::sin(t * 0.8);
    double actual_yaw = target_yaw + 1.2 * std::sin(t * 4.0);
    double target_pitch = 12.0 + 8.0 * std::cos(t * 0.6);
    double actual_pitch = target_pitch + 0.8 * std::cos(t * 3.5);
    double err_yaw = actual_yaw - target_yaw;
    double bullet_speed = 28.2 + 0.4 * std::sin(t * 5.0);
    double motor_cur = 2.5 + 1.8 * std::abs(std::sin(t * 2.0));
    bool locked = std::abs(err_yaw) < 1.5;

    omniscope::RemoteLogger::instance().plot({
      {"yaw_target_deg", target_yaw},
      {"yaw_actual_deg", actual_yaw},
      {"pitch_target_deg", target_pitch},
      {"pitch_actual_deg", actual_pitch},
      {"tracking_error_deg", err_yaw},
      {"target_distance_m", target_dist},
      {"bullet_speed_mps", bullet_speed},
      {"motor_current_a", motor_cur},
      {"locked", locked ? 1.0 : 0.0},
    });

    // 2. 3D Markers (at ~10Hz)
    if (iter % (rate_hz / 10 + 1) == 0) {
      std::vector<omniscope::Marker> markers;

      // Chassis Base (CUBE)
      omniscope::Marker chassis;
      chassis.ns = "sentry";
      chassis.id = 1;
      chassis.type = omniscope::MarkerType::CUBE;
      chassis.pose.position = vec3(0, 0, 0.2f);
      chassis.scale = vec3(0.65f, 0.5f, 0.28f);
      chassis.color = rgba(0.06f, 0.73f, 0.51f, 0.8f);
      markers.push_back(chassis);

      // Gimbal Heading Arrow (ARROW)
      float ty = static_cast<float>(target_dist * std::sin(target_yaw * M_PI / 180.0));
      float tx = static_cast<float>(target_dist * std::cos(target_yaw * M_PI / 180.0));
      float tz = static_cast<float>(target_dist * std::sin(target_pitch * M_PI / 180.0));

      omniscope::Marker arrow;
      arrow.ns = "gimbal";
      arrow.id = 2;
      arrow.type = omniscope::MarkerType::ARROW;
      arrow.points = {vec3(0, 0, 0.35f), vec3(tx, ty, tz + 0.35f)};
      arrow.scale = vec3(0.06f, 0.12f, 0.16f);
      arrow.color = rgba(0.0f, 0.94f, 1.0f, 1.0f);
      markers.push_back(arrow);

      // Target Armor (CYLINDER)
      omniscope::Marker target_m;
      target_m.ns = "target";
      target_m.id = 3;
      target_m.type = omniscope::MarkerType::CYLINDER;
      target_m.pose.position = vec3(tx, ty, tz + 0.35f);
      target_m.scale = vec3(0.45f, 0.45f, 0.6f);
      target_m.color = locked ? rgba(0.96f, 0.62f, 0.04f, 0.85f) : rgba(0.9f, 0.2f, 0.2f, 0.75f);
      markers.push_back(target_m);

      // Target HUD Label (TEXT_VIEW_FACING)
      omniscope::Marker label;
      label.ns = "target";
      label.id = 4;
      label.type = omniscope::MarkerType::TEXT_VIEW_FACING;
      label.pose.position = vec3(tx, ty, tz + 0.85f);
      label.scale = vec3(0.35f, 0.35f, 0.35f);
      label.color = rgba(1.0f, 1.0f, 1.0f, 1.0f);
      char text_buf[64];
      std::snprintf(text_buf, sizeof(text_buf), "Armor #1 [%.2fm | %s]", target_dist, locked ? "LOCKED" : "SEEK");
      label.text = text_buf;
      markers.push_back(label);

      // Ballistic Parabolic Arc (LINE_STRIP)
      omniscope::Marker arc;
      arc.ns = "ballistics";
      arc.id = 5;
      arc.type = omniscope::MarkerType::LINE_STRIP;
      arc.scale = vec3(0.035f, 0.035f, 0.035f);
      arc.color = rgba(0.55f, 0.36f, 0.96f, 0.9f);
      for (int i = 0; i <= 24; i++) {
        float s = i / 24.0f;
        float px = s * tx;
        float py = s * ty;
        float pz = 0.35f + s * tz + 0.6f * std::sin(s * static_cast<float>(M_PI));
        arc.points.push_back(vec3(px, py, pz));
      }
      markers.push_back(arc);

      omniscope::RemoteLogger::instance().plot_markers(markers);
    }

    // 3. Vision Stream (at ~15fps)
    if (iter % (rate_hz / 15 + 1) == 0) {
      cv::Mat hud = make_sentry_hud(320, 240, t, static_cast<float>(target_dist), locked);
      omniscope::RemoteLogger::instance().plot_image(hud, {{"name", "sentry_hud"}});
    }

    // 4. Periodic Logs
    if (iter % (rate_hz * 3) == 0) {
      omniscope::RemoteLogger::instance().log(
        "INFO", "Target lock acquired, distance={:.2f}m, bullet_vel={:.1f}m/s", target_dist, bullet_speed);
    } else if (iter % (rate_hz * 7) == 0) {
      omniscope::RemoteLogger::instance().log(
        "WARN", "Gimbal yaw approaching boundary limit: {:.1f} deg", actual_yaw);
    }

    iter++;
    std::this_thread::sleep_until(t1 + loop_gap);
  }

  omniscope::RemoteLogger::instance().shutdown();
}

// Scenario 2: SLAM Navigation & Omni-directional Chassis
void run_navigation_scenario(int rate_hz, bool local)
{
  std::cout << "[OmniScope DataSource] Starting scenario: 'navigation' (SLAM & Path Planning)" << std::endl;

  omniscope::RemoteLogger::Config cfg;
  cfg.sender_name = "navigation_robot";
  cfg.control_port = 15000;
  cfg.enable_local = local;
  cfg.img_width = 320;
  cfg.img_quality = 45;
  omniscope::RemoteLogger::instance().init(cfg);

  tools::Exiter exiter;
  auto t0 = std::chrono::steady_clock::now();
  uint64_t iter = 0;
  const auto loop_gap = std::chrono::microseconds(1000000 / rate_hz);

  while (!exiter.exit()) {
    auto t1 = std::chrono::steady_clock::now();
    double t = std::chrono::duration<double>(t1 - t0).count();

    float rx = static_cast<float>(2.0 * std::sin(t * 0.3));
    float ry = static_cast<float>(1.5 * std::cos(t * 0.4));
    float vx = static_cast<float>(0.8 * std::cos(t * 0.3));
    float vy = static_cast<float>(-0.6 * std::sin(t * 0.4));
    float wz = static_cast<float>(0.5 * std::sin(t * 0.5));
    float power = static_cast<float>(35.0 + 20.0 * (std::abs(vx) + std::abs(vy)));

    // Waveform plot
    omniscope::RemoteLogger::instance().plot({
      {"pos_x_m", rx},
      {"pos_y_m", ry},
      {"vel_x_mps", vx},
      {"vel_y_mps", vy},
      {"omega_z_radps", wz},
      {"chassis_power_w", power},
      {"battery_voltage_v", 24.2 - 0.05 * std::sin(t * 0.1)},
      {"odom_error_mm", 4.2 + 1.5 * std::sin(t * 2.0)},
    });

    // 3D Navigation Markers
    if (iter % (rate_hz / 10 + 1) == 0) {
      std::vector<omniscope::Marker> markers;

      // Robot Base (CUBE)
      omniscope::Marker base;
      base.ns = "robot";
      base.id = 1;
      base.type = omniscope::MarkerType::CUBE;
      base.pose.position = vec3(rx, ry, 0.18f);
      base.scale = vec3(0.6f, 0.5f, 0.25f);
      base.color = rgba(0.23f, 0.51f, 0.96f, 0.85f);
      markers.push_back(base);

      // Velocity Vector (ARROW)
      omniscope::Marker vel_arrow;
      vel_arrow.ns = "velocity";
      vel_arrow.id = 2;
      vel_arrow.type = omniscope::MarkerType::ARROW;
      vel_arrow.points = {vec3(rx, ry, 0.3f), vec3(rx + vx, ry + vy, 0.3f)};
      vel_arrow.scale = vec3(0.06f, 0.12f, 0.14f);
      vel_arrow.color = rgba(0.0f, 0.94f, 1.0f, 1.0f);
      markers.push_back(vel_arrow);

      // Planned Global Path (LINE_STRIP)
      omniscope::Marker path;
      path.ns = "planning";
      path.id = 3;
      path.type = omniscope::MarkerType::LINE_STRIP;
      path.scale = vec3(0.04f, 0.04f, 0.04f);
      path.color = rgba(0.0f, 0.94f, 0.6f, 0.95f);
      for (int i = 0; i < 20; i++) {
        float s = i / 19.0f;
        float px = rx + s * 3.5f * static_cast<float>(std::cos(t * 0.2));
        float py = ry + s * 2.8f * static_cast<float>(std::sin(t * 0.25));
        path.points.push_back(vec3(px, py, 0.05f));
      }
      markers.push_back(path);

      // Obstacle Map (CUBE_LIST)
      omniscope::Marker obstacles;
      obstacles.ns = "obstacles";
      obstacles.id = 4;
      obstacles.type = omniscope::MarkerType::CUBE_LIST;
      obstacles.scale = vec3(0.4f, 0.4f, 0.6f);
      obstacles.color = rgba(0.96f, 0.62f, 0.04f, 0.8f);
      obstacles.points = {
        vec3(2.5f, 1.0f, 0.3f),
        vec3(-1.8f, 2.2f, 0.3f),
        vec3(0.5f, -2.0f, 0.3f),
        vec3(-2.2f, -1.5f, 0.3f),
      };
      markers.push_back(obstacles);

      // Simulated LiDAR Obstacle Boundary Points (POINTS)
      omniscope::Marker lidar;
      lidar.ns = "lidar";
      lidar.id = 5;
      lidar.type = omniscope::MarkerType::POINTS;
      lidar.scale = vec3(0.05f, 0.05f, 0.05f);
      lidar.color = rgba(0.93f, 0.28f, 0.6f, 0.9f);
      for (int i = 0; i < 36; i++) {
        float ang = i * 10.0f * static_cast<float>(M_PI / 180.0);
        float r = 2.0f + 0.3f * std::sin(ang * 4.0f + static_cast<float>(t));
        lidar.points.push_back(vec3(rx + r * std::cos(ang), ry + r * std::sin(ang), 0.15f));
      }
      markers.push_back(lidar);

      // Goal Waypoint (SPHERE) & Label
      omniscope::Marker goal;
      goal.ns = "mission";
      goal.id = 6;
      goal.type = omniscope::MarkerType::SPHERE;
      goal.pose.position = vec3(3.0f, 2.0f, 0.25f);
      goal.scale = vec3(0.35f, 0.35f, 0.35f);
      goal.color = rgba(0.06f, 0.73f, 0.51f, 1.0f);
      markers.push_back(goal);

      omniscope::Marker goal_text;
      goal_text.ns = "mission";
      goal_text.id = 7;
      goal_text.type = omniscope::MarkerType::TEXT_VIEW_FACING;
      goal_text.pose.position = vec3(3.0f, 2.0f, 0.65f);
      goal_text.scale = vec3(0.35f, 0.35f, 0.35f);
      goal_text.color = rgba(1.0f, 1.0f, 1.0f, 1.0f);
      goal_text.text = "Waypoint Goal (x=3.0, y=2.0)";
      markers.push_back(goal_text);

      omniscope::RemoteLogger::instance().plot_markers(markers);
    }

    // Vision BEV Costmap (~10fps)
    if (iter % (rate_hz / 10 + 1) == 0) {
      cv::Mat bev = make_nav_bev(320, 240, t, rx, ry);
      omniscope::RemoteLogger::instance().plot_image(bev, {{"name", "bev_costmap"}});
    }

    // Status Logs
    if (iter % (rate_hz * 4) == 0) {
      omniscope::RemoteLogger::instance().log(
        "INFO", "Navigating to waypoint (3.0, 2.0), current_pos=({:.2f}, {:.2f}), vel={:.2f}m/s",
        rx, ry, std::hypot(vx, vy));
    }

    iter++;
    std::this_thread::sleep_until(t1 + loop_gap);
  }

  omniscope::RemoteLogger::instance().shutdown();
}

// Scenario 3: Complete ROS 2 3D Markers Showcase (All 10 Types simultaneously)
void run_markers_showcase_scenario(int rate_hz, bool local)
{
  std::cout << "[OmniScope DataSource] Starting scenario: 'markers_all' (All 10 ROS 2 3D Marker Types)" << std::endl;

  omniscope::RemoteLogger::Config cfg;
  cfg.sender_name = "markers_showcase";
  cfg.control_port = 15000;
  cfg.enable_local = local;
  omniscope::RemoteLogger::instance().init(cfg);

  tools::Exiter exiter;
  auto t0 = std::chrono::steady_clock::now();
  uint64_t iter = 0;
  const auto loop_gap = std::chrono::microseconds(1000000 / rate_hz);

  while (!exiter.exit()) {
    auto t1 = std::chrono::steady_clock::now();
    double t = std::chrono::duration<double>(t1 - t0).count();

    // 1. Waveform channels
    omniscope::RemoteLogger::instance().plot({
      {"marker_count", 10.0},
      {"sin_orbit", std::sin(t)},
      {"cos_orbit", std::cos(t)},
      {"pulsing_scale", 1.0 + 0.3 * std::sin(t * 2.0)},
      {"phase_rad", std::fmod(t, 2.0 * M_PI)},
    });

    // 2. All 10 Supported 3D Marker Types
    if (iter % (rate_hz / 15 + 1) == 0) {
      std::vector<omniscope::Marker> markers;
      float rot_x = static_cast<float>(std::cos(t));
      float rot_y = static_cast<float>(std::sin(t));

      // Type 0: ARROW
      omniscope::Marker arrow;
      arrow.ns = "showcase";
      arrow.id = 0;
      arrow.type = omniscope::MarkerType::ARROW;
      arrow.points = {vec3(0, 0, 0.5f), vec3(rot_x * 1.5f, rot_y * 1.5f, 0.5f)};
      arrow.scale = vec3(0.08f, 0.16f, 0.2f);
      arrow.color = rgba(0.0f, 0.94f, 1.0f, 1.0f); // Cyan
      markers.push_back(arrow);

      // Type 1: CUBE
      omniscope::Marker cube;
      cube.ns = "showcase";
      cube.id = 1;
      cube.type = omniscope::MarkerType::CUBE;
      cube.pose.position = vec3(2.2f, 0.0f, 0.4f);
      float pulse = 0.5f + 0.15f * static_cast<float>(std::sin(t * 3.0));
      cube.scale = vec3(pulse, pulse, pulse);
      cube.color = rgba(0.06f, 0.73f, 0.51f, 0.85f); // Green
      markers.push_back(cube);

      // Type 2: SPHERE
      omniscope::Marker sphere;
      sphere.ns = "showcase";
      sphere.id = 2;
      sphere.type = omniscope::MarkerType::SPHERE;
      sphere.pose.position = vec3(0.0f, 2.2f, 0.5f + 0.3f * static_cast<float>(std::sin(t * 2.5)));
      sphere.scale = vec3(0.5f, 0.5f, 0.5f);
      sphere.color = rgba(0.96f, 0.62f, 0.04f, 0.9f); // Amber
      markers.push_back(sphere);

      // Type 3: CYLINDER
      omniscope::Marker cylinder;
      cylinder.ns = "showcase";
      cylinder.id = 3;
      cylinder.type = omniscope::MarkerType::CYLINDER;
      cylinder.pose.position = vec3(-2.2f, 0.0f, 0.5f);
      cylinder.scale = vec3(0.45f, 0.45f, 0.9f);
      cylinder.color = rgba(0.93f, 0.28f, 0.6f, 0.85f); // Pink
      markers.push_back(cylinder);

      // Type 4: LINE_STRIP (Ribbon Curve)
      omniscope::Marker strip;
      strip.ns = "showcase";
      strip.id = 4;
      strip.type = omniscope::MarkerType::LINE_STRIP;
      strip.scale = vec3(0.04f, 0.04f, 0.04f);
      strip.color = rgba(0.55f, 0.36f, 0.96f, 1.0f); // Violet
      for (int i = 0; i <= 30; i++) {
        float p = i / 30.0f * 4.0f - 2.0f;
        strip.points.push_back(vec3(p, -2.2f, 0.4f + 0.3f * std::sin(p * 3.0f + static_cast<float>(t * 2.0))));
      }
      markers.push_back(strip);

      // Type 5: LINE_LIST (Starburst Rays)
      omniscope::Marker rays;
      rays.ns = "showcase";
      rays.id = 5;
      rays.type = omniscope::MarkerType::LINE_LIST;
      rays.scale = vec3(0.03f, 0.03f, 0.03f);
      rays.color = rgba(1.0f, 0.85f, 0.1f, 0.8f); // Yellow
      for (int i = 0; i < 6; i++) {
        float a = i * (static_cast<float>(M_PI) / 3.0f) + static_cast<float>(t * 0.5);
        rays.points.push_back(vec3(0, 0, 1.2f));
        rays.points.push_back(vec3(0.8f * std::cos(a), 0.8f * std::sin(a), 1.6f));
      }
      markers.push_back(rays);

      // Type 6: CUBE_LIST (3D Voxel Array)
      omniscope::Marker cubes;
      cubes.ns = "showcase";
      cubes.id = 6;
      cubes.type = omniscope::MarkerType::CUBE_LIST;
      cubes.scale = vec3(0.18f, 0.18f, 0.18f);
      cubes.color = rgba(0.1f, 0.7f, 1.0f, 0.9f);
      for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
          cubes.points.push_back(vec3(2.2f + x * 0.28f, 2.2f + y * 0.28f, 0.3f));
        }
      }
      markers.push_back(cubes);

      // Type 7: SPHERE_LIST (Orbiting Satellite Ring)
      omniscope::Marker spheres;
      spheres.ns = "showcase";
      spheres.id = 7;
      spheres.type = omniscope::MarkerType::SPHERE_LIST;
      spheres.scale = vec3(0.14f, 0.14f, 0.14f);
      spheres.color = rgba(0.2f, 0.9f, 0.4f, 0.95f);
      for (int i = 0; i < 8; i++) {
        float a = i * (static_cast<float>(M_PI) / 4.0f) + static_cast<float>(t * 1.2);
        spheres.points.push_back(vec3(-2.2f + 0.6f * std::cos(a), 2.2f + 0.6f * std::sin(a), 0.4f));
      }
      markers.push_back(spheres);

      // Type 8: POINTS (3D Particle Spiral)
      omniscope::Marker points;
      points.ns = "showcase";
      points.id = 8;
      points.type = omniscope::MarkerType::POINTS;
      points.scale = vec3(0.06f, 0.06f, 0.06f);
      points.color = rgba(1.0f, 0.3f, 0.3f, 0.95f);
      for (int i = 0; i < 35; i++) {
        float u = i / 35.0f * 6.0f;
        points.points.push_back(vec3(-2.2f + 0.4f * std::cos(u + static_cast<float>(t)),
                                    -2.2f + 0.4f * std::sin(u + static_cast<float>(t)),
                                    0.1f + u * 0.15f));
      }
      markers.push_back(points);

      // Type 9: TEXT_VIEW_FACING
      omniscope::Marker tag;
      tag.ns = "showcase";
      tag.id = 9;
      tag.type = omniscope::MarkerType::TEXT_VIEW_FACING;
      tag.pose.position = vec3(0, 0, 1.85f);
      tag.scale = vec3(0.35f, 0.35f, 0.35f);
      tag.color = rgba(1.0f, 1.0f, 1.0f, 1.0f);
      char tbuf[64];
      std::snprintf(tbuf, sizeof(tbuf), "All 10 3D Markers Active (t=%.1fs)", t);
      tag.text = tbuf;
      markers.push_back(tag);

      // Type 11: TRIANGLE_LIST (Pyramid polygon mesh)
      omniscope::Marker mesh;
      mesh.ns = "showcase";
      mesh.id = 11;
      mesh.type = omniscope::MarkerType::TRIANGLE_LIST;
      mesh.scale = vec3(1.0f, 1.0f, 1.0f);
      mesh.color = rgba(0.85f, 0.45f, 0.95f, 0.75f);
      // Base center at (2.2, -2.2)
      float mx = 2.2f, my = -2.2f;
      omniscope::Vector3 p0 = vec3(mx - 0.4f, my - 0.4f, 0.1f);
      omniscope::Vector3 p1 = vec3(mx + 0.4f, my - 0.4f, 0.1f);
      omniscope::Vector3 p2 = vec3(mx + 0.4f, my + 0.4f, 0.1f);
      omniscope::Vector3 p3 = vec3(mx - 0.4f, my + 0.4f, 0.1f);
      omniscope::Vector3 top = vec3(mx, my, 0.8f);
      // 4 triangular sides
      mesh.points = {
        p0, p1, top,
        p1, p2, top,
        p2, p3, top,
        p3, p0, top,
      };
      markers.push_back(mesh);

      omniscope::RemoteLogger::instance().plot_markers(markers);
    }

    if (iter % (rate_hz * 5) == 0) {
      omniscope::RemoteLogger::instance().log(
        "INFO", "3D Marker Showcase: broadcasting 10 ROS 2 marker types (iter={})", iter);
    }

    iter++;
    std::this_thread::sleep_until(t1 + loop_gap);
  }

  omniscope::RemoteLogger::instance().shutdown();
}

// Scenario 5: High-Frequency Telemetry & Marker Stress Benchmark
void run_stress_scenario(int rate_hz, bool local)
{
  std::cout << "[OmniScope DataSource] Starting scenario: 'stress' (" << rate_hz << "Hz Benchmark)" << std::endl;

  omniscope::RemoteLogger::Config cfg;
  cfg.sender_name = "stress_benchmark";
  cfg.control_port = 15000;
  cfg.enable_local = local;
  omniscope::RemoteLogger::instance().init(cfg);

  tools::Exiter exiter;
  auto t0 = std::chrono::steady_clock::now();
  uint64_t iter = 0;
  const auto loop_gap = std::chrono::microseconds(1000000 / rate_hz);

  while (!exiter.exit()) {
    auto t1 = std::chrono::steady_clock::now();
    double t = std::chrono::duration<double>(t1 - t0).count();

    omniscope::RemoteLogger::instance().plot({
      {"ch0_sine_1hz", std::sin(t * 2.0 * M_PI * 1.0)},
      {"ch1_sine_5hz", std::sin(t * 2.0 * M_PI * 5.0)},
      {"ch2_sine_10hz", std::sin(t * 2.0 * M_PI * 10.0)},
      {"ch3_sawtooth", 2.0 * std::fmod(t, 1.0) - 1.0},
      {"ch4_square", (std::sin(t * 4.0) > 0) ? 1.0 : -1.0},
      {"ch5_iter", static_cast<double>(iter)},
      {"ch6_elapsed_s", t},
      {"ch7_throughput_hz", static_cast<double>(rate_hz)},
    });

    if (iter % (rate_hz / 10 + 1) == 0) {
      omniscope::Marker m;
      m.ns = "stress";
      m.id = 1;
      m.type = omniscope::MarkerType::SPHERE;
      m.pose.position = vec3(static_cast<float>(std::cos(t * 3.0)), static_cast<float>(std::sin(t * 3.0)), 0.5f);
      m.scale = vec3(0.4f, 0.4f, 0.4f);
      m.color = rgba(0.0f, 0.94f, 1.0f, 1.0f);
      omniscope::RemoteLogger::instance().plot_marker(m);
    }

    if (iter % (rate_hz * 2) == 0) {
      omniscope::RemoteLogger::instance().log(
        "INFO", "Stress benchmark: {} packets transmitted, elapsed={:.1f}s", iter, t);
    }

    iter++;
    std::this_thread::sleep_until(t1 + loop_gap);
  }

  omniscope::RemoteLogger::instance().shutdown();
}

int main(int argc, char * argv[])
{
  std::string scenario = "sentry";
  int rate = 50;
  bool local = true;

  for (int i = 1; i < argc; i++) {
    std::string arg = argv[i];
    if (arg == "--help" || arg == "-h") {
      std::printf("OmniScope Test Data Sources Generator\n\n");
      std::printf("Usage: %s [options]\n", argv[0]);
      std::printf("Options:\n");
      std::printf("  --scenario=TYPE   Test scenario to run (default: sentry)\n");
      std::printf("                    sentry       : Auto-aim robot, 3D armor, ballistics, HUD\n");
      std::printf("                    navigation   : SLAM navigation, 3D obstacles, paths, BEV\n");
      std::printf("                    markers_all  : Exhibition of all 10 ROS 2 3D Marker types\n");
      std::printf("                    stress       : High-frequency stress benchmark\n");
      std::printf("  --rate=HZ         Emission rate in Hz (default: 50)\n");
      std::printf("  --no-local        Disable local .rlog file writing\n");
      return 0;
    }
    auto eq = arg.find('=');
    std::string k = (eq != std::string::npos) ? arg.substr(0, eq) : arg;
    std::string v = (eq != std::string::npos) ? arg.substr(eq + 1) : (i + 1 < argc ? argv[++i] : "");
    if (k == "--scenario" || k == "--type") scenario = v;
    else if (k == "--rate") rate = std::stoi(v);
    else if (k == "--no-local") local = false;
  }

  if (scenario == "sentry") {
    run_sentry_scenario(rate, local);
  } else if (scenario == "navigation" || scenario == "nav") {
    run_navigation_scenario(rate, local);
  } else if (scenario == "markers_all" || scenario == "markers" || scenario == "3d") {
    run_markers_showcase_scenario(rate, local);
  } else if (scenario == "stress") {
    run_stress_scenario(rate, local);
  } else {
    std::fprintf(stderr, "Unknown scenario: %s\nRun with --help for available scenarios.\n", scenario.c_str());
    return 1;
  }

  return 0;
}
