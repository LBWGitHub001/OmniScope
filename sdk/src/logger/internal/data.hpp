#ifndef OMNISCOPE_LOGGER_INTERNAL_DATA_HPP
#define OMNISCOPE_LOGGER_INTERNAL_DATA_HPP

#include <atomic>
#include <cstdint>
#include <nlohmann/json.hpp>
#include <string>
#include <vector>

namespace omniscope
{
namespace logger
{

class ControlPlane;

// L2：数据面。向当前队首单播发送 JSON / 图像 / 心跳。
class DataPlane
{
public:
  explicit DataPlane(ControlPlane & ctrl) : ctrl_(ctrl) {}

  void set_sender(std::string name) { sender_ = std::move(name); }
  const std::string & sender() const { return sender_; }

  void inject(nlohmann::json & j) const;
  void send_json(nlohmann::json j);
  void send_raw_json(const std::string & json_str);
  void send_image(const std::vector<uint8_t> & jpeg, uint64_t ts,
                  const std::string & meta_str);
  void send_heartbeat();
  void send_img_catalog(const std::vector<std::string> & streams);

private:
  ControlPlane & ctrl_;
  std::string sender_;
  std::atomic<uint16_t> frame_seq_{0};
};

}  // namespace logger
}  // namespace omniscope

#endif  // OMNISCOPE_LOGGER_INTERNAL_DATA_HPP
