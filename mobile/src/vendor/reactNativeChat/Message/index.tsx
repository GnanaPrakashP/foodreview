// @ts-nocheck
import React, { useCallback, useMemo, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Easing,
  runOnJS,
  SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import { Avatar } from '../Avatar'
import { Bubble } from '../Bubble'
import { Color } from '../Color'
import { IMessage } from '../Models'
import { SwipeToReplyProps } from '../Reply'
import { getStyleWithPosition } from '../styles'
import { SystemMessage } from '../SystemMessage'
import { isSameUser, renderComponentOrElement } from '../utils'
import styles from './styles'
import { MessageProps } from './types'

export * from './types'

const REPLY_SWIPE_ACTIVATION_DISTANCE = 30
const REPLY_SWIPE_TRIGGER_DISTANCE = 54
const REPLY_SWIPE_MAX_TRANSLATE = 68
const REPLY_SWIPE_VERTICAL_TOLERANCE = 12

interface ReplyIconProps {
  progress: SharedValue<number>
  direction: 'left' | 'right'
  position: 'left' | 'right'
  style?: SwipeToReplyProps<IMessage>['actionContainerStyle']
}

const ReplyIcon = ({ progress, direction, position, style }: ReplyIconProps) => {
  const animatedStyle = useAnimatedStyle(() => {
    'worklet'

    const scale = Math.min(progress.value, 1)
    // When swiping left (icon on right), icon should move left (negative)
    // When swiping right (icon on left), icon should move right (positive)
    const translateX = direction === 'left'
      ? Math.min(progress.value * -12, -12)
      : Math.max(progress.value * 12, 12)

    return {
      opacity: progress.value,
      transform: [{ scale }, { translateX }],
      marginLeft: position === 'left' ? 0 : 16,
      marginRight: position === 'right' ? 0 : 16,
    }
  })

  return (
    <Animated.Text style={[localStyles.replyIconText, animatedStyle, style]}>
      {'↩'}
    </Animated.Text>
  )
}

// The reply affordance is invisible until a swipe is actually in progress, but
// mounting it eagerly cost every row an Animated.Text plus two worklet nodes
// (the progress useDerivedValue and the icon's useAnimatedStyle) at rest. Both
// now live here, behind the arming flag, so a row that is never swiped never
// builds them. `progress` is still derived from the same shared value, so the
// renderAction contract (progress, translation, position) is unchanged.
const SwipeActionLayer = ({
  direction,
  position,
  renderAction,
  style,
  translation,
}: {
  direction: 'left' | 'right'
  position: 'left' | 'right'
  renderAction?: SwipeToReplyProps<IMessage>['renderAction']
  style?: SwipeToReplyProps<IMessage>['actionContainerStyle']
  translation: SharedValue<number>
}) => {
  const progress = useDerivedValue(() =>
    Math.min(1, Math.abs(translation.value) / REPLY_SWIPE_TRIGGER_DISTANCE)
  )

  if (renderAction)
    return renderAction(progress, translation, position)

  return (
    <ReplyIcon
      progress={progress}
      direction={direction}
      position={position}
      style={style}
    />
  )
}

export const Message = <TMessage extends IMessage = IMessage>(props: MessageProps<TMessage>) => {
  const {
    currentMessage,
    renderBubble: renderBubbleProp,
    renderSystemMessage: renderSystemMessageProp,
    onMessageLayout,
    nextMessage,
    position,
    containerStyle,
    user,
    isUserAvatarVisible,
    swipeToReply,
  } = props

  // Extract swipe props
  const isSwipeToReplyEnabled = swipeToReply?.isEnabled ?? false
  const swipeToReplyDirection = swipeToReply?.direction ?? 'left'
  const onSwipeToReply = swipeToReply?.onSwipe
  const renderSwipeToReplyActionProp = swipeToReply?.renderAction
  const swipeToReplyActionContainerStyle = swipeToReply?.actionContainerStyle
  const replySwipeX = useSharedValue(0)
  const replySwipeContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: replySwipeX.value }],
  }), [replySwipeX])
  // Armed on touch-down (onBegin), not on activation, so the action layer is
  // mounted well before the 30px activation threshold is crossed and the icon
  // exists by the time `progress` is visibly non-zero. Never disarmed: this is
  // a one-time cost per row, paid only by rows the user actually touches.
  const [isSwipeArmed, setIsSwipeArmed] = useState(false)
  const armSwipe = useCallback(() => {
    setIsSwipeArmed(current => (current ? current : true))
  }, [])

  const renderBubble = useCallback(() => {
    const {
      /* eslint-disable @typescript-eslint/no-unused-vars */
      containerStyle,
      onMessageLayout,
      swipeToReply,
      /* eslint-enable @typescript-eslint/no-unused-vars */
      ...rest
    } = props

    if (renderBubbleProp)
      return renderComponentOrElement(renderBubbleProp, rest)

    return <Bubble {...rest} />
  }, [props, renderBubbleProp])

  const renderSystemMessage = useCallback(() => {
    const {
      /* eslint-disable @typescript-eslint/no-unused-vars */
      containerStyle,
      onMessageLayout,
      swipeToReply,
      /* eslint-enable @typescript-eslint/no-unused-vars */
      ...rest
    } = props

    if (renderSystemMessageProp)
      return renderComponentOrElement(renderSystemMessageProp, rest)

    return <SystemMessage {...rest} />
  }, [props, renderSystemMessageProp])

  const renderAvatar = useCallback(() => {
    if (
      user?._id &&
      currentMessage?.user &&
      user._id === currentMessage.user._id &&
      !isUserAvatarVisible
    )
      return null

    if (currentMessage?.user?.avatar === null)
      return null

    const {
      /* eslint-disable @typescript-eslint/no-unused-vars */
      containerStyle,
      onMessageLayout,
      swipeToReply,
      /* eslint-enable @typescript-eslint/no-unused-vars */
      ...rest
    } = props

    return <Avatar {...rest} />
  }, [
    props,
    user,
    currentMessage,
    isUserAvatarVisible,
  ])

  const triggerSwipeReply = useCallback(() => {
    if (onSwipeToReply && currentMessage)
      onSwipeToReply(currentMessage)
  }, [onSwipeToReply, currentMessage])
  const replySwipeGesture = useMemo(() => (
    Gesture.Pan()
      .enabled(Boolean(isSwipeToReplyEnabled && onSwipeToReply && !currentMessage?.system))
      .activeOffsetX(
        swipeToReplyDirection === 'right'
          ? REPLY_SWIPE_ACTIVATION_DISTANCE
          : -REPLY_SWIPE_ACTIVATION_DISTANCE
      )
      .failOffsetY([-REPLY_SWIPE_VERTICAL_TOLERANCE, REPLY_SWIPE_VERTICAL_TOLERANCE])
      .onBegin(() => {
        runOnJS(armSwipe)()
      })
      .onUpdate(event => {
        const directionalDistance = swipeToReplyDirection === 'right'
          ? Math.max(0, event.translationX)
          : Math.min(0, event.translationX)
        replySwipeX.value = swipeToReplyDirection === 'right'
          ? Math.min(directionalDistance, REPLY_SWIPE_MAX_TRANSLATE)
          : Math.max(directionalDistance, -REPLY_SWIPE_MAX_TRANSLATE)
      })
      .onEnd(event => {
        const directionalDistance = swipeToReplyDirection === 'right'
          ? event.translationX
          : -event.translationX
        const deliberateReplySwipe = (
          directionalDistance >= REPLY_SWIPE_TRIGGER_DISTANCE &&
          directionalDistance > Math.abs(event.translationY) * 1.5
        )
        if (deliberateReplySwipe)
          runOnJS(triggerSwipeReply)()
      })
      .onFinalize(() => {
        replySwipeX.value = withTiming(0, {
          duration: 150,
          easing: Easing.out(Easing.cubic),
        })
      })
  ), [
    armSwipe,
    currentMessage?.system,
    isSwipeToReplyEnabled,
    onSwipeToReply,
    replySwipeX,
    swipeToReplyDirection,
    triggerSwipeReply,
  ])

  const sameUser = useMemo(() =>
    isSameUser(currentMessage, nextMessage!)
  , [currentMessage, nextMessage])

  const messageContent = useMemo(() => {
    if (currentMessage?.system)
      return renderSystemMessage()

    return (
      <View
        style={[
          getStyleWithPosition(styles, 'container', position),
          { marginBottom: sameUser ? 2 : 10 },
          !props.isInverted && { marginBottom: 2 },
          containerStyle?.[position],
        ]}
      >
        {position === 'left' && renderAvatar()}
        {renderBubble()}
        {position === 'right' && renderAvatar()}
      </View>
    )
  }, [
    currentMessage?.system,
    renderSystemMessage,
    position,
    sameUser,
    props.isInverted,
    containerStyle,
    renderAvatar,
    renderBubble,
  ])

  if (!currentMessage)
    return null

  // System/disabled rows stay as a single native wrapper.
  if (currentMessage.system || !isSwipeToReplyEnabled)
    return (
      <View onLayout={onMessageLayout}>
        {messageContent}
      </View>
    )

  return (
    <View onLayout={onMessageLayout} style={localStyles.swipeContainer}>
      {isSwipeArmed ? (
        <View
          pointerEvents="none"
          style={[
            localStyles.swipeActionLayer,
            swipeToReplyDirection === 'right'
              ? localStyles.swipeActionLayerLeft
              : localStyles.swipeActionLayerRight,
          ]}
        >
          <SwipeActionLayer
            direction={swipeToReplyDirection}
            position={position}
            renderAction={renderSwipeToReplyActionProp}
            style={swipeToReplyActionContainerStyle}
            translation={replySwipeX}
          />
        </View>
      ) : null}
      <GestureDetector gesture={replySwipeGesture} touchAction="pan-y">
        <Animated.View style={replySwipeContentStyle}>
          {messageContent}
        </Animated.View>
      </GestureDetector>
    </View>
  )
}

const localStyles = StyleSheet.create({
  swipeContainer: {
    position: 'relative',
  },
  swipeActionLayer: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    top: 0,
  },
  swipeActionLayerLeft: {
    left: 0,
  },
  swipeActionLayerRight: {
    right: 0,
  },
  replyIconText: {
    backgroundColor: Color.defaultBlue,
    borderRadius: 14,
    color: Color.white,
    fontSize: 17,
    width: 28,
    height: 28,
    lineHeight: 28,
    textAlign: 'center',
  },
})
