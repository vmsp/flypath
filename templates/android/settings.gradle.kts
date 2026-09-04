pluginManagement {
  includeBuild("__FLYPATH_GRADLE_PLUGIN_DIR__")
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}

plugins {
  id("com.facebook.react.settings")
}

dependencyResolutionManagement {
  repositories {
    google()
    mavenCentral()
    maven { url = uri("__FLYPATH_RN_DIR__/android") }
  }
}

rootProject.name = "__FLYPATH_PROJECT_NAME__"

include(":flypath")

include(":native")

project(":native").projectDir = file("__FLYPATH_NATIVE_DIR__")

include(":app")
