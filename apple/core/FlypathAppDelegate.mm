#import "FlypathAppDelegate.h"

#import <ReactCommon/CallInvoker.h>
#import <ReactCommon/TurboModule.h>

#import "FlypathHermesRuntime.h"
#import "FlypathModule.h"

extern "C" NSDictionary* FlypathFabricComponents(void);

@implementation FlypathAppDelegate

- (JSRuntimeFactoryRef)createJSRuntimeFactory {
  return static_cast<JSRuntimeFactoryRef>(flypath::CreateHermesRuntimeFactory());
}

- (NSDictionary<NSString*, Class<RCTComponentViewProtocol>>*)thirdPartyFabricComponents {
  NSMutableDictionary* components =
      [NSMutableDictionary dictionaryWithDictionary:[super thirdPartyFabricComponents]];
  [components addEntriesFromDictionary:FlypathFabricComponents()];
  return components;
}

- (std::shared_ptr<facebook::react::TurboModule>)
    getTurboModule:(const std::string&)name
         jsInvoker:(std::shared_ptr<facebook::react::CallInvoker>)jsInvoker {
  if (auto module = flypath::FlypathModule::provider(name, jsInvoker)) {
    return module;
  }
  return [super getTurboModule:name jsInvoker:jsInvoker];
}

@end
