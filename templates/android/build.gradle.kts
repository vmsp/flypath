buildscript {
  repositories {
    google()
    mavenCentral()
  }
  dependencies {
    classpath("com.android.tools.build:gradle:9.2.1")
  }
}

plugins {
  id("com.facebook.react.rootproject")
  id("org.jetbrains.kotlin.plugin.compose") version "2.2.10" apply false
}
