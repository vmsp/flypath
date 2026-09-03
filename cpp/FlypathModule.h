#pragma once

#include <ReactCommon/CallInvoker.h>
#include <ReactCommon/TurboModule.h>

#include <memory>
#include <string>

namespace flypath {

class FlypathModule : public facebook::react::TurboModule {
 public:
  static constexpr auto kModuleName = "Flypath";

  explicit FlypathModule(std::shared_ptr<facebook::react::CallInvoker> invoker);

  static facebook::jsi::Value installMethod(
      facebook::jsi::Runtime& runtime,
      facebook::react::TurboModule& turboModule,
      const facebook::jsi::Value* args,
      size_t count);

  static std::shared_ptr<facebook::react::TurboModule> provider(
      const std::string& name,
      const std::shared_ptr<facebook::react::CallInvoker>& invoker);
};

}  // namespace flypath
