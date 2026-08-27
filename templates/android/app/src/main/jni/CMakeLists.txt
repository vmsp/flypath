cmake_minimum_required(VERSION 3.13)

project(appmodules)

include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

find_package(hermes-engine REQUIRED CONFIG)

target_include_directories(${CMAKE_PROJECT_NAME}
  PRIVATE
    "__FLYPATH_RN_DIR__/ReactAndroid/src/main/jni/react/runtime/jni")

target_link_libraries(${CMAKE_PROJECT_NAME}
  ReactAndroid::hermestooling
  hermes-engine::hermesvm)
