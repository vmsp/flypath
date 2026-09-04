plugins {
  id("com.android.library")
  id("org.jetbrains.kotlin.plugin.compose")
}

android {
  namespace = "dev.flypath.example.nativemodules"
  compileSdk = 37

  defaultConfig { minSdk = 24 }

  buildFeatures { compose = true }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}

dependencies {
  implementation(project(":flypath"))
  implementation("androidx.camera:camera-camera2:1.4.2")
  implementation("androidx.camera:camera-lifecycle:1.4.2")
  implementation("androidx.camera:camera-view:1.4.2")
  implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
}
