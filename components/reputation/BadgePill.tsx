"use client";

import Image from "next/image";
import { Award, BadgeCheck, Bookmark, Camera, ChefHat, ClipboardList, Coffee, Compass, Crown, Film, Flag, Gem, Globe, Layers, Map, MapPin, Route, Star, Trophy, Users, Utensils } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type BadgePillProps = {
  badgeId?: string;
  name: string;
  description?: string;
  icon?: string;
  earnedAt?: string;
  onClick?: () => void;
};

const ICONS: Record<string, LucideIcon> = {
  award: Award,
  "badge-check": BadgeCheck,
  bookmark: Bookmark,
  camera: Camera,
  "chef-hat": ChefHat,
  "clipboard-list": ClipboardList,
  coffee: Coffee,
  compass: Compass,
  crown: Crown,
  film: Film,
  flag: Flag,
  gem: Gem,
  globe: Globe,
  layers: Layers,
  map: Map,
  "map-pin": MapPin,
  route: Route,
  star: Star,
  trophy: Trophy,
  users: Users,
  utensils: Utensils,
};

export function iconForBadge(icon?: string): LucideIcon {
  return ICONS[(icon ?? "award")] ?? Award;
}

/** Silver/steel variant for cuisine-explorer badges (chef-hat icon) */
function isLightBadge(icon?: string) {
  return icon === "chef-hat";
}

function BadgeOctagon({ icon }: { icon?: string }) {
  const Icon = iconForBadge(icon);
  const light = isLightBadge(icon);

  return (
    <div
      style={{
        width: 62,
        height: 62,
        clipPath:
          "polygon(29% 0%, 71% 0%, 100% 29%, 100% 71%, 71% 100%, 29% 100%, 0% 71%, 0% 29%)",
        background: light
          ? "linear-gradient(145deg, #D1D5DB 0%, #9CA3AF 50%, #6B7280 100%)"
          : "linear-gradient(145deg, #F5A623 0%, #D97706 50%, #92400E 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 46,
          height: 46,
          clipPath:
            "polygon(29% 0%, 71% 0%, 100% 29%, 100% 71%, 71% 100%, 29% 100%, 0% 71%, 0% 29%)",
          background: light
            ? "linear-gradient(145deg, #374151 0%, #1F2937 100%)"
            : "linear-gradient(145deg, #7C2D12 0%, #431407 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={20} strokeWidth={2} color="white" />
      </div>
    </div>
  );
}

const ACHIEVEMENT_BADGE_SRC: Record<string, string> = {
  first_bite: "/badges/achievements-transparent-ui/first-bite.png",
  photo_first: "/badges/achievements-transparent-ui/photo-first.png",
  good_call: "/badges/achievements-transparent-ui/good-call.png",
  food_explorer: "/badges/achievements-transparent-ui/food-explorer.png",
  area_explorer: "/badges/achievements-transparent-ui/area-explorer.png",
  cuisine_explorer: "/badges/achievements-transparent-ui/cuisine-explorer.png",
  cuisine_expert: "/badges/achievements-transparent-ui/cuisine-expert.png",
  crowd_approved: "/badges/achievements-transparent-ui/crowd-approved.png",
  hidden_gem_finder: "/badges/achievements-transparent-ui/hidden-gem-finder.png",
  visit_driver: "/badges/achievements-transparent-ui/visit-driver.png",
  dozen_reviews: "/badges/achievements-transparent-ui/dozen-reviews.png",
  twenty_five_reviews: "/badges/achievements-transparent-ui/twenty-five-reviews.png",
  hundred_reviews: "/badges/achievements-transparent-ui/hundred-reviews.png",
  multi_photo: "/badges/achievements-transparent-ui/multi-photo.png",
  detail_master: "/badges/achievements-transparent-ui/detail-master.png",
  save_magnet: "/badges/achievements-transparent-ui/save-magnet.png",
  must_try: "/badges/achievements-transparent-ui/must-try.png",
  taste_pioneer: "/badges/achievements-transparent-ui/taste-pioneer.png",
  regular: "/badges/achievements-transparent-ui/regular.png",
  neighborhood_guide: "/badges/achievements-transparent-ui/neighborhood-guide.png",
  weekly_explorer: "/badges/achievements-transparent-ui/weekly-explorer.png",
  monthly_explorer: "/badges/achievements-transparent-ui/monthly-explorer.png",
};

export function achievementBadgeSrc(badgeId?: string) {
  if (!badgeId) return null;
  const baseId = badgeId.split(":")[0];
  return ACHIEVEMENT_BADGE_SRC[baseId] ?? null;
}

export function AchievementBadgeArtwork({
  badgeId,
  icon,
  size = 62,
}: {
  badgeId?: string;
  icon?: string;
  size?: number;
}) {
  const src = achievementBadgeSrc(badgeId);
  if (src) {
    return (
      <Image
        src={src}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          objectFit: "contain",
          display: "block",
          flexShrink: 0,
          filter: "drop-shadow(0 8px 14px rgba(0,0,0,0.22))",
        }}
      />
    );
  }
  return <BadgeOctagon icon={icon} />;
}

export default function BadgePill({
  badgeId,
  name,
  icon,
  earnedAt,
  onClick,
}: BadgePillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={earnedAt ? `${name}, earned ${earnedAt}` : name}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        width: 88,
        height: 116,
        flexShrink: 0,
        padding: "12px 8px 10px",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.04)",
        cursor: "pointer",
        textAlign: "center",
      }}
    >
      <AchievementBadgeArtwork badgeId={badgeId} icon={icon} />
      <span
        style={{
          color: "var(--cream)",
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 11,
          fontWeight: 800,
          lineHeight: 1.25,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {name}
      </span>
    </button>
  );
}
