#ifndef OMNISCOPE_REMOTE_LOGGER_HPP
#define OMNISCOPE_REMOTE_LOGGER_HPP

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>

#include <fmt/format.h>
#include <nlohmann/json.hpp>
#include <opencv2/core.hpp>

namespace omniscope
{

/// 车载高频遥测与调试日志核心。
///
///   plot / log     → 本地异步 .rlog + 局域网 UDP 单播（队首中继）
///   plot_image     → 自动限频/丢帧入选 → 硬件加速/JPEG 压缩 → 本地 .rlog；UDP 分片仅当 Host 订阅时发送
///   enable_remote  → 自动局域网 Beacon 广播 + Host 队列连接管理
class RemoteLogger
{
public:
  struct Config
  {
    uint16_t control_port = 15000;
    uint16_t beacon_port = 15999;
    bool enable_remote = true;
    bool enable_local = true;
    std::string log_dir = "./logs";
    size_t var_buffer_size = 1024;
    size_t img_buffer_size = 10;
    int img_width = 640;
    int img_quality = 50;
    uint32_t heartbeat_interval_ms = 0;
    std::string sender_name;
    /// beacon 身份：normal=普通调试程序，calibrate=相机标定程序（host 据此开页）
    std::string app = "normal";
    uint32_t beacon_interval_ms = 1000;
    uint32_t head_timeout_ms = 2000;
  };

  static RemoteLogger & instance();

  void init(const Config & cfg);
  void init(const std::string & config_path);
  void plot(const nlohmann::json & data);
  void log(const std::string & level, const std::string & msg);

  template <typename... Args>
  void log(const std::string & level, const std::string & fmt_str, Args &&... args)
  {
    log(level, fmt::format(fmt::runtime(fmt_str), std::forward<Args>(args)...));
  }

  void plot_image(const cv::Mat & img, const nlohmann::json & meta);
  /// host 网页下发的标定指令
  bool poll_calib_cmd(std::string & cmd);
  /// host 下发的通用 JSON 控制命令
  bool poll_json(nlohmann::json & data);
  void shutdown();

private:
  RemoteLogger();
  ~RemoteLogger();
  RemoteLogger(const RemoteLogger &) = delete;
  RemoteLogger & operator=(const RemoteLogger &) = delete;

  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace omniscope

#endif  // OMNISCOPE_REMOTE_LOGGER_HPP
