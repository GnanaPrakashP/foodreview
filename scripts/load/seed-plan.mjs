import { deterministicUuid, invariant } from "./lib.mjs";

function count(volumes, key, scale) {
  return Math.max(key === "users" || key === "profiles" ? 10 : 1, Math.floor(volumes[key] * scale));
}

export function seedCounts(config, scale = 1) {
  invariant(Number.isFinite(scale) && scale > 0 && scale <= 1, "seed_scale_invalid");
  return Object.fromEntries(Object.keys(config.seed.volumes).map((key) => [key, count(config.seed.volumes, key, scale)]));
}

export function buildSeedPlan(config, identities, scale = 1) {
  const counts = seedCounts(config, scale);
  invariant(identities.length >= counts.users, "seed_identity_count_insufficient");
  const namespace = config.seed.namespace;
  const users = identities.slice(0, counts.users).map((identity, index) => ({
    id: identity.id,
    email: identity.email,
    username: `load9_${String(index).padStart(4, "0")}`
  }));
  const at = (index, spreadDays = 90) => new Date(Date.now() - (index % (spreadDays * 24 * 60)) * 60000).toISOString();
  const user = (index) => users[index % users.length];

  const profiles = users.map((item, index) => ({
    account_status: index >= users.length - counts.accountDeletionJobs ? "deleting" : "active",
    account_type: index % 9 === 0 ? "private" : "public",
    bio: `Synthetic load profile ${index}`,
    deletion_started_at: index >= users.length - counts.accountDeletionJobs ? at(index, 1) : null,
    first_name: "Load",
    id: item.id,
    last_name: `Actor ${index}`,
    username: item.username
  }));
  const largeCircleUsers = Math.max(1, Math.floor(users.length * config.seed.distribution.largeCircleUserPercent / 100));
  const largeCircleEdges = Math.min(
    counts.circleMemberships,
    Math.floor(counts.circleMemberships / 2),
    largeCircleUsers * Math.max(1, users.length - 1)
  );
  const circleMemberships = Array.from({ length: counts.circleMemberships }, (_, index) => {
    const inLargeGroup = index < largeCircleEdges;
    const ownerPool = inLargeGroup ? largeCircleUsers : Math.max(1, users.length - largeCircleUsers);
    const poolIndex = inLargeGroup ? index : index - largeCircleEdges;
    const ownerIndex = inLargeGroup ? poolIndex % ownerPool : largeCircleUsers + (poolIndex % ownerPool);
    const memberIndex = (ownerIndex + 1 + Math.floor(poolIndex / ownerPool)) % users.length;
    const owner = user(ownerIndex);
    const member = user(memberIndex);
    return { id: deterministicUuid(namespace, `circle:${index}`), user_name: owner.username, member_name: member.username, created_at: at(index) };
  });
  const blocks = Array.from({ length: counts.blocks }, (_, index) => ({
    id: deterministicUuid(namespace, `block:${index}`),
    blocker_name: user(index * 7).username,
    blocked_name: user(index * 7 + 3).username,
    created_at: at(index)
  }));
  const baseMentionsPerReview = Math.floor(counts.dishMentions / counts.posts);
  const reviewsWithExtraMention = counts.dishMentions % counts.posts;
  let dishCursor = 0;
  const dishNames = ["Masala Dosa", "Biryani", "Idli", "Pizza"];
  const reviews = Array.from({ length: counts.posts }, (_, index) => {
    const owner = user(index * 13);
    const hidden = index > 0 && index % 100 === 0;
    const itemCount = baseMentionsPerReview + (index < reviewsWithExtraMention ? 1 : 0);
    const items = Array.from({ length: itemCount }, () => {
      const itemIndex = dishCursor;
      dishCursor += 1;
      return { name: dishNames[itemIndex % dishNames.length], rating: 3 + (itemIndex % 3) };
    });
    return {
      area: `Load Area ${index % 40}`,
      body: `Synthetic staging review ${index}`,
      created_at: at(index),
      hidden_at: hidden ? at(index, 1) : null,
      id: deterministicUuid(namespace, `review:${index}`),
      items,
      restaurant_id: `load9-place-${String(index % counts.places).padStart(4, "0")}`,
      restaurant_lat: 12.85 + (index % 100) * 0.001,
      restaurant_lng: 77.5 + (index % 100) * 0.001,
      restaurant_name: `Load Restaurant ${index % counts.places}`,
      reviewer_name: owner.username,
      status: hidden ? "hidden" : "active",
      tags: ["synthetic", index % 2 ? "dinner" : "breakfast"],
      visibility: index % 100 < config.seed.distribution.privatePostPercent
        ? "me"
        : index % 100 < config.seed.distribution.privatePostPercent + config.seed.distribution.circlePostPercent ? "circle" : "public"
    };
  });
  const highEngagementPosts = Math.max(1, Math.floor(reviews.length * config.seed.distribution.highEngagementPostPercent / 100));
  const highEngagementLikes = Math.min(counts.likes, highEngagementPosts * Math.min(35, users.length - 1));
  const likes = Array.from({ length: counts.likes }, (_, index) => {
    const isHighEngagement = index < highEngagementLikes;
    const localIndex = isHighEngagement ? index : index - highEngagementLikes;
    const postPool = isHighEngagement ? highEngagementPosts : Math.max(1, reviews.length - highEngagementPosts);
    const postIndex = isHighEngagement ? localIndex % postPool : highEngagementPosts + (localIndex % postPool);
    const likerIndex = (postIndex + 1 + Math.floor(localIndex / postPool)) % users.length;
    return {
      id: deterministicUuid(namespace, `like:${index}`), post_id: reviews[postIndex].id,
      user_name: user(likerIndex).username, created_at: at(index)
    };
  });
  const bookmarks = Array.from({ length: counts.bookmarks }, (_, index) => ({
    id: deterministicUuid(namespace, `bookmark:${index}`), post_id: reviews[index % reviews.length].id,
    restaurant_name: reviews[index % reviews.length].restaurant_name, user_name: user(index + 29).username, created_at: at(index)
  }));
  const reactions = Array.from({ length: counts.reactions }, (_, index) => {
    const review = reviews[index % reviews.length];
    const reviewer = users.find((entry) => entry.username === review.reviewer_name);
    const feedback = user(index + 41);
    return {
      created_at: at(index), feedback_label: index % 5 === 0 ? "Disagree" : "Helpful",
      feedback_user_id: feedback.id, feedback_value: index % 5 === 0 ? -0.5 : 1,
      id: deterministicUuid(namespace, `reaction:${index}`), place_id: review.restaurant_id,
      post_id: review.id, reviewer_user_id: reviewer.id, updated_at: at(index)
    };
  });
  const highEngagementComments = Math.floor(counts.comments * 0.4);
  const comments = Array.from({ length: counts.comments }, (_, index) => ({
    content: `Synthetic comment ${index}`, created_at: at(index), id: deterministicUuid(namespace, `comment:${index}`),
    post_id: reviews[index < highEngagementComments ? index % highEngagementPosts : highEngagementPosts + ((index - highEngagementComments) % Math.max(1, reviews.length - highEngagementPosts))].id,
    user_name: user(index + 53).username
  }));
  const notifications = Array.from({ length: counts.notifications }, (_, index) => {
    const recipient = user(index);
    const actor = user(index + 1);
    return {
      actor_name: actor.username, actor_user_id: actor.id, created_at: at(index), entity_id: reviews[index % reviews.length].id,
      entity_type: "review", id: deterministicUuid(namespace, `notification:${index}`), is_read: index % 100 >= config.seed.distribution.unreadNotificationPercent,
      metadata: { synthetic: true }, read: index % 100 >= config.seed.distribution.unreadNotificationPercent,
      recipient_name: recipient.username, recipient_user_id: recipient.id, type: "review_engagement", updated_at: at(index)
    };
  });
  const postViews = Array.from({ length: counts.postViews }, (_, index) => ({
    post_id: reviews[index % reviews.length].id, user_id: user(index + Math.floor(index / reviews.length)).id, viewed_at: at(index)
  }));
  const rooms = Array.from({ length: counts.memoryRooms }, (_, index) => ({
    area: `Load Area ${index % 40}`, created_at: at(index), created_by: user(index).username,
    id: deterministicUuid(namespace, `room:${index}`), restaurant_id: `load9-place-${String(index % counts.places).padStart(4, "0")}`,
    restaurant_name: `Load Restaurant ${index % counts.places}`, status: "published", title: `Synthetic Memory ${index}`,
    updated_at: at(index), visit_date: at(index).slice(0, 10)
  }));
  const roomMembers = [];
  const membershipKeys = new Set();
  const addRoomMember = (roomIndex, userIndex) => {
    if (roomMembers.length >= counts.memoryMemberships) return;
    const room = rooms[roomIndex % rooms.length];
    const member = user(userIndex);
    const key = `${room.id}:${member.username}`;
    if (membershipKeys.has(key)) return;
    const index = roomMembers.length;
    membershipKeys.add(key);
    roomMembers.push({
      created_at: at(index), id: deterministicUuid(namespace, `member:${index}`), room_id: room.id,
      role: member.username === room.created_by ? "owner" : "participant", user_name: member.username
    });
  };
  for (let index = 0; index < rooms.length; index += 1) addRoomMember(index, index);
  for (let roomIndex = 0; roomIndex < Math.min(rooms.length, config.seed.distribution.manyRoomUserRooms); roomIndex += 1) {
    addRoomMember(roomIndex, 0);
  }
  const requiredStressActors = Math.min(users.length, counts.memoryMemberships, config.safety.maxConcurrentUsers);
  for (let index = 0; index < requiredStressActors; index += 1) addRoomMember(index, index);
  const popularRoomCount = Math.max(1, Math.floor(rooms.length * config.seed.distribution.popularRoomPercent / 100));
  for (let cursor = 0; roomMembers.length < counts.memoryMemberships; cursor += 1) {
    const popular = cursor % 2 === 0 || popularRoomCount === rooms.length;
    const roomIndex = popular
      ? cursor % popularRoomCount
      : popularRoomCount + (cursor % Math.max(1, rooms.length - popularRoomCount));
    addRoomMember(roomIndex, (cursor * 37 + Math.floor(cursor / rooms.length)) % users.length);
  }
  const popularMessageCount = Math.floor(counts.memoryMessages * 0.3);
  const roomMessages = Array.from({ length: counts.memoryMessages }, (_, index) => {
    const roomIndex = index < popularMessageCount || popularRoomCount === rooms.length
      ? index % popularRoomCount
      : popularRoomCount + ((index - popularMessageCount) % Math.max(1, rooms.length - popularRoomCount));
    const room = rooms[roomIndex];
    const members = roomMembers.filter((member) => member.room_id === room.id);
    const author = members[index % members.length];
    return {
      author_name: author.user_name, body: `Synthetic Memory message ${index}`, created_at: at(index, 30),
      id: deterministicUuid(namespace, `message:${index}`), room_id: room.id
    };
  });
  const memoryDishes = Array.from({ length: counts.memoryDishes }, (_, index) => {
    const room = rooms[index % rooms.length];
    const member = roomMembers.find((entry) => entry.room_id === room.id);
    return {
      added_by: member.user_name, created_at: at(index), dish_name: ["Masala Dosa", "Biryani", "Idli", "Pizza"][index % 4],
      id: deterministicUuid(namespace, `memory-dish:${index}`), note: "Synthetic fixture", rating: 3 + (index % 3), room_id: room.id
    };
  });
  invariant(dishCursor === counts.dishMentions, "seed_dish_mention_distribution_mismatch");
  const dishMentionInputs = reviews.map((review) => {
    const owner = users.find((entry) => entry.username === review.reviewer_name);
    return {
      items: review.items,
      placeId: review.restaurant_id,
      reviewId: review.id,
      source: "backfill",
      submittedItems: review.items,
      userId: owner.id
    };
  });
  const contentReports = Array.from({ length: counts.contentReports }, (_, index) => {
    const reporter = user(index + 73);
    return {
      created_at: at(index), details: "Synthetic moderation load fixture", id: deterministicUuid(namespace, `report:${index}`),
      reason: index % 4 === 0 ? "spam" : "other", reporter_id: reporter.id, reporter_name: reporter.username,
      status: ["open", "reviewing", "resolved", "dismissed"][index % 4], target_id: reviews[index % reviews.length].id,
      target_type: "review", updated_at: at(index)
    };
  });
  const accountDeletionJobs = users.slice(-counts.accountDeletionJobs).map((item, index) => ({
    id: deterministicUuid(namespace, `deletion:${index}`), last_error_code: "synthetic_operator_fixture", max_attempts: 50,
    next_retry_at: new Date(Date.now() + 86400000).toISOString(), owner_name: item.username,
    status: "failed", user_id: item.id
  }));
  const candidateStart = Math.max(0, users.length - counts.accountDeletionJobs * 2);
  const frozenStart = Math.max(0, users.length - counts.accountDeletionJobs);
  const actors = users.map((item, index) => {
    const actorRoomIds = roomMembers.filter((member) => member.user_name === item.username).slice(0, config.seed.distribution.manyRoomUserRooms).map((member) => member.room_id);
    const blockedUsernames = blocks.flatMap((block) => block.blocker_name === item.username
      ? [block.blocked_name]
      : block.blocked_name === item.username ? [block.blocker_name] : []);
    return {
    blockedPostIds: reviews.filter((review) => blockedUsernames.includes(review.reviewer_name)).slice(0, 2).map((review) => review.id),
    blockedUsernames,
    deletionCandidate: index >= candidateStart && index < frozenStart,
    email: item.email,
    engagementPostIds: reviews.filter((review) => review.reviewer_name !== item.username && review.visibility === "public" && review.status === "active").slice(index % 200, index % 200 + 12).map((review) => review.id),
    forbiddenRoomIds: rooms.filter((room) => !actorRoomIds.includes(room.id)).slice(0, 2).map((room) => room.id),
    foreignCommentIds: comments.filter((comment) => comment.user_name !== item.username).slice(index % 100, index % 100 + 2).map((comment) => comment.id),
    frozenFixture: index >= frozenStart,
    loadFixtureVersion: 1,
    loadEligible: index < candidateStart,
    messageIds: actorRoomIds.flatMap((roomId) => {
      const message = roomMessages.find((row) => row.room_id === roomId);
      return message ? [{ messageId: message.id, roomId }] : [];
    }),
    placeIds: [`load9-place-${String(users.indexOf(item) % counts.places).padStart(4, "0")}`],
    postIds: reviews.filter((review) => review.reviewer_name === item.username).slice(0, 12).map((review) => review.id),
    roomIds: actorRoomIds,
    otherUsername: user(index + 1).username,
    username: item.username
  }; });
  return {
    counts,
    rows: { profiles, circleMemberships, blocks, reviews, likes, bookmarks, reactions, comments, notifications, postViews, rooms, roomMembers, roomMessages, memoryDishes, dishMentionInputs, contentReports, accountDeletionJobs },
    actors
  };
}
