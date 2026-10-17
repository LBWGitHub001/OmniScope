cmake_minimum_required(VERSION 3.16)
project(omniscope_core CXX)

add_library(omniscope_core INTERFACE)
add_library(OmniScope::Core ALIAS omniscope_core)

target_include_directories(omniscope_core INTERFACE
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
)

target_compile_features(omniscope_core INTERFACE cxx_std_17)

find_package(yaml-cpp QUIET)
if(TARGET yaml-cpp)
    target_link_libraries(omniscope_core INTERFACE yaml-cpp)
endif()
