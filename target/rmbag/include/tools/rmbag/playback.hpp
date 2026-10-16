#ifndef TOOLS_RMBAG_PLAYBACK_HPP
#define TOOLS_RMBAG_PLAYBACK_HPP

#include <chrono>
#include <memory>
#include <mutex>
#include <nlohmann/json.hpp>
#include <string>

#include "tools/rmbag/proto.hpp"
#include "tools/rmbag/reader.hpp"

namespace tools
{
namespace rmbag
{

/// Shared sequential bag session: Camera advances frames; Gimbal reads current.
class Playback
{
public:
  static std::shared_ptr<Playback> acquire(
    const std::string & path, bool loop, bool realtime);

  explicit Playback(const std::string & path, bool loop, bool realtime);

  bool next();
  bool has_frame() const;
  Frame current() const;
  const nlohmann::json & header() const { return reader_.header(); }
  bool loop() const { return loop_; }
  bool realtime() const { return realtime_; }
  const std::string & path() const { return path_; }

  /// Map bag ts_ns onto a process-local steady_clock timeline.
  std::chrono::steady_clock::time_point stamp() const;

private:
  void sleep_for_realtime(uint64_t ts_ns);

  std::string path_;
  bool loop_;
  bool realtime_;
  Reader reader_;
  Frame current_{};
  bool has_{false};
  bool started_{false};
  std::chrono::steady_clock::time_point t0_{};
  uint64_t last_ts_ns_{0};
  mutable std::mutex mtx_;
};

}  // namespace rmbag
}  // namespace tools

#endif
