import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
} from "react";
import { cx } from "./contained";
import styles from "./Field.module.css";

export type FieldProps = InputHTMLAttributes<HTMLInputElement>;

/** A text or number input. Label it with a SectionLabel as="label" or aria-label. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(styles.field, className)} {...rest} />;
});

export type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement>;

/** A native select in the field frame. */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  function SelectField({ className, ...rest }, ref) {
    return (
      <select ref={ref} className={cx(styles.field, className)} {...rest} />
    );
  },
);

export type ColourFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
>;

/** A native colour picker drawn as a swatch the size of a control. */
export const ColourField = forwardRef<HTMLInputElement, ColourFieldProps>(
  function ColourField({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        type="color"
        className={cx(styles.colour, className)}
        {...rest}
      />
    );
  },
);
