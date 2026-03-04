import { useEffect, useState } from "react";

type Props = {
  text: string;
  value: string;
  onChange: (text: string) => void;
  onEditingChange: (editing: boolean) => void;
  className: string;
};

export const EditableField = ({
  text,
  value,
  onChange,
  onEditingChange,
  className,
}: Props) => {
  const [editing, setEditing] = useState(false);
  const [newValue, setNewValue] = useState(value);

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
      <p>{text}</p>
    </div>
  );
};
