#ifndef OMNISCOPE_RMBAG_READER_HPP
#define OMNISCOPE_RMBAG_READER_HPP

#include <cstdint>
#include <nlohmann/json.hpp>
#include <optional>
#include <string>

#include "omniscope/rmbag/proto.hpp"

namespace omniscope
{
namespace rmbag
{

class Reader
{
public:
  Reader() = default;
  ~Reader();

  Reader(const Reader &) = delete;
  Reader & operator=(const Reader &) = delete;

  bool open(const std::string & path);
  void close();
  bool rewind();

  const nlohmann::json & header() const { return header_; }
  const std::optional<nlohmann::json> & footer() const { return footer_; }

  /// Returns false on EOF (footer consumed or truncated).
  bool read_frame(Frame & out);

  const std::string & path() const { return path_; }

private:
  bool read_all(void * data, size_t n);

  int fd_{-1};
  std::string path_;
  nlohmann::json header_;
  std::optional<nlohmann::json> footer_;
  off_t data_offset_{0};
};

}  // namespace rmbag
}  // namespace omniscope

#endif  // OMNISCOPE_RMBAG_READER_HPP
