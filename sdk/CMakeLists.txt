cmake_minimum_required(VERSION 3.16)
project(omniscope_sdk VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

include(GNUInstallDirs)
include(CMakePackageConfigHelpers)

# 组件选项
option(OMNISCOPE_BUILD_MCU         "Build OmniScope MCU C library"        ON)
option(OMNISCOPE_BUILD_LOGGER      "Build OmniScope Logger library"       ON)
option(OMNISCOPE_BUILD_RMBAG       "Build OmniScope RMBag library"        ON)
option(OMNISCOPE_BUILD_CALIBRATION "Build OmniScope Calibration tools"    ON)

set(OMNISCOPE_EXPORTED_TARGETS "")

# 公共依赖发现
find_package(Threads REQUIRED)
find_package(nlohmann_json QUIET)
find_package(fmt QUIET)
find_package(yaml-cpp QUIET)
find_package(OpenCV QUIET COMPONENTS core imgcodecs imgproc calib3d highgui)

# -----------------------------------------------------------------------------
# 1. 单片机嵌入式 C99 支持库 (OmniScope::MCU)
# -----------------------------------------------------------------------------
if(OMNISCOPE_BUILD_MCU)
    add_library(omniscope_mcu STATIC
        src/mcu/mailbox.c
    )
    add_library(OmniScope::MCU ALIAS omniscope_mcu)
    target_compile_features(omniscope_mcu PUBLIC c_std_99)
    target_include_directories(omniscope_mcu PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
    )
    list(APPEND OMNISCOPE_EXPORTED_TARGETS omniscope_mcu)
endif()

# -----------------------------------------------------------------------------
# 2. 核心远程遥测与 3D Marker 库 (OmniScope::Logger)
# -----------------------------------------------------------------------------
if(OMNISCOPE_BUILD_LOGGER)
    if(NOT OpenCV_FOUND)
        find_package(OpenCV REQUIRED COMPONENTS core imgcodecs imgproc)
    endif()

    add_library(omniscope_logger STATIC
        src/logger/control.cpp
        src/logger/data.cpp
        src/logger/engine.cpp
        src/logger/image.cpp
        src/logger/remote_logger.cpp
        src/logger/session.cpp
        src/logger/transport.cpp
    )
    add_library(OmniScope::Logger ALIAS omniscope_logger)

    target_include_directories(omniscope_logger
        PUBLIC
            $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
            $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
        PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/src/logger
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
    elseif(yaml-cpp_FOUND)
        target_link_libraries(omniscope_logger PRIVATE yaml-cpp)
    endif()

    list(APPEND OMNISCOPE_EXPORTED_TARGETS omniscope_logger)
endif()

# -----------------------------------------------------------------------------
# 3. 视觉与姿态数据集录放库 (OmniScope::RMBag)
# -----------------------------------------------------------------------------
if(OMNISCOPE_BUILD_RMBAG)
    add_library(omniscope_rmbag STATIC
        src/rmbag/meta.cpp
        src/rmbag/playback.cpp
        src/rmbag/reader.cpp
        src/rmbag/writer.cpp
    )
    add_library(OmniScope::RMBag ALIAS omniscope_rmbag)

    target_include_directories(omniscope_rmbag
        PUBLIC
            $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
            $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
        PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/src/rmbag
    )

    target_link_libraries(omniscope_rmbag PUBLIC
        Threads::Threads
    )

    if(TARGET nlohmann_json::nlohmann_json)
        target_link_libraries(omniscope_rmbag PUBLIC nlohmann_json::nlohmann_json)
    endif()

    if(TARGET yaml-cpp)
        target_link_libraries(omniscope_rmbag PRIVATE yaml-cpp)
    elseif(yaml-cpp_FOUND)
        target_link_libraries(omniscope_rmbag PRIVATE yaml-cpp)
    endif()

    list(APPEND OMNISCOPE_EXPORTED_TARGETS omniscope_rmbag)
endif()

# -----------------------------------------------------------------------------
# 4. 相机与手眼标定模块 (OmniScope::Calibrator)
# -----------------------------------------------------------------------------
if(OMNISCOPE_BUILD_CALIBRATION)
    find_package(Eigen3 REQUIRED)
    if(NOT yaml-cpp_FOUND)
        find_package(yaml-cpp REQUIRED)
    endif()

    add_library(omniscope_calibrator STATIC
        src/calibration/calibrator.cpp
    )
    add_library(OmniScope::Calibrator ALIAS omniscope_calibrator)

    target_include_directories(omniscope_calibrator PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
    )

    target_link_libraries(omniscope_calibrator PUBLIC
        omniscope_logger
        ${OpenCV_LIBS}
        Eigen3::Eigen
        yaml-cpp
        fmt::fmt
        nlohmann_json::nlohmann_json
    )

    # 独立可执行标定节点
    add_executable(omniscope_calibrate src/calibration/calibrate_node.cpp)
    target_link_libraries(omniscope_calibrate PRIVATE
        omniscope_calibrator
        omniscope_logger
        ${OpenCV_LIBS}
    )

    list(APPEND OMNISCOPE_EXPORTED_TARGETS omniscope_calibrator)
endif()

# -----------------------------------------------------------------------------
# 5. 统一聚合目标 OmniScope::All
# -----------------------------------------------------------------------------
add_library(omniscope_all INTERFACE)
add_library(OmniScope::All ALIAS omniscope_all)
list(APPEND OMNISCOPE_EXPORTED_TARGETS omniscope_all)

foreach(_tgt IN LISTS OMNISCOPE_EXPORTED_TARGETS)
    if(TARGET ${_tgt} AND NOT ${_tgt} STREQUAL "omniscope_all")
        target_link_libraries(omniscope_all INTERFACE ${_tgt})
    endif()
endforeach()

# -----------------------------------------------------------------------------
# 6. 安装与导出配置
# -----------------------------------------------------------------------------
install(TARGETS ${OMNISCOPE_EXPORTED_TARGETS}
    EXPORT OmniScopeTargets
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
    INCLUDES DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
)

export(EXPORT OmniScopeTargets
    FILE "${CMAKE_CURRENT_BINARY_DIR}/OmniScopeTargets.cmake"
    NAMESPACE OmniScope::
)

set(PACKAGE_CONFIG_DESTINATION "${CMAKE_INSTALL_LIBDIR}/cmake/OmniScope")

write_basic_package_version_file(
    "${CMAKE_CURRENT_BINARY_DIR}/OmniScopeConfigVersion.cmake"
    VERSION ${PROJECT_VERSION}
    COMPATIBILITY SameMajorVersion
)

configure_package_config_file(
    "${CMAKE_CURRENT_SOURCE_DIR}/cmake/OmniScopeConfig.cmake.in"
    "${CMAKE_CURRENT_BINARY_DIR}/OmniScopeConfig.cmake"
    INSTALL_DESTINATION "${PACKAGE_CONFIG_DESTINATION}"
)

install(DIRECTORY include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})

install(EXPORT OmniScopeTargets
    FILE OmniScopeTargets.cmake
    NAMESPACE OmniScope::
    DESTINATION "${PACKAGE_CONFIG_DESTINATION}"
)

install(FILES
    "${CMAKE_CURRENT_BINARY_DIR}/OmniScopeConfig.cmake"
    "${CMAKE_CURRENT_BINARY_DIR}/OmniScopeConfigVersion.cmake"
    DESTINATION "${PACKAGE_CONFIG_DESTINATION}"
)
