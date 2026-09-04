plugins {
  id("com.android.application")
  id("com.facebook.react")
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
    minSdk = __FLYPATH_MIN_SDK__
    targetSdk = 36
    versionCode = __FLYPATH_BUILD__
    versionName = "__FLYPATH_VERSION__"
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
  implementation(project(":flypath"))
  implementation(project(":native"))
}

__FLYPATH_APP_GRADLE__
