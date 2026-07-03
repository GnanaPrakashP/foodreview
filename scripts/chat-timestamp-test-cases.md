# Chat timestamp verification checklist

Seed the text cases with:

```sh
node scripts/seed-chat-timestamp-cases.mjs --list-rooms          # find the room id
node scripts/seed-chat-timestamp-cases.mjs --room <id> --me <your-username>
```

Then verify each item on the phone. The placement rule under test: **the line
under the last line of message text cuts the time in half**; only when the
last line has no room does the time drop to its own line, with a gap tighter
than normal line spacing. Clean up afterwards with `--cleanup`.

## Seeded text cases

### 1. Single-line, time beside the text
- [ ] "K", "Hi", "Asd", "Asdf", "On my way now" (sent): bubble grows to hold text + time, time half-cut by the text's bottom line
- [ ] "Hi", "Ok" (received): left side, colored sender name, initials avatar, same time placement
- [ ] Sent bubbles have the top-right tail on the first message of each group

### 2. Boundary stair (5 sent + 1 received, "The dosa here is…")
- [ ] Shorter ones: time beside the text
- [ ] Longer ones: time drops to its own line, right-aligned, tight gap (visibly tighter than the gap between two text lines)
- [ ] The transition point differs between sent and received (received has the avatar column) — both look clean
- [ ] None of them jiggle or resize while watching for ~1 minute

### 3. Unbroken words
- [ ] Single 31-char word: breaks mid-word, no dead band on the right
- [ ] Two-gibberish-words message (sent + received): greedy line filling, time placed correctly, bubble hugs its content

### 4. Multiline
- [ ] Biryani message ending with a short last line: time sits in the trailing gap of the last line — no extra line added
- [ ] Biryani message ending with a full last line: time on its own tight line, small gap between time and bubble bottom (same as other bubbles)
- [ ] "Order list:" with explicit newlines: 4 lines render, time after the short last line
- [ ] Very long paragraph (6+ lines): stable, time bottom-right

### 5. Special content
- [ ] Emoji-only and emoji+text: time beside
- [ ] Link message: link styled + tappable, wraps correctly, time placed correctly
- [ ] "Total was 1,240.50!!" and "OKAY WOW": time beside

### 6. Replies
- [ ] "Ok" replying to a long message: quote card spans the bubble, time at the **bubble's right edge** (not immediately after "Ok")
- [ ] Received long reply: quote card + body render, time normal

### 7. Edited label
- [ ] "This message was edited after sending": shows the wide "edited h:mm" label without overlapping or clipping

### 8. Grouping
- [ ] "One/Two/Three/Four" run: tail on the first only, tight corners between, each shows its own time
- [ ] "A?/B/C?/D" alternation: sender name reappears on every received group start

### 9. Day boundary
- [ ] "Late night one" and "Past midnight" sit on opposite sides of a date divider; the later one starts a fresh group (tail again)

### 10. Sanitization
- [ ] The whitespace-only message does **not** appear anywhere

### 12. Short lines via explicit newlines
- [ ] "Jssjdj / Sbdjdbdk / Jdndjx / Jxjd" (sent + received): bubble hugs the longest line, time on its own line **tight** under the last word — no dead line of space above the time

### 11. Sender-name lengths (received bubbles)
- [ ] "Hi" under **Priya Nair**, **Siddharth Rao**, and **Ananya Krishnan**: bubble width driven by the name, time still at the **bubble's** bottom-right edge (not stuck after "Hi")
- [ ] "Same" under the longest name: same rule
- [ ] Text ≈ name width ("Priya here ok"): no awkward gap either side
- [ ] Multiline text wider than the name: normal placement
- [ ] Ananya's "One / Two more / Three" run: header only on the first; follow-ups hug their own text+time (narrower bubbles are fine — each time at its own bubble edge)
- [ ] Ananya's "Yes" reply quoting "Done?": name header + quote card + 3-char body — time at the bubble edge

## Manual cases (cannot be seeded by the script)

- [ ] Photo without caption: time overlaid on the photo (bottom-right), no duplicate time
- [ ] Photo + short caption: caption under photo, time beside caption
- [ ] Photo + long caption (3+ lines): caption wraps at photo width, time placement follows the same rule
- [ ] Multi-photo (2, 3, 4+) grid, with and without caption
- [ ] Voice/audio message time placement
- [ ] Dish added: system pill renders, tapping opens the dish
- [ ] Send a message while on airplane mode: pending → failed/sent states look right
- [ ] Edit a message from the UI: label switches to "edited h:mm" and re-measures cleanly
- [ ] Live sends: send 5 messages rapidly — grouping/tails/times correct as they arrive

## Environment sweeps (repeat a quick scroll-through for each)

- [ ] Dark theme and light theme
- [ ] Device font size set to largest (Settings → Display → Font size) — the whole rule must still hold
- [ ] Leave the chat open and idle for 2 minutes: nothing oscillates
- [ ] Scroll far up, then back down: re-mounted bubbles settle instantly without visible reflow
- [ ] Rotate / split-screen (if supported): bubbles re-lay out sanely
