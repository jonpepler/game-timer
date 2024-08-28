import { useState } from "react";

export const useImmutableList = <T>(startingList: T[] = []) => {
  const [list, setList] = useState<T[]>(startingList);

  const add = (value: T) => {
    setList((currentList) => [...currentList, value]);
  };

  return [list, add] as const;
};
