plugins {
  id("com.android.application")
  id("com.facebook.react")
}

react {
  root = file("__FLYPATH_PROJECT_ROOT__")
  reactNativeDir = file("__FLYPATH_RN_DIR__")
  debuggableVariants = listOf("debug", "release")
  autolinkLibrariesWithApp()
}

val keystoreProperties =
  java.util.Properties().apply {
    val file = file("__FLYPATH_NATIVE_DIR__/keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
  }

fun keystore(name: String): String? =
  System.getenv("FLYPATH_ANDROID_" + name.uppercase())
    ?: keystoreProperties.getProperty(name)

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
    create("release") {
      val store = keystore("storeFile")
      if (store != null) {
        storeFile = file(store)
        storePassword = keystore("storePassword")
        keyAlias = keystore("keyAlias")
        keyPassword = keystore("keyPassword")
      }
    }
  }

  buildTypes {
    getByName("debug") {
      signingConfig = signingConfigs.getByName("debug")
    }
    getByName("release") {
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(
        getDefaultProguardFile("proguard-android-optimize.txt"),
        file("__FLYPATH_RN_DIR__/ReactAndroid/proguard-rules.pro"),
        file("flypath-rules.pro"),
      )
      signingConfig =
        if (keystore("storeFile") != null) signingConfigs.getByName("release")
        else signingConfigs.getByName("debug")
    }
  }

  buildFeatures {
    buildConfig = true
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
