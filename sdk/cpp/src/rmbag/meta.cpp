#include "omniscope/rmbag/meta.hpp"

#include <array>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <sys/utsname.h>
#include <unistd.h>

#include <yaml-cpp/yaml.h>

namespace omniscope
{
namespace rmbag
{
namespace
{

std::string slurp_file(const std::string & path)
{
  std::ifstream in(path);
  if (!in) return {};
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

std::string shell_trim(const std::string & cmd)
{
  FILE * fp = ::popen(cmd.c_str(), "r");
  if (!fp) return {};
  std::array<char, 256> buf{};
  std::string out;
  while (std::fgets(buf.data(), static_cast<int>(buf.size()), fp)) out += buf.data();
  ::pclose(fp);
  while (!out.empty() && (out.back() == '\n' || out.back() == '\r')) out.pop_back();
  return out;
}

uint64_t wall_ns()
{
  return static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(
                                 std::chrono::system_clock::now().time_since_epoch())
                                 .count());
}

}  // namespace

nlohmann::json collect_session_header(
  const std::string & config_path, int argc, char ** argv, const std::string & device_name)
{
  const std::string resolved = config_path;
  nlohmann::json j;
  j["version"] = 1;
  j["format"] = "RMB1";
  j["config"]["path"] = config_path;
  j["config"]["resolved"] = resolved;
  j["config"]["text"] = slurp_file(resolved);

  j["timing"]["start_wall_ns"] = wall_ns();
  j["timing"]["start_steady_ns"] = 0;

  char host[256]{};
  gethostname(host, sizeof(host) - 1);
  j["host"]["hostname"] = host;
  const char * user = std::getenv("USER");
  j["host"]["username"] = user ? user : "";
  utsname un{};
  if (uname(&un) == 0) {
    j["host"]["os"] = std::string(un.sysname) + " " + un.release;
    j["host"]["machine"] = un.machine;
  }
  char cwd[4096]{};
  j["host"]["cwd"] = getcwd(cwd, sizeof(cwd)) ? cwd : "";

  j["git"]["commit"] = shell_trim("git rev-parse --short HEAD 2>/dev/null");
  j["git"]["branch"] = shell_trim("git rev-parse --abbrev-ref HEAD 2>/dev/null");
  const std::string dirty = shell_trim("git diff --quiet 2>/dev/null; echo $?");
  j["git"]["dirty"] = (dirty == "1");

  try {
    auto yaml = YAML::LoadFile(config_path);
    if (yaml["camera_name"]) j["camera"]["name"] = yaml["camera_name"].as<std::string>();
    if (yaml["exposure_ms"]) j["camera"]["exposure_ms"] = yaml["exposure_ms"].as<double>();
    if (yaml["gain"]) j["camera"]["gain"] = yaml["gain"].as<double>();
    if (yaml["vid_pid"]) j["camera"]["vid_pid"] = yaml["vid_pid"].as<std::string>();
    j["camera"]["model"] = "";
    j["camera"]["serial"] = "";
    j["camera"]["firmware"] = "";
    if (yaml["com_port"]) j["gimbal"]["port"] = yaml["com_port"].as<std::string>();
    j["gimbal"]["baud"] = 115200;
  } catch (...) {
  }

  std::string name = device_name;
  if (name.empty()) {
    try {
      auto yaml = YAML::LoadFile(config_path);
      if (yaml["device_name"]) name = yaml["device_name"].as<std::string>();
    } catch (...) {
    }
  }
  if (name.empty()) name = host;
  j["device"]["name"] = name;
  j["device"]["note"] = "";

  nlohmann::json argv_json = nlohmann::json::array();
  for (int i = 0; i < argc; ++i) argv_json.push_back(argv[i] ? argv[i] : "");
  j["recorder"]["argv"] = argv_json;
  j["recorder"]["binary"] = "rmbag_record";
  return j;
}

}  // namespace rmbag
}  // namespace omniscope
