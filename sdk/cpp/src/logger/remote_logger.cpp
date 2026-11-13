#include "omniscope/remote_logger.hpp"
#include "internal/engine.hpp"
#if __has_include(<yaml-cpp/yaml.h>)
#include <yaml-cpp/yaml.h>
#endif

namespace omniscope
{

struct RemoteLogger::Impl : logger::Engine
{
};

RemoteLogger::RemoteLogger() : impl_(std::make_unique<Impl>()) {}

RemoteLogger::~RemoteLogger() { shutdown(); }

RemoteLogger & RemoteLogger::instance()
{
  static RemoteLogger inst;
  return inst;
}

void RemoteLogger::init(const Config & cfg) { impl_->init(cfg); }

void RemoteLogger::init(const std::string & config_path)
{
#if __has_include(<yaml-cpp/yaml.h>)
  YAML::Node yaml = YAML::LoadFile(config_path);
  auto node = yaml["remote_logger"];
  if (!node) {
    log("ERROR", "[YAML] remote_logger not found!");
    exit(1);
  }

  Config cfg;
  if (node["control_port"]) cfg.control_port = node["control_port"].as<uint16_t>();
  if (node["enable_remote"]) cfg.enable_remote = node["enable_remote"].as<bool>();
  if (node["enable_local"]) cfg.enable_local = node["enable_local"].as<bool>();
  if (node["log_dir"]) cfg.log_dir = node["log_dir"].as<std::string>();
  if (node["var_buffer_size"]) cfg.var_buffer_size = node["var_buffer_size"].as<size_t>();
  if (node["img_buffer_size"]) cfg.img_buffer_size = node["img_buffer_size"].as<size_t>();
  if (node["img_width"]) cfg.img_width = node["img_width"].as<int>();
  if (node["img_quality"]) cfg.img_quality = node["img_quality"].as<int>();
  if (node["heartbeat_interval_ms"]) cfg.heartbeat_interval_ms = node["heartbeat_interval_ms"].as<uint32_t>();
  if (node["sender_name"]) cfg.sender_name = node["sender_name"].as<std::string>();
  if (node["app"]) cfg.app = node["app"].as<std::string>();
  if (node["beacon_interval_ms"])
    cfg.beacon_interval_ms = node["beacon_interval_ms"].as<uint32_t>();
  if (node["head_timeout_ms"])
    cfg.head_timeout_ms = node["head_timeout_ms"].as<uint32_t>();
  if (node["beacon_port"])
    cfg.beacon_port = node["beacon_port"].as<uint16_t>();

  init(cfg);
#else
  (void)config_path;
  log("ERROR", "[YAML] yaml-cpp not available to load config_path");
#endif
}

void RemoteLogger::plot(const nlohmann::json & data) { impl_->plot(data); }

void RemoteLogger::log(const std::string & level, const std::string & msg)
{
  impl_->log(level, msg);
}

void RemoteLogger::plot_image(const cv::Mat & img, const nlohmann::json & meta)
{
  impl_->plot_image(img, meta);
}

void RemoteLogger::plot_marker(const Marker & marker)
{
  nlohmann::json j;
  j["marker"] = marker.to_json();
  plot(j);
}

void RemoteLogger::plot_markers(const std::vector<Marker> & markers)
{
  nlohmann::json arr = nlohmann::json::array();
  for (const auto & m : markers) {
    arr.push_back(m.to_json());
  }
  nlohmann::json j;
  j["markers"] = arr;
  plot(j);
}

bool RemoteLogger::poll_calib_cmd(std::string & cmd) { return impl_->poll_calib_cmd(cmd); }

bool RemoteLogger::poll_json(nlohmann::json & data) { return impl_->poll_json(data); }

void RemoteLogger::shutdown() { impl_->shutdown(); }

}  // namespace omniscope
