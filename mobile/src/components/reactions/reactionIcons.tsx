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

export function HelpfulReactionIcon({
  color,
  fillColor,
  selected = false,
  size = 22,
  strokeWidth = 2.25
}: ReactionIconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <G fill={selected ? fillColor : "none"} stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth}>
        <Path d="M7.6 10.2v10.2" fill="none" />
        <Path d="M3.2 10.7h3.3c.6 0 1.1.5 1.1 1.1v7.5c0 .6-.5 1.1-1.1 1.1H3.2c-.6 0-1.1-.5-1.1-1.1v-7.5c0-.6.5-1.1 1.1-1.1Z" />
        <Path d="M7.8 11.1 11.7 4c.3-.6.9-.9 1.5-.9 1.1 0 1.9 1 1.6 2l-.8 3.4h4.8c1.7 0 2.9 1.6 2.5 3.2l-1.1 5.6a3.8 3.8 0 0 1-3.7 3.1H8.8c-.7 0-1.2-.5-1.2-1.2v-7c0-.4.1-.7.2-1.1Z" />
        <Path d="m18.7 3.5.8-1.4" fill="none" />
        <Path d="m20.7 6 1.4-.7" fill="none" />
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
  mustTry: HelpfulReactionIcon,
  notWorthIt: NotWorthItReactionIcon
} satisfies Record<FoodReactionType, (props: ReactionIconProps) => ReactElement>;
