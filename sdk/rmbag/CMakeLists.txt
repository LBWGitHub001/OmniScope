cmake_minimum_required(VERSION 3.16)
project(omniscope_rmbag CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Threads REQUIRED)
find_package(nlohmann_json QUIET)
find_package(yaml-cpp QUIET)

add_library(omniscope_rmbag
    src/meta.cpp
    src/playback.cpp
    src/reader.cpp
    src/writer.cpp
)

add_library(OmniScope::RMBag ALIAS omniscope_rmbag)

target_include_directories(omniscope_rmbag
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(omniscope_rmbag PUBLIC
    omniscope_core
    Threads::Threads
)

if(TARGET nlohmann_json::nlohmann_json)
    target_link_libraries(omniscope_rmbag PUBLIC nlohmann_json::nlohmann_json)
endif()

if(TARGET yaml-cpp)
    target_link_libraries(omniscope_rmbag PRIVATE yaml-cpp)
endif()
