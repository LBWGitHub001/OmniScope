#include "omniscope/rmbag/playback.hpp"

#include <map>
#include <stdexcept>
#include <thread>

namespace omniscope
{
namespace rmbag
{
namespace
{
std::mutex g_mu;
std::map<std::string, std::weak_ptr<Playback>> g_sessions;
}  // namespace

std::shared_ptr<Playback> Playback::acquire(
  const std::string & path, bool loop, bool realtime)
{
  std::lock_guard<std::mutex> lock(g_mu);
  auto it = g_sessions.find(path);
  if (it != g_sessions.end()) {
    if (auto sp = it->second.lock()) return sp;
  }
  auto sp = std::make_shared<Playback>(path, loop, realtime);
  g_sessions[path] = sp;
  return sp;
}

Playback::Playback(const std::string & path, bool loop, bool realtime)
: path_(path), loop_(loop), realtime_(realtime)
{
  if (!reader_.open(path_))
    throw std::runtime_error("failed to open rmbag: " + path_);
}

bool Playback::next()
{
  std::lock_guard<std::mutex> lock(mtx_);
  Frame f;
  if (!reader_.read_frame(f)) {
    if (!loop_ || !reader_.rewind() || !reader_.read_frame(f)) {
      has_ = false;
      return false;
    }
    started_ = false;
  }
  if (realtime_) sleep_for_realtime(f.hdr.ts_ns);
  if (!started_) {
    t0_ = std::chrono::steady_clock::now();
    started_ = true;
  }
  current_ = std::move(f);
  last_ts_ns_ = current_.hdr.ts_ns;
  has_ = true;
  return true;
}

bool Playback::has_frame() const
{
  std::lock_guard<std::mutex> lock(mtx_);
  return has_;
}

Frame Playback::current() const
{
  std::lock_guard<std::mutex> lock(mtx_);
  return current_;
}

std::chrono::steady_clock::time_point Playback::stamp() const
{
  std::lock_guard<std::mutex> lock(mtx_);
  return t0_ + std::chrono::nanoseconds(last_ts_ns_);
}

void Playback::sleep_for_realtime(uint64_t ts_ns)
{
  if (!started_) return;
  const auto target = t0_ + std::chrono::nanoseconds(ts_ns);
  const auto now = std::chrono::steady_clock::now();
  if (target > now) std::this_thread::sleep_until(target);
}

}  // namespace rmbag
}  // namespace omniscope
