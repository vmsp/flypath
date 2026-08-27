plugins {
  id("com.android.application")
  id("com.facebook.react")
  id("org.jetbrains.kotlin.plugin.compose") version "2.2.10"
}

react {
  root = file("__FLYPATH_PROJECT_ROOT__")
  reactNativeDir = file("__FLYPATH_RN_DIR__")
  autolinkLibrariesWithApp()
}

android {
  namespace = "__FLYPATH_PACKAGE__"
  compileSdk = 37

  defaultConfig {
    applicationId = "__FLYPATH_PACKAGE__"
    minSdk = 24
    targetSdk = 36
    versionCode = 1
    versionName = "1.0"
  }

  signingConfigs {
    getByName("debug") {
      storeFile = file("debug.keystore")
      storePassword = "android"
      keyAlias = "androiddebugkey"
      keyPassword = "android"
    }
  }

  buildTypes {
    getByName("debug") {
      signingConfig = signingConfigs.getByName("debug")
    }
    getByName("release") {
      isMinifyEnabled = false
      signingConfig = signingConfigs.getByName("debug")
    }
  }

  buildFeatures {
    compose = true
  }

  sourceSets {
    getByName("main") {
      kotlin.directories.add("__FLYPATH_KIT_DIR__")
      kotlin.directories.add("__FLYPATH_REACT_KIT_DIR__")
__FLYPATH_KOTLIN_SRC_DIRS__
    }
  }

  externalNativeBuild {
    cmake {
      path = file("src/main/jni/CMakeLists.txt")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}

dependencies {
  implementation("com.facebook.react:react-android")
  implementation("com.facebook.react:hermes-android")
  implementation(platform("androidx.compose:compose-bom:2025.06.01"))
  implementation("androidx.compose.runtime:runtime")
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.foundation:foundation")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.activity:activity-compose:1.10.1")
}
