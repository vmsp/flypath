#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

#import <React/RCTComponentViewProtocol.h>
#import <React/RCTMountingTransactionObserving.h>
#import <React/RCTSurfaceTouchHandler.h>
#import <React/RCTViewComponentView.h>

#import "FlypathScreens.h"

using namespace facebook::react;

@protocol FlypathScreenStackHost <NSObject>
@property(nonatomic, assign, readonly) BOOL transitioning;
@end

@interface FlypathScreenComponentView : RCTViewComponentView

@property(nonatomic, weak) id<FlypathScreenStackHost> stack;
@property(nonatomic, copy, readonly) NSString* screenKey;
@property(nonatomic, copy, readonly) NSString* transitionMode;
@property(nonatomic, assign, readonly) BOOL modal;
@property(nonatomic, assign, readonly) BOOL gestureEnabled;

- (void)applyPendingMetrics;

@end

@interface FlypathScreenController : UIViewController

- (instancetype)initWithScreen:(FlypathScreenComponentView*)screen;

@property(nonatomic, strong, readonly) FlypathScreenComponentView* screen;
@property(nonatomic, strong) RCTSurfaceTouchHandler* touches;

@end

@implementation FlypathScreenController

- (instancetype)initWithScreen:(FlypathScreenComponentView*)screen {
  if (self = [super initWithNibName:nil bundle:nil]) {
    _screen = screen;
  }
  return self;
}

- (void)loadView {
  self.view = _screen;
}

- (void)startReceivingTouches {
  if (_touches != nil)
    return;
  _touches = [[RCTSurfaceTouchHandler alloc] init];
  [_touches attachToView:_screen];
}

- (void)stopReceivingTouches {
  if (_touches == nil)
    return;
  [_touches detachFromView:_screen];
  _touches = nil;
}

@end

@implementation FlypathScreenComponentView {
  LayoutMetrics _pendingMetrics;
  BOOL _hasPendingMetrics;
}

+ (BOOL)shouldBeRecycled {
  return NO;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<
      flypath::ScreenComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    static const auto defaults = std::make_shared<const flypath::ScreenProps>();
    _props = defaults;
    _screenKey = @"";
    _transitionMode = @"platform";
    _gestureEnabled = YES;
  }
  return self;
}

- (void)updateProps:(const Props::Shared&)props
           oldProps:(const Props::Shared&)oldProps {
  const auto& next =
      *std::static_pointer_cast<const flypath::ScreenProps>(props);

  _screenKey = [NSString stringWithUTF8String:next.screenKey.c_str()];
  _transitionMode = [NSString stringWithUTF8String:next.transition.c_str()];
  _modal = next.presentation == "modal";
  _gestureEnabled = next.gesture && next.transition == "platform";

  [super updateProps:props oldProps:oldProps];
}

- (void)updateLayoutMetrics:(const LayoutMetrics&)layoutMetrics
           oldLayoutMetrics:(const LayoutMetrics&)oldLayoutMetrics {
  if (self.stack.transitioning) {
    _pendingMetrics = layoutMetrics;
    _hasPendingMetrics = YES;
    return;
  }
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
}

- (void)applyPendingMetrics {
  if (!_hasPendingMetrics)
    return;
  _hasPendingMetrics = NO;
  [super updateLayoutMetrics:_pendingMetrics oldLayoutMetrics:_pendingMetrics];
}

@end

@interface FlypathScreenFade : NSObject <UIViewControllerAnimatedTransitioning>

@property(nonatomic, assign) NSTimeInterval duration;

@end

@implementation FlypathScreenFade

- (NSTimeInterval)transitionDuration:
    (id<UIViewControllerContextTransitioning>)context {
  return _duration;
}

- (void)animateTransition:(id<UIViewControllerContextTransitioning>)context {
  UIViewController* to =
      [context viewControllerForKey:UITransitionContextToViewControllerKey];
  UIViewController* from =
      [context viewControllerForKey:UITransitionContextFromViewControllerKey];
  if (to == nil) {
    [context completeTransition:!context.transitionWasCancelled];
    return;
  }

  UIView* incoming = to.view;
  incoming.frame = [context finalFrameForViewController:to];
  [context.containerView addSubview:incoming];

  if (_duration <= 0) {
    [context completeTransition:!context.transitionWasCancelled];
    return;
  }

  incoming.alpha = 0;
  [UIView animateWithDuration:_duration
      animations:^{
        incoming.alpha = 1;
        from.view.alpha = 0;
      }
      completion:^(BOOL finished) {
        from.view.alpha = 1;
        [context completeTransition:!context.transitionWasCancelled];
      }];
}

@end

@interface FlypathScreenStackComponentView
    : RCTViewComponentView <FlypathScreenStackHost,
                            RCTMountingTransactionObserving,
                            UIGestureRecognizerDelegate,
                            UINavigationControllerDelegate,
                            UIAdaptivePresentationControllerDelegate>

@property(nonatomic, assign, readonly) BOOL transitioning;

@end

@implementation FlypathScreenStackComponentView {
  UINavigationController* _navigation;
  NSMutableArray<FlypathScreenController*>* _children;
  NSMutableArray<FlypathScreenController*>* _retired;
  NSMutableArray<FlypathScreenController*>* _pushed;
  NSMutableArray<FlypathScreenController*>* _presented;
  NSMutableSet<NSString*>* _dismissed;
  NSArray<NSString*>* _dismissedAt;
  BOOL _active;
  BOOL _dirty;
  BOOL _scheduled;
}

+ (BOOL)shouldBeRecycled {
  return NO;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<
      flypath::ScreenStackComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    static const auto defaults =
        std::make_shared<const flypath::ScreenStackProps>();
    _props = defaults;
    _children = [NSMutableArray array];
    _retired = [NSMutableArray array];
    _pushed = [NSMutableArray array];
    _presented = [NSMutableArray array];
    _dismissed = [NSMutableSet set];
    _dismissedAt = @[];
    _active = YES;
    _navigation = [[UINavigationController alloc] initWithNibName:nil
                                                           bundle:nil];
    _navigation.navigationBarHidden = YES;
    _navigation.delegate = self;
  }
  return self;
}

#pragma mark - props

- (void)updateProps:(const Props::Shared&)props
           oldProps:(const Props::Shared&)oldProps {
  const auto& next =
      *std::static_pointer_cast<const flypath::ScreenStackProps>(props);
  BOOL active = next.active;
  [super updateProps:props oldProps:oldProps];
  if (active == _active)
    return;
  _active = active;
  _navigation.interactivePopGestureRecognizer.enabled = active;
}

#pragma mark - children

- (void)mountChildComponentView:
            (UIView<RCTComponentViewProtocol>*)childComponentView
                          index:(NSInteger)index {
  if (![childComponentView isKindOfClass:FlypathScreenComponentView.class]) {
    [super mountChildComponentView:childComponentView index:index];
    return;
  }

  FlypathScreenComponentView* screen =
      (FlypathScreenComponentView*)childComponentView;
  screen.stack = self;
  FlypathScreenController* controller =
      [[FlypathScreenController alloc] initWithScreen:screen];
  NSUInteger at = MIN((NSUInteger)MAX(index, 0), _children.count);
  [_children insertObject:controller atIndex:at];
  [self setNeedsReconcile];
}

- (void)unmountChildComponentView:
            (UIView<RCTComponentViewProtocol>*)childComponentView
                            index:(NSInteger)index {
  if (![childComponentView isKindOfClass:FlypathScreenComponentView.class]) {
    [super unmountChildComponentView:childComponentView index:index];
    return;
  }

  FlypathScreenComponentView* screen =
      (FlypathScreenComponentView*)childComponentView;
  FlypathScreenController* controller = nil;
  for (FlypathScreenController* candidate in _children) {
    if (candidate.screen != screen)
      continue;
    controller = candidate;
    break;
  }
  if (controller == nil)
    return;

  [_children removeObject:controller];
  [_retired addObject:controller];
  [_dismissed removeObject:screen.screenKey];
  screen.stack = nil;
  [self setNeedsReconcile];
}

#pragma mark - scheduling

- (void)setNeedsReconcile {
  _dirty = YES;
  if (_scheduled)
    return;
  _scheduled = YES;
  __weak FlypathScreenStackComponentView* weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    FlypathScreenStackComponentView* strongSelf = weakSelf;
    if (strongSelf == nil)
      return;
    strongSelf->_scheduled = NO;
    [strongSelf reconcileIfNeeded];
  });
}

- (void)reconcileIfNeeded {
  if (!_dirty)
    return;
  if (self.window == nil)
    return;
  if (_transitioning)
    return;
  _dirty = NO;
  [self reconcile];
}

- (void)mountingTransactionDidMount:(const MountingTransaction&)transaction
               withSurfaceTelemetry:(const SurfaceTelemetry&)surfaceTelemetry {
  [self reconcileIfNeeded];
}

- (void)didMoveToWindow {
  [super didMoveToWindow];
  if (self.window == nil)
    return;
  [self attach];
  [self reconcileIfNeeded];
}

- (void)layoutSubviews {
  [super layoutSubviews];
  _navigation.view.frame = self.bounds;
}

- (void)attach {
  if (_navigation.parentViewController != nil)
    return;

  UIViewController* parent = nil;
  for (UIResponder* responder = self.nextResponder; responder != nil;
       responder = responder.nextResponder) {
    if (![responder isKindOfClass:UIViewController.class])
      continue;
    parent = (UIViewController*)responder;
    break;
  }
  if (parent == nil)
    return;

  [parent addChildViewController:_navigation];
  _navigation.view.frame = self.bounds;
  _navigation.view.autoresizingMask =
      UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  [self addSubview:_navigation.view];
  [_navigation didMoveToParentViewController:parent];

  _navigation.interactivePopGestureRecognizer.delegate = self;
  _navigation.interactivePopGestureRecognizer.enabled = _active;
}

- (void)invalidate {
  if (_presented.count > 0) {
    [_navigation dismissViewControllerAnimated:NO completion:nil];
    [_presented removeAllObjects];
  }
  [_navigation willMoveToParentViewController:nil];
  [_navigation.view removeFromSuperview];
  [_navigation removeFromParentViewController];
  [_children removeAllObjects];
  [_retired removeAllObjects];
  [_pushed removeAllObjects];
}

#pragma mark - reconciliation

- (void)reconcile {
  [self attach];
  if (_navigation.parentViewController == nil)
    return;

  [self forgetDeclinedDismissals];

  NSMutableArray<FlypathScreenController*>* target = [NSMutableArray array];
  for (FlypathScreenController* controller in _children) {
    if ([_dismissed containsObject:controller.screen.screenKey])
      continue;
    [target addObject:controller];
  }
  if (target.count == 0)
    return;

  NSUInteger split = target.count;
  for (NSUInteger at = 1; at < target.count; at += 1) {
    if (!target[at].screen.modal)
      continue;
    split = at;
    break;
  }

  [self syncPushed:[target subarrayWithRange:NSMakeRange(0, split)]];
  [self
      syncPresented:[target subarrayWithRange:NSMakeRange(split, target.count -
                                                                     split)]];
  [self forgetRetired];
}

- (void)forgetRetired {
  if (_transitioning)
    return;
  for (FlypathScreenController* controller in [_retired copy]) {
    if ([_navigation.viewControllers containsObject:controller])
      continue;
    if (controller.presentingViewController != nil)
      continue;
    [controller stopReceivingTouches];
    [_retired removeObject:controller];
  }
}

- (void)forgetDeclinedDismissals {
  if (_dismissed.count == 0)
    return;

  NSMutableArray<NSString*>* keys = [NSMutableArray array];
  for (FlypathScreenController* controller in _children) {
    [keys addObject:controller.screen.screenKey];
  }
  if ([keys isEqualToArray:_dismissedAt])
    return;

  for (NSString* key in [_dismissed copy]) {
    if (![keys containsObject:key])
      continue;
    [_dismissed removeObject:key];
  }
}

- (BOOL)animatesScreen:(FlypathScreenComponentView*)screen {
  if (self.window == nil)
    return NO;
  return ![screen.transitionMode isEqualToString:@"none"];
}

- (void)syncPushed:(NSArray<FlypathScreenController*>*)target {
  NSArray<UIViewController*>* current = _navigation.viewControllers;
  if ([current isEqualToArray:target]) {
    [_pushed setArray:target];
    return;
  }

  BOOL started = current.count > 0 && self.window != nil;
  NSUInteger shared = MIN(current.count, target.count);
  BOOL prefix = [[current subarrayWithRange:NSMakeRange(0, shared)]
      isEqualToArray:[target subarrayWithRange:NSMakeRange(0, shared)]];

  [_pushed setArray:target];

  if (started && prefix && target.count == current.count + 1) {
    FlypathScreenController* pushed = target.lastObject;
    [_navigation pushViewController:pushed
                           animated:[self animatesScreen:pushed.screen]];
    return;
  }

  if (started && prefix && target.count + 1 == current.count) {
    UIViewController* leaving = current.lastObject;
    BOOL animated =
        [leaving isKindOfClass:FlypathScreenController.class] &&
        [self animatesScreen:((FlypathScreenController*)leaving).screen];
    [_navigation popToViewController:target.lastObject animated:animated];
    return;
  }

  [_navigation setViewControllers:target animated:NO];
}

- (void)syncPresented:(NSArray<FlypathScreenController*>*)target {
  UIViewController* presenter = _navigation;

  for (FlypathScreenController* controller in target) {
    UIViewController* shown = presenter.presentedViewController;
    if (shown == controller) {
      presenter = controller;
      continue;
    }
    if (shown != nil)
      break;
    if (presenter.isBeingDismissed || presenter.isBeingPresented)
      return;

    controller.modalPresentationStyle = UIModalPresentationPageSheet;
    [controller startReceivingTouches];
    [presenter presentViewController:controller
                            animated:[self animatesScreen:controller.screen]
                          completion:nil];
    controller.presentationController.delegate = self;
    presenter = controller;
  }

  [_presented setArray:target];

  UIViewController* extra = presenter.presentedViewController;
  if (extra == nil || presenter.isBeingDismissed)
    return;

  __weak FlypathScreenStackComponentView* weakSelf = self;
  [presenter dismissViewControllerAnimated:self.window != nil
                                completion:^{
                                  [weakSelf forgetRetired];
                                }];
}

#pragma mark - dismissals

- (void)reportDismissals {
  NSMutableArray<NSString*>* keys = [NSMutableArray array];

  for (FlypathScreenController* controller in [_pushed copy]) {
    if ([_navigation.viewControllers containsObject:controller])
      continue;
    [_pushed removeObject:controller];
    if (![_children containsObject:controller])
      continue;
    NSString* key = controller.screen.screenKey;
    if ([_dismissed containsObject:key])
      continue;
    [_dismissed addObject:key];
    [keys addObject:key];
  }

  [self emitPopped:keys];
}

- (void)emitPopped:(NSArray<NSString*>*)keys {
  if (keys.count == 0)
    return;

  NSMutableArray<NSString*>* snapshot = [NSMutableArray array];
  for (FlypathScreenController* controller in _children) {
    [snapshot addObject:controller.screen.screenKey];
  }
  _dismissedAt = snapshot;

  if (!_eventEmitter)
    return;
  folly::dynamic list = folly::dynamic::array();
  for (NSString* key in keys)
    list.push_back(std::string(key.UTF8String));
  _eventEmitter->dispatchEvent("popped",
                               folly::dynamic::object("keys", std::move(list)),
                               RawEvent::Category::Discrete);
}

#pragma mark - UINavigationControllerDelegate

- (void)navigationController:(UINavigationController*)navigationController
      willShowViewController:(UIViewController*)viewController
                    animated:(BOOL)animated {
  _transitioning = YES;
}

- (void)navigationController:(UINavigationController*)navigationController
       didShowViewController:(UIViewController*)viewController
                    animated:(BOOL)animated {
  _transitioning = NO;
  navigationController.interactivePopGestureRecognizer.delegate = self;
  navigationController.interactivePopGestureRecognizer.enabled = _active;

  for (FlypathScreenController* controller in _children) {
    [controller.screen applyPendingMetrics];
  }

  [self reportDismissals];
  [self forgetRetired];
  [self reconcileIfNeeded];
}

- (id<UIViewControllerAnimatedTransitioning>)
               navigationController:
                   (UINavigationController*)navigationController
    animationControllerForOperation:(UINavigationControllerOperation)operation
                 fromViewController:(UIViewController*)fromViewController
                   toViewController:(UIViewController*)toViewController {
  UIViewController* subject = operation == UINavigationControllerOperationPush
                                  ? toViewController
                                  : fromViewController;
  if (![subject isKindOfClass:FlypathScreenController.class])
    return nil;

  NSString* mode = ((FlypathScreenController*)subject).screen.transitionMode;
  if ([mode isEqualToString:@"fade"]) {
    FlypathScreenFade* fade = [[FlypathScreenFade alloc] init];
    fade.duration = 0.22;
    return fade;
  }
  if ([mode isEqualToString:@"none"]) {
    FlypathScreenFade* cut = [[FlypathScreenFade alloc] init];
    cut.duration = 0;
    return cut;
  }
  return nil;
}

#pragma mark - UIGestureRecognizerDelegate

- (BOOL)gestureRecognizerShouldBegin:(UIGestureRecognizer*)gestureRecognizer {
  if (gestureRecognizer != _navigation.interactivePopGestureRecognizer)
    return YES;
  if (!_active || _transitioning)
    return NO;
  if (_navigation.viewControllers.count < 2)
    return NO;
  if (_navigation.presentedViewController != nil)
    return NO;
  FlypathScreenController* top =
      (FlypathScreenController*)_navigation.viewControllers.lastObject;
  if (![top isKindOfClass:FlypathScreenController.class])
    return NO;
  if (!top.screen.gestureEnabled)
    return NO;
  [self cancelReactTouches];
  return YES;
}

- (void)cancelReactTouches {
  Class handler = NSClassFromString(@"RCTSurfaceTouchHandler");
  if (handler == nil)
    return;
  for (UIView* view = self; view != nil; view = view.superview) {
    for (UIGestureRecognizer* recognizer in view.gestureRecognizers) {
      if (![recognizer isKindOfClass:handler])
        continue;
      recognizer.enabled = NO;
      recognizer.enabled = YES;
    }
  }
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer*)gestureRecognizer
    shouldRecognizeSimultaneouslyWithGestureRecognizer:
        (UIGestureRecognizer*)other {
  return NO;
}

#pragma mark - UIAdaptivePresentationControllerDelegate

- (void)presentationControllerDidDismiss:
    (UIPresentationController*)presentationController {
  UIViewController* dismissed = presentationController.presentedViewController;
  if (![dismissed isKindOfClass:FlypathScreenController.class])
    return;

  FlypathScreenController* controller = (FlypathScreenController*)dismissed;
  [controller stopReceivingTouches];
  [_presented removeObject:controller];
  [_retired removeObject:controller];
  if (![_children containsObject:controller])
    return;

  NSString* key = controller.screen.screenKey;
  if ([_dismissed containsObject:key])
    return;
  [_dismissed addObject:key];
  [self emitPopped:@[ key ]];
}

@end

extern "C" NSDictionary* FlypathCoreFabricComponents(void) {
  return @{
    @"FlypathScreenStack" : [FlypathScreenStackComponentView class],
    @"FlypathScreen" : [FlypathScreenComponentView class],
  };
}
