import { useEffect, useState, type ReactNode } from "react";

type Props = {
  text: string;
  value: string;
  onChange: (text: string) => void;
  onEditingChange: (editing: boolean) => void;
  className: string;
  renderDisplay?: () => ReactNode;
};

export const EditableField = ({
  text,
  value,
  onChange,
  onEditingChange,
  className,
  renderDisplay,
}: Props) => {
  const [editing, setEditing] = useState(false);
  const [newValue, setNewValue] = useState(value);

  // biome-ignore lint/correctness/useExhaustiveDependencies: notify parent only on editing transitions, not when the callback identity changes
  useEffect(() => {
    onEditingChange(editing);
  }, [editing]);

  return editing ? (
    <div className={className}>
      <textarea
        value={newValue}
        onChange={(event) => setNewValue(event.target.value ?? "")}
      />
      <button
        type="button"
        onClick={() => {
          onChange(newValue);
          setEditing(false);
        }}
      >
        Save
      </button>
    </div>
  ) : (
    <div onClick={() => setEditing(true)} className={className}>
      {renderDisplay ? renderDisplay() : <p>{text}</p>}
    </div>
  );
};
