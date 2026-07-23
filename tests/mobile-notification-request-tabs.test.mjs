import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screen = readFileSync("mobile/app/notifications.tsx", "utf8");
const service = readFileSync("mobile/src/services/notifications.ts", "utf8");
const hooks = readFileSync("mobile/src/hooks/useNotifications.ts", "utf8");
const route = readFileSync("app/api/notifications/route.ts", "utf8");
const push = readFileSync("mobile/src/providers/PushNotificationBootstrap.tsx", "utf8");

test("Notifications preserves the shared top anchor and mirrors the Profile swipe tabs", () => {
  assert.match(screen, /screen:\s*\{[\s\S]*?paddingTop:\s*screenLayout\.topGap/);
  assert.match(screen, /import \{ Tabs, type CollapsibleRef, type TabBarProps \} from "react-native-collapsible-tab-view"/);
  assert.match(screen, /<UnderlineTabBar/);
  assert.match(screen, /<Tabs\.Tab name="all" label="All">/);
  assert.match(screen, /<Tabs\.Tab name="requests" label="Requests">/);
  assert.match(screen, /pagerProps=\{\{ offscreenPageLimit: 1 \}\}/);
  assert.match(screen, /width=\{tabPagerWidth\}/);
  assert.match(screen, /<Tabs\.SectionList/);
});

test("Requests preserves Circle and Table Memory request history while actions stay pending-only", () => {
  assert.match(screen, /filter\(isRequestNotification\)/);
  assert.match(screen, /isIncomingCircleRequest\(notification\) && notification\.circleRequestStatus === "pending"/);
  assert.match(screen, /isIncomingMemoryInvite\(notification\) && notification\.memoryInviteStatus === "pending"/);
  assert.match(screen, /view: "all"/);
  assert.match(screen, /view: "requests"/);
  assert.match(screen, /const hasPendingRequests = useMemo\(\(\) => requestItems\.some\(isPendingRequest\)/);
  assert.match(screen, /getBadgeVisible=\{\(name\) => name === "requests" && hasPendingRequests\}/);
  assert.match(screen, /title="No requests yet"/);
  assert.match(screen, /circleRequestStatus === "accepted"[\s\S]*?label: "Accepted"/);
  assert.match(screen, /memoryInviteStatus === "accepted"[\s\S]*?label: "Joined"/);
});

test("request pages are filtered and paginated independently on the server", () => {
  assert.match(route, /const REQUEST_NOTIFICATION_TYPES = \[[\s\S]*?CIRCLE_REQUEST_RECEIVED[\s\S]*?circle_request[\s\S]*?TABLE_MEMORY_INVITE/);
  assert.match(route, /viewParam !== "all" && viewParam !== "requests"/);
  assert.match(route, /\.in\("type", \[\.\.\.REQUEST_NOTIFICATION_TYPES\]\)/);
  assert.doesNotMatch(route, /metadata->>status/);
  assert.match(service, /if \(view === "requests"\) params\.set\("view", view\)/);
  assert.match(hooks, /queryKey: \[\.\.\.notificationKeys\.list, view, options\.limit \?\? 30\]/);
});

test("incoming request pushes open Requests before any room deep link", () => {
  assert.match(push, /router\.push\(\{ pathname: "\/notifications", params: \{ tab: "requests" \} \}\)/);
  assert.match(push, /notificationType === "CIRCLE_REQUEST_RECEIVED" \|\| notificationType === "circle_request"\) \{\s*openRequestInbox\(\)/);
  const inviteBranch = push.indexOf('notificationType === "TABLE_MEMORY_INVITE"');
  const roomBranch = push.indexOf("const roomId = roomIdFromNotificationResponse(response)");
  assert.ok(inviteBranch >= 0 && roomBranch >= 0 && inviteBranch < roomBranch);
});
