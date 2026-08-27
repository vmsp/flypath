#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef const struct FlypathValueOpaque* FlypathValueRef;
typedef struct FlypathOutOpaque* FlypathOutRef;
typedef struct FlypathPromiseOpaque* FlypathPromiseRef;

typedef void (*FlypathCall)(FlypathValueRef args, FlypathOutRef result);
typedef void (*FlypathAsyncCall)(FlypathValueRef args,
                                 FlypathPromiseRef promise);
typedef void* (*FlypathViewCreate)(FlypathValueRef props, void* view);

int flypath_abi_version(void);

size_t flypath_count(FlypathValueRef value);
FlypathValueRef flypath_at(FlypathValueRef value, size_t index);
FlypathValueRef flypath_field(FlypathValueRef value, const char* name);
bool flypath_is_null(FlypathValueRef value);
bool flypath_bool(FlypathValueRef value);
double flypath_number(FlypathValueRef value);
const char* flypath_string(FlypathValueRef value, size_t* length);
const uint8_t* flypath_bytes(FlypathValueRef value, size_t* length);

void flypath_out_null(FlypathOutRef out);
void flypath_out_bool(FlypathOutRef out, bool value);
void flypath_out_number(FlypathOutRef out, double value);
void flypath_out_string(FlypathOutRef out, const char* value, size_t length);
void flypath_out_bytes(FlypathOutRef out, const uint8_t* value, size_t length);
FlypathOutRef flypath_out_array(FlypathOutRef out, size_t count);
FlypathOutRef flypath_out_element(FlypathOutRef array, size_t index);
FlypathOutRef flypath_out_object(FlypathOutRef out);
FlypathOutRef flypath_out_field(FlypathOutRef object, const char* name);

FlypathOutRef flypath_promise_out(FlypathPromiseRef promise);
void flypath_promise_resolve(FlypathPromiseRef promise);
void flypath_promise_reject(FlypathPromiseRef promise, const char* message,
                            size_t length);

void flypath_register_hash(const char* hash);
void flypath_register_function(const char* module, const char* name,
                               size_t arity, FlypathCall call);
void flypath_register_async(const char* module, const char* name, size_t arity,
                            FlypathAsyncCall call);
void flypath_register_view(const char* name, FlypathViewCreate create);

FlypathViewCreate flypath_view_create(const char* name);

FlypathOutRef flypath_event_begin(void* view);
void flypath_event_end(void* view, const char* name, FlypathOutRef payload);

void* flypath_host_controller(void* host);
void flypath_host_update(void* host, FlypathValueRef props);
void flypath_host_release(void* host);

#ifdef __cplusplus
}
#endif
