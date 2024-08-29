import { useEffect, useState } from "react";

type Props = {
  text: string;
  value: string;
  onChange: (text: string) => void;
  onEditingChange: (editing: boolean) => void;
};

export const EditableField = ({
  text,
  value,
  onChange,
  onEditingChange,
}: Props) => {
  const [editing, setEditing] = useState(false);
  const [newValue, setNewValue] = useState(value);

  useEffect(() => {
    onEditingChange(editing);
  }, [editing]);

  return editing ? (
    <>
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
    </>
  ) : (
    <div onClick={() => setEditing(true)}>
      <p>{text}</p>
    </div>
  );
};
