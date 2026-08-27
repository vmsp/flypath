#include "FlypathHermesInstance.h"

namespace flypath {

facebook::jni::local_ref<FlypathHermesInstance::jhybriddata>
FlypathHermesInstance::initHybrid(facebook::jni::alias_ref<jclass>) {
  return makeCxxInstance();
}

void FlypathHermesInstance::registerNatives() {
  registerHybrid({
      makeNativeMethod("initHybrid", FlypathHermesInstance::initHybrid),
  });
}

std::unique_ptr<facebook::react::JSRuntime>
FlypathHermesInstance::createJSRuntime(
    std::shared_ptr<facebook::react::MessageQueueThread>
        msgQueueThread) noexcept {
  return factory_.createJSRuntime(std::move(msgQueueThread));
}

}  // namespace flypath
