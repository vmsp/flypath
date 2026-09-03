#include "FlypathInsets.h"

#include <mutex>
#include <utility>

namespace flypath {
namespace {

std::mutex& lock() {
  static std::mutex mutex;
  return mutex;
}

Insets& store() {
  static Insets insets;
  return insets;
}

InsetsInstaller& installer() {
  static InsetsInstaller hook = nullptr;
  return hook;
}

std::weak_ptr<FlypathInsetsModule>& live() {
  static std::weak_ptr<FlypathInsetsModule> module;
  return module;
}

bool same(const Insets& a, const Insets& b) {
  return a.top == b.top && a.bottom == b.bottom && a.left == b.left &&
         a.right == b.right;
}

facebook::jsi::Value describe(facebook::jsi::Runtime& runtime,
                              const Insets& insets) {
  facebook::jsi::Object result(runtime);
  result.setProperty(runtime, "top", facebook::jsi::Value(insets.top));
  result.setProperty(runtime, "bottom", facebook::jsi::Value(insets.bottom));
  result.setProperty(runtime, "left", facebook::jsi::Value(insets.left));
  result.setProperty(runtime, "right", facebook::jsi::Value(insets.right));
  return facebook::jsi::Value(runtime, result);
}

}  // namespace

using facebook::jsi::Runtime;
using facebook::jsi::Value;
using facebook::react::TurboModule;

void setInsetsInstaller(InsetsInstaller hook) {
  installer() = hook;
}

Insets currentInsets() {
  std::lock_guard<std::mutex> guard(lock());
  return store();
}

void publishInsets(const Insets& insets) {
  std::shared_ptr<FlypathInsetsModule> module;
  {
    std::lock_guard<std::mutex> guard(lock());
    if (same(store(), insets))
      return;
    store() = insets;
    module = live().lock();
  }
  if (module)
    module->emit();
}

Value FlypathInsetsModule::getInsetsMethod(Runtime& runtime,
                                           TurboModule&,
                                           const Value*,
                                           size_t) {
  return describe(runtime, currentInsets());
}

Value FlypathInsetsModule::observeMethod(Runtime& runtime,
                                         TurboModule& turboModule,
                                         const Value* args,
                                         size_t count) {
  auto& module = static_cast<FlypathInsetsModule&>(turboModule);
  if (count == 0 || !args[0].isObject() ||
      !args[0].getObject(runtime).isFunction(runtime)) {
    module.listener_.reset();
    return Value::undefined();
  }
  module.listener_ = std::make_shared<facebook::jsi::Function>(
      args[0].getObject(runtime).getFunction(runtime));
  module.listener_->call(runtime, describe(runtime, currentInsets()));
  return Value::undefined();
}

void FlypathInsetsModule::emit() {
  std::weak_ptr<FlypathInsetsModule> self = weak_from_this();
  jsInvoker_->invokeAsync([self](Runtime& runtime) {
    auto module = self.lock();
    if (!module || !module->listener_)
      return;
    module->listener_->call(runtime, describe(runtime, currentInsets()));
  });
}

FlypathInsetsModule::FlypathInsetsModule(
    std::shared_ptr<facebook::react::CallInvoker> invoker)
    : TurboModule(kModuleName, std::move(invoker)) {
  methodMap_["getInsets"] = MethodMetadata{0, getInsetsMethod};
  methodMap_["observe"] = MethodMetadata{1, observeMethod};
  if (auto hook = installer())
    hook();
}

std::shared_ptr<TurboModule> FlypathInsetsModule::provider(
    const std::string& name,
    const std::shared_ptr<facebook::react::CallInvoker>& invoker) {
  if (name != kModuleName)
    return nullptr;
  auto module = std::make_shared<FlypathInsetsModule>(invoker);
  {
    std::lock_guard<std::mutex> guard(lock());
    live() = module;
  }
  return module;
}

}  // namespace flypath
