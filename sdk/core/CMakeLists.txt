cmake_minimum_required(VERSION 3.16)
project(omniscope_core CXX)

find_package(Eigen3 3.3 QUIET CONFIG)
if(NOT TARGET Eigen3::Eigen)
    find_package(Eigen3 REQUIRED)
endif()

find_package(OpenCV REQUIRED COMPONENTS core imgproc)
find_package(yaml-cpp QUIET)

add_library(omniscope_core STATIC
    src/crc.cpp
    src/exiter.cpp
    src/extended_kalman_filter.cpp
    src/img_tools.cpp
    src/math_tools.cpp
    src/pid.cpp
    src/ransac_sine_fitter.cpp
    src/trajectory.cpp
)
add_library(OmniScope::Core ALIAS omniscope_core)

target_include_directories(omniscope_core PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include/omniscope/core>
    $<INSTALL_INTERFACE:include>
)

target_compile_features(omniscope_core PUBLIC cxx_std_17)

target_link_libraries(omniscope_core PUBLIC
    Eigen3::Eigen
    ${OpenCV_LIBS}
)

if(TARGET yaml-cpp)
    target_link_libraries(omniscope_core PUBLIC yaml-cpp)
endif()
