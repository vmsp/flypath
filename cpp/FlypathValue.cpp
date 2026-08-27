#include "FlypathValue.h"

#include <cstring>
#include <utility>

namespace flypath {

using facebook::jsi::Array;
using facebook::jsi::ArrayBuffer;
using facebook::jsi::Object;
using facebook::jsi::PropNameID;
using facebook::jsi::Runtime;
using facebook::jsi::String;
using facebook::jsi::Value;

In* Scope::root(const Value* values, size_t count) {
  ins_.push_back(In{Source::Args, runtime_, values, nullptr, count, this});
  return &ins_.back();
}

In* Scope::child(Value&& value) {
  values_.push_back(std::move(value));
  ins_.push_back(
      In{Source::Value, runtime_, &values_.back(), nullptr, 1, this});
  return &ins_.back();
}

In* Scope::wrap(const folly::dynamic* value) {
  ins_.push_back(In{Source::Dynamic, nullptr, nullptr, value, 1, this});
  return &ins_.back();
}

const char* Scope::text(std::string&& value, size_t* length) {
  strings_.push_back(std::move(value));
  if (length != nullptr) *length = strings_.back().size();
  return strings_.back().c_str();
}

const uint8_t* Scope::bytes(std::vector<uint8_t>&& value, size_t* length) {
  buffers_.push_back(std::move(value));
  if (length != nullptr) *length = buffers_.back().size();
  return buffers_.back().data();
}

Value toValue(Runtime& runtime, const Out& out) {
  switch (out.kind) {
    case Out::Kind::Undefined:
      return Value::undefined();
    case Out::Kind::Null:
      return Value::null();
    case Out::Kind::Bool:
      return Value(out.boolean);
    case Out::Kind::Number:
      return Value(out.number);
    case Out::Kind::String:
      return Value(String::createFromUtf8(runtime, out.text));
    case Out::Kind::Bytes: {
      auto buffer =
          runtime.global()
              .getPropertyAsFunction(runtime, "ArrayBuffer")
              .callAsConstructor(runtime,
                                 Value(static_cast<double>(out.bytes.size())))
              .getObject(runtime)
              .getArrayBuffer(runtime);
      if (!out.bytes.empty()) {
        std::memcpy(buffer.data(runtime), out.bytes.data(), out.bytes.size());
      }
      return Value(std::move(buffer));
    }
    case Out::Kind::Array: {
      Array array(runtime, out.items.size());
      size_t index = 0;
      for (const Out& item : out.items) {
        array.setValueAtIndex(runtime, index, toValue(runtime, item));
        index += 1;
      }
      return Value(std::move(array));
    }
    case Out::Kind::Object: {
      Object object(runtime);
      for (const auto& field : out.fields) {
        object.setProperty(runtime, PropNameID::forUtf8(runtime, field.first),
                           toValue(runtime, field.second));
      }
      return Value(std::move(object));
    }
  }
  return Value::undefined();
}

folly::dynamic toDynamic(const Out& out) {
  switch (out.kind) {
    case Out::Kind::Undefined:
    case Out::Kind::Null:
      return nullptr;
    case Out::Kind::Bool:
      return out.boolean;
    case Out::Kind::Number:
      return out.number;
    case Out::Kind::String:
      return out.text;
    case Out::Kind::Bytes:
      return folly::dynamic::array();
    case Out::Kind::Array: {
      folly::dynamic array = folly::dynamic::array();
      for (const Out& item : out.items) array.push_back(toDynamic(item));
      return array;
    }
    case Out::Kind::Object: {
      folly::dynamic object = folly::dynamic::object();
      for (const auto& field : out.fields) {
        object[field.first] = toDynamic(field.second);
      }
      return object;
    }
  }
  return nullptr;
}

}  // namespace flypath

using flypath::In;
using flypath::Out;
using flypath::Source;

namespace {

const In* in(FlypathValueRef value) {
  return reinterpret_cast<const In*>(value);
}

const folly::dynamic* dyn(const In* node) { return node->dynamic; }

}  // namespace

extern "C" {

size_t flypath_count(FlypathValueRef value) {
  const In* node = in(value);
  if (node->source == Source::Args) return node->count;
  if (node->source == Source::Dynamic) {
    const folly::dynamic* item = dyn(node);
    return item != nullptr && item->isArray() ? item->size() : 0;
  }
  if (!node->values->isObject()) return 0;
  facebook::jsi::Object object = node->values->getObject(*node->runtime);
  if (!object.isArray(*node->runtime)) return 0;
  return object.getArray(*node->runtime).size(*node->runtime);
}

FlypathValueRef flypath_at(FlypathValueRef value, size_t index) {
  const In* node = in(value);
  if (node->source == Source::Dynamic) {
    const folly::dynamic* item = dyn(node);
    return reinterpret_cast<FlypathValueRef>(node->scope->wrap(
        item == nullptr || !item->isArray() || index >= item->size()
            ? nullptr
            : &(*item)[index]));
  }
  if (node->source == Source::Args) {
    return reinterpret_cast<FlypathValueRef>(node->scope->child(
        facebook::jsi::Value(*node->runtime, node->values[index])));
  }
  facebook::jsi::Array array =
      node->values->getObject(*node->runtime).getArray(*node->runtime);
  return reinterpret_cast<FlypathValueRef>(
      node->scope->child(array.getValueAtIndex(*node->runtime, index)));
}

FlypathValueRef flypath_field(FlypathValueRef value, const char* name) {
  const In* node = in(value);
  if (node->source == Source::Dynamic) {
    const folly::dynamic* item = dyn(node);
    const folly::dynamic* field =
        item != nullptr && item->isObject() ? item->get_ptr(name) : nullptr;
    return reinterpret_cast<FlypathValueRef>(node->scope->wrap(field));
  }
  facebook::jsi::Object object = node->values->getObject(*node->runtime);
  return reinterpret_cast<FlypathValueRef>(
      node->scope->child(object.getProperty(*node->runtime, name)));
}

bool flypath_is_null(FlypathValueRef value) {
  const In* node = in(value);
  if (node->source == Source::Dynamic) {
    const folly::dynamic* item = dyn(node);
    return item == nullptr || item->isNull();
  }
  const facebook::jsi::Value& item = *node->values;
  return item.isNull() || item.isUndefined();
}

bool flypath_bool(FlypathValueRef value) {
  const In* node = in(value);
  if (node->source == Source::Dynamic) {
    const folly::dynamic* item = dyn(node);
    return item != nullptr && item->isBool() ? item->getBool() : false;
  }
  const facebook::jsi::Value& item = *node->values;
  return item.isBool() ? item.getBool() : false;
}

double flypath_number(FlypathValueRef value) {
  const In* node = in(value);
  if (node->source == Source::Dynamic) {
    const folly::dynamic* item = dyn(node);
    if (item == nullptr) return 0;
    if (item->isDouble()) return item->getDouble();
    if (item->isInt()) return static_cast<double>(item->getInt());
    return 0;
  }
  const facebook::jsi::Value& item = *node->values;
  return item.isNumber() ? item.getNumber() : 0;
}

const char* flypath_string(FlypathValueRef value, size_t* length) {
  const In* node = in(value);
  if (node->source == Source::Dynamic) {
    const folly::dynamic* item = dyn(node);
    return node->scope->text(item != nullptr && item->isString()
                                 ? std::string(item->getString())
                                 : std::string(),
                             length);
  }
  const facebook::jsi::Value& item = *node->values;
  if (!item.isString()) return node->scope->text(std::string(), length);
  return node->scope->text(item.getString(*node->runtime).utf8(*node->runtime),
                           length);
}

const uint8_t* flypath_bytes(FlypathValueRef value, size_t* length) {
  const In* node = in(value);
  if (node->source == Source::Dynamic) return node->scope->bytes({}, length);
  const facebook::jsi::Value& item = *node->values;
  if (!item.isObject()) return node->scope->bytes({}, length);
  facebook::jsi::Object object = item.getObject(*node->runtime);
  if (!object.isArrayBuffer(*node->runtime)) {
    return node->scope->bytes({}, length);
  }
  facebook::jsi::ArrayBuffer buffer = object.getArrayBuffer(*node->runtime);
  const uint8_t* data = buffer.data(*node->runtime);
  return node->scope->bytes(
      std::vector<uint8_t>(data, data + buffer.size(*node->runtime)), length);
}

void flypath_out_null(FlypathOutRef out) {
  reinterpret_cast<Out*>(out)->kind = Out::Kind::Null;
}

void flypath_out_bool(FlypathOutRef out, bool value) {
  Out* target = reinterpret_cast<Out*>(out);
  target->kind = Out::Kind::Bool;
  target->boolean = value;
}

void flypath_out_number(FlypathOutRef out, double value) {
  Out* target = reinterpret_cast<Out*>(out);
  target->kind = Out::Kind::Number;
  target->number = value;
}

void flypath_out_string(FlypathOutRef out, const char* value, size_t length) {
  Out* target = reinterpret_cast<Out*>(out);
  target->kind = Out::Kind::String;
  target->text.assign(value, length);
}

void flypath_out_bytes(FlypathOutRef out, const uint8_t* value, size_t length) {
  Out* target = reinterpret_cast<Out*>(out);
  target->kind = Out::Kind::Bytes;
  target->bytes.assign(value, value + length);
}

FlypathOutRef flypath_out_array(FlypathOutRef out, size_t count) {
  Out* target = reinterpret_cast<Out*>(out);
  target->kind = Out::Kind::Array;
  target->items.resize(count);
  return out;
}

FlypathOutRef flypath_out_element(FlypathOutRef array, size_t index) {
  return reinterpret_cast<FlypathOutRef>(
      &reinterpret_cast<Out*>(array)->items[index]);
}

FlypathOutRef flypath_out_object(FlypathOutRef out) {
  reinterpret_cast<Out*>(out)->kind = Out::Kind::Object;
  return out;
}

FlypathOutRef flypath_out_field(FlypathOutRef object, const char* name) {
  Out* target = reinterpret_cast<Out*>(object);
  target->fields.push_back({std::string(name), Out{}});
  return reinterpret_cast<FlypathOutRef>(&target->fields.back().second);
}

}  // extern "C"
