import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  memoryMessageLogicalKey,
  mergeMemoryMessageSnapshot,
  removeMemoryMessage,
  upsertMemoryMessage
} from "../mobile/src/services/memoryMessageReconciliation.mjs";
import {
  beginForegroundMemoryMessageSend,
  endForegroundMemoryMessageSend,
  isForegroundMemoryMessageSend,
  resetForegroundMemoryMessageSends
} from "../mobile/src/services/memoryMessageSendRegistry.mjs";

function message({
  body,
  clientId,
  sequence,
  status = "pending",
  serverCreatedAt = null,
  serverId = null,
  type = "text"
}) {
  const clientCreatedAt = `2026-07-27T10:00:00.${String(sequence).padStart(3, "0")}Z`;
  return {
    attachments: type === "media" ? [{ id: `asset-${clientId}` }] : [],
    authorDisplayName: "Rapid Sender",
    authorName: "rapid.sender",
    body,
    clientCreatedAt,
    clientId,
    clientOrderKey: `${clientCreatedAt}:${String(sequence).padStart(16, "0")}:${clientId}`,
    clientSequence: sequence,
    createdAt: clientCreatedAt,
    deliveryStatus: status,
    editedAt: null,
    id: serverId ?? `optimistic-message:room:${clientId}`,
    replyToMessage: null,
    replyToMessageId: null,
    roomId: "room",
    serverCreatedAt,
    serverId
  };
}

function confirm(local, serverIndex) {
  return {
    ...local,
    createdAt: local.clientCreatedAt,
    deliveryStatus: "sent",
    id: `server-${serverIndex}`,
    serverCreatedAt: `2026-07-27T11:00:00.${String(999 - serverIndex).padStart(3, "0")}Z`,
    serverId: `server-${serverIndex}`
  };
}

function permutations(values) {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) => (
    permutations(values.filter((_, candidateIndex) => candidateIndex !== index))
      .map((rest) => [value, ...rest])
  ));
}

test("foreground send ownership prevents recovery replay until every owner releases", () => {
  resetForegroundMemoryMessageSends();
  const clientId = "foreground-send-client-000001";
  beginForegroundMemoryMessageSend(clientId);
  beginForegroundMemoryMessageSend(clientId);
  assert.equal(isForegroundMemoryMessageSend(clientId), true);
  endForegroundMemoryMessageSend(clientId);
  assert.equal(isForegroundMemoryMessageSend(clientId), true);
  endForegroundMemoryMessageSend(clientId);
  assert.equal(isForegroundMemoryMessageSend(clientId), false);
});

test("reverse HTTP/realtime acknowledgements keep A-E in press order and one row per clientId", () => {
  const optimistic = ["A", "B", "C", "D", "E"].map((body, sequence) => (
    message({ body, clientId: `client-${sequence}-abcdefghijkl`, sequence })
  ));
  let state = optimistic;
  for (const index of [4, 3, 2, 1, 0]) {
    state = upsertMemoryMessage(state, confirm(optimistic[index], index));
  }
  assert.deepEqual(state.map((item) => item.body), ["A", "B", "C", "D", "E"]);
  assert.equal(new Set(state.map(memoryMessageLogicalKey)).size, 5);
  assert.ok(state.every((item) => item.deliveryStatus === "sent"));
});

test("all 120 A-E acknowledgement orders tolerate duplicate realtime, HTTP, and stale snapshots", () => {
  const optimistic = ["A", "B", "C", "D", "E"].map((body, sequence) => (
    message({ body, clientId: `client-permutation-${sequence}-000`, sequence })
  ));
  for (const acknowledgementOrder of permutations([0, 1, 2, 3, 4])) {
    let state = optimistic;
    const confirmed = [];
    for (const index of acknowledgementOrder) {
      const serverMessage = confirm(optimistic[index], index);
      confirmed.push(serverMessage);
      state = upsertMemoryMessage(state, serverMessage);
      state = upsertMemoryMessage(state, serverMessage);
      state = mergeMemoryMessageSnapshot(state, confirmed);
      state = mergeMemoryMessageSnapshot(state, []);
    }
    assert.deepEqual(state.map((item) => item.body), ["A", "B", "C", "D", "E"]);
    assert.equal(state.length, 5);
    assert.equal(new Set(state.map(memoryMessageLogicalKey)).size, 5);
  }
});

test("twenty reverse confirmations retain press order", () => {
  const optimistic = Array.from({ length: 20 }, (_, sequence) => (
    message({
      body: `message-${String(sequence).padStart(2, "0")}`,
      clientId: `client-twenty-${String(sequence).padStart(2, "0")}-000000`,
      sequence
    })
  ));
  let state = optimistic;
  for (let index = optimistic.length - 1; index >= 0; index -= 1) {
    state = upsertMemoryMessage(state, confirm(optimistic[index], index));
  }
  assert.deepEqual(state.map((item) => item.body), optimistic.map((item) => item.body));
});

test("identical rapid messages stay distinct through realtime then HTTP duplicates", () => {
  const first = message({ body: "same", clientId: "client-identical-00000001", sequence: 1 });
  const second = message({ body: "same", clientId: "client-identical-00000002", sequence: 2 });
  let state = [first, second];
  state = upsertMemoryMessage(state, confirm(second, 2));
  state = upsertMemoryMessage(state, confirm(first, 1));
  state = upsertMemoryMessage(state, confirm(second, 2));
  assert.equal(state.length, 2);
  assert.deepEqual(state.map((item) => item.clientId), [first.clientId, second.clientId]);
});

test("stale bootstrap and cursor snapshots cannot erase or resurrect a local pending row", () => {
  const pending = message({ body: "local", clientId: "client-stale-0000000001", sequence: 1 });
  const remote = confirm(
    message({ body: "remote", clientId: "client-remote-000000001", sequence: 0 }),
    9
  );
  let state = mergeMemoryMessageSnapshot([pending], [remote]);
  assert.deepEqual(state.map((item) => item.body), ["remote", "local"]);
  state = mergeMemoryMessageSnapshot(state, [remote]);
  assert.equal(state.filter((item) => item.clientId === pending.clientId).length, 1);
});

test("one targeted failure and retry never restores or removes sibling successes", () => {
  const items = ["A", "B", "C"].map((body, sequence) => (
    message({ body, clientId: `client-failure-${sequence}-00000`, sequence })
  ));
  let state = items;
  state = upsertMemoryMessage(state, confirm(items[2], 2));
  state = upsertMemoryMessage(state, { ...items[1], deliveryStatus: "failed" });
  assert.deepEqual(state.map((item) => item.deliveryStatus), ["pending", "failed", "sent"]);
  state = upsertMemoryMessage(state, { ...items[1], deliveryStatus: "retrying" });
  state = upsertMemoryMessage(state, confirm(items[1], 1));
  assert.deepEqual(state.map((item) => item.deliveryStatus), ["pending", "sent", "sent"]);
});

test("late failure and retry events cannot demote an already confirmed message", () => {
  const pending = message({ body: "monotonic", clientId: "client-monotonic-00000001", sequence: 1 });
  const sent = confirm(pending, 1);
  let state = upsertMemoryMessage([pending], sent);
  state = upsertMemoryMessage(state, { ...pending, deliveryStatus: "failed" });
  state = upsertMemoryMessage(state, { ...pending, deliveryStatus: "retrying" });
  assert.equal(state.length, 1);
  assert.equal(state[0].deliveryStatus, "sent");
  assert.equal(state[0].serverId, sent.serverId);
});

test("mixed text/media operations retain independent stable identities", () => {
  const textA = message({ body: "A", clientId: "client-mixed-text-a-0001", sequence: 1 });
  const media = message({
    body: "",
    clientId: "client-mixed-media-000001",
    sequence: 2,
    status: "uploading",
    type: "media"
  });
  const textB = message({ body: "B", clientId: "client-mixed-text-b-0001", sequence: 3 });
  let state = [textA, media, textB];
  state = upsertMemoryMessage(state, confirm(textB, 3));
  state = upsertMemoryMessage(state, confirm(textA, 1));
  state = upsertMemoryMessage(state, confirm(media, 2));
  assert.deepEqual(state.map(memoryMessageLogicalKey), [
    textA.clientId,
    media.clientId,
    textB.clientId
  ]);
});

test("confirming one row preserves unaffected sibling object references", () => {
  const first = message({ body: "A", clientId: "client-reference-a-000001", sequence: 1 });
  const second = message({ body: "B", clientId: "client-reference-b-000001", sequence: 2 });
  const third = message({ body: "C", clientId: "client-reference-c-000001", sequence: 3 });
  const state = upsertMemoryMessage([first, second, third], confirm(second, 2));
  assert.equal(state[0], first);
  assert.equal(state[2], third);
  assert.notEqual(state[1], second);
});

test("serialized restart data reconciles by persisted clientId without a session side map", () => {
  const pending = message({ body: "restart", clientId: "client-restart-000000001", sequence: 7 });
  const restarted = JSON.parse(JSON.stringify([pending]));
  const state = upsertMemoryMessage(restarted, confirm(pending, 7));
  assert.equal(state.length, 1);
  assert.equal(memoryMessageLogicalKey(state[0]), pending.clientId);
});

test("legacy compatibility is one-to-one and never collapses ambiguous identical rows", () => {
  const legacyBase = {
    ...message({ body: "legacy", clientId: "discarded-legacy-client", sequence: 1 }),
    clientId: null,
    clientOrderKey: "",
    id: "legacy-pending-1"
  };
  const ambiguous = [{ ...legacyBase }, { ...legacyBase, id: "legacy-pending-2" }];
  const server = {
    ...confirm(legacyBase, 10),
    clientId: null,
    clientOrderKey: "legacy-server"
  };
  assert.equal(upsertMemoryMessage(ambiguous, server).length, 3);
  assert.equal(upsertMemoryMessage([legacyBase], server).length, 1);
});

test("explicit delete removes only its addressed server/client identity", () => {
  const first = confirm(message({ body: "A", clientId: "client-delete-a-0000001", sequence: 1 }), 1);
  const second = confirm(message({ body: "B", clientId: "client-delete-b-0000001", sequence: 2 }), 2);
  assert.deepEqual(removeMemoryMessage([first, second], first.serverId).map((item) => item.body), ["B"]);
});

test("Android composer contract atomically captures native text and never branches Send on delayed JS state", () => {
  const screen = readFileSync("mobile/app/memories/[id].tsx", "utf8");
  const nativeInput = readFileSync(
    "mobile/modules/keyboard-inset/android/src/main/java/expo/modules/keyboardinset/NativeChatInputView.kt",
    "utf8"
  );
  const toolbar = screen.match(
    /function MemoryChatMainInputToolbar\([\s\S]*?\n\}\n\n(?:\/\/[^\n]*\n)*function MemoryChatMainSelectionToolbar/
  )?.[0] ?? "";

  assert.match(nativeInput, /fun submitAndClear\(\): NativeChatInputSubmitResult/);
  assert.match(nativeInput, /BaseInputConnection\.removeComposingSpans\(editable\)/);
  assert.match(nativeInput, /val submittedText = editable\?\.toString\(\)\.orEmpty\(\)/);
  assert.match(nativeInput, /clearNativeBuffer\(\)[\s\S]*mostRecentNativeEventCount \+= 1/);
  assert.match(toolbar, /if \(Platform\.OS === "android"\) \{[\s\S]*await inputRef\.current\?\.submit\(\)/);
  assert.match(toolbar, /if \(textSubmitInFlightRef\.current\) return/);
  assert.match(screen, /const textSubmitInFlightRef = useRef\(false\)/);
  assert.match(screen, /textSubmitInFlightRef=\{textSubmitInFlightRef\}/);
  assert.match(toolbar, /const outgoingText = submission\.text\.trim\(\)/);
  assert.match(toolbar, /if \(outgoingText\) \{[\s\S]*onSend\?\.\(/);
  assert.doesNotMatch(
    toolbar.match(/if \(Platform\.OS === "android"\) \{[\s\S]*?\n    \}/)?.[0] ?? "",
    /sendAffordance\.value === 1/
  );
});
