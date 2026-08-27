#import "FlypathComponentView.h"

#import <FlypathAbi.h>

#import "FlypathComponent.h"
#import "FlypathValue.h"

using namespace facebook::react;

@interface FlypathComponentView ()
- (void)flypathEmit:(const char*)name payload:(const flypath::Out&)payload;
@end

@implementation FlypathComponentView {
  void* _host;
  UIViewController* _controller;
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    static const auto defaults = std::make_shared<const flypath::FlypathProps>();
    _props = defaults;
  }
  return self;
}

- (void)dealloc {
  if (_host != nullptr) {
    flypath_host_release(_host);
    _host = nullptr;
  }
}

- (void)updateProps:(const Props::Shared&)props oldProps:(const Props::Shared&)oldProps {
  const auto& next = *std::static_pointer_cast<const flypath::FlypathProps>(props);

  flypath::Scope scope;
  FlypathValueRef values = reinterpret_cast<FlypathValueRef>(scope.wrap(&next.values));

  if (_host == nullptr) {
    const std::string name = [[self class] componentDescriptorProvider].name;
    FlypathViewCreate create = flypath_view_create(name.c_str());
    if (create == nullptr) {
      [super updateProps:props oldProps:oldProps];
      return;
    }
    _host = create(values, (__bridge void*)self);
    _controller = (__bridge UIViewController*)flypath_host_controller(_host);
    _controller.view.frame = self.bounds;
    _controller.view.autoresizingMask =
        UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    self.contentView = _controller.view;
  } else {
    flypath_host_update(_host, values);
  }

  [super updateProps:props oldProps:oldProps];
}

- (void)flypathEmit:(const char*)name payload:(const flypath::Out&)payload {
  if (!_eventEmitter) return;
  _eventEmitter->dispatchEvent(std::string(name), flypath::toDynamic(payload));
}

@end

extern "C" FlypathOutRef flypath_event_begin(void* view) {
  (void)view;
  return reinterpret_cast<FlypathOutRef>(new flypath::Out());
}

extern "C" void flypath_event_end(void* view, const char* name, FlypathOutRef payload) {
  flypath::Out* out = reinterpret_cast<flypath::Out*>(payload);
  FlypathComponentView* self = (__bridge FlypathComponentView*)view;
  [self flypathEmit:name payload:*out];
  delete out;
}
