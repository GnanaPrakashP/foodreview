export type Priority = "H" | "M" | "L";

export interface CircleTest {
  id: string;
  title: string;
  priority: Priority;
  section: string;
  preconditions: string;
  steps: string[];
  expectedUI: string;
  expectedBackend: string;
  smoke?: boolean;
  supportsNA?: boolean;
}

export const SMOKE_TEST_IDS = new Set([
  "CIR-001",
  "CIR-006",
  "CIR-017",
  "CIR-013",
  "CIR-067",
  "CIR-057",
  "CIR-052",
  "CIR-033",
]);

export const SECTIONS = [
  "Public Account Add Flow",
  "Private Account Request Flow",
  "Cancel Request",
  "Accept Request from Notification Bell",
  "Reject Request from Notification Bell",
  "Accept / Reject from User Profile",
  "Notification Disappearance After Actions",
  "Stale Notification Handling",
  "Page Refresh After Actions",
  "Multi-Tab Stale State Behavior",
  "Search Result Button States",
  "Profile Button States",
  "Public / Private Account Switch Behavior",
  "Common Restaurant Badge Visibility",
  "Circle-Only Post Visibility",
  "Public Post Visibility from Private Accounts",
  "Trending Page Behavior",
  "Remove from Circle",
  "Mobile Responsive Checks",
  "Negative and Error Cases",
] as const;

export const circleTests: CircleTest[] = [
  // ── Section 1: Public Account Add Flow ──────────────────────────────────
  {
    id: "CIR-001",
    title: "Add a public account — button state transitions correctly",
    priority: "H",
    section: "Public Account Add Flow",
    smoke: true,
    preconditions: "User A logged in. User B has a PUBLIC account. No existing circle relationship.",
    steps: [
      "Navigate to User B's profile page as User A.",
      "Observe the button label next to User B's name.",
      "Click the Add button.",
      "Observe the button label immediately after clicking.",
    ],
    expectedUI:
      "Step 2: Button reads 'Add'. Step 4: Button changes to 'In Circle' without page reload. No 'Requested' intermediate state for public accounts.",
    expectedBackend:
      "circle_memberships: row added WHERE user_name=B, member_name=A. No row WHERE user_name=A, member_name=B. circle_requests: no pending row created.",
  },
  {
    id: "CIR-002",
    title: "Add a public account — duplicate click does not duplicate membership",
    priority: "H",
    section: "Public Account Add Flow",
    preconditions: "CIR-001 completed — A is already in B's circle.",
    steps: [
      "Navigate to User B's profile as User A.",
      "Confirm button reads 'In Circle'.",
      "Click the button again if the UI allows re-clicking.",
      "Refresh the page.",
    ],
    expectedUI:
      "Clicking while already in circle should not change state to 'Add' and back. After refresh: still 'In Circle'.",
    expectedBackend:
      "Exactly one circle_memberships row for (user_name=B, member_name=A). No duplicate rows.",
  },
  {
    id: "CIR-003",
    title: "Add a public account — User B sees A in their circle member list",
    priority: "H",
    section: "Public Account Add Flow",
    preconditions: "CIR-001 completed — A joined B's public circle.",
    steps: [
      "Log out and log in as User B.",
      "Navigate to the People / Circle section.",
      "Look for User A in the list of circle members.",
    ],
    expectedUI:
      "User A appears in B's circle member list. User B is NOT automatically shown in A's circle.",
    expectedBackend:
      "circle_memberships: (user_name=B, member_name=A) exists. (user_name=A, member_name=B) does NOT exist.",
  },
  {
    id: "CIR-004",
    title: "Public account add — A sees B's circle posts after joining",
    priority: "M",
    section: "Public Account Add Flow",
    preconditions: "A has joined B's circle. User B has at least one post with visibility set to 'circle'.",
    steps: [
      "Log in as User A.",
      "Navigate to User B's profile.",
    ],
    expectedUI:
      "B's circle-visibility posts are visible to A. B's me-only posts are NOT visible to A.",
    expectedBackend: "No change — read-only check.",
  },
  {
    id: "CIR-005",
    title: "Public account add — A's feed updates after joining B's circle",
    priority: "M",
    section: "Public Account Add Flow",
    preconditions: "A has NOT yet joined B's circle. User B has circle-visibility posts.",
    steps: [
      "Log in as A; check the circle/trending feed and confirm B's posts are absent.",
      "Navigate to B's profile and click Add.",
      "Return to the circle feed.",
    ],
    expectedUI:
      "After adding B, B's circle-visibility posts appear in A's feed (may require page refresh).",
    expectedBackend: "circle_memberships: (user_name=B, member_name=A) created.",
  },

  // ── Section 2: Private Account Request Flow ──────────────────────────────
  {
    id: "CIR-006",
    title: "Send request to private account — button transitions to 'Requested'",
    priority: "H",
    section: "Private Account Request Flow",
    smoke: true,
    preconditions: "User A logged in. User B has a PRIVATE account. No existing circle relationship.",
    steps: [
      "Navigate to User B's profile as User A.",
      "Observe the button label.",
      "Click the button to send a request.",
      "Observe the button label immediately after.",
    ],
    expectedUI:
      "Step 2: Button reads 'Add' or 'Send Request'. Step 4: Button changes to 'Requested' without page reload. No 'In Circle' state appears immediately.",
    expectedBackend:
      "circle_requests: one row with sender_name=A, receiver_name=B, status=pending. circle_memberships: NO row created yet.",
  },
  {
    id: "CIR-007",
    title: "Private account request — notification appears in B's notification bell",
    priority: "H",
    section: "Private Account Request Flow",
    preconditions: "CIR-006 completed — A sent request to B.",
    steps: [
      "Log out and log in as User B.",
      "Look at the notification bell/icon.",
      "Click to open notifications.",
      "Find the circle request notification from A.",
    ],
    expectedUI:
      "Notification badge appears on the bell. Notification reads 'A requested to join your circle'. Notification has Accept and Decline buttons.",
    expectedBackend:
      "notifications: row with recipient_name=B, actor_name=A, type=CIRCLE_REQUEST_RECEIVED (or circle_request), is_read=false.",
  },
  {
    id: "CIR-008",
    title: "Private account request — duplicate request does not create second row",
    priority: "H",
    section: "Private Account Request Flow",
    preconditions: "CIR-006 completed — pending request exists.",
    steps: [
      "Navigate to B's profile as A (button shows 'Requested').",
      "If the button is clickable, click it again.",
      "Check the notification bell as User B.",
    ],
    expectedUI:
      "Button remains 'Requested'. B sees only ONE circle request notification from A, not two.",
    expectedBackend:
      "circle_requests: exactly one row with sender_name=A, receiver_name=B. notifications: exactly one notification row (upserted, not duplicated).",
  },
  {
    id: "CIR-009",
    title: "Private account request — page refresh preserves 'Requested' state",
    priority: "H",
    section: "Private Account Request Flow",
    preconditions: "CIR-006 completed — pending request exists.",
    steps: [
      "While on B's profile as A, hard-refresh the page (Ctrl+Shift+R / Cmd+Shift+R).",
    ],
    expectedUI: "Button still shows 'Requested' after reload. Not reset to 'Add'.",
    expectedBackend: "circle_requests: row still with status=pending.",
  },
  {
    id: "CIR-010",
    title: "Private request — resend after rejection reactivates to 'Requested'",
    priority: "M",
    section: "Private Account Request Flow",
    preconditions: "A had a previous request that B rejected. A is logged in and on B's profile.",
    steps: [
      "Confirm button shows 'Add' (previous request was rejected).",
      "Click the button to resend the request.",
      "Observe the button state.",
    ],
    expectedUI:
      "Button transitions to 'Requested' again. No error shown to A.",
    expectedBackend:
      "circle_requests: existing row updated to status=pending (no new row). notifications: B receives a new/updated circle request notification.",
  },
  {
    id: "CIR-011",
    title: "Private request — A cannot see B's circle-only posts before acceptance",
    priority: "H",
    section: "Private Account Request Flow",
    preconditions: "A has a pending request to B. B has at least one circle-visibility post.",
    steps: [
      "Navigate to B's profile as A.",
      "Count visible posts.",
    ],
    expectedUI:
      "Only B's PUBLIC posts are visible to A. B's circle-visibility posts do NOT appear.",
    expectedBackend: "No change — read-only visibility check.",
  },
  {
    id: "CIR-012",
    title: "Reverse pending auto-accept — A sends to B who already requested A",
    priority: "M",
    section: "Private Account Request Flow",
    preconditions: "User B (private) sent a request to User A that is still pending. User A has NOT yet responded.",
    steps: [
      "Log in as User A.",
      "Navigate to User B's profile.",
      "Click Add / Send Request on B's profile.",
      "Observe the resulting button state.",
    ],
    expectedUI:
      "Button immediately shows 'Mutual' or 'In Circle' (not 'Requested'). Flow completes instantly — no separate accept step needed.",
    expectedBackend:
      "circle_requests: B's pending request updated to status=accepted. circle_memberships: TWO rows — (user_name=A, member_name=B) AND (user_name=B, member_name=A).",
  },

  // ── Section 3: Cancel Request ────────────────────────────────────────────
  {
    id: "CIR-013",
    title: "Cancel pending request from B's profile — button resets to 'Add'",
    priority: "H",
    section: "Cancel Request",
    smoke: true,
    preconditions: "A has a pending request to B (private account). Button shows 'Requested' on B's profile.",
    steps: [
      "Navigate to B's profile as A.",
      "Click 'Cancel Request' (or click 'Requested' to reveal cancel action).",
      "Confirm the cancellation in any dialog that appears.",
      "Observe the button state.",
    ],
    expectedUI:
      "Button reverts to 'Add' / 'Send Request'. No error message.",
    expectedBackend:
      "circle_requests: pending row WHERE sender=A, receiver=B deleted or marked cancelled. notifications: B's circle request notification soft-deleted (deleted_at set).",
  },
  {
    id: "CIR-014",
    title: "Cancel pending request — B's notification disappears",
    priority: "H",
    section: "Cancel Request",
    preconditions: "A has a pending request to B. B can see the notification in their bell.",
    steps: [
      "As User A, cancel the request (see CIR-013 steps).",
      "Log in as User B.",
      "Open the notification bell.",
    ],
    expectedUI:
      "The circle request notification from A is no longer visible. Notification count badge decreases or disappears.",
    expectedBackend:
      "notifications row for this pair: deleted_at is set (soft-deleted).",
  },
  {
    id: "CIR-015",
    title: "Cancel pending request — page refresh preserves cancellation",
    priority: "H",
    section: "Cancel Request",
    preconditions: "CIR-013 completed — request cancelled.",
    steps: [
      "Hard-refresh B's profile page while logged in as A.",
      "Observe the button state.",
    ],
    expectedUI: "Button still reads 'Add' after refresh, not 'Requested'.",
    expectedBackend: "circle_requests: no pending row for this pair.",
  },
  {
    id: "CIR-016",
    title: "Cancel accepted request — blocked by UI or returns error",
    priority: "H",
    section: "Cancel Request",
    preconditions: "A sent a request to B (private); B accepted it. A and B are now in circle.",
    steps: [
      "Navigate to B's profile as A.",
      "Attempt to use any 'cancel' or 'remove' action.",
      "Observe the resulting action / error.",
    ],
    expectedUI:
      "If a cancel action is presented: the UI shows an error or redirects A to the remove flow. The circle membership remains intact after the attempt.",
    expectedBackend:
      "circle_memberships: both edges unchanged. No circle_requests rows deleted.",
  },

  // ── Section 4: Accept Request from Notification Bell ────────────────────
  {
    id: "CIR-017",
    title: "Accept circle request from notification bell — mutual circle created",
    priority: "H",
    section: "Accept Request from Notification Bell",
    smoke: true,
    preconditions: "A sent a request to B (private account). B is logged in and can see the notification.",
    steps: [
      "Log in as User B.",
      "Open the notification bell.",
      "Find the circle request notification from A.",
      "Click 'Accept'.",
      "Observe the notification state.",
      "Navigate to A's profile as B and observe the button.",
    ],
    expectedUI:
      "Step 5: Notification updates or disappears. Step 6: Button reads 'Mutual' or 'In Circle' indicating mutual connection.",
    expectedBackend:
      "circle_requests: row updated to status=accepted. circle_memberships: (user_name=B, member_name=A) AND (user_name=A, member_name=B) both created.",
  },
  {
    id: "CIR-018",
    title: "Accept request — A receives 'accepted' notification",
    priority: "H",
    section: "Accept Request from Notification Bell",
    preconditions: "CIR-017 completed — B accepted A's request.",
    steps: [
      "Log in as User A.",
      "Open the notification bell.",
      "Look for a 'B accepted your circle request' notification.",
    ],
    expectedUI:
      "A sees a notification indicating B accepted their request. Notification links to B's profile.",
    expectedBackend:
      "notifications: row with recipient_name=A, actor_name=B, type=CIRCLE_REQUEST_ACCEPTED.",
  },
  {
    id: "CIR-019",
    title: "Accept request — A sees B's circle posts immediately after acceptance",
    priority: "H",
    section: "Accept Request from Notification Bell",
    preconditions: "CIR-017 completed. B has at least one circle-visibility post.",
    steps: [
      "Log in as User A after B has accepted.",
      "Navigate to B's profile.",
    ],
    expectedUI:
      "B's circle-visibility posts are now visible to A. A does not need to re-add or re-send a request.",
    expectedBackend: "No change — read-only visibility check.",
  },
  {
    id: "CIR-020",
    title: "Double accept — accepting the same request twice is idempotent",
    priority: "M",
    section: "Accept Request from Notification Bell",
    preconditions: "B has already accepted A's request.",
    steps: [
      "Log in as User B.",
      "If the notification still shows, attempt to click Accept again.",
      "Observe the result.",
    ],
    expectedUI:
      "No error shown to B. State remains 'Mutual' — no duplicate circle edges created.",
    expectedBackend:
      "circle_memberships: still exactly two rows (one per direction). No duplicate rows.",
  },

  // ── Section 5: Reject Request from Notification Bell ────────────────────
  {
    id: "CIR-021",
    title: "Reject circle request from notification bell — no circle created",
    priority: "H",
    section: "Reject Request from Notification Bell",
    preconditions: "A sent a request to B (private account). B can see the notification.",
    steps: [
      "Log in as User B.",
      "Open notifications and find A's request.",
      "Click 'Decline' / 'Reject'.",
      "Navigate to A's profile as B.",
    ],
    expectedUI:
      "Step 3: Notification shows rejected/dismissed state or disappears. Step 4: No circle connection shown.",
    expectedBackend:
      "circle_requests: row updated to status=rejected. circle_memberships: NO rows created for this pair.",
  },
  {
    id: "CIR-022",
    title: "Reject request — A's button resets to 'Add' after rejection",
    priority: "H",
    section: "Reject Request from Notification Bell",
    preconditions: "CIR-021 completed — B rejected A's request.",
    steps: [
      "Log in as User A.",
      "Navigate to B's profile.",
      "Observe the button state.",
    ],
    expectedUI:
      "Button reads 'Add' or 'Send Request' (not 'Requested'). A can resend a request if desired.",
    expectedBackend:
      "circle_requests: row with status=rejected. circle_memberships: no rows.",
  },

  // ── Section 6: Accept / Reject from User Profile ────────────────────────
  {
    id: "CIR-023",
    title: "Accept incoming request from A's profile page as B",
    priority: "M",
    section: "Accept / Reject from User Profile",
    supportsNA: true,
    preconditions: "A sent a request to B (private). B visits A's profile directly (not via notification bell).",
    steps: [
      "Log in as User B.",
      "Navigate directly to A's profile page.",
      "Look for an 'Accept Request' or 'Incoming Request' button.",
      "Click Accept.",
    ],
    expectedUI:
      "Button state on A's profile updates to 'Mutual' or accepted state. If there is no button on the profile for incoming requests, mark this test N/A.",
    expectedBackend:
      "circle_requests: row updated to accepted. circle_memberships: both edges created.",
  },
  {
    id: "CIR-024",
    title: "Profile shows correct button for each relationship state",
    priority: "H",
    section: "Accept / Reject from User Profile",
    preconditions:
      "Set up pairs: no relationship → 'Add', pending outgoing → 'Requested', pending incoming → 'Accept Request', one-way → 'In Circle', mutual → 'Mutual'.",
    steps: [
      "Log in as User A and navigate to each counterpart's profile.",
      "Record the button label for each relationship state.",
    ],
    expectedUI:
      "Each profile shows the correct button matching its relationship state. No state bleeds into another.",
    expectedBackend: "No change — read-only state check.",
  },
  {
    id: "CIR-025",
    title: "Incoming request button shows 'Accept Request' not 'Add'",
    priority: "H",
    section: "Accept / Reject from User Profile",
    preconditions: "User B (private) sent a request to User A.",
    steps: [
      "Log in as User A.",
      "Navigate to User B's profile.",
    ],
    expectedUI:
      "Button reads 'Accept Request' (not 'Add'). Clicking the button accepts the request and both enter mutual circle.",
    expectedBackend:
      "No new circle_requests row created. Existing B→A request updated to accepted, mutual edges created.",
  },

  // ── Section 7: Notification Disappearance After Actions ─────────────────
  {
    id: "CIR-026",
    title: "Notification disappears after A cancels their outgoing request",
    priority: "H",
    section: "Notification Disappearance After Actions",
    preconditions: "A has a pending request to B (private). B has an unread notification from A.",
    steps: [
      "Log in as A, cancel the request on B's profile.",
      "Without refreshing, log in as B in a different browser/tab.",
      "Check B's notification bell.",
    ],
    expectedUI:
      "The 'A requested to join your circle' notification is either gone or marked as deleted in B's notification list.",
    expectedBackend:
      "notifications row for this pair: deleted_at is set.",
  },
  {
    id: "CIR-027",
    title: "Notification marked read after B accepts from bell",
    priority: "M",
    section: "Notification Disappearance After Actions",
    preconditions: "A has pending request to B.",
    steps: [
      "Log in as B, open notification bell, click Accept on A's request.",
      "Close and reopen the notification bell.",
    ],
    expectedUI:
      "The request notification no longer shows as unread (badge cleared). Notification may still be visible in read state, or it may disappear.",
    expectedBackend: "notifications: is_read=true for this notification row.",
  },
  {
    id: "CIR-028",
    title: "Resend after cancel — B gets a fresh notification, not a duplicated one",
    priority: "M",
    section: "Notification Disappearance After Actions",
    preconditions: "A previously cancelled a request to B (CIR-013 completed).",
    steps: [
      "Log in as A, resend the circle request to B.",
      "Log in as B and check notifications.",
    ],
    expectedUI:
      "B sees exactly ONE circle request notification from A. Not two (one for old, one for new).",
    expectedBackend:
      "notifications: same row updated (upserted) with deleted_at=null, not a new duplicate row.",
  },

  // ── Section 8: Stale Notification Handling ──────────────────────────────
  {
    id: "CIR-029",
    title: "Stale accept — A cancels request AFTER B opens notification but BEFORE B clicks Accept",
    priority: "H",
    section: "Stale Notification Handling",
    preconditions: "A has a pending request to B.",
    steps: [
      "Log in as B in Browser 1, open the notification (do NOT click Accept yet).",
      "Log in as A in Browser 2, cancel the request.",
      "In Browser 1, click Accept on the now-stale notification.",
    ],
    expectedUI:
      "Browser 1 shows an error or 'Request no longer available' message. B is NOT added to A's circle.",
    expectedBackend:
      "circle_memberships: no rows for this pair. circle_requests: row deleted (cancelled by A).",
  },
  {
    id: "CIR-030",
    title: "Stale reject — same timing scenario but B clicks Reject",
    priority: "M",
    section: "Stale Notification Handling",
    preconditions: "Same as CIR-029 — A cancelled after B opened the notification.",
    steps: [
      "Log in as B in Browser 1, open the notification (do NOT click Reject yet).",
      "Log in as A in Browser 2, cancel the request.",
      "In Browser 1, click Reject on the stale notification.",
    ],
    expectedUI:
      "Error or silent no-op (reject on non-existent pending request). No crash or misleading success message.",
    expectedBackend: "No new circle_requests or circle_memberships rows.",
  },
  {
    id: "CIR-031",
    title: "Stale notification after B already accepted via profile",
    priority: "M",
    section: "Stale Notification Handling",
    preconditions: "A sent request to B. B accepted via profile button (not via notification bell).",
    steps: [
      "B clicks Accept on the notification bell for the same request afterward.",
    ],
    expectedUI:
      "Idempotent — no error, state shows already-accepted/mutual. No duplicate circle edges created.",
    expectedBackend:
      "circle_memberships: still exactly two rows. No duplicates.",
  },
  {
    id: "CIR-032",
    title: "Accept rejected request is blocked",
    priority: "H",
    section: "Stale Notification Handling",
    preconditions: "A sent request to B; B rejected it (status=rejected). B tries to re-interact with the stale notification.",
    steps: [
      "Log in as B.",
      "If the notification is still in B's list, click Accept.",
    ],
    expectedUI:
      "Error shown: 'Request is no longer pending' or equivalent. No circle membership created.",
    expectedBackend:
      "circle_requests: status remains rejected. circle_memberships: no rows created.",
  },

  // ── Section 9: Page Refresh After Actions ───────────────────────────────
  {
    id: "CIR-033",
    title: "Refresh after Add (public) — 'In Circle' persists",
    priority: "H",
    section: "Page Refresh After Actions",
    smoke: true,
    preconditions: "A has just added a public account (button shows 'In Circle').",
    steps: [
      "Add a public account (button becomes 'In Circle').",
      "Hard-refresh the profile page.",
    ],
    expectedUI: "Button still reads 'In Circle' after refresh.",
    expectedBackend: "circle_memberships row persists.",
  },
  {
    id: "CIR-034",
    title: "Refresh after Request (private) — 'Requested' persists",
    priority: "H",
    section: "Page Refresh After Actions",
    preconditions: "A has just sent a request to a private account.",
    steps: [
      "Send request to private account (button becomes 'Requested').",
      "Hard-refresh the profile page.",
    ],
    expectedUI: "Button still reads 'Requested' after refresh.",
    expectedBackend: "circle_requests row with status=pending persists.",
  },
  {
    id: "CIR-035",
    title: "Refresh after Accept — mutual state persists",
    priority: "H",
    section: "Page Refresh After Actions",
    preconditions: "B just accepted A's request (button on A's profile shows 'Mutual').",
    steps: [
      "Accept A's request as B (button on A's profile becomes 'Mutual').",
      "Hard-refresh A's profile.",
    ],
    expectedUI: "Button still reads 'Mutual' after refresh.",
    expectedBackend: "Both circle_memberships rows persist.",
  },
  {
    id: "CIR-036",
    title: "Refresh after Cancel — button resets to 'Add' and persists",
    priority: "H",
    section: "Page Refresh After Actions",
    preconditions: "A has just cancelled a pending request (button reverted to 'Add').",
    steps: [
      "Cancel a pending request (button reverts to 'Add').",
      "Hard-refresh the profile page.",
    ],
    expectedUI: "Button still reads 'Add' after refresh, not 'Requested'.",
    expectedBackend: "No pending circle_requests row for this pair.",
  },
  {
    id: "CIR-037",
    title: "Refresh after Remove — button resets to 'Add' and persists",
    priority: "H",
    section: "Page Refresh After Actions",
    preconditions: "A has just removed someone from circle (button should revert to 'Add').",
    steps: [
      "Remove someone from circle (button reverts to 'Add').",
      "Hard-refresh the profile page.",
    ],
    expectedUI: "Button still reads 'Add' after refresh.",
    expectedBackend: "Relevant circle_memberships rows deleted.",
  },
  {
    id: "CIR-038",
    title: "Refresh after Reject — A's button shows 'Add' after reload",
    priority: "M",
    section: "Page Refresh After Actions",
    preconditions: "B has rejected A's request.",
    steps: [
      "B rejects A's request.",
      "A hard-refreshes B's profile page.",
    ],
    expectedUI: "A's button reads 'Add' (can resend) after refresh.",
    expectedBackend: "circle_requests row with status=rejected.",
  },

  // ── Section 10: Multi-Tab Stale State Behavior ──────────────────────────
  {
    id: "CIR-039",
    title: "Two tabs — accept in one tab, other tab still shows 'Requested'",
    priority: "M",
    section: "Multi-Tab Stale State Behavior",
    preconditions: "B has A's profile open in Tab 1 showing 'Requested'. Notification bell open in Tab 2.",
    steps: [
      "In Tab 2, accept A's request.",
      "Return to Tab 1 without refreshing.",
    ],
    expectedUI:
      "Tab 1 may still show 'Requested' (stale state — acceptable). After refreshing Tab 1, button updates to reflect accepted state. Mark FAIL only if Tab 1 shows an error or broken UI.",
    expectedBackend: "circle_memberships: both edges created.",
  },
  {
    id: "CIR-040",
    title: "Add on public profile in one tab — second tab reflects correct state",
    priority: "M",
    section: "Multi-Tab Stale State Behavior",
    preconditions: "User B's profile open in Tab 1 and Tab 2 (both showing 'Add').",
    steps: [
      "Click Add in Tab 1 (button becomes 'In Circle').",
      "In Tab 2, click Add again (stale state still shows 'Add').",
    ],
    expectedUI:
      "Tab 2 Add click should not create a duplicate membership. After Tab 2 refreshes, button shows 'In Circle'.",
    expectedBackend:
      "Still exactly one circle_memberships row (no duplicate).",
  },
  {
    id: "CIR-041",
    title: "Cancel in one tab while other tab still shows 'Requested'",
    priority: "M",
    section: "Multi-Tab Stale State Behavior",
    preconditions: "B's profile open in Tab 1 (shows 'Requested'). Tab 2 also open.",
    steps: [
      "Cancel the request in Tab 2.",
      "In Tab 1 (stale), click 'Requested' or interact with the button.",
    ],
    expectedUI:
      "No crash or console error visible to the user. After Tab 1 refreshes, button shows 'Add'.",
    expectedBackend: "circle_requests: row deleted or cancelled.",
  },
  {
    id: "CIR-042",
    title: "Remove in one tab — second tab still shows 'Mutual'",
    priority: "L",
    section: "Multi-Tab Stale State Behavior",
    preconditions: "Partner's profile open in two tabs, both showing 'Mutual'.",
    steps: [
      "Remove in Tab 1 (button reverts to 'Add').",
      "Click 'Mutual' button in Tab 2 (stale).",
    ],
    expectedUI:
      "Tab 2 action should not crash the UI. After Tab 2 refreshes, button shows 'Add'.",
    expectedBackend: "circle_memberships: edges deleted.",
  },

  // ── Section 11: Search Result Button States ──────────────────────────────
  {
    id: "CIR-043",
    title: "Search results show correct button for each relationship state",
    priority: "H",
    section: "Search Result Button States",
    preconditions:
      "Prepare test accounts: User X (no relationship), User Y (pending outgoing), User Z (mutual), User W (one-way in logged-in user's circle).",
    steps: [
      "Log in as the test user.",
      "Use the People search/explore to find each of X, Y, Z, W.",
      "Record the button shown next to each name in search results.",
    ],
    expectedUI:
      "Each user in search results shows the correct button matching their relationship. No state bleeds into another.",
    expectedBackend: "No change — read-only check.",
  },
  {
    id: "CIR-044",
    title: "Search result Add button — public account — works without navigating to profile",
    priority: "M",
    section: "Search Result Button States",
    preconditions: "A public account (User B) is visible in search results.",
    steps: [
      "Find User B in search results.",
      "Click 'Add' directly from the search results list (without opening profile).",
      "Observe the button state in search results.",
    ],
    expectedUI:
      "Button changes to 'In Circle' inline, without a page navigation.",
    expectedBackend: "circle_memberships row created.",
  },
  {
    id: "CIR-045",
    title: "Search result — private account button transitions to 'Requested'",
    priority: "M",
    section: "Search Result Button States",
    preconditions: "A private account is visible in search results.",
    steps: [
      "Find the private account in search results.",
      "Click the button to send a request.",
      "Observe the button in search results.",
    ],
    expectedUI:
      "Button changes to 'Requested' immediately in the search list.",
    expectedBackend: "circle_requests: pending row created.",
  },

  // ── Section 12: Profile Button States ───────────────────────────────────
  {
    id: "CIR-046",
    title: "Own profile — no circle button shown to yourself",
    priority: "H",
    section: "Profile Button States",
    preconditions: "User is logged in.",
    steps: [
      "Log in and navigate to your own profile.",
    ],
    expectedUI:
      "No 'Add' or circle button appears on your own profile. Edit profile or settings options may be shown instead.",
    expectedBackend: "No change — read-only.",
  },
  {
    id: "CIR-047",
    title: "Profile button updates after Remove without page reload",
    priority: "H",
    section: "Profile Button States",
    preconditions: "Logged-in user is in mutual circle with partner.",
    steps: [
      "Navigate to a mutual circle partner's profile.",
      "Click Remove / Leave circle.",
      "Observe the button without refreshing.",
    ],
    expectedUI:
      "Button immediately updates to 'Add' (or equivalent). No page reload needed.",
    expectedBackend: "circle_memberships: relevant rows deleted.",
  },
  {
    id: "CIR-048",
    title: "Profile button shows 'Accept Request' for incoming private requests",
    priority: "H",
    section: "Profile Button States",
    preconditions: "User B (private) sent a request to logged-in User A.",
    steps: [
      "Navigate to User B's profile as User A.",
    ],
    expectedUI:
      "Button reads 'Accept Request' (not 'Add'). Clicking the button accepts the request and both enter circle mutually.",
    expectedBackend:
      "On click: existing B→A request updated to accepted, mutual edges created.",
  },

  // ── Section 13: Public / Private Account Switch Behavior ────────────────
  {
    id: "CIR-049",
    title: "Public account switches to private — existing circle members retained",
    priority: "M",
    section: "Public / Private Account Switch Behavior",
    preconditions: "User B is public; User A is in B's circle (A joined B).",
    steps: [
      "Log in as B, switch account type to Private in settings.",
      "Log in as A, navigate to B's profile.",
    ],
    expectedUI:
      "A's button should still show 'In Circle' (A is already in B's circle). A does NOT need to re-request.",
    expectedBackend:
      "circle_memberships row (user_name=B, member_name=A) still exists.",
  },
  {
    id: "CIR-050",
    title: "Private account switches to public — pending requests unaffected",
    priority: "M",
    section: "Public / Private Account Switch Behavior",
    preconditions: "User B is private; User A sent a pending request to B.",
    steps: [
      "Log in as B, switch account type to Public in settings.",
      "Log in as A, navigate to B's profile.",
    ],
    expectedUI:
      "Pending request may still show as 'Requested' to A, or the system auto-accepts. Document actual observed behavior.",
    expectedBackend:
      "Document what happens to the pending circle_requests row after account type change.",
  },
  {
    id: "CIR-051",
    title: "New Add attempt after switching public → private requires approval",
    priority: "M",
    section: "Public / Private Account Switch Behavior",
    preconditions: "User B switched from public to private. User C has NO relationship with B.",
    steps: [
      "Log in as C, navigate to B's (now private) profile.",
      "Click Add.",
    ],
    expectedUI:
      "Button shows 'Requested' (not immediately 'In Circle'). B must approve C's request.",
    expectedBackend: "circle_requests: pending row created. No circle_memberships row yet.",
  },

  // ── Section 14: Common Restaurant Badge Visibility ───────────────────────
  {
    id: "CIR-052",
    title: "Common restaurant badge visible only to circle members",
    priority: "H",
    section: "Common Restaurant Badge Visibility",
    smoke: true,
    preconditions:
      "User A and User B have reviewed at least one common restaurant. User A is in User B's circle.",
    steps: [
      "Log in as User A (who is in B's circle).",
      "Navigate to User B's profile.",
      "Observe the area next to B's name for a restaurant count badge (e.g. '1 🧑‍🍳').",
      "Log out and log in as User C (no relationship with B).",
      "Navigate to User B's profile.",
    ],
    expectedUI:
      "Step 3: Badge IS visible to A (in B's circle) with correct common restaurant count. Step 5: Badge is NOT visible to C (not in B's circle).",
    expectedBackend: "No change — read-only visibility check.",
  },
  {
    id: "CIR-053",
    title: "Common restaurant badge — mutual circle both see badge on each other",
    priority: "M",
    section: "Common Restaurant Badge Visibility",
    preconditions: "A and B are in mutual circle, both have reviewed common restaurants.",
    steps: [
      "Log in as A, navigate to B's profile — note badge count.",
      "Log in as B, navigate to A's profile — note badge count.",
    ],
    expectedUI: "Both A and B see the badge on each other's profiles.",
    expectedBackend: "No change — read-only.",
  },
  {
    id: "CIR-054",
    title: "Common restaurant badge — not visible to sender before acceptance",
    priority: "H",
    section: "Common Restaurant Badge Visibility",
    preconditions: "A sent a pending request to B (private account). A and B have common restaurants.",
    steps: [
      "Log in as A and navigate to B's profile.",
    ],
    expectedUI:
      "Badge is NOT visible (A is not yet in B's circle). After B accepts, badge should appear.",
    expectedBackend: "No change — read-only.",
  },
  {
    id: "CIR-055",
    title: "Common restaurant badge — not visible after removal",
    priority: "H",
    section: "Common Restaurant Badge Visibility",
    preconditions: "A and B were in circle; A could see the badge on B's profile. A removes from B's circle.",
    steps: [
      "As A, remove from B's circle.",
      "Navigate to B's profile.",
    ],
    expectedUI: "Badge is no longer visible after removal.",
    expectedBackend: "circle_memberships: relevant row deleted.",
  },
  {
    id: "CIR-056",
    title: "Common restaurant badge — zero common restaurants shows no badge",
    priority: "M",
    section: "Common Restaurant Badge Visibility",
    preconditions: "A and B are in circle. A and B have NOT reviewed any common restaurants.",
    steps: [
      "Log in as A, navigate to B's profile.",
    ],
    expectedUI: "No badge appears (0 common restaurants → badge hidden).",
    expectedBackend: "No change — read-only.",
  },

  // ── Section 15: Circle-Only Post Visibility ──────────────────────────────
  {
    id: "CIR-057",
    title: "Circle-visibility post visible to mutual circle member",
    priority: "H",
    section: "Circle-Only Post Visibility",
    smoke: true,
    preconditions: "A and B are in mutual circle. B has a post with visibility = 'circle'.",
    steps: [
      "Log in as A and navigate to B's profile (or feed).",
    ],
    expectedUI: "B's circle-visibility post is visible to A.",
    expectedBackend: "No change — read-only.",
  },
  {
    id: "CIR-058",
    title: "Circle-visibility post NOT visible to non-member",
    priority: "H",
    section: "Circle-Only Post Visibility",
    preconditions: "User C has no relationship with B. B has a circle-visibility post.",
    steps: [
      "Log in as C and navigate to B's profile.",
    ],
    expectedUI: "B's circle post is NOT visible to C. Only B's public posts appear.",
    expectedBackend: "No change — read-only.",
  },
  {
    id: "CIR-059",
    title: "Circle post NOT visible to one who has NOT joined owner's circle as viewer",
    priority: "H",
    section: "Circle-Only Post Visibility",
    preconditions:
      "A joined B's circle (user_name=B, member_name=A). B has NOT joined A's circle. A has a circle-visibility post.",
    steps: [
      "Log in as B and navigate to A's profile.",
    ],
    expectedUI:
      "A's circle post is NOT visible to B. B is not a member of A's circle (user_name=A, member_name=B does not exist), so B cannot see A's circle posts.",
    expectedBackend: "No change — read-only.",
  },
  {
    id: "CIR-060",
    title: "Me-only post not visible to anyone including circle members",
    priority: "H",
    section: "Circle-Only Post Visibility",
    preconditions: "A and B are in mutual circle. B has a post with visibility = 'me' (only me).",
    steps: [
      "Log in as A, navigate to B's profile.",
    ],
    expectedUI: "B's 'me-only' post is NOT visible to A.",
    expectedBackend: "No change — read-only.",
  },
  {
    id: "CIR-061",
    title: "Circle post visibility survives page refresh",
    priority: "M",
    section: "Circle-Only Post Visibility",
    preconditions: "A can see B's circle post.",
    steps: [
      "Navigate to B's profile as A and confirm circle post is visible.",
      "Hard-refresh the page.",
    ],
    expectedUI: "Circle post remains visible after refresh.",
    expectedBackend: "No change.",
  },

  // ── Section 16: Public Post Visibility from Private Accounts ─────────────
  {
    id: "CIR-062",
    title: "Public posts from private accounts visible to everyone",
    priority: "H",
    section: "Public Post Visibility from Private Accounts",
    preconditions: "User B has a PRIVATE account. B has a post with visibility = 'public'.",
    steps: [
      "Log in as User C (no relationship with B).",
      "Navigate to B's profile.",
    ],
    expectedUI:
      "B's public post IS visible to C despite B having a private account. (Post visibility is determined by post setting, not account type.)",
    expectedBackend: "No change — read-only.",
  },
  {
    id: "CIR-063",
    title: "Private account public posts appear in global trending",
    priority: "M",
    section: "Public Post Visibility from Private Accounts",
    preconditions: "User B (private account) has a public post at a popular restaurant.",
    steps: [
      "Navigate to the trending page (without logging in, or as a non-circle user).",
      "Check if the restaurant appears in global trending.",
    ],
    expectedUI:
      "The restaurant DOES appear in global trending (driven by public posts, not account type).",
    expectedBackend: "No change — read-only.",
  },

  // ── Section 17: Trending Page Behavior ──────────────────────────────────
  {
    id: "CIR-064",
    title: "Circle feed shows posts from joined circles only",
    priority: "H",
    section: "Trending Page Behavior",
    preconditions: "A has joined B's and C's circles. A has NOT joined D's circle. B, C, D all have circle-visibility posts.",
    steps: [
      "Log in as A and navigate to the circle/trending feed.",
    ],
    expectedUI:
      "Posts from B and C appear in the circle feed. Posts from D do NOT appear.",
    expectedBackend: "No change — read-only.",
  },
  {
    id: "CIR-065",
    title: "Trending page updates after A joins a new circle",
    priority: "M",
    section: "Trending Page Behavior",
    preconditions: "A has not joined E's circle. E has circle-visibility posts.",
    steps: [
      "Log in as A, check the circle feed — confirm E's posts are absent.",
      "Add E (public) to circle.",
      "Return to circle feed (refresh if needed).",
    ],
    expectedUI: "E's circle posts now appear in A's feed after joining.",
    expectedBackend: "circle_memberships: (user_name=E, member_name=A) created.",
  },
  {
    id: "CIR-066",
    title: "Trending page updates after A removes from circle",
    priority: "M",
    section: "Trending Page Behavior",
    preconditions: "A has joined B's circle and B's posts appear in A's feed.",
    steps: [
      "Remove B from A's circle connections.",
      "Check the circle feed.",
    ],
    expectedUI: "B's circle posts NO LONGER appear in A's feed after removal.",
    expectedBackend: "circle_memberships: relevant row deleted.",
  },

  // ── Section 18: Remove from Circle ──────────────────────────────────────
  {
    id: "CIR-067",
    title: "Remove from public mutual circle — only removes A from B's circle",
    priority: "H",
    section: "Remove from Circle",
    smoke: true,
    preconditions: "Both A and B are public. A joined B's circle; B joined A's circle (mutual one-way-in-both-directions).",
    steps: [
      "Log in as A, navigate to B's profile.",
      "Click 'Remove' / 'Leave circle'.",
      "Observe the button state from A's perspective.",
      "Log in as B, navigate to A's profile.",
    ],
    expectedUI:
      "Step 3: A's button reverts to 'Add' (A left B's circle). Step 4: B's button on A's profile still shows 'In Circle' (B's membership in A's circle is untouched).",
    expectedBackend:
      "circle_memberships: (user_name=B, member_name=A) DELETED. (user_name=A, member_name=B) REMAINS intact.",
  },
  {
    id: "CIR-068",
    title: "Remove from private mutual circle — dissolves both edges",
    priority: "H",
    section: "Remove from Circle",
    preconditions: "Both A and B are private. A and B are in mutual circle (both edges exist).",
    steps: [
      "Log in as A, navigate to B's profile.",
      "Click Remove.",
      "Log in as B, navigate to A's profile and observe.",
    ],
    expectedUI:
      "Step 2: A's button reverts to 'Add'. Step 3: B's button on A's profile also reverts to 'Add' (B automatically removed from A's circle too).",
    expectedBackend:
      "circle_memberships: BOTH edges deleted. (user_name=A, member_name=B) DELETED AND (user_name=B, member_name=A) DELETED.",
  },
  {
    id: "CIR-069",
    title: "Remove from mixed private+public mutual — dissolves both edges",
    priority: "H",
    section: "Remove from Circle",
    preconditions: "User A is public, User B is private. A and B are in mutual circle.",
    steps: [
      "Log in as A, remove from circle (leave B's circle).",
      "Log in as B, navigate to A's profile.",
    ],
    expectedUI:
      "B's button on A's profile also shows 'Add' (both edges dissolved). Because either party being private triggers full dissolution on mutual remove.",
    expectedBackend: "circle_memberships: BOTH rows DELETED.",
  },
  {
    id: "CIR-070",
    title: "Remove flow — mutual private removes do not leave stale pending requests",
    priority: "M",
    section: "Remove from Circle",
    preconditions: "CIR-068 completed (both edges removed).",
    steps: [
      "As A, send a new request to B (now private again).",
      "Observe the button and request flow.",
    ],
    expectedUI:
      "A sees 'Requested' (new pending request sent). B must re-approve — A cannot instantly recreate mutual circle.",
    expectedBackend:
      "New circle_requests row with status=pending. No immediate circle_memberships row.",
  },
  {
    id: "CIR-071",
    title: "Remove does not affect third-party relationships",
    priority: "L",
    section: "Remove from Circle",
    preconditions: "A is in B's circle AND C's circle. A removes from B's circle.",
    steps: [
      "As A, remove from B's circle.",
      "Navigate to C's profile as A.",
    ],
    expectedUI: "A's relationship with C is unchanged (still 'In Circle' with C).",
    expectedBackend:
      "circle_memberships: only the B-related row deleted. C-related row untouched.",
  },

  // ── Section 19: Mobile Responsive Checks ────────────────────────────────
  {
    id: "CIR-072",
    title: "Profile circle button visible and tappable on mobile screen",
    priority: "H",
    section: "Mobile Responsive Checks",
    preconditions: "Test on actual mobile device or browser DevTools at 375px width (iPhone SE).",
    steps: [
      "Open a user profile page.",
      "Locate the Add / In Circle / Requested button.",
      "Verify it is not overlapping other UI elements.",
      "Tap the button.",
    ],
    expectedUI:
      "Button is fully visible and responds to tap. No overlap with name, avatar, or other elements. Button state updates after tap.",
    expectedBackend: "Same as desktop behavior.",
  },
  {
    id: "CIR-073",
    title: "Notification bell on mobile — circle request accept/reject work",
    priority: "H",
    section: "Mobile Responsive Checks",
    preconditions: "Test on mobile or DevTools at 375px. A pending request exists.",
    steps: [
      "Open notification bell on mobile.",
      "Tap Accept on a circle request notification.",
    ],
    expectedUI:
      "Accept/Reject buttons are tappable (not too small, not overlapping). Action completes and notification updates.",
    expectedBackend: "circle_memberships created, circle_requests updated.",
  },
  {
    id: "CIR-074",
    title: "People search on mobile — button states correct and usable",
    priority: "M",
    section: "Mobile Responsive Checks",
    preconditions: "Test on mobile or DevTools at 375px.",
    steps: [
      "Open the People / search page on mobile.",
      "Verify circle buttons next to search results are visible and tappable.",
    ],
    expectedUI: "Buttons are properly sized and not clipped or hidden.",
    expectedBackend: "No change — read-only.",
  },
  {
    id: "CIR-075",
    title: "Common restaurant badge renders correctly on mobile",
    priority: "M",
    section: "Mobile Responsive Checks",
    preconditions: "Test on mobile or DevTools at 375px. Viewing a circle member's profile.",
    steps: [
      "Navigate to a circle member's profile on mobile.",
      "Observe the badge area next to the name.",
    ],
    expectedUI:
      "Badge is visible and not overlapping with other content. Text is legible at small screen sizes.",
    expectedBackend: "No change — read-only.",
  },

  // ── Section 20: Negative and Error Cases ────────────────────────────────
  {
    id: "CIR-076",
    title: "Network failure during Add — UI shows error, does not leave ghost state",
    priority: "H",
    section: "Negative and Error Cases",
    preconditions: "Use browser DevTools to throttle network to 'Offline' or block the API.",
    steps: [
      "Navigate to a public user's profile.",
      "Enable network block in DevTools.",
      "Click Add.",
    ],
    expectedUI:
      "An error toast or message appears. Button does NOT remain in a loading/spinner state indefinitely. Button reverts to 'Add' after error (not stuck in 'In Circle').",
    expectedBackend: "No circle_memberships row created.",
  },
  {
    id: "CIR-077",
    title: "Network failure during Accept — notification not marked handled prematurely",
    priority: "H",
    section: "Negative and Error Cases",
    preconditions: "Block network in DevTools. A pending request notification is visible.",
    steps: [
      "Block network in DevTools.",
      "Click Accept on a circle request notification.",
    ],
    expectedUI:
      "Error shown to user. Notification still shows as pending/unread after failure. No circle membership created.",
    expectedBackend: "circle_requests: status remains pending. circle_memberships: no rows created.",
  },
  {
    id: "CIR-078",
    title: "Rapid double-click on Add button — no duplicate membership",
    priority: "M",
    section: "Negative and Error Cases",
    preconditions: "Logged in as A. Viewing a public user's profile.",
    steps: [
      "Navigate to a public user's profile.",
      "Double-click the Add button very quickly.",
    ],
    expectedUI: "Button transitions to 'In Circle' once. No visible error or glitch.",
    expectedBackend: "Exactly one circle_memberships row (no duplicate).",
  },
  {
    id: "CIR-079",
    title: "Rapid double-click on Send Request (private) — no duplicate request row",
    priority: "M",
    section: "Negative and Error Cases",
    preconditions: "Logged in as A. Viewing a private user's profile.",
    steps: [
      "Navigate to a private user's profile.",
      "Double-click the Send Request button quickly.",
    ],
    expectedUI: "Button shows 'Requested' once. No duplicate spinner or flash.",
    expectedBackend: "Exactly one circle_requests row with status=pending.",
  },
  {
    id: "CIR-080",
    title: "Logged-out user visits private profile — no Add button shown",
    priority: "H",
    section: "Negative and Error Cases",
    preconditions: "User is logged out.",
    steps: [
      "Log out.",
      "Navigate directly to a user's profile URL.",
    ],
    expectedUI:
      "No Add / circle button is shown, or user is redirected to login. No circle actions accessible to unauthenticated users.",
    expectedBackend: "No circle_memberships or circle_requests rows created.",
  },
  {
    id: "CIR-081",
    title: "Logged-out user visits public profile — cannot initiate circle action",
    priority: "H",
    section: "Negative and Error Cases",
    preconditions: "User is logged out.",
    steps: [
      "Log out.",
      "Navigate to a public user's profile.",
    ],
    expectedUI:
      "Either no circle button shown, or button clicking redirects to login page. No circle membership created for unauthenticated user.",
    expectedBackend: "No circle_memberships row created.",
  },
  {
    id: "CIR-082",
    title: "Add button works for names with spaces and special characters",
    priority: "M",
    section: "Negative and Error Cases",
    preconditions: "At least one user has a multi-word name (e.g., 'Alice Smith').",
    steps: [
      "Navigate to the profile of a user with a multi-word name.",
      "Click Add.",
    ],
    expectedUI:
      "Button transitions correctly. No encoding errors or 'user not found' messages.",
    expectedBackend:
      "circle_memberships row created with correct full name (e.g., member_name='Alice Smith').",
  },
  {
    id: "CIR-083",
    title: "Circle status loads correctly after navigating via browser Back button",
    priority: "M",
    section: "Negative and Error Cases",
    preconditions: "Logged in as A.",
    steps: [
      "Navigate to User B's profile (note button state).",
      "Navigate to another page.",
      "Press browser Back button to return to B's profile.",
    ],
    expectedUI:
      "Circle button shows correct state (not briefly flickering or showing wrong state).",
    expectedBackend: "No change.",
  },
  {
    id: "CIR-084",
    title: "Circle count in People tab is accurate",
    priority: "M",
    section: "Negative and Error Cases",
    preconditions: "Logged in as A with at least one circle member.",
    steps: [
      "Navigate to the People / Circle tab in the app.",
      "Observe the displayed circle count.",
      "Compare against number of visible circle members.",
    ],
    expectedUI:
      "Displayed count matches the actual number of people in your circle audience (your circle members, not the circles you've joined).",
    expectedBackend: "No change — read-only.",
  },
];
