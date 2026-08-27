#pragma once

#include <FlypathAbi.h>
#include <ReactCommon/CallInvoker.h>
#include <jsi/jsi.h>

#include <memory>
#include <string>
#include <vector>

namespace flypath {

struct Binding {
  std::string name;
  size_t arity;
  FlypathCall sync;
  FlypathAsyncCall async;
};

struct Module {
  std::string id;
  std::vector<Binding> bindings;
};

struct View {
  std::string name;
  FlypathViewCreate create;
};

class Registry {
 public:
  static Registry& shared();

  Module& module(const char* id);

  std::string hash;
  std::vector<Module> modules;
  std::vector<View> views;
};

void install(facebook::jsi::Runtime& runtime,
             const std::shared_ptr<facebook::react::CallInvoker>& invoker);

}  // namespace flypath

extern "C" void FlypathRegisterAll(void);
