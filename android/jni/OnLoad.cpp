#include <DefaultComponentsRegistry.h>
#include <DefaultTurboModuleManagerDelegate.h>
#include <FBReactNativeSpec.h>
#include <autolinking.h>
#include <fbjni/fbjni.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>

#include "FlypathHermesInstance.h"
#include "FlypathInsets.h"
#include "FlypathModule.h"

namespace facebook::react {

namespace {

void installInsetsSource() {
  facebook::jni::ThreadScope scope;
  static const auto clazz =
      facebook::jni::findClassStatic("dev/flypath/FlypathInsets");
  static const auto method = clazz->getStaticMethod<void()>("install");
  method(clazz);
}

void registerComponents(
    std::shared_ptr<const ComponentDescriptorProviderRegistry> registry) {
  autolinking_registerProviders(registry);
}

std::shared_ptr<TurboModule> cxxModuleProvider(
    const std::string& name,
    const std::shared_ptr<CallInvoker>& jsInvoker) {
  if (auto module = flypath::FlypathModule::provider(name, jsInvoker)) {
    return module;
  }
  if (auto insets = flypath::FlypathInsetsModule::provider(name, jsInvoker)) {
    return insets;
  }
  return autolinking_cxxModuleProvider(name, jsInvoker);
}

std::shared_ptr<TurboModule> javaModuleProvider(
    const std::string& name,
    const JavaTurboModule::InitParams& params) {
  if (auto module = FBReactNativeSpec_ModuleProvider(name, params)) {
    return module;
  }
  return autolinking_ModuleProvider(name, params);
}

}  // namespace

}  // namespace facebook::react

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [] {
    flypath::FlypathHermesInstance::registerNatives();
    flypath::setInsetsInstaller(&facebook::react::installInsetsSource);
    facebook::react::DefaultTurboModuleManagerDelegate::cxxModuleProvider =
        &facebook::react::cxxModuleProvider;
    facebook::react::DefaultTurboModuleManagerDelegate::javaModuleProvider =
        &facebook::react::javaModuleProvider;
    facebook::react::DefaultComponentsRegistry::
        registerComponentDescriptorsFromEntryPoint =
            &facebook::react::registerComponents;
  });
}
