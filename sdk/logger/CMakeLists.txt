cmake_minimum_required(VERSION 3.16)
project(omniscope_logger CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Threads REQUIRED)
find_package(OpenCV REQUIRED COMPONENTS core imgcodecs imgproc)
find_package(nlohmann_json QUIET)
find_package(fmt QUIET)
find_package(yaml-cpp QUIET)

add_library(omniscope_logger
    src/remote_logger.cpp
    src/control.cpp
    src/data.cpp
    src/engine.cpp
    src/image.cpp
    src/session.cpp
    src/transport.cpp
)

add_library(OmniScope::Logger ALIAS omniscope_logger)

target_include_directories(omniscope_logger
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(omniscope_logger PUBLIC
    Threads::Threads
    ${OpenCV_LIBS}
)

if(TARGET nlohmann_json::nlohmann_json)
    target_link_libraries(omniscope_logger PUBLIC nlohmann_json::nlohmann_json)
endif()

if(TARGET fmt::fmt)
    target_link_libraries(omniscope_logger PUBLIC fmt::fmt)
else()
    find_package(fmt REQUIRED)
    target_link_libraries(omniscope_logger PUBLIC fmt::fmt)
endif()

if(TARGET yaml-cpp)
    target_link_libraries(omniscope_logger PRIVATE yaml-cpp)
endif()
