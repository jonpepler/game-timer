import type { MouseEvent, MouseEventHandler } from "react";

/**
 * Wraps a click handler so the click ends at the kit control. The timer
 * advances a turn on a tap that reaches its ring, and a tap on any kit
 * control must never count as one.
 */
export const contained =
  <T extends Element>(handler?: MouseEventHandler<T>) =>
  (event: MouseEvent<T>) => {
    event.stopPropagation();
    handler?.(event);
  };

/** Joins the class names that are set. */
export const cx = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).join(" ");
