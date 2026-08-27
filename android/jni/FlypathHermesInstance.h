#pragma once

#include <fbjni/fbjni.h>
#include <jni.h>
#include <react/runtime/JSRuntimeFactory.h>

#include <memory>

#include "FlypathHermesRuntime.h"
#include "JJSRuntimeFactory.h"

namespace flypath {

class FlypathHermesInstance
    : public facebook::jni::HybridClass<FlypathHermesInstance,
                                        facebook::react::JJSRuntimeFactory> {
 public:
  static constexpr auto kJavaDescriptor =
      "Ldev/flypath/kit/FlypathHermesInstance;";

  static facebook::jni::local_ref<jhybriddata> initHybrid(
      facebook::jni::alias_ref<jclass>);

  static void registerNatives();

  std::unique_ptr<facebook::react::JSRuntime> createJSRuntime(
      std::shared_ptr<facebook::react::MessageQueueThread>
          msgQueueThread) noexcept;

 private:
  friend HybridBase;

  HermesRuntimeFactory factory_;
};

}  // namespace flypath
