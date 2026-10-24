#ifndef OMNISCOPE_LOGGER_INTERNAL_SESSION_HPP
#define OMNISCOPE_LOGGER_INTERNAL_SESSION_HPP

#include <chrono>
#include <cstdint>
#include <mutex>
#include <nlohmann/json.hpp>
#include <cstddef>
#include <string>
#include <sys/uio.h>
#include <utility>
#include <vector>

namespace omniscope
{
namespace logger
{

// L3：本地 .rlog（RLG2）异步落盘写入器。
class Session
{
public:
  void open(const std::string & log_dir);
  void close();
  void write_json(uint64_t ts, const std::string & json);
  void write_jsons(const std::vector<std::pair<uint64_t, std::string>> & entries);
  void write_image(uint64_t ts, const std::string & meta_json,
                   const std::vector<uint8_t> & jpeg);
  void sync(bool force = true);

private:
  bool ensure_file();
  bool writev_all(const struct ::iovec * iov, int iovcnt);
  void sync_locked(bool force);

  std::mutex mtx_;
  std::string log_dir_;
  std::string path_;
  int fd_{-1};
  std::chrono::steady_clock::time_point last_sync_{};
};

}  // namespace logger
}  // namespace omniscope

#endif  // OMNISCOPE_LOGGER_INTERNAL_SESSION_HPP
