#ifndef OMNISCOPE_VERSION_HPP
#define OMNISCOPE_VERSION_HPP

#define OMNISCOPE_VERSION_MAJOR 1
#define OMNISCOPE_VERSION_MINOR 0
#define OMNISCOPE_VERSION_PATCH 0
#define OMNISCOPE_VERSION_STRING "1.0.0"

namespace omniscope
{
struct Version
{
  static constexpr int major = OMNISCOPE_VERSION_MAJOR;
  static constexpr int minor = OMNISCOPE_VERSION_MINOR;
  static constexpr int patch = OMNISCOPE_VERSION_PATCH;
  static constexpr const char * string = OMNISCOPE_VERSION_STRING;
};
}  // namespace omniscope

#endif  // OMNISCOPE_VERSION_HPP
