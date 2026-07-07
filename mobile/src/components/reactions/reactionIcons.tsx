import type { ReactElement } from "react";
import Svg, { G, Path } from "react-native-svg";
import type { FoodReactionType } from "./reactionTypes";

export type ReactionIconProps = {
  color: string;
  fillColor: string;
  selected?: boolean;
  size?: number;
  strokeWidth?: number;
};

export function MustTryReactionIcon({
  color,
  fillColor,
  selected = false,
  size = 22,
  strokeWidth = 2.25
}: ReactionIconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <G fill={selected ? fillColor : "none"} stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}>
        <Path d="M12.2 21c3.9 0 6.7-2.7 6.7-6.7 0-2.9-1.5-5.1-4-7.7-.2 2.3-1.2 3.8-2.8 5.1.2-3.3-1.3-5.9-4-8.5.2 3.9-2.9 6.3-2.9 11C5.2 18.2 8.1 21 12.2 21Z" />
        <Path d="M12.4 18.2c1.8 0 3.1-1.2 3.1-2.9 0-1.2-.7-2.3-1.8-3.4-.2 1.2-.8 2-1.7 2.7.1-1.6-.7-2.8-2-4.1.1 2.3-1.4 3.6-1.4 5.2 0 1.5 1.4 2.5 3.8 2.5Z" fill={selected ? fillColor : "none"} />
      </G>
    </Svg>
  );
}

export function NotWorthItReactionIcon({
  color,
  fillColor,
  selected = false,
  size = 22,
  strokeWidth = 2.25
}: ReactionIconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <G fill={selected ? fillColor : "none"} stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}>
        <Path d="M10.2 14.1 8.8 20a2 2 0 0 0 2 2.4c.8 0 1.5-.5 1.8-1.2l3-6.5" />
        <Path d="M17.5 13.8h3.2c1.1 0 1.9-.9 1.7-2l-1.1-6.3A2.7 2.7 0 0 0 18.7 3H9.5c-.7 0-1.3.4-1.6 1l-2.7 6.2a2.8 2.8 0 0 0 2.6 3.9h2.4" />
        <Path d="M5.8 3.4H3.5c-.9 0-1.6.7-1.6 1.6v7.2c0 .9.7 1.6 1.6 1.6h2.3" fill="none" />
      </G>
    </Svg>
  );
}

export const reactionIcons = {
  mustTry: MustTryReactionIcon,
  notWorthIt: NotWorthItReactionIcon
} satisfies Record<FoodReactionType, (props: ReactionIconProps) => ReactElement>;
