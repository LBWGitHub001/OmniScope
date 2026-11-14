# OmniScope Embedded SDK — STM32 / FreeRTOS / 裸机纯 C99 SWD 邮箱与高速迹缓冲
#
# 用户工程链接 OmniScope::Embedded 即选择嵌入式版本。

add_library(omniscope_embedded STATIC
    src/mailbox.c
    src/instances.c
)
add_library(OmniScope::Embedded ALIAS omniscope_embedded)

target_compile_features(omniscope_embedded PUBLIC c_std_99)
set_target_properties(omniscope_embedded PROPERTIES EXPORT_NAME Embedded)

target_include_directories(omniscope_embedded PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
)

install(TARGETS omniscope_embedded
    EXPORT OmniScopeTargets
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    INCLUDES DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
)
install(DIRECTORY include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
