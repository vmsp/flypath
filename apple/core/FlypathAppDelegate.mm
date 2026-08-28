#import "FlypathAppDelegate.h"

#import <ReactCommon/CallInvoker.h>
#import <ReactCommon/TurboModule.h>

#import "FlypathHermesRuntime.h"
#import "FlypathInsets.h"
#import "FlypathInsetsProbe.h"
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
  if (auto insets = flypath::FlypathInsetsModule::provider(name, jsInvoker)) {
    return insets;
  }
  return [super getTurboModule:name jsInvoker:jsInvoker];
}

- (BOOL)application:(UIApplication*)application
    didFinishLaunchingWithOptions:(NSDictionary*)launchOptions {
  BOOL started = [super application:application didFinishLaunchingWithOptions:launchOptions];
  [FlypathInsetsProbe installInWindow:self.window];
  return started;
}

@end
