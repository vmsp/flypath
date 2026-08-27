#include "FlypathComponent.h"

namespace flypath {

FlypathProps::FlypathProps(const facebook::react::PropsParserContext& context,
                           const FlypathProps& sourceProps,
                           const facebook::react::RawProps& rawProps)
    : facebook::react::ViewProps(context, sourceProps, rawProps),
      values(rawProps.toDynamic()) {}

}  // namespace flypath
