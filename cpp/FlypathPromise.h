#pragma once

#include <FlypathAbi.h>
#include <ReactCommon/CallInvoker.h>
#include <jsi/jsi.h>

#include <atomic>
#include <memory>

#include "FlypathValue.h"

namespace flypath {

class Promise {
 public:
  static facebook::jsi::Value create(
      facebook::jsi::Runtime& runtime,
      const std::shared_ptr<facebook::react::CallInvoker>& invoker,
      Promise** handle);

  Out& out() { return out_; }

  void resolve();
  void reject(std::string&& message);

 private:
  Promise(std::shared_ptr<facebook::jsi::Function> resolve,
          std::shared_ptr<facebook::jsi::Function> reject,
          std::shared_ptr<facebook::react::CallInvoker> invoker)
      : resolve_(std::move(resolve)),
        reject_(std::move(reject)),
        invoker_(std::move(invoker)) {}

  std::shared_ptr<facebook::jsi::Function> resolve_;
  std::shared_ptr<facebook::jsi::Function> reject_;
  std::shared_ptr<facebook::react::CallInvoker> invoker_;
  std::atomic<bool> settled_{false};
  Out out_;
};

}  // namespace flypath
