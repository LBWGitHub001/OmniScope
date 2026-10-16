#ifndef TOOLS_RMBAG_META_HPP
#define TOOLS_RMBAG_META_HPP

#include <nlohmann/json.hpp>
#include <string>
#include <vector>

namespace tools
{
namespace rmbag
{

nlohmann::json collect_session_header(
  const std::string & config_path, int argc, char ** argv, const std::string & device_name);

}  // namespace rmbag
}  // namespace tools

#endif
