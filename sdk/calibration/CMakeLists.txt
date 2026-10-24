cmake_minimum_required(VERSION 3.16)
project(omniscope_calibration CXX)

find_package(OpenCV REQUIRED COMPONENTS core imgproc calib3d highgui)
find_package(yaml-cpp REQUIRED)
find_package(fmt REQUIRED)
find_package(nlohmann_json REQUIRED)

add_library(omniscope_calibrator STATIC
    src/calibrator.cpp
)
add_library(OmniScope::Calibrator ALIAS omniscope_calibrator)

target_include_directories(omniscope_calibrator PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include/omniscope/calibration>
    $<INSTALL_INTERFACE:include>
)

target_compile_features(omniscope_calibrator PUBLIC cxx_std_17)

target_link_libraries(omniscope_calibrator PUBLIC
    OmniScope::Core
    OmniScope::Logger
    ${OpenCV_LIBS}
    yaml-cpp
    fmt::fmt
    nlohmann_json::nlohmann_json
)

# Standalone calibration executable
add_executable(omniscope_calibrate src/calibrate_node.cpp)
target_link_libraries(omniscope_calibrate PRIVATE
    omniscope_calibrator
    OmniScope::Logger
    OmniScope::Core
    ${OpenCV_LIBS}
)
