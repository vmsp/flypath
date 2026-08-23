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

rootProject.name = "__FLYPATH_APP_NAME__"
include(":app")
