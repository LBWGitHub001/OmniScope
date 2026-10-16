#include "writer.hpp"

#include <cerrno>
#include <cstdio>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

namespace tools
{
namespace rmbag
{

Writer::~Writer() { close(); }

bool Writer::open(const std::string & path)
{
  close();
  path_ = path;
  fd_ = ::open(path.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd_ < 0) {
    std::fprintf(stderr, "[rmbag] open failed %s errno=%d\n", path.c_str(), errno);
    path_.clear();
    return false;
  }
  uint32_t magic = kMagic;
  if (!write_all(&magic, sizeof(magic))) {
    close();
    return false;
  }
  return true;
}

bool Writer::write_header(const nlohmann::json & header)
{
  if (fd_ < 0 || header_written_) return false;
  const std::string s = header.dump();
  const uint32_t len = static_cast<uint32_t>(s.size());
  if (!write_all(&len, sizeof(len))) return false;
  if (!write_all(s.data(), s.size())) return false;
  header_written_ = true;
  return true;
}

bool Writer::write_frame(const Frame & frame)
{
  if (fd_ < 0 || !header_written_) return false;
  if (frame.hdr.data_len != frame.pixels.size()) return false;
  const uint8_t type = kRecFrame;
  if (!write_all(&type, sizeof(type))) return false;
  if (!write_all(&frame.hdr, sizeof(frame.hdr))) return false;
  if (frame.hdr.data_len > 0 && !write_all(frame.pixels.data(), frame.pixels.size())) return false;
  ++frame_count_;
  return true;
}

bool Writer::write_footer(const nlohmann::json & footer)
{
  if (fd_ < 0 || !header_written_) return false;
  const uint8_t type = kRecFooter;
  const std::string s = footer.dump();
  const uint32_t len = static_cast<uint32_t>(s.size());
  if (!write_all(&type, sizeof(type))) return false;
  if (!write_all(&len, sizeof(len))) return false;
  if (!write_all(s.data(), s.size())) return false;
  sync();
  return true;
}

void Writer::close()
{
  if (fd_ < 0) return;
  sync();
  ::close(fd_);
  fd_ = -1;
  header_written_ = false;
}

bool Writer::write_all(const void * data, size_t n)
{
  const auto * p = static_cast<const uint8_t *>(data);
  size_t off = 0;
  while (off < n) {
    const ssize_t w = ::write(fd_, p + off, n - off);
    if (w <= 0) {
      std::fprintf(stderr, "[rmbag] write failed errno=%d\n", errno);
      return false;
    }
    off += static_cast<size_t>(w);
  }
  bytes_written_ += n;
  return true;
}

void Writer::sync()
{
  if (fd_ < 0) return;
  if (::fdatasync(fd_) != 0)
    std::fprintf(stderr, "[rmbag] fdatasync errno=%d\n", errno);
}

}  // namespace rmbag
}  // namespace tools
