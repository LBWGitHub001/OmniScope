cmake_minimum_required(VERSION 3.16)
project(omniscope_tools CXX)

find_package(OpenCV REQUIRED COMPONENTS core imgproc videoio highgui)
find_package(nlohmann_json REQUIRED)

add_executable(omniscope_fake_robot fake_robot.cpp)
target_link_libraries(omniscope_fake_robot PRIVATE
    OmniScope::Logger
    OmniScope::Core
    ${OpenCV_LIBS}
)

add_executable(omniscope_multi_sender_test multi_sender_test.cpp)
target_link_libraries(omniscope_multi_sender_test PRIVATE
    OmniScope::Logger
    nlohmann_json::nlohmann_json
)
