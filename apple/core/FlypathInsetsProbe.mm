#import "FlypathInsetsProbe.h"

#import "FlypathInsets.h"

@implementation FlypathInsetsProbe

+ (void)installInWindow:(UIWindow*)window {
  if (window == nil)
    return;
  for (UIView* view in window.subviews) {
    if ([view isKindOfClass:FlypathInsetsProbe.class])
      return;
  }
  FlypathInsetsProbe* probe =
      [[FlypathInsetsProbe alloc] initWithFrame:window.bounds];
  probe.autoresizingMask =
      UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  probe.userInteractionEnabled = NO;
  probe.backgroundColor = UIColor.clearColor;
  [window addSubview:probe];
  [window sendSubviewToBack:probe];
  [probe publish];
}

- (void)publish {
  UIEdgeInsets insets = self.safeAreaInsets;
  flypath::publishInsets(
      {insets.top, insets.bottom, insets.left, insets.right});
}

- (void)safeAreaInsetsDidChange {
  [super safeAreaInsetsDidChange];
  [self publish];
}

- (void)didMoveToWindow {
  [super didMoveToWindow];
  [self publish];
}

- (void)layoutSubviews {
  [super layoutSubviews];
  [self publish];
}

@end
