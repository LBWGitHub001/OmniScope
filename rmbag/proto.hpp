#ifndef TOOLS_RMBAG_PROTO_HPP
#define TOOLS_RMBAG_PROTO_HPP

#include <cstdint>
#include <cstring>
#include <vector>

namespace tools
{
namespace rmbag
{

constexpr uint32_t kMagic = 0x31424D52;  // "RMB1" little-endian
constexpr uint8_t kRecFrame = 0x01;
constexpr uint8_t kRecFooter = 0x03;

#pragma pack(push, 1)
struct FrameHeader
{
  uint64_t ts_ns;
  double q_w;
  double q_x;
  double q_y;
  double q_z;
  float yaw_deg;
  float pitch_deg;
  float roll_deg;
  uint8_t mode;
  uint8_t pad[3];
  uint32_t width;
  uint32_t height;
  uint32_t step;
  uint32_t data_len;
};
#pragma pack(pop)

static_assert(sizeof(FrameHeader) == 72, "RMB1 FRAME header must be 72 bytes");

struct Frame
{
  FrameHeader hdr{};
  std::vector<uint8_t> pixels;
};

inline void write_le_u32(uint8_t * p, uint32_t v)
{
  std::memcpy(p, &v, sizeof(v));
}

inline void write_le_u64(uint8_t * p, uint64_t v)
{
  std::memcpy(p, &v, sizeof(v));
}

}  // namespace rmbag
}  // namespace tools

#endif
