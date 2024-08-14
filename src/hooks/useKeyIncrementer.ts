import { useState } from "react";

export const useKeyIncrementer = (prefix: string) => {
  const [key, setKey] = useState(0);

  const increment = () => setKey((k) => k + 1);

  return [prefix + "-" + key, increment] as const;
};
