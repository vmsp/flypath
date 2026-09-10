-keep class dev.flypath.** { *; }
-keep class __FLYPATH_PACKAGE__.** { *; }

-keep class * implements com.facebook.react.bridge.NativeModule { *; }
-keep class * implements com.facebook.react.turbomodule.core.interfaces.TurboModule { *; }
-keep class * extends com.facebook.react.uimanager.ViewManager { *; }
-keep class * extends com.facebook.react.uimanager.ViewGroupManager { *; }
-keep class * implements com.facebook.react.bridge.ReactModuleWithSpec { *; }
-keep @com.facebook.react.module.annotations.ReactModule class * { *; }

-keepclassmembers class * {
  @com.facebook.react.bridge.ReactMethod *;
  @com.facebook.react.uimanager.annotations.ReactProp *;
  @com.facebook.react.uimanager.annotations.ReactPropGroup *;
}

-keepclasseswithmembernames class * {
  native <methods>;
}

-dontwarn com.facebook.react.**
