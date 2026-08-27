#pragma once

#include <folly/dynamic.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>

namespace flypath {

class FlypathProps final : public facebook::react::ViewProps {
 public:
  FlypathProps() = default;
  FlypathProps(const facebook::react::PropsParserContext& context,
               const FlypathProps& sourceProps,
               const facebook::react::RawProps& rawProps);

  folly::dynamic values;
};

template <const char* Name>
using FlypathShadowNode =
    facebook::react::ConcreteViewShadowNode<Name, FlypathProps>;

template <const char* Name>
using FlypathComponentDescriptor =
    facebook::react::ConcreteComponentDescriptor<FlypathShadowNode<Name>>;

}  // namespace flypath
