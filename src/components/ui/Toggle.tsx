import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  useId,
} from "react";
import { cx } from "./contained";
import styles from "./Toggle.module.css";

export interface ToggleProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> {
  /** The visible label and the control's name. */
  label: ReactNode;
  /** A line under the label, read as the control's description. */
  description?: ReactNode;
  /** checkbox for an on/off option; radio for one of a set. */
  type?: "checkbox" | "radio";
}

/** An on/off option, or one of a set, as a framed labelled row. */
export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(function Toggle(
  { label, description, type = "checkbox", className, ...rest },
  ref,
) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <label className={cx(styles.toggle, className)}>
      <input
        ref={ref}
        type={type}
        className={styles.input}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        {...rest}
      />
      <span className={styles.text}>
        <span id={labelId}>{label}</span>
        {description && (
          <span id={descriptionId} className={styles.description}>
            {description}
          </span>
        )}
      </span>
    </label>
  );
});
