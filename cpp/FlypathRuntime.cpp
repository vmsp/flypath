#include "FlypathRuntime.h"

#include <utility>

#include "FlypathPromise.h"
#include "FlypathValue.h"

namespace flypath {

using facebook::jsi::Array;
using facebook::jsi::Function;
using facebook::jsi::Object;
using facebook::jsi::PropNameID;
using facebook::jsi::Runtime;
using facebook::jsi::String;
using facebook::jsi::Value;

Registry& Registry::shared() {
  static Registry registry;
  return registry;
}

Module& Registry::module(const char* id) {
  for (Module& existing : modules) {
    if (existing.id == id) return existing;
  }
  modules.push_back(Module{std::string(id), {}});
  return modules.back();
}

namespace {

Value bind(Runtime& runtime,
           const std::shared_ptr<facebook::react::CallInvoker>& invoker,
           const Binding& binding) {
  if (binding.async != nullptr) {
    FlypathAsyncCall call = binding.async;
    return Value(Function::createFromHostFunction(
        runtime, PropNameID::forUtf8(runtime, binding.name), binding.arity,
        [call, invoker](Runtime& rt, const Value&, const Value* args,
                        size_t count) -> Value {
          Scope scope(rt);
          Promise* promise = nullptr;
          Value result = Promise::create(rt, invoker, &promise);
          call(reinterpret_cast<FlypathValueRef>(scope.root(args, count)),
               reinterpret_cast<FlypathPromiseRef>(promise));
          return result;
        }));
  }

  FlypathCall call = binding.sync;
  return Value(Function::createFromHostFunction(
      runtime, PropNameID::forUtf8(runtime, binding.name), binding.arity,
      [call](Runtime& rt, const Value&, const Value* args,
             size_t count) -> Value {
        Scope scope(rt);
        Out out;
        call(reinterpret_cast<FlypathValueRef>(scope.root(args, count)),
             reinterpret_cast<FlypathOutRef>(&out));
        return toValue(rt, out);
      }));
}

}  // namespace

void install(Runtime& runtime,
             const std::shared_ptr<facebook::react::CallInvoker>& invoker) {
  Registry& registry = Registry::shared();

  Object modules(runtime);
  for (const Module& module : registry.modules) {
    Object exports(runtime);
    for (const Binding& binding : module.bindings) {
      exports.setProperty(runtime, PropNameID::forUtf8(runtime, binding.name),
                          bind(runtime, invoker, binding));
    }
    modules.setProperty(runtime, PropNameID::forUtf8(runtime, module.id),
                        std::move(exports));
  }

  Array components(runtime, registry.views.size());
  for (size_t index = 0; index < registry.views.size(); index += 1) {
    components.setValueAtIndex(
        runtime, index,
        String::createFromUtf8(runtime, registry.views[index].name));
  }

  Object native(runtime);
  native.setProperty(runtime, "hash",
                     String::createFromUtf8(runtime, registry.hash));
  native.setProperty(runtime, "modules", std::move(modules));
  native.setProperty(runtime, "components", std::move(components));

  Object root(runtime);
  root.setProperty(runtime, "native", std::move(native));
  runtime.global().setProperty(runtime, "__flypath", std::move(root));
}

}  // namespace flypath

extern "C" {

void flypath_register_hash(const char* hash) {
  flypath::Registry::shared().hash = hash;
}

void flypath_register_function(const char* module, const char* name,
                               size_t arity, FlypathCall call) {
  flypath::Registry::shared().module(module).bindings.push_back(
      flypath::Binding{std::string(name), arity, call, nullptr});
}

void flypath_register_async(const char* module, const char* name, size_t arity,
                            FlypathAsyncCall call) {
  flypath::Registry::shared().module(module).bindings.push_back(
      flypath::Binding{std::string(name), arity, nullptr, call});
}

void flypath_register_view(const char* name, FlypathViewCreate create) {
  flypath::Registry::shared().views.push_back(
      flypath::View{std::string(name), create});
}

FlypathViewCreate flypath_view_create(const char* name) {
  for (const flypath::View& view : flypath::Registry::shared().views) {
    if (view.name == name) return view.create;
  }
  return nullptr;
}

}  // extern "C"
