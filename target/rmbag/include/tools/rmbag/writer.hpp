#ifndef TOOLS_RMBAG_WRITER_HPP
#define TOOLS_RMBAG_WRITER_HPP

#include <cstdint>
#include <nlohmann/json.hpp>
#include <string>

#include "tools/rmbag/proto.hpp"

namespace tools
{
namespace rmbag
{

class Writer
{
public:
  Writer() = default;
  ~Writer();

  Writer(const Writer &) = delete;
  Writer & operator=(const Writer &) = delete;

  bool open(const std::string & path);
  bool write_header(const nlohmann::json & header);
  bool write_frame(const Frame & frame);
  bool write_footer(const nlohmann::json & footer);
  void close();

  const std::string & path() const { return path_; }
  uint64_t bytes_written() const { return bytes_written_; }
  uint64_t frame_count() const { return frame_count_; }

private:
  bool write_all(const void * data, size_t n);
  void sync();

  int fd_{-1};
  std::string path_;
  uint64_t bytes_written_{0};
  uint64_t frame_count_{0};
  bool header_written_{false};
};

}  // namespace rmbag
}  // namespace tools

#endif
