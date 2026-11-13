cmake_minimum_required(VERSION 3.16)
project(omniscope_sdk VERSION 1.0.0 LANGUAGES C CXX)

include(GNUInstallDirs)
include(CMakePackageConfigHelpers)

# 同一配置内同时提供两个版本；用户工程通过链接目标选择：
#   target_link_libraries(robot_node PRIVATE OmniScope::Cpp)       # 主机端 C++17 遥测/标记/录放
#   target_link_libraries(mcu_fw     PRIVATE OmniScope::Embedded)  # 单片机纯 C99 SWD 邮箱
add_subdirectory(cpp)
add_subdirectory(embedded)

# -----------------------------------------------------------------------------
# 安装与导出配置
# -----------------------------------------------------------------------------
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
