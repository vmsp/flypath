plugins {
  id("com.android.library")
  id("org.jetbrains.kotlin.plugin.compose")
}

android {
  namespace = "dev.flypath"
  compileSdk = 37

  defaultConfig { minSdk = 24 }

  buildFeatures { compose = true }

  sourceSets {
    getByName("main") { kotlin.directories.add("__FLYPATH_ANDROID_DIR__") }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}

dependencies {
  implementation("com.facebook.react:react-android")
  implementation("com.facebook.react:hermes-android")
  api(platform("androidx.compose:compose-bom:2025.06.01"))
  api("androidx.compose.runtime:runtime")
  api("androidx.compose.ui:ui")
  api("androidx.appcompat:appcompat:1.7.0")
  api("androidx.activity:activity-compose:1.10.1")
}
