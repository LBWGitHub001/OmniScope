#include <atomic>
#include <chrono>
#include <csignal>
#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <vector>
#include <opencv2/opencv.hpp>
#include <nlohmann/json.hpp>
#include <fmt/format.h>

#include "omniscope/calibration/calibrator.hpp"
#include "omniscope/calibration/test_feed.hpp"
#include "omniscope/remote_logger.hpp"

using namespace std::chrono_literals;

namespace
{
static std::atomic<bool> g_exit{false};
static void sig_handler(int) { g_exit = true; }
constexpr auto kAutoAddGap = std::chrono::milliseconds(250);
constexpr auto kUiGap = std::chrono::milliseconds(66);  // ~15fps
constexpr int kPreviewW = 480;

cv::Mat make_preview(
  const cv::Mat & img, const std::vector<cv::Point2f> & live_corners, bool found,
  const calibration::Calibrator & calib, bool undistort, bool flash)
{
  if (img.empty()) return {};
  const double scale = (img.cols > kPreviewW) ? static_cast<double>(kPreviewW) / img.cols : 1.0;
  cv::Mat small;
  if (scale != 1.0)
    cv::resize(img, small, {}, scale, scale, cv::INTER_AREA);
  else
    small = img.clone();

  const auto pattern = calib.pattern_size();
  for (const auto & s : calib.sample_views()) {
    cv::circle(
      small,
      {static_cast<int>(s.params.x * small.cols), static_cast<int>(s.params.y * small.rows)}, 3,
      {40, 160, 220}, -1, cv::LINE_AA);
  }

  if (found && !live_corners.empty()) {
    std::vector<cv::Point2f> scaled = live_corners;
    if (scale != 1.0) {
      for (auto & c : scaled) {
        c.x = static_cast<float>(c.x * scale);
        c.y = static_cast<float>(c.y * scale);
      }
    }
    cv::drawChessboardCorners(small, pattern, scaled, true);
  }

  if (undistort && calib.has_camera()) {
    cv::Mat K = calib.camera().camera_matrix.clone();
    K.at<double>(0, 0) *= scale;
    K.at<double>(1, 1) *= scale;
    K.at<double>(0, 2) *= scale;
    K.at<double>(1, 2) *= scale;
    cv::Mat und;
    cv::undistort(small, und, K, calib.camera().distort_coeffs);
    small = und;
  }

  if (flash) cv::rectangle(small, cv::Rect(0, 0, small.cols, small.rows), {0, 220, 0}, 4);
  return small;
}

nlohmann::json status_json(
  const calibration::Progress & prog, const calibration::Calibrator & calib, bool board,
  bool undistort, const std::string & hint, double exposure_us)
{
  nlohmann::json j;
  j["calib"] = true;
  j["board"] = board ? 1 : 0;
  j["n"] = prog.n;
  j["min_n"] = calibration::Calibrator::kMinSamples;
  j["x"] = prog.x;
  j["y"] = prog.y;
  j["size"] = prog.size;
  j["skew"] = prog.skew;
  j["goodenough"] = prog.goodenough ? 1 : 0;
  j["hint"] = hint;
  j["undistort"] = undistort ? 1 : 0;
  j["has_cam"] = calib.has_camera() ? 1 : 0;
  j["reproj"] = calib.has_camera() ? calib.camera().reproj_error : -1.0;
  j["exposure_us"] = exposure_us;
  if (!calib.calibrated_at().empty()) j["calibrated_at"] = calib.calibrated_at();
  nlohmann::json samples = nlohmann::json::array();
  for (const auto & s : calib.sample_views()) {
    samples.push_back(
      {{"x", s.params.x},
       {"y", s.params.y},
       {"size", s.params.size},
       {"skew", s.params.skew}});
  }
  j["samples"] = samples;
  return j;
}

nlohmann::json result_json(const calibration::Calibrator & calib, bool saved, const std::string & hint)
{
  nlohmann::json j;
  j["calib"] = true;
  j["calib_done"] = 1;
  j["saved"] = saved ? 1 : 0;
  j["hint"] = hint;
  j["has_cam"] = 1;
  j["n"] = calib.size();
  j["min_n"] = calibration::Calibrator::kMinSamples;
  j["reproj"] = calib.camera().reproj_error;
  j["calibrated_at"] = calib.calibrated_at();
  j["result_path"] = calib.result_path();
  j["camera_matrix"] = std::vector<double>(
    calib.camera().camera_matrix.begin<double>(), calib.camera().camera_matrix.end<double>());
  j["distort_coeffs"] = std::vector<double>(
    calib.camera().distort_coeffs.begin<double>(), calib.camera().distort_coeffs.end<double>());
  return j;
}
}  // namespace

int main(int argc, char * argv[])
{
  bool use_test_feed = false;
  int cam_idx = 0;
  std::string sender_name = "omniscope_calib";

  for (int i = 1; i < argc; i++) {
    std::string arg = argv[i];
    if (arg == "--test") use_test_feed = true;
    else if (arg.rfind("--cam=", 0) == 0) cam_idx = std::stoi(arg.substr(6));
    else if (arg.rfind("--name=", 0) == 0) sender_name = arg.substr(7);
  }

  omniscope::RemoteLogger::Config cfg;
  cfg.sender_name = sender_name;
  cfg.app = "calibrate";
  cfg.img_width = kPreviewW;
  omniscope::RemoteLogger::instance().init(cfg);

  calibration::Calibrator calib;
  std::unique_ptr<calibration::TestFeed> test_feed;
  std::unique_ptr<cv::VideoCapture> cap;

  if (use_test_feed) {
    std::cout << "[OmniScope Calibrate] Running with synthetic TestFeed" << std::endl;
    test_feed = std::make_unique<calibration::TestFeed>();
  } else {
    cap = std::make_unique<cv::VideoCapture>(cam_idx);
    if (!cap->isOpened()) {
      std::cerr << "[OmniScope Calibrate] Cannot open camera " << cam_idx << ", falling back to TestFeed" << std::endl;
      test_feed = std::make_unique<calibration::TestFeed>();
    }
  }

  std::signal(SIGINT, sig_handler);
  std::signal(SIGTERM, sig_handler);
  cv::Mat raw;
  std::vector<cv::Point2f> corners;
  calibration::SampleParams params;
  bool undistort = false;
  bool want_add = false;
  bool quit_cmd = false;
  bool finished = false;
  std::string hint = use_test_feed ? "Test feed active" : "Wave chessboard in front of camera";
  double exposure_us = 6500.0;
  auto last_auto_add = std::chrono::steady_clock::now();
  auto flash_until = std::chrono::steady_clock::now();
  auto last_ui = std::chrono::steady_clock::now();

  std::cout << "[OmniScope Calibrate] Calibration service started (app=calibrate)" << std::endl;

  auto do_calibrate = [&](const std::string & host_time) {
    if (finished) return;
    const auto prog = calib.progress();
    if (prog.n < calibration::Calibrator::kMinSamples) {
      hint = fmt::format("Need >= {} samples", calibration::Calibrator::kMinSamples);
      return;
    }
    hint = "Calibrating...";
    omniscope::RemoteLogger::instance().plot(
      status_json(prog, calib, false, false, hint, exposure_us));
    if (!calib.calibrate_camera()) {
      hint = "Camera calib failed: not enough coverage";
      omniscope::RemoteLogger::instance().log("ERROR", "{}", hint);
      omniscope::RemoteLogger::instance().plot(
        status_json(prog, calib, false, false, hint, exposure_us));
      return;
    }
    if (!host_time.empty()) calib.set_calibrated_at(host_time);

    const bool saved = calib.save_yaml();
    if (saved) {
      hint = fmt::format("Saved {} ({})", calib.result_path(), calib.calibrated_at());
      omniscope::RemoteLogger::instance().log("INFO", "{}", hint);
    } else {
      hint = fmt::format("Calib ok ({:.4f}px) but save failed: {}", calib.camera().reproj_error, calib.result_path());
      omniscope::RemoteLogger::instance().log("ERROR", "{}", hint);
    }

    finished = true;
    undistort = true;
    auto payload = result_json(calib, saved, hint);
    for (int i = 0; i < 5; i++) {
      omniscope::RemoteLogger::instance().plot(payload);
      std::this_thread::sleep_for(20ms);
    }
  };

  auto apply_remote = [&](const nlohmann::json & msg) {
    const auto cmd = msg.value("cmd", "");
    if (cmd.empty()) return;
    if (cmd == "add") {
      want_add = true;
    } else if (cmd == "calibrate") {
      do_calibrate(msg.value("host_time", ""));
    } else if (cmd == "drop") {
      if (!finished) {
        calib.drop_last();
        hint = "Dropped last sample";
      }
    } else if (cmd == "reset") {
      if (!finished) {
        calib.reset();
        undistort = false;
        hint = "Reset all samples";
      }
    } else if (cmd == "save") {
      calib.save_yaml();
      hint = fmt::format("Saved result to {}", calib.result_path());
    } else if (cmd == "set_exposure") {
      if (msg.contains("exposure_us")) exposure_us = msg["exposure_us"].get<double>();
      hint = "Exposure updated";
    } else if (cmd == "quit" || cmd == "done") {
      quit_cmd = true;
      hint = "Host closed session";
    }
  };

  while (!g_exit && !quit_cmd) {
    // Consume commands from OmniScope Web UI
    nlohmann::json remote;
    while (omniscope::RemoteLogger::instance().poll_json(remote)) {
      apply_remote(remote);
    }
    std::string legacy_cmd;
    while (omniscope::RemoteLogger::instance().poll_calib_cmd(legacy_cmd)) {
      apply_remote({{"cmd", legacy_cmd}});
    }

    if (finished) {
      std::this_thread::sleep_for(20ms);
      continue;
    }

    if (test_feed) {
      raw = test_feed->next_frame();
    } else if (cap) {
      cap->read(raw);
    }
    if (raw.empty()) {
      std::this_thread::sleep_for(10ms);
      continue;
    }

    bool board = calib.detect(raw, corners, params, false);

    // Auto-sample or manual sample
    const auto now = std::chrono::steady_clock::now();
    const bool cooled = (now - last_auto_add) >= kAutoAddGap;
    if (board && cooled && (want_add || calib.is_good_sample(params))) {
      auto refined = corners;
      calib.refine_corners(raw, refined);
      const auto refined_params = calib.sample_params(refined, raw.size());
      if (calib.add_sample(refined, refined_params, raw.size(), nullptr)) {
        last_auto_add = now;
        flash_until = now + std::chrono::milliseconds(180);
        hint = fmt::format("Added sample #{}", calib.size());
        omniscope::RemoteLogger::instance().log("INFO", "Sample {} added", calib.size());
      } else if (want_add) {
        hint = "Sample too similar, move chessboard";
      }
    }
    want_add = false;

    // Stream status & HUD preview to Web UI
    if (now - last_ui >= kUiGap) {
      last_ui = now;
      const auto prog = calib.progress();
      const bool flash = now < flash_until;
      omniscope::RemoteLogger::instance().plot(status_json(prog, calib, board, undistort, hint, exposure_us));
      cv::Mat preview = make_preview(raw, corners, board, calib, undistort, flash);
      if (!preview.empty()) {
        omniscope::RemoteLogger::instance().plot_image(preview, {{"name", "calibrate"}});
      }
    }

    std::this_thread::sleep_for(5ms);
  }

  omniscope::RemoteLogger::instance().shutdown();
  return 0;
}
