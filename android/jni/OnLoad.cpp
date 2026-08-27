#include <DefaultComponentsRegistry.h>
#include <DefaultTurboModuleManagerDelegate.h>
#include <FBReactNativeSpec.h>
#include <autolinking.h>
#include <fbjni/fbjni.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>

#include "FlypathHermesInstance.h"
#include "FlypathModule.h"

namespace facebook::react {

namespace {

void registerComponents(
    std::shared_ptr<const ComponentDescriptorProviderRegistry> registry) {
  autolinking_registerProviders(registry);
}

std::shared_ptr<TurboModule> cxxModuleProvider(
    const std::string& name, const std::shared_ptr<CallInvoker>& jsInvoker) {
  if (auto module = flypath::FlypathModule::provider(name, jsInvoker)) {
    return module;
  }
  return autolinking_cxxModuleProvider(name, jsInvoker);
}

std::shared_ptr<TurboModule> javaModuleProvider(
    const std::string& name, const JavaTurboModule::InitParams& params) {
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
    facebook::react::DefaultTurboModuleManagerDelegate::cxxModuleProvider =
        &facebook::react::cxxModuleProvider;
    facebook::react::DefaultTurboModuleManagerDelegate::javaModuleProvider =
        &facebook::react::javaModuleProvider;
    facebook::react::DefaultComponentsRegistry::
        registerComponentDescriptorsFromEntryPoint =
            &facebook::react::registerComponents;
  });
}
