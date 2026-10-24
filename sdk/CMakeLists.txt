cmake_minimum_required(VERSION 3.16)
project(omniscope_sdk VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

include(GNUInstallDirs)
include(CMakePackageConfigHelpers)

# 组件选项
option(OMNISCOPE_BUILD_CORE   "Build OmniScope Core library"   ON)
option(OMNISCOPE_BUILD_MCU    "Build OmniScope MCU C library"  ON)
option(OMNISCOPE_BUILD_LOGGER "Build OmniScope Logger library" ON)
option(OMNISCOPE_BUILD_RMBAG  "Build OmniScope RMBag library"  ON)
option(OMNISCOPE_BUILD_CALIBRATION "Build OmniScope Calibration tools" ON)
option(OMNISCOPE_BUILD_TOOLS       "Build OmniScope Robot tools & simulators" ON)

set(OMNISCOPE_EXPORTED_TARGETS "")

# 1. 核心与单片机接口模块
if(OMNISCOPE_BUILD_CORE)
    add_subdirectory(core)
    list(APPEND OMNISCOPE_EXPORTED_TARGETS omniscope_core)
endif()

if(OMNISCOPE_BUILD_MCU)
    add_subdirectory(mcu)
    list(APPEND OMNISCOPE_EXPORTED_TARGETS omniscope_mcu)
endif()

# 2. 遥测日志模块与 RMBag 录放模块
if(OMNISCOPE_BUILD_LOGGER)
    add_subdirectory(logger)
    list(APPEND OMNISCOPE_EXPORTED_TARGETS omniscope_logger)
endif()

if(OMNISCOPE_BUILD_RMBAG)
    add_subdirectory(rmbag)
    list(APPEND OMNISCOPE_EXPORTED_TARGETS omniscope_rmbag)
endif()

# 3. 相机标定与配套调试仿真工具
if(OMNISCOPE_BUILD_CALIBRATION)
    add_subdirectory(calibration)
    list(APPEND OMNISCOPE_EXPORTED_TARGETS omniscope_calibrator)
endif()

if(OMNISCOPE_BUILD_TOOLS)
    add_subdirectory(tools)
endif()

# 3. 统一聚合目标 OmniScope::All
add_library(omniscope_all INTERFACE)
add_library(OmniScope::All ALIAS omniscope_all)
list(APPEND OMNISCOPE_EXPORTED_TARGETS omniscope_all)

foreach(_tgt IN LISTS OMNISCOPE_EXPORTED_TARGETS)
    if(TARGET ${_tgt} AND NOT ${_tgt} STREQUAL "omniscope_all")
        target_link_libraries(omniscope_all INTERFACE ${_tgt})
    endif()
endforeach()

# 4. 注册 Export Set 并安装目标
install(TARGETS ${OMNISCOPE_EXPORTED_TARGETS}
    EXPORT OmniScopeTargets
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
    INCLUDES DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
)

# 5. 构建树内直接导出 (Build-tree export)
export(EXPORT OmniScopeTargets
    FILE "${CMAKE_CURRENT_BINARY_DIR}/OmniScopeTargets.cmake"
    NAMESPACE OmniScope::
)

# 6. 生成 Package 配置文件 (OmniScopeConfig.cmake & OmniScopeConfigVersion.cmake)
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

# 7. 安装头文件与 CMake package 配置文件
if(OMNISCOPE_BUILD_CORE)
    install(DIRECTORY core/include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
endif()

if(OMNISCOPE_BUILD_MCU)
    install(DIRECTORY mcu/include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
endif()

if(OMNISCOPE_BUILD_LOGGER)
    install(DIRECTORY logger/include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
endif()

if(OMNISCOPE_BUILD_RMBAG)
    install(DIRECTORY rmbag/include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
endif()

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
