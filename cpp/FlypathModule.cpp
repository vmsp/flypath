#include "FlypathModule.h"

#include <utility>

#include "FlypathRuntime.h"

namespace flypath {

using facebook::jsi::Runtime;
using facebook::jsi::Value;
using facebook::react::TurboModule;

Value FlypathModule::installMethod(Runtime& runtime, TurboModule& turboModule,
                                   const Value*, size_t) {
  static bool registered = false;
  if (!registered) {
    registered = true;
    FlypathRegisterAll();
  }
  install(runtime, static_cast<FlypathModule&>(turboModule).jsInvoker_);
  return Value(true);
}

FlypathModule::FlypathModule(
    std::shared_ptr<facebook::react::CallInvoker> invoker)
    : TurboModule(kModuleName, std::move(invoker)) {
  methodMap_["install"] = MethodMetadata{0, installMethod};
}

std::shared_ptr<TurboModule> FlypathModule::provider(
    const std::string& name,
    const std::shared_ptr<facebook::react::CallInvoker>& invoker) {
  if (name != kModuleName) return nullptr;
  return std::make_shared<FlypathModule>(invoker);
}

}  // namespace flypath
