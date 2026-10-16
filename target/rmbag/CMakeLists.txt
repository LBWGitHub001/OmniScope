cmake_minimum_required(VERSION 3.16)
project(target_rmbag CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Threads REQUIRED)
find_package(nlohmann_json QUIET)
find_package(yaml-cpp QUIET)

add_library(target_rmbag
    src/meta.cpp
    src/playback.cpp
    src/reader.cpp
    src/writer.cpp
)

target_include_directories(target_rmbag PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
)

target_link_libraries(target_rmbag PUBLIC
    Threads::Threads
)

if(TARGET nlohmann_json::nlohmann_json)
    target_link_libraries(target_rmbag PUBLIC nlohmann_json::nlohmann_json)
endif()

if(TARGET yaml-cpp)
    target_link_libraries(target_rmbag PRIVATE yaml-cpp)
endif()
