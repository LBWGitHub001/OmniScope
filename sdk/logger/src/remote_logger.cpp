#include "omniscope/remote_logger.hpp"
#include "internal/engine.hpp"
#include "omniscope/common/yaml.hpp"

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
  auto yaml = common::load(config_path);
  auto node = yaml["remote_logger"];
  if (!node) {
    log("ERROR", "[YAML] remote_logger not found!");
    exit(1);
  }

  Config cfg;
  cfg.control_port = common::read<uint16_t>(node, "control_port");
  cfg.enable_remote = common::read<bool>(node, "enable_remote");
  cfg.enable_local = common::read<bool>(node, "enable_local");
  cfg.log_dir = common::read<std::string>(node, "log_dir");
  cfg.var_buffer_size = common::read<size_t>(node, "var_buffer_size");
  cfg.img_buffer_size = common::read<size_t>(node, "img_buffer_size");
  cfg.img_width = common::read<int>(node, "img_width");
  cfg.img_quality = common::read<int>(node, "img_quality");
  cfg.heartbeat_interval_ms = common::read<uint32_t>(node, "heartbeat_interval_ms");
  cfg.sender_name = common::read<std::string>(node, "sender_name");
  if (node["app"]) cfg.app = node["app"].as<std::string>();
  if (node["beacon_interval_ms"])
    cfg.beacon_interval_ms = node["beacon_interval_ms"].as<uint32_t>();
  if (node["head_timeout_ms"])
    cfg.head_timeout_ms = node["head_timeout_ms"].as<uint32_t>();
  if (node["beacon_port"])
    cfg.beacon_port = node["beacon_port"].as<uint16_t>();

  init(cfg);
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
