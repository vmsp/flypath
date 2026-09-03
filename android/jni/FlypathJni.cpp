#include <FlypathAbi.h>
#include <jni.h>

#include <string>
#include <vector>

#include "FlypathInsets.h"

namespace {

FlypathValueRef value(jlong ref) {
  return reinterpret_cast<FlypathValueRef>(static_cast<uintptr_t>(ref));
}

FlypathOutRef out(jlong ref) {
  return reinterpret_cast<FlypathOutRef>(static_cast<uintptr_t>(ref));
}

FlypathPromiseRef promise(jlong ref) {
  return reinterpret_cast<FlypathPromiseRef>(static_cast<uintptr_t>(ref));
}

jlong handle(void* pointer) {
  return static_cast<jlong>(reinterpret_cast<uintptr_t>(pointer));
}

std::string utf8(JNIEnv* env, jstring text) {
  const char* chars = env->GetStringUTFChars(text, nullptr);
  std::string copy(chars == nullptr ? "" : chars);
  if (chars != nullptr)
    env->ReleaseStringUTFChars(text, chars);
  return copy;
}

}  // namespace

extern "C" {

JNIEXPORT jint JNICALL Java_dev_flypath_FlypathAbi_count(JNIEnv*,
                                                         jclass,
                                                         jlong ref) {
  return static_cast<jint>(flypath_count(value(ref)));
}

JNIEXPORT jlong JNICALL Java_dev_flypath_FlypathAbi_at(JNIEnv*,
                                                       jclass,
                                                       jlong ref,
                                                       jint index) {
  return handle(const_cast<void*>(reinterpret_cast<const void*>(
      flypath_at(value(ref), static_cast<size_t>(index)))));
}

JNIEXPORT jlong JNICALL Java_dev_flypath_FlypathAbi_field(JNIEnv* env,
                                                          jclass,
                                                          jlong ref,
                                                          jstring name) {
  const std::string key = utf8(env, name);
  return handle(const_cast<void*>(
      reinterpret_cast<const void*>(flypath_field(value(ref), key.c_str()))));
}

JNIEXPORT jboolean JNICALL Java_dev_flypath_FlypathAbi_isNull(JNIEnv*,
                                                              jclass,
                                                              jlong ref) {
  return flypath_is_null(value(ref)) ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jboolean JNICALL Java_dev_flypath_FlypathAbi_bool(JNIEnv*,
                                                            jclass,
                                                            jlong ref) {
  return flypath_bool(value(ref)) ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jdouble JNICALL Java_dev_flypath_FlypathAbi_number(JNIEnv*,
                                                             jclass,
                                                             jlong ref) {
  return flypath_number(value(ref));
}

JNIEXPORT jstring JNICALL Java_dev_flypath_FlypathAbi_string(JNIEnv* env,
                                                             jclass,
                                                             jlong ref) {
  size_t length = 0;
  const char* text = flypath_string(value(ref), &length);
  return env->NewStringUTF(text == nullptr ? "" : text);
}

JNIEXPORT jbyteArray JNICALL Java_dev_flypath_FlypathAbi_bytes(JNIEnv* env,
                                                               jclass,
                                                               jlong ref) {
  size_t length = 0;
  const uint8_t* data = flypath_bytes(value(ref), &length);
  jbyteArray array = env->NewByteArray(static_cast<jsize>(length));
  if (data != nullptr && length > 0) {
    env->SetByteArrayRegion(array, 0, static_cast<jsize>(length),
                            reinterpret_cast<const jbyte*>(data));
  }
  return array;
}

JNIEXPORT void JNICALL Java_dev_flypath_FlypathAbi_outNull(JNIEnv*,
                                                           jclass,
                                                           jlong ref) {
  flypath_out_null(out(ref));
}

JNIEXPORT void JNICALL Java_dev_flypath_FlypathAbi_outBool(JNIEnv*,
                                                           jclass,
                                                           jlong ref,
                                                           jboolean value_) {
  flypath_out_bool(out(ref), value_ == JNI_TRUE);
}

JNIEXPORT void JNICALL Java_dev_flypath_FlypathAbi_outNumber(JNIEnv*,
                                                             jclass,
                                                             jlong ref,
                                                             jdouble value_) {
  flypath_out_number(out(ref), value_);
}

JNIEXPORT void JNICALL Java_dev_flypath_FlypathAbi_outString(JNIEnv* env,
                                                             jclass,
                                                             jlong ref,
                                                             jstring value_) {
  const std::string text = utf8(env, value_);
  flypath_out_string(out(ref), text.data(), text.size());
}

JNIEXPORT void JNICALL Java_dev_flypath_FlypathAbi_outBytes(JNIEnv* env,
                                                            jclass,
                                                            jlong ref,
                                                            jbyteArray value_) {
  const jsize length = env->GetArrayLength(value_);
  std::vector<uint8_t> buffer(static_cast<size_t>(length));
  if (length > 0) {
    env->GetByteArrayRegion(value_, 0, length,
                            reinterpret_cast<jbyte*>(buffer.data()));
  }
  flypath_out_bytes(out(ref), buffer.data(), buffer.size());
}

JNIEXPORT jlong JNICALL Java_dev_flypath_FlypathAbi_outArray(JNIEnv*,
                                                             jclass,
                                                             jlong ref,
                                                             jint count) {
  return handle(flypath_out_array(out(ref), static_cast<size_t>(count)));
}

JNIEXPORT jlong JNICALL Java_dev_flypath_FlypathAbi_outElement(JNIEnv*,
                                                               jclass,
                                                               jlong ref,
                                                               jint index) {
  return handle(flypath_out_element(out(ref), static_cast<size_t>(index)));
}

JNIEXPORT jlong JNICALL Java_dev_flypath_FlypathAbi_outObject(JNIEnv*,
                                                              jclass,
                                                              jlong ref) {
  return handle(flypath_out_object(out(ref)));
}

JNIEXPORT jlong JNICALL Java_dev_flypath_FlypathAbi_outField(JNIEnv* env,
                                                             jclass,
                                                             jlong ref,
                                                             jstring name) {
  const std::string key = utf8(env, name);
  return handle(flypath_out_field(out(ref), key.c_str()));
}

JNIEXPORT jlong JNICALL Java_dev_flypath_FlypathAbi_promiseOut(JNIEnv*,
                                                               jclass,
                                                               jlong ref) {
  return handle(flypath_promise_out(promise(ref)));
}

JNIEXPORT void JNICALL Java_dev_flypath_FlypathAbi_promiseResolve(JNIEnv*,
                                                                  jclass,
                                                                  jlong ref) {
  flypath_promise_resolve(promise(ref));
}

JNIEXPORT void JNICALL
Java_dev_flypath_FlypathAbi_promiseReject(JNIEnv* env,
                                          jclass,
                                          jlong ref,
                                          jstring message) {
  const std::string text = utf8(env, message);
  flypath_promise_reject(promise(ref), text.data(), text.size());
}

JNIEXPORT void JNICALL Java_dev_flypath_FlypathInsets_publish(JNIEnv*,
                                                              jclass,
                                                              jdouble top,
                                                              jdouble bottom,
                                                              jdouble left,
                                                              jdouble right) {
  flypath::publishInsets({top, bottom, left, right});
}

}  // extern "C"
