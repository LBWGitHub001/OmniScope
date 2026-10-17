cmake_minimum_required(VERSION 3.16)
project(omniscope_mcu C CXX)

add_library(omniscope_mcu
    src/mailbox.c
)

add_library(OmniScope::MCU ALIAS omniscope_mcu)

target_include_directories(omniscope_mcu
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>
)

target_compile_features(omniscope_mcu PUBLIC c_std_99)
