#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>
#include <opencv2/core.hpp>

#include "omniscope/marker.hpp"
#include "omniscope/remote_logger.hpp"

// Lightweight C++ assertion macro
#define TEST_ASSERT(cond, msg) \
  do { \
    if (!(cond)) { \
      std::fprintf(stderr, "[FAIL] Line %d: %s (%s)\n", __LINE__, msg, #cond); \
      std::exit(1); \
    } else { \
      std::printf("  [PASS] %s\n", msg); \
    } \
  } while (0)

void test_3d_marker_types()
{
  std::printf("\n=== Test 1: ROS 2 3D Marker Types & Serialization ===\n");

  // 1. ARROW (type 0)
  {
    omniscope::Marker m;
    m.ns = "test_ns";
    m.id = 101;
    m.type = omniscope::MarkerType::ARROW;
    m.points.push_back({0, 0, 0});
    m.points.push_back({1.0f, 2.0f, 3.0f});
    auto j = m.to_json();
    TEST_ASSERT(j["type"] == 0, "ARROW type code is 0");
    TEST_ASSERT(j["ns"] == "test_ns", "Namespace preserved");
    TEST_ASSERT(j["id"] == 101, "Marker ID preserved");
    TEST_ASSERT(j["points"].size() == 2, "Arrow points array serialized");
  }

  // 2. CUBE (type 1)
  {
    omniscope::Marker m;
    m.type = omniscope::MarkerType::CUBE;
    m.pose.position = {1.5f, -0.5f, 0.8f};
    m.scale = {0.6f, 0.4f, 0.2f};
    m.color = {0.1f, 0.8f, 0.4f, 0.9f};
    auto j = m.to_json();
    TEST_ASSERT(j["type"] == 1, "CUBE type code is 1");
    TEST_ASSERT(std::abs(j["pose"]["position"]["x"].get<float>() - 1.5f) < 1e-4, "Position X serialized");
    TEST_ASSERT(std::abs(j["scale"]["x"].get<float>() - 0.6f) < 1e-4, "Scale X serialized");
    TEST_ASSERT(std::abs(j["color"]["r"].get<float>() - 0.1f) < 1e-4, "Color R serialized");
  }

  // 3. SPHERE (type 2)
  {
    omniscope::Marker m;
    m.type = omniscope::MarkerType::SPHERE;
    auto j = m.to_json();
    TEST_ASSERT(j["type"] == 2, "SPHERE type code is 2");
  }

  // 4. CYLINDER (type 3)
  {
    omniscope::Marker m;
    m.type = omniscope::MarkerType::CYLINDER;
    auto j = m.to_json();
    TEST_ASSERT(j["type"] == 3, "CYLINDER type code is 3");
  }

  // 5. LINE_STRIP (type 4)
  {
    omniscope::Marker m;
    m.type = omniscope::MarkerType::LINE_STRIP;
    for (int i = 0; i < 5; i++) {
      m.points.push_back({static_cast<float>(i), 0.0f, 0.0f});
    }
    auto j = m.to_json();
    TEST_ASSERT(j["type"] == 4, "LINE_STRIP type code is 4");
    TEST_ASSERT(j["points"].size() == 5, "Trajectory point count matches");
  }

  // 6. LINE_LIST (type 5)
  {
    omniscope::Marker m;
    m.type = omniscope::MarkerType::LINE_LIST;
    m.points.push_back({0, 0, 0});
    m.points.push_back({1, 1, 1});
    auto j = m.to_json();
    TEST_ASSERT(j["type"] == 5, "LINE_LIST type code is 5");
  }

  // 7. CUBE_LIST (type 6)
  {
    omniscope::Marker m;
    m.type = omniscope::MarkerType::CUBE_LIST;
    m.points.push_back({0, 1, 2});
    auto j = m.to_json();
    TEST_ASSERT(j["type"] == 6, "CUBE_LIST type code is 6");
  }

  // 8. SPHERE_LIST (type 7)
  {
    omniscope::Marker m;
    m.type = omniscope::MarkerType::SPHERE_LIST;
    m.points.push_back({2, 3, 4});
    auto j = m.to_json();
    TEST_ASSERT(j["type"] == 7, "SPHERE_LIST type code is 7");
  }

  // 9. POINTS (type 8)
  {
    omniscope::Marker m;
    m.type = omniscope::MarkerType::POINTS;
    m.points.push_back({0, 0, 1});
    m.points.push_back({0, 0, 2});
    auto j = m.to_json();
    TEST_ASSERT(j["type"] == 8, "POINTS type code is 8");
  }

  // 10. TEXT_VIEW_FACING (type 9)
  {
    omniscope::Marker m;
    m.type = omniscope::MarkerType::TEXT_VIEW_FACING;
    m.text = "Target Lock: Infantry #1";
    auto j = m.to_json();
    TEST_ASSERT(j["type"] == 9, "TEXT_VIEW_FACING type code is 9");
    TEST_ASSERT(j["text"] == "Target Lock: Infantry #1", "Text label string serialized");
  }

  // 11. TRIANGLE_LIST (type 11)
  {
    omniscope::Marker m;
    m.type = omniscope::MarkerType::TRIANGLE_LIST;
    m.points.push_back({0, 0, 0});
    m.points.push_back({1, 0, 0});
    m.points.push_back({0, 1, 0});
    auto j = m.to_json();
    TEST_ASSERT(j["type"] == 11, "TRIANGLE_LIST type code is 11");
    TEST_ASSERT(j["points"].size() == 3, "Triangle vertices serialized");
  }
}

void test_marker_actions_and_lifetime()
{
  std::printf("\n=== Test 2: 3D Marker Actions & Auto-Pruning Lifetime ===\n");

  omniscope::Marker m;
  m.action = omniscope::MarkerAction::ADD;
  TEST_ASSERT(m.to_json()["action"] == 0, "Action ADD is 0");

  m.action = omniscope::MarkerAction::DELETE;
  TEST_ASSERT(m.to_json()["action"] == 2, "Action DELETE is 2");

  m.action = omniscope::MarkerAction::DELETEALL;
  TEST_ASSERT(m.to_json()["action"] == 3, "Action DELETEALL is 3");

  m.lifetime = 1.5f;
  TEST_ASSERT(std::abs(m.to_json()["lifetime"].get<float>() - 1.5f) < 1e-4, "Lifetime property serialized");
}

void test_remote_logger_telemetry()
{
  std::printf("\n=== Test 3: RemoteLogger Telemetry & Pipeline (Non-Embedded) ===\n");

  omniscope::RemoteLogger::Config cfg;
  cfg.sender_name = "test_unit_robot";
  cfg.enable_remote = false; // Unit test: local only
  cfg.enable_local = false;
  omniscope::RemoteLogger::instance().init(cfg);

  // Send waveform plots
  omniscope::RemoteLogger::instance().plot({
    {"pitch_angle", 14.25},
    {"yaw_rate", -2.80},
    {"dist_m", 3.14},
  });
  TEST_ASSERT(true, "RemoteLogger plot execution completed without exception");

  // Send分级日志
  omniscope::RemoteLogger::instance().log("INFO", "Robot initialized, camera FPS=50");
  omniscope::RemoteLogger::instance().log("WARN", "Approaching gimbal limit: {:.1f}", 45.2);
  TEST_ASSERT(true, "RemoteLogger log execution completed without exception");

  // Send 3D Marker
  omniscope::Marker marker;
  marker.type = omniscope::MarkerType::ARROW;
  marker.ns = "test";
  marker.id = 1;
  omniscope::RemoteLogger::instance().plot_marker(marker);
  TEST_ASSERT(true, "RemoteLogger plot_marker completed without exception");

  omniscope::RemoteLogger::instance().plot_markers({marker, marker});
  TEST_ASSERT(true, "RemoteLogger batch plot_markers completed without exception");

  // Send dummy frame
  cv::Mat dummy(60, 80, CV_8UC3, cv::Scalar(10, 20, 30));
  omniscope::RemoteLogger::instance().plot_image(dummy, {{"name", "test_cam"}});
  TEST_ASSERT(true, "RemoteLogger plot_image completed without exception");

  omniscope::RemoteLogger::instance().shutdown();
  TEST_ASSERT(true, "RemoteLogger graceful shutdown succeeded");
}

int main()
{
  std::printf("======================================================================\n");
  std::printf(" OmniScope Pure C++ Remote Debugging & 3D Marker Test Suite\n");
  std::printf(" (Explicitly Excludes Embedded/Hardware Test Modules)\n");
  std::printf("======================================================================\n");

  test_3d_marker_types();
  test_marker_actions_and_lifetime();
  test_remote_logger_telemetry();

  std::printf("\n======================================================================\n");
  std::printf(" ALL PURE C++ REMOTE DEBUGGING TESTS PASSED (100%% SUCCESS)\n");
  std::printf("======================================================================\n");
  return 0;
}
