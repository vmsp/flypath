#import "FlypathHermes.h"

#import "FlypathHermesRuntime.h"

extern "C" void* FlypathCreateHermesFactory(void) {
  return static_cast<void*>(flypath::CreateHermesRuntimeFactory());
}
