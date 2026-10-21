---
name: collecting-design-feedback
description: Use when the user needs to review designs, prototypes, options, screenshots or videos and give per-item feedback, especially later or without a live session, or asks for a review page, a checklist to mark items pass or picked, or feedback they can hand back
---

# Collecting design feedback

## Overview

A local HTML page with one card per item: what it is, its weaknesses, questions, media, a checkbox and a notes box. Feedback saves in the browser as they type and comes back to you as a downloaded JSON file. Works for any design or review loop, not only game configs.

The page is local only. Never publish it with the Artifact tool or any other host: drafts, screenshots and notes stay on the user's machine, and the JSON file is the hand-back.

## Build it

```bash
python3 -I .claude/skills/collecting-design-feedback/review-page.py manifest.json <out_dir>
```

Copies media into `<out_dir>/media` and writes `<out_dir>/index.html`. Give the user the absolute path to `index.html` to open in a browser.

## Manifest

| Field | Meaning |
|---|---|
| `title` | Page heading |
| `storage_key` | localStorage key. Unique per review round (`review:<topic>:<round>`) so a new round does not inherit old ticks |
| `meta` | Copied into the JSON. `reviewId` is required and names the download (`<reviewId>-feedback.json`) |
| `check_label` | Checkbox label. `"Pass"` (default) when each item is approved or not, `"Pick"` when the user chooses among options |
| `intro_html` | Context at the top: what changed, how to review |
| `sections[]` | `id`, `title`, `summary`, `items[]` |
| `items[]` | `id` (short, quotable like `B2`), `title`, `summary`, `weaknesses[]`, `questions[]`, `media[{src, caption, kind?}]`, `options[{id, label}]` |

`options` renders one pick checkbox per option beside the item's pass box and notes; ticks export as `picks`. Use it when an item asks the user to choose between alternatives (label them `A`, `B`, `C` and show each in the media).

`kind` is `phone` or `wide`; it is inferred from `phone` in the filename. Media: PNG, JPG, `webm`, `mp4`.

## Content

- One item per decision or reviewable thing, so one checkbox means one answer
- Weaknesses first and honest; the page is where the user finds them
- Phone (390x844) and desktop evidence for anything on screen

## After the JSON comes back

Read every item's `pass`, `picks` and `notes`. A pick with an unticked pass usually means "this one, with the changes in the notes". Unticked items and notes are the work list; reply with what you will change per item id. The next round is a new `storage_key` and `reviewId`.

**Next:** return to the skill that sent you; its step after the review names where to go. Used on its own, act on the feedback and stop.
