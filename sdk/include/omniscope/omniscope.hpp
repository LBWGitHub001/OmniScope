#ifndef OMNISCOPE_OMNISCOPE_HPP
#define OMNISCOPE_OMNISCOPE_HPP

/**
 * @file omniscope.hpp
 * @brief OmniScope C++ & Embedded Client Master Header
 *
 * Provides a clean, modern, zero-verbosity API for high-frequency remote debugging,
 * real-time waveform telemetry, ROS 2-compatible 3D visualization markers,
 * image streaming, and MCU SWD memory watching.
 */

#include "omniscope/logger.hpp"
#include "omniscope/remote_logger.hpp"
#include "omniscope/marker.hpp"

#ifdef __cplusplus
extern "C" {
#endif
#include "omniscope/mcu/mailbox.h"
#ifdef __cplusplus
}
#endif

namespace omniscope
{

// ============================================================================
// Lifecycle & Configuration
// ============================================================================

/// 初始化 OmniScope 遥测调试引擎（通过结构体配置）
inline void init(const RemoteLogger::Config & cfg)
{
  RemoteLogger::instance().init(cfg);
}

/// 初始化 OmniScope 遥测调试引擎（通过 YAML 配置文件路径）
inline void init(const std::string & config_path)
{
  RemoteLogger::instance().init(config_path);
}

/// 优雅关闭遥测引擎，刷新落盘与后台队列
inline void shutdown()
{
  RemoteLogger::instance().shutdown();
}

// ============================================================================
// Telemetry Waveforms (示波器曲线遥测)
// ============================================================================

/// 极简高频遥测上报，例如：omniscope::plot({{"yaw", 12.5}, {"pitch", -3.2}});
inline void plot(const nlohmann::json & data)
{
  RemoteLogger::instance().plot(data);
}

// ============================================================================
// Structured Remote Logging (分级远程日志)
// ============================================================================

/// 发送基础分级日志
inline void log(const std::string & level, const std::string & msg)
{
  RemoteLogger::instance().log(level, msg);
}

/// 发送支持 fmt 格式化的分级日志
template <typename... Args>
inline void log(const std::string & level, const std::string & fmt_str, Args &&... args)
{
  RemoteLogger::instance().log(level, fmt_str, std::forward<Args>(args)...);
}

/// [INFO] 级别日志
template <typename... Args>
inline void info(const std::string & fmt_str, Args &&... args)
{
  RemoteLogger::instance().log("INFO", fmt_str, std::forward<Args>(args)...);
}

/// [WARN] 级别日志
template <typename... Args>
inline void warn(const std::string & fmt_str, Args &&... args)
{
  RemoteLogger::instance().log("WARN", fmt_str, std::forward<Args>(args)...);
}

/// [ERROR] 级别日志
template <typename... Args>
inline void error(const std::string & fmt_str, Args &&... args)
{
  RemoteLogger::instance().log("ERROR", fmt_str, std::forward<Args>(args)...);
}

/// [DEBUG] 级别日志
template <typename... Args>
inline void debug(const std::string & fmt_str, Args &&... args)
{
  RemoteLogger::instance().log("DEBUG", fmt_str, std::forward<Args>(args)...);
}

// ============================================================================
// 3D Visualization Markers (ROS 2 兼容 3D 空间标记)
// ============================================================================

/// 上报单个 3D Marker 标记
inline void plot_marker(const Marker & marker)
{
  RemoteLogger::instance().plot_marker(marker);
}

/// 批量上报多个 3D Marker 标记
inline void plot_markers(const std::vector<Marker> & markers)
{
  RemoteLogger::instance().plot_markers(markers);
}

// ============================================================================
// Vision & Image Stream (视觉图像遥测流)
// ============================================================================

/// 上报图像帧（自动限频与 JPEG 压缩，支持元数据注入）
inline void plot_image(const cv::Mat & img, const nlohmann::json & meta = {})
{
  RemoteLogger::instance().plot_image(img, meta);
}

// ============================================================================
// Remote Command Polling (上位机反向控制命令接收)
// ============================================================================

/// 轮询上位机下发的 JSON 命令
inline bool poll_json(nlohmann::json & data)
{
  return RemoteLogger::instance().poll_json(data);
}

}  // namespace omniscope

#endif  // OMNISCOPE_OMNISCOPE_HPP
