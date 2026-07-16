import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function source(relativePath) {
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

async function loadLatestIntentModule() {
  const compiled = ts.transpileModule(source("mobile/src/state/latestPostEngagement.ts"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const {
  LatestIntentQueue,
  optimisticBookmarkIntentState,
  optimisticLikeIntentState,
  optimisticReactionIntentState
} = await loadLatestIntentModule();

function reactionState(label, helpful, disagree) {
  return {
    myFeedbackLabel: label,
    summary: {
      feedback_counts: { Helpful: helpful, Disagree: disagree }
    }
  };
}

test("rapid Like -> Unlike keeps the latest intent while the first response is delayed", async () => {
  const requests = [];
  const displays = [];
  const queue = new LatestIntentQueue({
    execute: ({ to }) => {
      const request = deferred();
      requests.push({ request, to });
      return request.promise;
    },
    getIntent: (state) => state.likedByMe,
    initialResult: { postId: "post-1", likedByMe: false, likeCount: 7 },
    onDisplay: (state, meta) => displays.push({ state: { ...state }, source: meta.source }),
    optimisticResult: optimisticLikeIntentState
  });

  queue.setDesiredIntent(true);
  queue.setDesiredIntent(false);
  assert.deepEqual(queue.getDisplayedResult(), { postId: "post-1", likedByMe: false, likeCount: 7 });
  assert.equal(requests.length, 1);

  requests[0].request.resolve({ postId: "post-1", likedByMe: true, likeCount: 8 });
  await flushMicrotasks();
  assert.equal(requests.length, 2);
  assert.deepEqual(queue.getDisplayedResult(), { postId: "post-1", likedByMe: false, likeCount: 7 });

  requests[1].request.resolve({ postId: "post-1", likedByMe: false, likeCount: 7 });
  await queue.waitForIdle();
  assert.deepEqual(queue.getSyncedResult(), { postId: "post-1", likedByMe: false, likeCount: 7 });
  assert.equal(displays.some(({ source, state }) => source === "stable" && state.likedByMe), false);
});

test("a superseded Like failure still reconciles the server explicitly to the latest Unlike intent", async () => {
  const requests = [];
  let errorCount = 0;
  const queue = new LatestIntentQueue({
    execute: ({ to }) => {
      const request = deferred();
      requests.push({ request, to });
      return request.promise;
    },
    getIntent: (state) => state.likedByMe,
    initialResult: { postId: "post-1b", likedByMe: false, likeCount: 7 },
    onDisplay: () => {},
    onError: () => { errorCount += 1; },
    optimisticResult: optimisticLikeIntentState
  });

  queue.setDesiredIntent(true);
  queue.setDesiredIntent(false);
  requests[0].request.reject(new Error("ambiguous timeout"));
  await flushMicrotasks();
  assert.deepEqual(requests.map(({ to }) => to), [true, false]);
  requests[1].request.resolve({ postId: "post-1b", likedByMe: false, likeCount: 7 });
  await queue.waitForIdle();
  assert.equal(queue.getDisplayedResult().likedByMe, false);
  assert.equal(errorCount, 0, "a superseded failure must not roll back or alert over the newer intent");
});

test("rapid Save -> Unsave serializes requests so an older delayed response cannot win out of order", async () => {
  const requests = [];
  const stableDisplays = [];
  const queue = new LatestIntentQueue({
    execute: ({ to }) => {
      const request = deferred();
      requests.push({ request, to });
      return request.promise;
    },
    getIntent: (state) => state.bookmarkedByMe,
    initialResult: { postId: "post-2", bookmarkedByMe: false },
    onDisplay: (state, meta) => {
      if (meta.source === "stable") stableDisplays.push(state.bookmarkedByMe);
    },
    optimisticResult: optimisticBookmarkIntentState
  });

  queue.setDesiredIntent(true);
  queue.setDesiredIntent(false);
  assert.equal(requests.length, 1, "the Unsave request must wait for the delayed Save response");
  requests[0].request.resolve({ postId: "post-2", bookmarkedByMe: true });
  await flushMicrotasks();
  assert.equal(requests.length, 2);
  requests[1].request.resolve({ postId: "post-2", bookmarkedByMe: false });
  await queue.waitForIdle();

  assert.equal(queue.getDisplayedResult().bookmarkedByMe, false);
  assert.deepEqual(stableDisplays, [false]);
});

test("Like and Save rollbacks are field-isolated when either simultaneous mutation fails", async () => {
  for (const failingControl of ["like", "save"]) {
    const cache = { likedByMe: false, likeCount: 2, bookmarkedByMe: false };
    const likeRequest = deferred();
    const saveRequest = deferred();
    const likeQueue = new LatestIntentQueue({
      execute: () => likeRequest.promise,
      getIntent: (state) => state.likedByMe,
      initialResult: { postId: "post-3", likedByMe: false, likeCount: 2 },
      onDisplay: (state) => {
        cache.likedByMe = state.likedByMe;
        cache.likeCount = state.likeCount;
      },
      optimisticResult: optimisticLikeIntentState
    });
    const saveQueue = new LatestIntentQueue({
      execute: () => saveRequest.promise,
      getIntent: (state) => state.bookmarkedByMe,
      initialResult: { postId: "post-3", bookmarkedByMe: false },
      onDisplay: (state) => {
        cache.bookmarkedByMe = state.bookmarkedByMe;
      },
      optimisticResult: optimisticBookmarkIntentState
    });

    likeQueue.setDesiredIntent(true);
    saveQueue.setDesiredIntent(true);
    if (failingControl === "like") {
      saveRequest.resolve({ postId: "post-3", bookmarkedByMe: true });
      likeRequest.reject(new Error("like failed"));
    } else {
      likeRequest.resolve({ postId: "post-3", likedByMe: true, likeCount: 3 });
      saveRequest.reject(new Error("save failed"));
    }
    await Promise.all([likeQueue.waitForIdle(), saveQueue.waitForIdle()]);

    assert.deepEqual(
      cache,
      failingControl === "like"
        ? { likedByMe: false, likeCount: 2, bookmarkedByMe: true }
        : { likedByMe: true, likeCount: 3, bookmarkedByMe: false }
    );
  }
});

test("Helpful -> Disagree does not display the delayed Helpful response", async () => {
  const requests = [];
  const displays = [];
  const queue = new LatestIntentQueue({
    execute: ({ to }) => {
      const request = deferred();
      requests.push({ request, to });
      return request.promise;
    },
    getIntent: (state) => state.myFeedbackLabel,
    initialResult: reactionState(null, 10, 3),
    onDisplay: (state, meta) => displays.push({ state, source: meta.source }),
    optimisticResult: optimisticReactionIntentState
  });

  queue.setDesiredIntent("Helpful");
  queue.setDesiredIntent("Disagree");
  assert.deepEqual(queue.getDisplayedResult(), reactionState("Disagree", 10, 4));
  requests[0].request.resolve(reactionState("Helpful", 11, 3));
  await flushMicrotasks();
  assert.deepEqual(queue.getDisplayedResult(), reactionState("Disagree", 10, 4));
  requests[1].request.resolve(reactionState("Disagree", 10, 4));
  await queue.waitForIdle();

  assert.deepEqual(queue.getDisplayedResult(), reactionState("Disagree", 10, 4));
  assert.equal(displays.some(({ source, state }) => source === "stable" && state.myFeedbackLabel === "Helpful"), false);
});

test("Helpful -> Disagree -> no selection consolidates directly to the latest state with accurate counts", async () => {
  const requests = [];
  const queue = new LatestIntentQueue({
    execute: ({ to }) => {
      const request = deferred();
      requests.push({ request, to });
      return request.promise;
    },
    getIntent: (state) => state.myFeedbackLabel,
    initialResult: reactionState(null, 4, 2),
    onDisplay: () => {},
    optimisticResult: optimisticReactionIntentState
  });

  queue.setDesiredIntent("Helpful");
  queue.setDesiredIntent("Disagree");
  queue.setDesiredIntent(null);
  assert.deepEqual(queue.getDisplayedResult(), reactionState(null, 4, 2));
  requests[0].request.resolve(reactionState("Helpful", 5, 2));
  await flushMicrotasks();
  assert.deepEqual(requests.map(({ to }) => to), ["Helpful", null]);
  requests[1].request.resolve(reactionState(null, 4, 2));
  await queue.waitForIdle();
  assert.deepEqual(queue.getDisplayedResult(), reactionState(null, 4, 2));
});

test("repeated alternating reactions keep only the latest intent and coalesce redundant network work", async () => {
  const request = deferred();
  const targets = [];
  const queue = new LatestIntentQueue({
    execute: ({ to }) => {
      targets.push(to);
      return request.promise;
    },
    getIntent: (state) => state.myFeedbackLabel,
    initialResult: reactionState(null, 8, 1),
    onDisplay: () => {},
    optimisticResult: optimisticReactionIntentState
  });

  for (const intent of ["Helpful", "Disagree", "Helpful", "Disagree", "Helpful"]) {
    queue.setDesiredIntent(intent);
  }
  assert.deepEqual(queue.getDisplayedResult(), reactionState("Helpful", 9, 1));
  request.resolve(reactionState("Helpful", 9, 1));
  await queue.waitForIdle();
  assert.deepEqual(targets, ["Helpful"]);
  assert.deepEqual(queue.getDisplayedResult(), reactionState("Helpful", 9, 1));
});

test("final failure rolls selected state and counts back to the last confirmed reaction", async () => {
  const request = deferred();
  const sources = [];
  const queue = new LatestIntentQueue({
    execute: () => request.promise,
    getIntent: (state) => state.myFeedbackLabel,
    initialResult: reactionState(null, 5, 2),
    onDisplay: (state, meta) => sources.push({ source: meta.source, state }),
    optimisticResult: optimisticReactionIntentState
  });

  queue.setDesiredIntent("Helpful");
  assert.deepEqual(queue.getDisplayedResult(), reactionState("Helpful", 6, 2));
  request.reject(new Error("offline"));
  await queue.waitForIdle();
  assert.deepEqual(queue.getDisplayedResult(), reactionState(null, 5, 2));
  assert.deepEqual(sources.at(-1), { source: "rollback", state: reactionState(null, 5, 2) });
});

test("a failed latest reaction rolls back to the accurate intermediate server counts", async () => {
  const requests = [];
  const queue = new LatestIntentQueue({
    execute: ({ to }) => {
      const request = deferred();
      requests.push({ request, to });
      return request.promise;
    },
    getIntent: (state) => state.myFeedbackLabel,
    initialResult: reactionState(null, 5, 2),
    onDisplay: () => {},
    optimisticResult: optimisticReactionIntentState
  });

  queue.setDesiredIntent("Helpful");
  queue.setDesiredIntent("Disagree");
  requests[0].request.resolve(reactionState("Helpful", 6, 2));
  await flushMicrotasks();
  requests[1].request.reject(new Error("Disagree failed"));
  await queue.waitForIdle();
  assert.deepEqual(queue.getDisplayedResult(), reactionState("Helpful", 6, 2));
});

test("Home alone opts into 24dp gaps, hidden dividers, green joined state, and compact title", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  const postFeed = source("mobile/src/components/feeds/PostFeed.tsx");
  const postCard = source("mobile/src/components/posts/PostCard.tsx");
  const otherConsumers = [
    "mobile/app/restaurants/[placeId].tsx",
    "mobile/app/(tabs)/hungry.tsx",
    "mobile/app/dishes/[dish].tsx",
    "mobile/app/profile/settings/liked.tsx",
    "mobile/app/profile/settings/saved.tsx",
    "mobile/app/people/[username].tsx",
    "mobile/app/reviews/[id].tsx",
    "mobile/app/(tabs)/profile.tsx"
  ].map(source).join("\n");

  assert.match(home, /const HOME_FEED_POST_SPACING = 24/);
  assert.match(home, /hidePostDividers/);
  assert.match(home, /postSpacing=\{HOME_FEED_POST_SPACING\}/);
  assert.match(home, /useGreenJoinedRequestState/);
  assert.doesNotMatch(home, /showSectionLabels/);
  assert.match(home, /fontSize: 26/);
  assert.match(home, /lineHeight: 32/);
  assert.match(postFeed, /hidePostDividers = false/);
  assert.match(postFeed, /postSpacing = 0/);
  assert.match(postFeed, /ItemSeparatorComponent=\{postSpacing > 0 \? renderPostSeparator : undefined\}/);
  assert.match(postCard, /hideDivider = false/);
  assert.match(postCard, /borderBottomWidth: 1/);
  assert.match(postCard, /hideDivider && styles\.cardWithoutDivider/);
  assert.match(postCard, /backgroundColor: c\.greenDim/);
  assert.match(postCard, /borderColor: c\.greenBorder/);
  assert.match(postCard, /color: c\.green/);
  assert.doesNotMatch(otherConsumers, /hidePostDividers|postSpacing=|useGreenJoinedRequestState/);
});
