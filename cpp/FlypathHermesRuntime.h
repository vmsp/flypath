#pragma once

#include <react/runtime/JSRuntimeFactory.h>

#include <memory>

namespace flypath {

class HermesRuntimeFactory : public facebook::react::JSRuntimeFactory {
 public:
  std::unique_ptr<facebook::react::JSRuntime> createJSRuntime(
      std::shared_ptr<facebook::react::MessageQueueThread>
          msgQueueThread) noexcept override;
};

facebook::react::JSRuntimeFactory* CreateHermesRuntimeFactory();

}  // namespace flypath
