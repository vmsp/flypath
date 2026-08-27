#pragma once

#include <FlypathAbi.h>
#include <folly/dynamic.h>
#include <jsi/jsi.h>

#include <deque>
#include <list>
#include <string>
#include <utility>
#include <vector>

namespace flypath {

class Scope;

enum class Source { Args, Value, Dynamic };

struct In {
  Source source;
  facebook::jsi::Runtime* runtime;
  const facebook::jsi::Value* values;
  const folly::dynamic* dynamic;
  size_t count;
  Scope* scope;
};

class Scope {
 public:
  explicit Scope(facebook::jsi::Runtime& runtime) : runtime_(&runtime) {}

  Scope() : runtime_(nullptr) {}

  In* root(const facebook::jsi::Value* values, size_t count);
  In* child(facebook::jsi::Value&& value);
  In* wrap(const folly::dynamic* value);
  const char* text(std::string&& value, size_t* length);
  const uint8_t* bytes(std::vector<uint8_t>&& value, size_t* length);

 private:
  facebook::jsi::Runtime* runtime_;
  std::deque<In> ins_;
  std::deque<facebook::jsi::Value> values_;
  std::deque<std::string> strings_;
  std::deque<std::vector<uint8_t>> buffers_;
};

struct Out {
  enum class Kind {
    Undefined,
    Null,
    Bool,
    Number,
    String,
    Bytes,
    Array,
    Object,
  };

  Kind kind = Kind::Undefined;
  bool boolean = false;
  double number = 0;
  std::string text;
  std::vector<uint8_t> bytes;
  std::vector<Out> items;
  std::list<std::pair<std::string, Out>> fields;
};

facebook::jsi::Value toValue(facebook::jsi::Runtime& runtime, const Out& out);

folly::dynamic toDynamic(const Out& out);

}  // namespace flypath
