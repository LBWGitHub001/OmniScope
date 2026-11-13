#ifndef OMNISCOPE_LOGGER_INTERNAL_CLOCK_HPP
#define OMNISCOPE_LOGGER_INTERNAL_CLOCK_HPP

#include <chrono>
#include <cstdint>

namespace omniscope
{
namespace logger
{

inline uint64_t now_ns()
{
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
           std::chrono::system_clock::now().time_since_epoch())
    .count();
}

}  // namespace logger
}  // namespace omniscope

#endif  // OMNISCOPE_LOGGER_INTERNAL_CLOCK_HPP
