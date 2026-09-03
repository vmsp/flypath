#include "FlypathPromise.h"

#include <utility>

namespace flypath {

using facebook::jsi::Function;
using facebook::jsi::PropNameID;
using facebook::jsi::Runtime;
using facebook::jsi::String;
using facebook::jsi::Value;

Value Promise::create(
    Runtime& runtime,
    const std::shared_ptr<facebook::react::CallInvoker>& invoker,
    Promise** handle) {
  auto slot = std::make_shared<Promise*>(nullptr);
  Function executor = Function::createFromHostFunction(
      runtime, PropNameID::forAscii(runtime, "executor"), 2,
      [slot, invoker](Runtime& rt, const Value&, const Value* args,
                      size_t count) -> Value {
        if (count < 2)
          return Value::undefined();
        auto resolve =
            std::make_shared<Function>(args[0].getObject(rt).getFunction(rt));
        auto reject =
            std::make_shared<Function>(args[1].getObject(rt).getFunction(rt));
        *slot = new Promise(std::move(resolve), std::move(reject), invoker);
        return Value::undefined();
      });

  Value promise = runtime.global()
                      .getPropertyAsFunction(runtime, "Promise")
                      .callAsConstructor(runtime, executor);
  *handle = *slot;
  return promise;
}

void Promise::resolve() {
  if (settled_.exchange(true))
    return;
  invoker_->invokeAsync([this](Runtime& runtime) {
    resolve_->call(runtime, toValue(runtime, out_));
    delete this;
  });
}

void Promise::reject(std::string&& message) {
  if (settled_.exchange(true))
    return;
  invoker_->invokeAsync([this, text = std::move(message)](Runtime& runtime) {
    Value error =
        runtime.global()
            .getPropertyAsFunction(runtime, "Error")
            .callAsConstructor(runtime, String::createFromUtf8(runtime, text));
    reject_->call(runtime, error);
    delete this;
  });
}

}  // namespace flypath

extern "C" {

FlypathOutRef flypath_promise_out(FlypathPromiseRef promise) {
  return reinterpret_cast<FlypathOutRef>(
      &reinterpret_cast<flypath::Promise*>(promise)->out());
}

void flypath_promise_resolve(FlypathPromiseRef promise) {
  reinterpret_cast<flypath::Promise*>(promise)->resolve();
}

void flypath_promise_reject(FlypathPromiseRef promise,
                            const char* message,
                            size_t length) {
  reinterpret_cast<flypath::Promise*>(promise)->reject(
      std::string(message, length));
}

}  // extern "C"
