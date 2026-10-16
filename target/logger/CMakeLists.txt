cmake_minimum_required(VERSION 3.16)
project(target_logger CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Threads REQUIRED)
find_package(OpenCV REQUIRED COMPONENTS core imgcodecs imgproc)
find_package(nlohmann_json QUIET)
find_package(fmt QUIET)
find_package(yaml-cpp QUIET)

add_library(target_logger
    src/remote_logger.cpp
    src/control.cpp
    src/data.cpp
    src/engine.cpp
    src/image.cpp
    src/session.cpp
    src/transport.cpp
)

target_include_directories(target_logger PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
)

target_link_libraries(target_logger PUBLIC
    Threads::Threads
    ${OpenCV_LIBS}
)

if(TARGET nlohmann_json::nlohmann_json)
    target_link_libraries(target_logger PUBLIC nlohmann_json::nlohmann_json)
endif()

if(TARGET fmt::fmt)
    target_link_libraries(target_logger PUBLIC fmt::fmt)
else()
    find_package(fmt REQUIRED)
    target_link_libraries(target_logger PUBLIC fmt::fmt)
endif()

if(TARGET yaml-cpp)
    target_link_libraries(target_logger PRIVATE yaml-cpp)
endif()
