#include "reader.hpp"

#include <cerrno>
#include <cstdio>
#include <fcntl.h>
#include <unistd.h>
#include <vector>

namespace tools
{
namespace rmbag
{

Reader::~Reader() { close(); }

bool Reader::open(const std::string & path)
{
  close();
  path_ = path;
  fd_ = ::open(path.c_str(), O_RDONLY);
  if (fd_ < 0) {
    std::fprintf(stderr, "[rmbag] open failed %s errno=%d\n", path.c_str(), errno);
    path_.clear();
    return false;
  }
  uint32_t magic = 0;
  if (!read_all(&magic, sizeof(magic)) || magic != kMagic) {
    std::fprintf(stderr, "[rmbag] bad magic in %s\n", path.c_str());
    close();
    return false;
  }
  uint32_t header_len = 0;
  if (!read_all(&header_len, sizeof(header_len))) {
    close();
    return false;
  }
  std::vector<char> buf(header_len);
  if (header_len > 0 && !read_all(buf.data(), buf.size())) {
    close();
    return false;
  }
  try {
    header_ = nlohmann::json::parse(buf.begin(), buf.end());
  } catch (const std::exception & e) {
    std::fprintf(stderr, "[rmbag] header json: %s\n", e.what());
    close();
    return false;
  }
  data_offset_ = ::lseek(fd_, 0, SEEK_CUR);
  if (data_offset_ < 0) {
    close();
    return false;
  }
  return true;
}

void Reader::close()
{
  if (fd_ >= 0) {
    ::close(fd_);
    fd_ = -1;
  }
  header_ = nlohmann::json{};
  footer_.reset();
  data_offset_ = 0;
  path_.clear();
}

bool Reader::rewind()
{
  if (fd_ < 0) return false;
  footer_.reset();
  return ::lseek(fd_, data_offset_, SEEK_SET) == data_offset_;
}

bool Reader::read_frame(Frame & out)
{
  if (fd_ < 0) return false;
  uint8_t type = 0;
  if (!read_all(&type, sizeof(type))) return false;
  if (type == kRecFooter) {
    uint32_t len = 0;
    if (!read_all(&len, sizeof(len))) return false;
    std::vector<char> buf(len);
    if (len > 0 && !read_all(buf.data(), buf.size())) return false;
    try {
      footer_ = nlohmann::json::parse(buf.begin(), buf.end());
    } catch (...) {
      footer_.reset();
    }
    return false;
  }
  if (type != kRecFrame) {
    std::fprintf(stderr, "[rmbag] unknown record type 0x%02x\n", type);
    return false;
  }
  FrameHeader hdr{};
  if (!read_all(&hdr, sizeof(hdr))) return false;
  if (hdr.data_len != hdr.step * hdr.height) {
    std::fprintf(stderr, "[rmbag] data_len mismatch\n");
    return false;
  }
  out.hdr = hdr;
  out.pixels.resize(hdr.data_len);
  if (hdr.data_len > 0 && !read_all(out.pixels.data(), out.pixels.size())) return false;
  return true;
}

bool Reader::read_all(void * data, size_t n)
{
  auto * p = static_cast<uint8_t *>(data);
  size_t off = 0;
  while (off < n) {
    const ssize_t r = ::read(fd_, p + off, n - off);
    if (r == 0) return false;
    if (r < 0) {
      std::fprintf(stderr, "[rmbag] read errno=%d\n", errno);
      return false;
    }
    off += static_cast<size_t>(r);
  }
  return true;
}

}  // namespace rmbag
}  // namespace tools
