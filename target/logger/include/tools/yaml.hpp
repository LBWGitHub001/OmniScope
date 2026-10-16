#ifndef TOOLS_YAML_HPP
#define TOOLS_YAML_HPP

#include <string>

#if __has_include(<yaml-cpp/yaml.h>)
#include <yaml-cpp/yaml.h>

namespace tools
{
inline YAML::Node load(const std::string & path)
{
  return YAML::LoadFile(path);
}

template <typename T>
inline T read(const YAML::Node & node, const std::string & key)
{
  if (!node || !node[key]) return T{};
  return node[key].as<T>();
}

inline std::string project_path(const std::string & path)
{
  return path;
}
}  // namespace tools
#endif

#endif  // TOOLS_YAML_HPP
