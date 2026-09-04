plugins {
  id("com.android.library")
  id("org.jetbrains.kotlin.plugin.compose")
}

android {
  namespace = "__FLYPATH_NATIVE_NAMESPACE__"
  compileSdk = 37

  defaultConfig { minSdk = 24 }

  buildFeatures { compose = true }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}

dependencies { implementation(project(":flypath")) }
