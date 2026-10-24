cmake_minimum_required(VERSION 3.16)
project(omniscope_tools CXX)

find_package(OpenCV REQUIRED COMPONENTS core imgproc videoio highgui)
find_package(nlohmann_json REQUIRED)

# 1. Standalone fake robot simulator
add_executable(omniscope_fake_robot fake_robot.cpp)
target_link_libraries(omniscope_fake_robot PRIVATE
    OmniScope::Logger
    OmniScope::Core
    ${OpenCV_LIBS}
)

# 2. Comprehensive Multi-Scenario Test Data Sources Generator
add_executable(omniscope_data_sources data_sources.cpp)
target_link_libraries(omniscope_data_sources PRIVATE
    OmniScope::Logger
    OmniScope::Core
    ${OpenCV_LIBS}
    nlohmann_json::nlohmann_json
)

# 3. Pure C++ Remote Debugging & 3D Marker Test Suite (No embedded dependencies)
add_executable(omniscope_test_remote_debugging test_remote_debugging.cpp)
target_link_libraries(omniscope_test_remote_debugging PRIVATE
    OmniScope::Logger
    OmniScope::Core
    ${OpenCV_LIBS}
    nlohmann_json::nlohmann_json
)

# 4. Multi-sender protocol test
add_executable(omniscope_multi_sender_test multi_sender_test.cpp)
target_link_libraries(omniscope_multi_sender_test PRIVATE
    OmniScope::Logger
    nlohmann_json::nlohmann_json
)
