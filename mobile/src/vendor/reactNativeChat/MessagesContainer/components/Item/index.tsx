// @ts-nocheck
import React, { memo, useMemo } from 'react'
import { View } from 'react-native'
import Animated, { useAnimatedStyle, useDerivedValue } from 'react-native-reanimated'
import { Day } from '../../../Day'
import { Message, MessageProps } from '../../../Message'
import { IMessage } from '../../../Models'
import { isSameDay } from '../../../utils'
import { DAY_HANDOFF_OFFSET, dayPositionScreenTop, findDayPosition } from '../dayLayout'
import { ItemProps } from './types'

export * from './types'

const DayWrapper = <TMessage extends IMessage>(props: MessageProps<TMessage>) => {
  const {
    renderDay: renderDayProp,
    currentMessage,
    previousMessage,
  } = props

  if (!currentMessage?.createdAt || isSameDay(currentMessage, previousMessage))
    return null

  const {
    /* eslint-disable @typescript-eslint/no-unused-vars */
    containerStyle,
    onMessageLayout,
    /* eslint-enable @typescript-eslint/no-unused-vars */
    ...rest
  } = props

  return (
    <View>
      {
        renderDayProp
          ? renderDayProp({ ...rest, createdAt: currentMessage.createdAt, isAnimated: false })
          : <Day {...rest} createdAt={currentMessage.createdAt} isAnimated={false} />
      }
    </View>
  )
}

const AnimatedDayWrapper = <TMessage extends IMessage>(props: ItemProps<TMessage>) => {
  const {
    scrolledY,
    daysPositions,
    listHeight,
    floatingRenderedDate,
    ...rest
  } = props

  const createdAt = useMemo(() =>
    new Date(props.currentMessage.createdAt).getTime()
  , [props.currentMessage.createdAt])

  // On-screen Y of this day's separator. Infinity (treated as below the pin, i.e.
  // visible) until the day has been measured.
  const separatorScreenTop = useDerivedValue(() => {
    'worklet'

    const day = findDayPosition(daysPositions.value, createdAt)
    if (!day)
      return Infinity

    return dayPositionScreenTop(listHeight.value + scrolledY.value, day)
  }, [daysPositions, listHeight, scrolledY, createdAt])

  const style = useAnimatedStyle(() => {
    // The inline separator is the in-conversation date marker. It is shown while its
    // day is below the handoff line, and hidden once its day is the one the floating
    // header is actually rendering at the pin - a hard step (no fade) so the date
    // goes floating(1) <-> inline(1) at the same pixel with no dip and no duplicate.
    //
    // Hiding on `floatingRenderedDate` (the header's *rendered* date) rather than on
    // position alone is what kills the 1-frame flash when scrolling into a newer day:
    // the worklet picks the new stuck day instantly but the header's text only
    // updates ~1 frame later on the JS thread; until it does, this inline separator
    // stays up and shows the correct date, so the header never flashes the old one.
    const belowHandoff = separatorScreenTop.value > DAY_HANDOFF_OFFSET
    const headerShowsThisDay = floatingRenderedDate != null && floatingRenderedDate.value === createdAt

    return {
      opacity: belowHandoff || !headerShowsThisDay ? 1 : 0,
    }
  }, [separatorScreenTop, floatingRenderedDate, createdAt])

  return (
    <Animated.View style={style}>
      <DayWrapper<TMessage> {...rest as MessageProps<TMessage>} />
    </Animated.View>
  )
}

const ItemComponent = <TMessage extends IMessage>(props: ItemProps<TMessage>) => {
  const {
    renderMessage: renderMessageProp,
    isDayAnimationEnabled,
    reply,
    /* eslint-disable @typescript-eslint/no-unused-vars */
    scrolledY: _scrolledY,
    daysPositions: _daysPositions,
    listHeight: _listHeight,
    /* eslint-enable @typescript-eslint/no-unused-vars */
    ...rest
  } = props

  // Transform reply props for Message and Bubble
  const messageProps = useMemo(() => ({
    ...rest,
    // Swipe to reply for Message component
    swipeToReply: reply?.swipe,
    // Message reply styling for Bubble component
    messageReply: reply ? {
      renderMessageReply: reply.renderMessageReply,
      onPress: reply.onPress,
      ...reply.messageStyle,
    } : undefined,
  }), [rest, reply])

  return (
    // do not remove key. it helps to get correct position of the day container
    <View key={props.currentMessage._id.toString()}>
      {isDayAnimationEnabled
        ? <AnimatedDayWrapper<TMessage> {...props} />
        : <DayWrapper<TMessage> {...messageProps as MessageProps<TMessage>} />}
      {
        renderMessageProp
          ? renderMessageProp(messageProps as MessageProps<TMessage>)
          : <Message<TMessage> {...messageProps as MessageProps<TMessage>} />
      }
    </View>
  )
}

// The row is the memo boundary for the whole list. VirtualizedList re-renders
// its cells on every render-window update (~20x/second while scrolling) and
// each cell re-invokes renderItem, so without this boundary every visible
// row's subtree — Swipeable pan handler, bubble long-press/tap gestures,
// timestamp measurement, day separator — re-renders on every one of those
// updates even though nothing about the row changed. Measured on-device
// (Hermes sampling profile, 6s fling): React render + Fabric commit was 49%
// of wall clock with the surface component itself running only 13ms, i.e. the
// work was cell re-renders, not app state changes.
//
// A plain shallow compare is safe here: every prop is either value-stable
// during a scroll (the message objects, the Reanimated shared values, the
// isDayAnimationEnabled flag) or a callback/config object whose identity
// changes exactly when the surface re-renders and rows genuinely must follow.
export const Item = memo(ItemComponent) as typeof ItemComponent
