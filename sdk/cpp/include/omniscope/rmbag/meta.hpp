#ifndef OMNISCOPE_RMBAG_META_HPP
#define OMNISCOPE_RMBAG_META_HPP

#include <nlohmann/json.hpp>
#include <string>
#include <vector>

namespace omniscope
{
namespace rmbag
{

nlohmann::json collect_session_header(
  const std::string & config_path, int argc, char ** argv, const std::string & device_name);

}  // namespace rmbag
}  // namespace omniscope

#endif  // OMNISCOPE_RMBAG_META_HPP
