#pragma once

#include <ReactCommon/CallInvoker.h>
#include <ReactCommon/TurboModule.h>

#include <memory>
#include <string>

namespace flypath {

struct Insets {
  double top = 0;
  double bottom = 0;
  double left = 0;
  double right = 0;
};

using InsetsInstaller = void (*)();

void setInsetsInstaller(InsetsInstaller installer);

void publishInsets(const Insets& insets);

Insets currentInsets();

class FlypathInsetsModule
    : public facebook::react::TurboModule,
      public std::enable_shared_from_this<FlypathInsetsModule> {
 public:
  static constexpr auto kModuleName = "FlypathInsets";

  explicit FlypathInsetsModule(
      std::shared_ptr<facebook::react::CallInvoker> invoker);

  static std::shared_ptr<facebook::react::TurboModule> provider(
      const std::string& name,
      const std::shared_ptr<facebook::react::CallInvoker>& invoker);

  void emit();

 private:
  static facebook::jsi::Value getInsetsMethod(
      facebook::jsi::Runtime& runtime,
      facebook::react::TurboModule& turboModule,
      const facebook::jsi::Value* args,
      size_t count);

  static facebook::jsi::Value observeMethod(
      facebook::jsi::Runtime& runtime,
      facebook::react::TurboModule& turboModule,
      const facebook::jsi::Value* args,
      size_t count);

  std::shared_ptr<facebook::jsi::Function> listener_;
};

}  // namespace flypath
