#pragma once

#include <hermes/hermes.h>
#include <react/runtime/JSRuntimeFactory.h>

#if __has_include(<hermes/inspector-modern/chrome/HermesRuntimeTargetDelegate.h>)
#include <hermes/inspector-modern/chrome/HermesRuntimeTargetDelegate.h>
#else
#include <reacthermes/HermesRuntimeTargetDelegate.h>
#endif

#include <memory>
#include <optional>
#include <utility>

namespace flypath {

class HermesJSRuntime : public facebook::react::JSRuntime {
 public:
  HermesJSRuntime(std::shared_ptr<facebook::jsi::Runtime> runtime,
                  facebook::hermes::HermesRuntime& hermesRuntime)
      : runtime_(std::move(runtime)), hermesRuntime_(hermesRuntime) {}

  facebook::jsi::Runtime& getRuntime() noexcept override { return *runtime_; }

  facebook::react::jsinspector_modern::RuntimeTargetDelegate&
  getRuntimeTargetDelegate() override {
    if (!targetDelegate_) {
      targetDelegate_.emplace(runtime_, hermesRuntime_);
    }
    return *targetDelegate_;
  }

  void unstable_initializeOnJsThread() override {
    hermesRuntime_.registerForProfiling();
  }

 private:
  std::shared_ptr<facebook::jsi::Runtime> runtime_;
  facebook::hermes::HermesRuntime& hermesRuntime_;
  std::optional<
      facebook::react::jsinspector_modern::HermesRuntimeTargetDelegate>
      targetDelegate_;
};

class HermesRuntimeFactory : public facebook::react::JSRuntimeFactory {
 public:
  std::unique_ptr<facebook::react::JSRuntime> createJSRuntime(
      std::shared_ptr<facebook::react::MessageQueueThread>
          msgQueueThread) noexcept override {
    (void)msgQueueThread;

    auto gcConfig = ::hermes::vm::GCConfig::Builder()
                        .withMaxHeapSize(3072 << 20)
                        .withName("Flypath");

    auto config = ::hermes::vm::RuntimeConfig::Builder()
                      .withGCConfig(gcConfig.build())
                      .withEnableSampleProfiling(true)
                      .withMicrotaskQueue(true)
                      .withES6BlockScoping(true)
                      .build();

    std::unique_ptr<facebook::hermes::HermesRuntime> runtime =
        facebook::hermes::makeHermesRuntime(config);

    auto errorPrototype = runtime->global()
                              .getPropertyAsObject(*runtime, "Error")
                              .getPropertyAsObject(*runtime, "prototype");
    errorPrototype.setProperty(*runtime, "jsEngine", "hermes");

    facebook::hermes::HermesRuntime& ref = *runtime;
    return std::make_unique<HermesJSRuntime>(std::move(runtime), ref);
  }
};

inline facebook::react::JSRuntimeFactory* CreateHermesRuntimeFactory() {
  return new HermesRuntimeFactory();
}

}  // namespace flypath
