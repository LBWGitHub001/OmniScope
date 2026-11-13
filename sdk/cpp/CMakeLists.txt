# OmniScope C++ SDK — Linux / ROS / Jetson 等主机端遥测、3D 标记、录放与标定
#
# 用户工程链接 OmniScope::Cpp 即选择 C++ 版本。

find_package(Threads REQUIRED)
find_package(nlohmann_json QUIET)
find_package(fmt QUIET)
find_package(yaml-cpp QUIET)
find_package(OpenCV QUIET COMPONENTS core imgcodecs imgproc calib3d highgui)

add_library(omniscope_cpp STATIC
    src/logger/control.cpp
    src/logger/data.cpp
    src/logger/engine.cpp
    src/logger/image.cpp
    src/logger/remote_logger.cpp
    src/logger/session.cpp
    src/logger/transport.cpp
    src/rmbag/meta.cpp
    src/rmbag/playback.cpp
    src/rmbag/reader.cpp
    src/rmbag/writer.cpp
)
add_library(OmniScope::Cpp ALIAS omniscope_cpp)

target_compile_features(omniscope_cpp PUBLIC cxx_std_17)
set_target_properties(omniscope_cpp PROPERTIES
    POSITION_INDEPENDENT_CODE ON
    EXPORT_NAME Cpp
)

target_include_directories(omniscope_cpp
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/src/logger
        ${CMAKE_CURRENT_SOURCE_DIR}/src/rmbag
)

if(NOT OpenCV_FOUND)
    find_package(OpenCV REQUIRED COMPONENTS core imgcodecs imgproc)
endif()

target_link_libraries(omniscope_cpp PUBLIC
    Threads::Threads
    ${OpenCV_LIBS}
)

if(TARGET nlohmann_json::nlohmann_json)
    target_link_libraries(omniscope_cpp PUBLIC nlohmann_json::nlohmann_json)
endif()

if(TARGET fmt::fmt)
    target_link_libraries(omniscope_cpp PUBLIC fmt::fmt)
else()
    find_package(fmt REQUIRED)
    target_link_libraries(omniscope_cpp PUBLIC fmt::fmt)
endif()

if(TARGET yaml-cpp)
    target_link_libraries(omniscope_cpp PRIVATE yaml-cpp)
elseif(yaml-cpp_FOUND)
    target_link_libraries(omniscope_cpp PRIVATE yaml-cpp)
endif()

# 标定算法与独立节点：需要 Eigen3 与 yaml-cpp 时才编入
find_package(Eigen3 QUIET)
if(Eigen3_FOUND AND (TARGET yaml-cpp OR yaml-cpp_FOUND) AND TARGET nlohmann_json::nlohmann_json)
    target_sources(omniscope_cpp PRIVATE src/calibration/calibrator.cpp)
    target_link_libraries(omniscope_cpp PUBLIC Eigen3::Eigen)

    add_executable(omniscope_calibrate src/calibration/calibrate_node.cpp)
    target_link_libraries(omniscope_calibrate PRIVATE omniscope_cpp)
    message(STATUS "[OmniScope] C++ SDK: calibration module enabled")
else()
    message(STATUS "[OmniScope] C++ SDK: calibration module disabled (need Eigen3, yaml-cpp, nlohmann_json)")
endif()

install(TARGETS omniscope_cpp
    EXPORT OmniScopeTargets
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
    INCLUDES DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
)
install(DIRECTORY include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
if(TARGET omniscope_calibrate)
    install(TARGETS omniscope_calibrate RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
endif()
