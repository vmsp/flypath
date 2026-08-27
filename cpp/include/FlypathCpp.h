#pragma once

#include <FlypathAbi.h>

#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace flypath {

inline void encode(FlypathOutRef out, bool value) {
  flypath_out_bool(out, value);
}

inline void encode(FlypathOutRef out, double value) {
  flypath_out_number(out, value);
}

inline void encode(FlypathOutRef out, const std::string& value) {
  flypath_out_string(out, value.data(), value.size());
}

inline void encode(FlypathOutRef out, const std::vector<uint8_t>& value) {
  flypath_out_bytes(out, value.data(), value.size());
}

template <typename T>
void encode(FlypathOutRef out, const std::vector<T>& value) {
  FlypathOutRef array = flypath_out_array(out, value.size());
  for (size_t index = 0; index < value.size(); index += 1) {
    encode(flypath_out_element(array, index), value[index]);
  }
}

template <typename T>
void encode(FlypathOutRef out, const std::optional<T>& value) {
  if (!value.has_value()) {
    flypath_out_null(out);
    return;
  }
  encode(out, *value);
}

inline void decode(FlypathValueRef value, bool& out) {
  out = flypath_bool(value);
}

inline void decode(FlypathValueRef value, double& out) {
  out = flypath_number(value);
}

inline void decode(FlypathValueRef value, std::string& out) {
  size_t length = 0;
  const char* text = flypath_string(value, &length);
  out.assign(text == nullptr ? "" : text, length);
}

inline void decode(FlypathValueRef value, std::vector<uint8_t>& out) {
  size_t length = 0;
  const uint8_t* data = flypath_bytes(value, &length);
  out.assign(data, data + length);
}

template <typename T>
void decode(FlypathValueRef value, std::vector<T>& out) {
  const size_t count = flypath_count(value);
  out.resize(count);
  for (size_t index = 0; index < count; index += 1) {
    decode(flypath_at(value, index), out[index]);
  }
}

template <typename T>
void decode(FlypathValueRef value, std::optional<T>& out) {
  if (flypath_is_null(value)) {
    out.reset();
    return;
  }
  T inner{};
  decode(value, inner);
  out = std::move(inner);
}

template <typename T>
T read(FlypathValueRef value) {
  T out{};
  decode(value, out);
  return out;
}

template <typename T>
class Promise {
 public:
  Promise() : state_(std::make_shared<State>()) {}

  void resolve(T value) const { state_->settle(std::move(value)); }

  void reject(std::string message) const { state_->fail(std::move(message)); }

  void bind(FlypathPromiseRef ref) const { state_->bind(ref); }

 private:
  struct State {
    std::mutex mutex;
    FlypathPromiseRef ref = nullptr;
    std::optional<T> value;
    std::optional<std::string> error;
    bool sent = false;

    void settle(T next) {
      std::lock_guard<std::mutex> guard(mutex);
      value = std::move(next);
      flush();
    }

    void fail(std::string message) {
      std::lock_guard<std::mutex> guard(mutex);
      error = std::move(message);
      flush();
    }

    void bind(FlypathPromiseRef target) {
      std::lock_guard<std::mutex> guard(mutex);
      ref = target;
      flush();
    }

    void flush() {
      if (sent || ref == nullptr) return;
      if (error.has_value()) {
        sent = true;
        flypath_promise_reject(ref, error->data(), error->size());
        return;
      }
      if (!value.has_value()) return;
      sent = true;
      encode(flypath_promise_out(ref), *value);
      flypath_promise_resolve(ref);
    }
  };

  std::shared_ptr<State> state_;
};

template <>
class Promise<void> {
 public:
  Promise() : state_(std::make_shared<State>()) {}

  void resolve() const { state_->settle(); }

  void reject(std::string message) const { state_->fail(std::move(message)); }

  void bind(FlypathPromiseRef ref) const { state_->bind(ref); }

 private:
  struct State {
    std::mutex mutex;
    FlypathPromiseRef ref = nullptr;
    bool done = false;
    std::optional<std::string> error;
    bool sent = false;

    void settle() {
      std::lock_guard<std::mutex> guard(mutex);
      done = true;
      flush();
    }

    void fail(std::string message) {
      std::lock_guard<std::mutex> guard(mutex);
      error = std::move(message);
      flush();
    }

    void bind(FlypathPromiseRef target) {
      std::lock_guard<std::mutex> guard(mutex);
      ref = target;
      flush();
    }

    void flush() {
      if (sent || ref == nullptr) return;
      if (error.has_value()) {
        sent = true;
        flypath_promise_reject(ref, error->data(), error->size());
        return;
      }
      if (!done) return;
      sent = true;
      flypath_promise_resolve(ref);
    }
  };

  std::shared_ptr<State> state_;
};

}  // namespace flypath
